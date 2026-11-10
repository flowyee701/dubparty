import {
  assignTroupes,
  canVoteFor,
  charactersOf,
  computeRoundScore,
  eligibleTargets,
  LIMITS,
  lineWindows,
  positionAt,
  VOTE_CATEGORIES,
  type CastVote,
  type EffectId,
  type EntryPublic,
  type GameMode,
  type HistoryRound,
  type Phase,
  type PlaybackControl,
  type PlaybackState,
  type RoundScore,
  type RoundState,
  type TakeStatus,
  type Troupe,
  type VoteCategory,
  type VoteTarget,
} from '@dubparty/shared';
import { AppError } from '../util/errors';
import { newId, shuffle } from '../util/ids';
import { roomPrefix } from './manager';
import type { Room } from './room';
import type { GameHandle, PlayableClip, PlayablePack } from './types';

interface TakeRecord {
  status: TakeStatus;
  errorCode?: string;
  /** Номер попытки: результат устаревшей обработки отбрасывается. */
  seq: number;
  uploads: number;
  rawKey: string | null;
  voiceKey: string | null;
  pending: Promise<void> | null;
}

interface EntryRecord extends EntryPublic {
  key: string;
}

interface RoundRecord {
  index: number;
  mode: GameMode;
  clip: PlayableClip;
  troupes: Troupe[] | null;
  takes: Map<string, TakeRecord>;
  entries: EntryRecord[];
  playback: PlaybackState | null;
  targets: VoteTarget[];
  votes: Map<string, Partial<Record<VoteCategory, string>>>;
  /** Голоса зрителей: имя зрителя → идентификатор цели. */
  audience: Map<string, string>;
  results: RoundScore | null;
}

export function mediaUrl(key: string): string {
  return `/api/media/${key}`;
}

export const TAKE_EXTENSIONS = ['webm', 'mp4', 'wav', 'ogg'] as const;
export type TakeExtension = (typeof TAKE_EXTENSIONS)[number];

/**
 * Одна игра в комнате: раунды, фазы, дубли, просмотр, голосование, очки.
 * Вся логика и все таймеры — здесь, на сервере; клиенты только присылают намерения.
 */
export class GameSession implements GameHandle {
  phase: Phase = 'intro';
  phaseEndsAt: number | null = null;
  roundIndex = 0;
  readonly totalRounds: number;

  private readonly rounds: RoundRecord[] = [];
  private clipQueue: PlayableClip[] = [];
  private timer: NodeJS.Timeout | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private playbackRev = 0;

  constructor(
    private readonly room: Room,
    private readonly pack: PlayablePack,
  ) {
    this.totalRounds = room.settings.rounds;
  }

  private get deps() {
    return this.room.deps;
  }

  private get round(): RoundRecord {
    return this.rounds[this.roundIndex]!;
  }

  // ── Фазы ────────────────────────────────────────────────────────────────

  begin(): void {
    this.startRound(0);
  }

