import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  NICKNAME_MAX,
  type Phase,
  type Profile,
  type PublicPlayer,
  type RoomState,
  type Settings,
  type TwitchState,
} from '@dubparty/shared';
import { AppError } from '../util/errors';
import { hashToken, newId, newToken } from '../util/ids';
import type { GameHandle, RoomDeps, TwitchVoteSource } from './types';

export interface RoomPlayer {
  id: string;
  tokenHash: string;
  nickname: string;
  avatar: Profile['avatar'];
  color: string;
  connected: boolean;
  left: boolean;
  socketId: string | null;
  score: number;
  joinedAt: number;
  disconnectTimer: NodeJS.Timeout | null;
}

/**
 * Комната: игроки, хост, настройки, сессии. Игровой процесс вынесен в GameHandle;
 * комната лишь решает, кто здесь и кто главный.
 */
export class Room {
  readonly createdAt = Date.now();
  lastActivityAt = Date.now();
  endedAt: number | null = null;
  closed = false;

  players: RoomPlayer[] = [];
  hostId = '';
  settings: Settings = { ...DEFAULT_SETTINGS };
  game: GameHandle | null = null;
  twitch: TwitchState;

  /** Учёт файлов комнаты для лимитов. */
  fileCount = 0;
  fileBytes = 0;

  private hostTimer: NodeJS.Timeout | null = null;
  private twitchSource: TwitchVoteSource | null = null;

  constructor(
    readonly code: string,
    readonly deps: RoomDeps,
  ) {
    this.twitch = { enabled: deps.twitchEnabled, channel: null, status: 'off' };
  }

  // ── Состояние ───────────────────────────────────────────────────────────

  get phase(): Phase {
    return this.game?.phase ?? 'lobby';
  }

  get host(): RoomPlayer | undefined {
    return this.players.find((p) => p.id === this.hostId);
  }

  /** Игроки, которые ещё участвуют (не ушли и не исключены). */
  get activePlayers(): RoomPlayer[] {
    return this.players.filter((p) => !p.left);
  }

  get connectedPlayers(): RoomPlayer[] {
    return this.players.filter((p) => !p.left && p.connected);
  }

  getPlayer(playerId: string): RoomPlayer | undefined {
    return this.players.find((p) => p.id === playerId);
  }

  requirePlayer(playerId: string): RoomPlayer {
    const player = this.getPlayer(playerId);
    if (!player || player.left) throw new AppError('NOT_IN_ROOM');
    return player;
  }

  requireHost(playerId: string): RoomPlayer {
    const player = this.requirePlayer(playerId);
    if (player.id !== this.hostId) throw new AppError('FORBIDDEN', 'Only the host can do this');
    return player;
  }

  requirePhase(...phases: Phase[]): void {
    if (!phases.includes(this.phase)) {
      throw new AppError('BAD_PHASE', `Not allowed during "${this.phase}"`);
    }
  }

  touch(): void {
    this.lastActivityAt = Date.now();
  }

  changed(): void {
    if (!this.closed) this.deps.onChange(this);
  }

  // ── Вход и сессии ───────────────────────────────────────────────────────

  join(profile: Profile): { player: RoomPlayer; token: string } {
    if (this.closed) throw new AppError('ROOM_NOT_FOUND');
    if (this.phase !== 'lobby') throw new AppError('GAME_IN_PROGRESS');
    if (this.activePlayers.length >= MAX_PLAYERS) throw new AppError('ROOM_FULL');

    const token = newToken();
    const player: RoomPlayer = {
      id: newId(),
      tokenHash: hashToken(token),
      nickname: this.uniqueNickname(profile.nickname),
      avatar: profile.avatar,
      color: profile.color,
      connected: false,
      left: false,
      socketId: null,
      score: 0,
      joinedAt: Date.now(),
      disconnectTimer: null,
    };
    this.players.push(player);
    if (!this.host || this.host.left) this.hostId = player.id;
    this.touch();
    return { player, token };
  }

  /** Находит игрока по токену сессии. */
  authenticate(token: string): RoomPlayer {
    const hash = hashToken(token);
    const player = this.players.find((p) => p.tokenHash === hash);
    if (!player || player.left || this.closed) throw new AppError('SESSION_EXPIRED');
    return player;
  }