  private setPhase(
    phase: Phase,
    durationMs: number | null,
    onTimeout?: () => void,
    extraMs = 0,
  ): void {
    this.clearTimer();
    this.phase = phase;
    this.phaseEndsAt = durationMs === null ? null : Date.now() + durationMs;
    if (durationMs !== null && onTimeout) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.disposed) onTimeout();
      }, durationMs + extraMs);
    }
    this.room.touch();
    this.room.changed();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private nextClip(mode: GameMode): PlayableClip {
    if (this.clipQueue.length === 0) {
      const shuffled = shuffle(this.pack.clips, this.deps.rng);
      // Для режима ролей сначала идут клипы, где есть кого делить.
      this.clipQueue =
        mode === 'roles'
          ? [
              ...shuffled.filter((c) => c.characters.length > 1),
              ...shuffled.filter((c) => c.characters.length <= 1),
            ]
          : shuffled;
    }
    return this.clipQueue.shift()!;
  }

  private startRound(index: number): void {
    const mode = this.room.settings.mode;
    const clip = this.nextClip(mode);
    const playerIds = shuffle(
      this.room.activePlayers.map((p) => p.id),
      this.deps.rng,
    );
    this.roundIndex = index;
    this.rounds[index] = {
      index,
      mode,
      clip,
      troupes:
        mode === 'roles'
          ? assignTroupes(
              playerIds,
              clip.characters.map((c) => c.id),
            )
          : null,
      takes: new Map(),
      entries: [],
      playback: null,
      targets: [],
      votes: new Map(),
      audience: new Map(),
      results: null,
    };
    this.setPhase('intro', this.deps.timings.introMs, () => this.startRecording());
  }

  private startRecording(): void {
    const { timings } = this.deps;
    const durationMs = Math.max(
      this.room.settings.recordSeconds * 1000,
      this.round.clip.durationMs + timings.recordMinExtraMs,
    );
    // Таймер срабатывает чуть позже видимого дедлайна: клиенты успевают дослать дубли.
    this.setPhase('recording', durationMs, () => void this.endRecording(), timings.recordGraceMs);
  }

  private async endRecording(): Promise<void> {
    if (this.phase !== 'recording') return;
    const round = this.round;
    this.setPhase('processing', null);

    const pending = [...round.takes.values()].flatMap((t) => (t.pending ? [t.pending] : []));
    await this.withTimeout(Promise.allSettled(pending), this.deps.timings.processingMaxMs);
    if (this.stale(round, 'processing')) return;

    await this.withTimeout(this.buildEntries(round), this.deps.timings.processingMaxMs);
    if (this.stale(round, 'processing')) return;

    if (round.entries.length === 0) this.finishRound();
    else this.startPlayback();
  }

  private stale(round: RoundRecord, phase: Phase): boolean {
    return this.disposed || this.round !== round || this.phase !== phase;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
    let handle: NodeJS.Timeout;
    const timeout = new Promise<void>((resolve) => {
      handle = setTimeout(resolve, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
  }

  private async buildEntries(round: RoundRecord): Promise<void> {
    const ready = (playerId: string) => {
      const take = round.takes.get(playerId);
      return take?.status === 'ready' && take.voiceKey ? take.voiceKey : null;
    };

    const drafts: { authorIds: string[]; voiceKeys: string[] }[] = [];
    if (round.troupes) {
      for (const troupe of round.troupes) {
        const members = troupe.members.filter((m) => ready(m.playerId));
        if (members.length > 0) {
          drafts.push({
            authorIds: members.map((m) => m.playerId),
            voiceKeys: members.map((m) => ready(m.playerId)!),
          });
        }
      }
    } else {
      for (const [playerId] of round.takes) {
        const voiceKey = ready(playerId);
        if (voiceKey) drafts.push({ authorIds: [playerId], voiceKeys: [voiceKey] });
      }
    }

    const built = await Promise.all(
      shuffle(drafts, this.deps.rng).map(async (draft): Promise<EntryRecord | null> => {
        const id = newId();
        const key = `${roomPrefix(this.room.code)}/r${round.index}/entries/${id}.mp4`;
        try {
          await this.deps.media.buildReview({
            videoKey: round.clip.videoKey,
            hasMusic: round.clip.hasMusic,
            voiceKeys: draft.voiceKeys,
            outKey: key,
            durationMs: round.clip.durationMs,
          });
          this.room.fileCount += 1;
          return {
            id,
            key,
            authorIds: draft.authorIds,
            url: mediaUrl(key),
            durationMs: round.clip.durationMs,
          };
        } catch (err) {
          // Одна неудачная сборка не должна срывать раунд остальным.
          this.deps.logger.error({ err, room: this.room.code }, 'review build failed');
          return null;
        }
      }),
    );
    round.entries = built.filter((e): e is EntryRecord => e !== null);
  }

  // ── Дубли ───────────────────────────────────────────────────────────────

  /** Проверки до приёма файла: фаза, раунд, лимиты. Возвращает ключ для сырого файла. */
  prepareTake(
    playerId: string,
    roundIndex: number,
    ext: TakeExtension,
  ): { rawKey: string; seq: number } {
    this.room.requirePlayer(playerId);
    if (this.phase !== 'recording' || roundIndex !== this.roundIndex) {
      throw new AppError('BAD_PHASE', 'Recording is over');
    }
    const take = this.round.takes.get(playerId);
    if ((take?.uploads ?? 0) >= LIMITS.takesPerPlayerPerRound) {
      throw new AppError('LIMIT_REACHED', 'Too many takes this round');
    }
    const { limits } = this.deps;
    if (this.room.fileCount >= limits.maxRoomFiles || this.room.fileBytes >= limits.maxRoomBytes) {
      throw new AppError('LIMIT_REACHED', 'Room storage limit reached');
    }
    const seq = (take?.seq ?? 0) + 1;
    const rawKey = `${roomPrefix(this.room.code)}/r${roundIndex}/takes/${playerId}-${seq}.${ext}`;
    return { rawKey, seq };
  }

  /**
   * Принимает загруженный дубль и запускает обработку. Промис завершается, когда дубль
   * обработан (или обработка не удалась) — HTTP-обработчик ждёт его, чтобы сразу сообщить итог.
   */
  async submitTake(
    playerId: string,
    input: { rawKey: string; seq: number; size: number; offsetMs: number; effect: EffectId },
  ): Promise<{ status: TakeStatus; errorCode?: string }> {
    const round = this.round;
    if (this.phase !== 'recording') throw new AppError('BAD_PHASE', 'Recording is over');

    const previous = round.takes.get(playerId);
    const take: TakeRecord = {
      status: 'processing',
      seq: input.seq,
      uploads: (previous?.uploads ?? 0) + 1,
      rawKey: input.rawKey,
      voiceKey: null,
      pending: null,
    };
    round.takes.set(playerId, take);
    this.room.fileCount += 1;
    this.room.fileBytes += input.size;
    this.notifyTake(playerId, round, take);
    this.room.changed();

    const voiceKey = input.rawKey.replace(/\.[a-z0-9]+$/, '.voice.wav');
    const characterIds = round.troupes ? charactersOf(round.troupes, playerId) : null;
    const effect = this.room.settings.effectsEnabled ? input.effect : 'none';

    take.pending = this.deps.media
      .processTake({
        rawKey: input.rawKey,
        outKey: voiceKey,
        offsetMs: input.offsetMs,
        effect,
        durationMs: round.clip.durationMs,
        windows: characterIds
          ? lineWindows(round.clip.lines, characterIds, round.clip.durationMs)
          : undefined,
      })
      .then(
        () => {
          take.status = 'ready';
          take.voiceKey = voiceKey;
          this.room.fileCount += 1;
        },
        (err: unknown) => {
          take.status = 'failed';
          take.errorCode = err instanceof AppError ? err.code : 'PROCESSING_FAILED';
          this.deps.logger.warn({ err, room: this.room.code }, 'take processing failed');
        },
      )
      .finally(() => {
        take.pending = null;
      });
    await take.pending;

    // Пока шла обработка, игрок мог прислать новый дубль — тогда этот уже не нужен.
    if (round.takes.get(playerId) === take && !this.disposed) {
      this.notifyTake(playerId, round, take);
      this.room.changed();
      if (this.phase === 'recording' && this.round === round) this.checkAllSubmitted();
    }
    return { status: take.status, errorCode: take.errorCode };
  }

  private notifyTake(playerId: string, round: RoundRecord, take: TakeRecord): void {
    this.deps.onTakeStatus(this.room, playerId, {
      roundIndex: round.index,
      status: take.status,
      errorCode: take.errorCode,
    });
  }

  private checkAllSubmitted(): void {
    if (this.phase !== 'recording') return;
    const waiting = this.room.connectedPlayers;
    if (waiting.length === 0) return;
    if (waiting.every((p) => this.round.takes.get(p.id)?.status === 'ready')) {
      void this.endRecording();
    }
  }

  // ── Просмотр ────────────────────────────────────────────────────────────

  private startPlayback(): void {
    this.setPhase('playback', null);
    this.showEntry(0);
  }

  private showEntry(entryIndex: number): void {
    this.setPlayback({
      entryIndex,
      playing: true,
      positionMs: 0,
      // Позиция привязана к моменту в будущем: до него клиенты показывают заставку.
      serverTime: Date.now() + this.deps.timings.playbackPrerollMs,
    });
  }

  private setPlayback(state: Omit<PlaybackState, 'rev'>): void {
    const round = this.round;
    round.playback = { ...state, rev: ++this.playbackRev };
    this.clearTimer();
    if (state.playing) {
      const entry = round.entries[state.entryIndex]!;
      const untilEnd = state.serverTime - Date.now() + (entry.durationMs - state.positionMs);
      this.timer = setTimeout(
        () => {
          this.timer = null;
          if (!this.disposed && this.phase === 'playback') this.advance(1);
        },
        Math.max(0, untilEnd) + this.deps.timings.playbackGapMs,
      );
    }
    this.deps.onPlayback(this.room, round.playback);
    this.room.touch();
    this.room.changed();
  }

  private advance(step: 1 | -1): void {
    const round = this.round;
    const next = (round.playback?.entryIndex ?? 0) + step;
    if (next >= round.entries.length) this.startVoting();
    else this.showEntry(Math.max(0, next));
  }

  playbackControl(playerId: string, control: PlaybackControl): void {
    this.room.requireHost(playerId);
    this.room.requirePhase('playback');
    const round = this.round;
    const current = round.playback!;
    const entry = round.entries[current.entryIndex]!;
    const now = Date.now();
    const position = positionAt(current, now, entry.durationMs);

    switch (control.action) {
      case 'play':
        if (!current.playing) {
          this.setPlayback({
            entryIndex: current.entryIndex,
            playing: true,
            positionMs: position >= entry.durationMs ? 0 : position,
            serverTime: now,
          });
        }
        break;
      case 'pause':
        if (current.playing) {
          this.setPlayback({
            entryIndex: current.entryIndex,
            playing: false,
            positionMs: position,
            serverTime: now,
          });
        }
        break;
      case 'seek':
        this.setPlayback({
          entryIndex: current.entryIndex,
          playing: current.playing,
          positionMs: Math.min(control.positionMs, entry.durationMs),
          serverTime: now,
        });
        break;
      case 'next':
        this.advance(1);
        break;
      case 'prev':
        this.advance(-1);
        break;
      case 'finish':
        this.startVoting();
        break;
    }
  }

  // ── Голосование ─────────────────────────────────────────────────────────

  private buildTargets(round: RoundRecord): VoteTarget[] {
    const [only] = round.entries;
    // Единственная труппа: голосовать «за запись» некому, поэтому выбирают участника.
    if (round.troupes && round.entries.length === 1 && only && only.authorIds.length > 1) {
      return only.authorIds.map((playerId) => ({
        id: `p_${playerId}`,
        authorIds: [playerId],
        entryId: only.id,
      }));
    }
    return round.entries.map((e) => ({ id: e.id, authorIds: e.authorIds, entryId: e.id }));
  }

  private startVoting(): void {
    const round = this.round;
    this.clearTimer();
    round.playback = null;
    round.targets = this.buildTargets(round);
    const anyoneCanVote = this.room.activePlayers.some(
      (p) => eligibleTargets(round.targets, p.id).length > 0,
    );
    if (!anyoneCanVote) {
      this.finishRound();
      return;
    }
    this.setPhase('voting', this.deps.timings.votingMs, () => this.finishRound());
  }

  castVote(playerId: string, category: VoteCategory, targetId: string): void {
    this.room.requirePlayer(playerId);
    this.room.requirePhase('voting');
    const round = this.round;
    const target = round.targets.find((t) => t.id === targetId);
    if (!target) throw new AppError('NOT_FOUND', 'Unknown vote target');
    if (!canVoteFor(target, playerId))
      throw new AppError('SELF_VOTE', 'You cannot vote for yourself');

    round.votes.set(playerId, { ...round.votes.get(playerId), [category]: targetId });
    this.room.touch();
    this.room.changed();
    this.checkAllVoted();
  }

  /** Голос зрителя Twitch: вариант — номер цели с единицы. Учитывается последний голос зрителя. */
  audienceVote(user: string, choice: number): void {
    if (this.phase !== 'voting') return;
    const round = this.round;
    const target = round.targets[choice - 1];
    if (!target) return;
    const isNew = !round.audience.has(user);
    if (isNew && round.audience.size >= 50_000) return;
    round.audience.set(user, target.id);
    if (isNew) this.room.changed();
  }

  private hasVotedFully(round: RoundRecord, playerId: string): boolean {
    if (eligibleTargets(round.targets, playerId).length === 0) return true;
    const votes = round.votes.get(playerId);
    return VOTE_CATEGORIES.every((c) => votes?.[c]);
  }

  private checkAllVoted(): void {
    if (this.phase !== 'voting') return;
    const waiting = this.room.connectedPlayers;
    if (waiting.length === 0) return;
    if (waiting.every((p) => this.hasVotedFully(this.round, p.id))) {
      // Небольшая пауза, чтобы последний проголосовавший увидел свой выбор.
      this.clearTimer();
      this.phaseEndsAt = Date.now() + 800;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.disposed && this.phase === 'voting') this.finishRound();
      }, 800);
      this.room.changed();
    }
  }

  private finishRound(): void {
    const round = this.round;
    const votes: CastVote[] = [];
    for (const [voterId, byCategory] of round.votes) {
      // Голоса ушедших игроков не считаются.
      if (this.room.getPlayer(voterId)?.left) continue;
      for (const category of VOTE_CATEGORIES) {
        const targetId = byCategory[category];
        if (targetId) votes.push({ voterId, category, targetId });
      }
    }
    const audience: Record<string, number> = {};
    for (const targetId of round.audience.values()) {
      audience[targetId] = (audience[targetId] ?? 0) + 1;
    }

    round.results = computeRoundScore({
      targets: round.targets,
      votes,
      audience,
      playerIds: this.room.activePlayers.map((p) => p.id),
    });
    for (const [playerId, delta] of Object.entries(round.results.deltas)) {
      const player = this.room.getPlayer(playerId);
      if (player) player.score += delta.total;
    }
    this.setPhase('results', this.deps.timings.resultsMs, () => this.nextRound());
  }

  continuePhase(playerId: string): void {
    this.room.requireHost(playerId);
    this.room.requirePhase('results');
    this.nextRound();
  }

  private nextRound(): void {
    const canContinue =
      this.roundIndex + 1 < this.totalRounds && this.room.activePlayers.length >= 2;
    if (canContinue) this.startRound(this.roundIndex + 1);
    else this.finishGame();
  }

  private finishGame(): void {
    if (this.phase === 'final') return;
    this.clearTimer();
    this.room.endedAt = Date.now();
    this.setPhase('final', null);
    this.deps.onEnded(this.room);
  }

  // ── Реакция на игроков ──────────────────────────────────────────────────

  onPlayerGone(playerId: string): void {
    if (this.phase === 'final') return;
    this.round.votes.delete(playerId);
    if (this.room.activePlayers.length < 2) {
      // Играть больше не с кем — показываем итоги тем, кто остался.
      this.finishGame();
      return;
    }
    this.recheckWaiting();
  }

  onPresenceChange(): void {
    // Отключение часто оказывается обновлением страницы, поэтому не спешим:
    // даём игроку время вернуться, прежде чем перестать его ждать.
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      if (!this.disposed) this.recheckWaiting();
    }, 10_000);
  }

  private recheckWaiting(): void {
    if (this.phase === 'recording') this.checkAllSubmitted();
    else if (this.phase === 'voting') this.checkAllVoted();
  }

  // ── Чтение ──────────────────────────────────────────────────────────────

  findEntry(entryId: string): { round: number; entry: EntryRecord; clipTitle: string } | null {
    for (const round of this.rounds) {
      const entry = round.entries.find((e) => e.id === entryId);
      if (entry) return { round: round.index, entry, clipTitle: round.clip.title };
    }
    return null;
  }

  entriesOf(roundIndex: number): { entries: EntryRecord[]; clipTitle: string } | null {
    const round = this.rounds[roundIndex];
    // Записи текущего раунда доступны только после того, как их показали.
    if (!round || !this.entriesVisible(round)) return null;
    return { entries: round.entries, clipTitle: round.clip.title };
  }

  private entriesVisible(round: RoundRecord): boolean {
    if (round.index < this.roundIndex) return true;
    return ['playback', 'voting', 'results', 'final'].includes(this.phase);
  }

  private toPublicEntry(e: EntryRecord): EntryPublic {
    return { id: e.id, authorIds: e.authorIds, url: e.url, durationMs: e.durationMs };
  }

  roundStateFor(playerId: string): RoundState | null {
    const round = this.rounds[this.roundIndex];
    if (!round) return null;
    const take = round.takes.get(playerId);
    const visible = this.entriesVisible(round);
    const votingOpen =
      this.phase === 'voting' || this.phase === 'results' || this.phase === 'final';
    return {
      index: round.index,
      mode: round.mode,
      clip: {
        id: round.clip.id,
        title: round.clip.title,
        videoUrl: mediaUrl(round.clip.videoKey),
        posterUrl: mediaUrl(round.clip.posterKey),
        hasMusic: round.clip.hasMusic,
        durationMs: round.clip.durationMs,
        characters: round.clip.characters,
        lines: round.mode === 'free' ? [] : round.clip.lines,
      },
      troupes: round.troupes,
      submittedIds: [...round.takes].filter(([, t]) => t.status === 'ready').map(([id]) => id),
      yourTake: take ? { status: take.status, errorCode: take.errorCode } : { status: 'none' },
      entries: visible ? round.entries.map((e) => this.toPublicEntry(e)) : [],
      playback: this.phase === 'playback' ? round.playback : null,
      voteTargets: votingOpen ? round.targets : [],
      // Чужие голоса до подведения итогов не раскрываются.
      yourVotes: round.votes.get(playerId) ?? {},
      votedIds: votingOpen
        ? this.room.activePlayers.filter((p) => this.hasVotedFully(round, p.id)).map((p) => p.id)
        : [],
      audienceVotes: round.audience.size,
      results: this.phase === 'results' || this.phase === 'final' ? round.results : null,
    };
  }

  history(): HistoryRound[] {
    return this.rounds
      .filter((r) => this.entriesVisible(r) && r.entries.length > 0)
      .map((r) => ({
        index: r.index,
        clipTitle: r.clip.title,
        mode: r.mode,
        entries: r.entries.map((e) => this.toPublicEntry(e)),
      }));
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
  }
}