  /** Привязывает сокет к игроку. Прежнее соединение того же игрока вытесняется. */
  attach(playerId: string, socketId: string): void {
    const player = this.requirePlayer(playerId);
    if (player.socketId && player.socketId !== socketId) {
      this.deps.onPlayerRemoved(this, player.socketId, 'replaced');
    }
    player.socketId = socketId;
    player.connected = true;
    this.clearDisconnectTimer(player);
    if (player.id === this.hostId) this.clearHostTimer();
    // Если хоста нет на месте, а этот игрок подключён — права не висят в воздухе.
    if (!this.host?.connected && !this.hostTimer) this.electHost();
    this.touch();
    this.game?.onPresenceChange();
    this.changed();
  }

  detach(playerId: string, socketId: string): void {
    const player = this.getPlayer(playerId);
    if (!player || player.socketId !== socketId) return;
    player.socketId = null;
    player.connected = false;

    if (!player.left) {
      if (this.phase === 'lobby') {
        // В лобби место держим недолго: вернётся — хорошо, нет — освобождаем.
        player.disconnectTimer = setTimeout(
          () => this.remove(player.id),
          this.deps.timings.lobbyDisconnectMs,
        );
      }
      if (player.id === this.hostId) this.startHostTimer();
    }
    this.game?.onPresenceChange();
    this.changed();
  }

  leave(playerId: string): void {
    const player = this.requirePlayer(playerId);
    player.socketId = null;
    player.connected = false;
    this.remove(player.id);
  }

  // ── Лобби ───────────────────────────────────────────────────────────────

  updateProfile(playerId: string, patch: Partial<Profile>): void {
    const player = this.requirePlayer(playerId);
    this.requirePhase('lobby');
    if (patch.nickname !== undefined && patch.nickname !== player.nickname) {
      player.nickname = this.uniqueNickname(patch.nickname, player.id);
    }
    if (patch.avatar !== undefined) player.avatar = patch.avatar;
    if (patch.color !== undefined) player.color = patch.color;
    this.touch();
    this.changed();
  }

  updateSettings(playerId: string, patch: Partial<Settings>): void {
    this.requireHost(playerId);
    // Скрытие кода — про экран стримера, его можно переключать и во время игры.
    const onlyHideCode = Object.keys(patch).every((k) => k === 'hideCode');
    if (!onlyHideCode) this.requirePhase('lobby');
    if (patch.packId !== undefined && !this.deps.packs.exists(patch.packId)) {
      throw new AppError('PACK_UNAVAILABLE', 'Pack not found');
    }
    this.settings = { ...this.settings, ...patch };
    this.touch();
    this.changed();
  }

  kick(hostId: string, targetId: string): void {
    this.requireHost(hostId);
    if (targetId === hostId) throw new AppError('VALIDATION', 'Cannot kick yourself');
    const target = this.requirePlayer(targetId);
    const socketId = target.socketId;
    target.socketId = null;
    target.connected = false;
    this.remove(target.id);
    this.deps.onPlayerRemoved(this, socketId, 'kicked');
  }

  transferHost(hostId: string, targetId: string): void {
    this.requireHost(hostId);
    const target = this.requirePlayer(targetId);
    if (!target.connected) throw new AppError('VALIDATION', 'Player is offline');
    this.hostId = target.id;
    this.clearHostTimer();
    this.touch();
    this.changed();
  }

  /** Убирает тех, кто отключился в лобби и не вернулся (перед стартом игры). */
  dropDisconnected(): void {
    this.requirePhase('lobby');
    for (const p of this.players) {
      if (!p.connected) this.clearDisconnectTimer(p);
    }
    this.players = this.players.filter((p) => p.connected);
  }

  // ── Twitch ──────────────────────────────────────────────────────────────

  async connectTwitch(channel: string): Promise<void> {
    if (!this.twitch.enabled) throw new AppError('FORBIDDEN', 'Twitch integration is disabled');
    await this.disconnectTwitch();
    const source = this.deps.createTwitch();
    this.twitchSource = source;
    this.twitch = { enabled: true, channel, status: 'connecting' };
    this.changed();
    try {
      await source.connect(channel, (user, choice) => this.game?.audienceVote(user, choice));
      if (this.twitchSource !== source) return;
      this.twitch = { enabled: true, channel, status: 'connected' };
    } catch (err) {
      this.deps.logger.warn({ err, room: this.code, channel }, 'twitch connect failed');
      if (this.twitchSource !== source) return;
      this.twitchSource = null;
      await source.disconnect().catch(() => {});
      this.twitch = { enabled: true, channel, status: 'error' };
    }
    this.touch();
    this.changed();
  }

  async disconnectTwitch(): Promise<void> {
    const source = this.twitchSource;
    this.twitchSource = null;
    this.twitch = { enabled: this.twitch.enabled, channel: null, status: 'off' };
    if (source) await source.disconnect().catch(() => {});
    this.changed();
  }

  // ── Внутреннее ──────────────────────────────────────────────────────────

  /** Убирает игрока: в лобби — насовсем, в игре — помечает ушедшим (он остаётся в истории). */
  private remove(playerId: string): void {
    const player = this.getPlayer(playerId);
    if (!player) return;
    this.clearDisconnectTimer(player);

    if (this.phase === 'lobby') {
      this.players = this.players.filter((p) => p.id !== playerId);
    } else {
      player.left = true;
      player.connected = false;
      this.game?.onPlayerGone(playerId);
    }
    if (this.hostId === playerId) {
      this.clearHostTimer();
      this.electHost();
    }
    this.touch();
    this.changed();
  }

  /** Передаёт права хоста следующему подключённому игроку (по порядку входа). */
  private electHost(): void {
    const candidates = this.activePlayers;
    const next = candidates.find((p) => p.connected) ?? candidates[0];
    if (next && next.id !== this.hostId) {
      this.hostId = next.id;
      this.deps.logger.debug({ room: this.code, host: next.id }, 'host changed');
    }
  }

  private startHostTimer(): void {
    this.clearHostTimer();
    this.hostTimer = setTimeout(() => {
      this.hostTimer = null;
      if (this.host?.connected) return;
      this.electHost();
      this.changed();
    }, this.deps.timings.hostGraceMs);
  }

  private clearHostTimer(): void {
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
  }

  private clearDisconnectTimer(player: RoomPlayer): void {
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }

  private uniqueNickname(nickname: string, exceptId?: string): string {
    const taken = new Set(
      this.activePlayers.filter((p) => p.id !== exceptId).map((p) => p.nickname.toLowerCase()),
    );
    if (!taken.has(nickname.toLowerCase())) return nickname;
    for (let n = 2; n < 100; n++) {
      const suffix = ` ${n}`;
      const candidate = nickname.slice(0, NICKNAME_MAX - suffix.length) + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return nickname;
  }

  /** После игры: ушедшие игроки исчезают, очки обнуляются. */
  resetToLobby(): void {
    this.game?.dispose();
    this.game = null;
    this.endedAt = null;
    this.players = this.players.filter((p) => !p.left);
    for (const p of this.players) {
      p.score = 0;
      // Отключившиеся во время игры в лобби держатся по обычным правилам.
      if (!p.connected && !p.disconnectTimer) {
        p.disconnectTimer = setTimeout(
          () => this.remove(p.id),
          this.deps.timings.lobbyDisconnectMs,
        );
      }
    }
    if (!this.host) this.electHost();
    this.touch();
    this.changed();
  }

  toPublicPlayer(p: RoomPlayer): PublicPlayer {
    return {
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      color: p.color,
      connected: p.connected,
      left: p.left,
      score: p.score,
    };
  }

  snapshotFor(playerId: string): RoomState {
    return {
      code: this.code,
      youId: playerId,
      hostId: this.hostId,
      players: this.players.map((p) => this.toPublicPlayer(p)),
      settings: this.settings,
      phase: this.phase,
      phaseEndsAt: this.game?.phaseEndsAt ?? null,
      serverTime: Date.now(),
      roundIndex: this.game?.roundIndex ?? 0,
      totalRounds: this.game?.totalRounds ?? this.settings.rounds,
      round: this.game?.roundStateFor(playerId) ?? null,
      history: this.game?.history() ?? [],
      twitch: this.twitch,
    };
  }

  dispose(): void {
    this.closed = true;
    this.clearHostTimer();
    for (const p of this.players) this.clearDisconnectTimer(p);
    this.game?.dispose();
    this.game = null;
    const source = this.twitchSource;
    this.twitchSource = null;
    if (source) void source.disconnect().catch(() => {});
  }
}
