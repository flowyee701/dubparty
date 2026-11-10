import {
  estimateClock,
  type ClockSample,
  type JoinResult,
  type PlaybackState,
  type Profile,
  type RoomClosedReason,
  type RoomState,
  type Settings,
} from '@dubparty/shared';
import { create } from 'zustand';
import { playSfx } from '../audio/sfx';
import { clearSession, loadSession, saveSession } from '../lib/sessions';
import { ApiErr, request, socket } from '../net/socket';

export type ConnectionStatus = 'idle' | 'connecting' | 'joined' | 'reconnecting';
export type ClosedReason = RoomClosedReason | 'shutdown';

interface RoomStore {
  status: ConnectionStatus;
  state: RoomState | null;
  token: string | null;
  closedReason: ClosedReason | null;
  /** serverTime ≈ Date.now() + clockOffsetMs */
  clockOffsetMs: number;
  playback: PlaybackState | null;

  create(profile: Profile): Promise<string>;
  join(code: string, profile: Profile): Promise<void>;
  /** Пытается вернуться в комнату по сохранённому токену. false — токена нет или он не подошёл. */
  resume(code: string): Promise<boolean>;
  leave(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  reset(): void;
}

function accept(result: JoinResult) {
  saveSession(result.roomCode, result.sessionToken);
  useRoom.setState({
    status: 'joined',
    state: result.state,
    token: result.sessionToken,
    closedReason: null,
    playback: result.state.round?.playback ?? null,
  });
  void syncClock();
}

export const useRoom = create<RoomStore>((set, get) => ({
  status: 'idle',
  state: null,
  token: null,
  closedReason: null,
  clockOffsetMs: 0,
  playback: null,

  async create(profile) {
    set({ status: 'connecting', closedReason: null });
    try {
      const result = await request('room:create', profile);
      accept(result);
      return result.roomCode;
    } catch (err) {
      set({ status: 'idle' });
      throw err;
    }
  },

  async join(code, profile) {
    set({ status: 'connecting', closedReason: null });
    try {
      accept(await request('room:join', { ...profile, roomCode: code }));
    } catch (err) {
      set({ status: 'idle' });
      throw err;
    }
  },

  async resume(code) {
    const sessionToken = loadSession(code);
    if (!sessionToken) return false;
    set({ status: 'connecting', closedReason: null });
    try {
      accept(await request('session:resume', { roomCode: code, sessionToken }));
      return true;
    } catch (err) {
      set({ status: 'idle' });
      // Сетевой сбой — не повод забывать сессию; отказ сервера — повод.
      if (err instanceof ApiErr && err.code !== 'TIMEOUT' && err.code !== 'NETWORK') {
        clearSession(code);
        return false;
      }
      throw err;
    }
  },

  async leave() {
    const code = get().state?.code;
    if (code) clearSession(code);
    await request('room:leave').catch(() => {});
    get().reset();
  },

  async updateSettings(patch) {
    await request('lobby:updateSettings', patch);
  },

  reset() {
    set({ status: 'idle', state: null, token: null, playback: null });
  },
}));

// ── Часы ──────────────────────────────────────────────────────────────────

let syncing = false;

/** Серия замеров времени сервера; берётся замер с минимальной задержкой сети. */
export async function syncClock(rounds = 6): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const samples: ClockSample[] = [];
    for (let i = 0; i < rounds; i++) {
      const sentAt = Date.now();
      try {
        const res = await request('time:sync', { clientTime: sentAt });
        samples.push({ sentAt, receivedAt: Date.now(), serverTime: res.serverTime });
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    const estimate = estimateClock(samples);
    if (estimate) useRoom.setState({ clockOffsetMs: estimate.offsetMs });
  } finally {
    syncing = false;
  }
}

export function serverNow(): number {
  return Date.now() + useRoom.getState().clockOffsetMs;
}

window.setInterval(() => {
  if (useRoom.getState().status === 'joined') void syncClock(4);
}, 30_000);

// ── События сервера ───────────────────────────────────────────────────────

socket.on('room:state', (state) => {
  const prev = useRoom.getState().state;
  if (!prev || prev.code !== state.code) return;
  const before = prev.players.filter((p) => !p.left).length;
  const after = state.players.filter((p) => !p.left).length;
  if (after > before) playSfx('join');
  else if (after < before) playSfx('leave');
  useRoom.setState((s) => ({
    state,
    playback: newer(s.playback, state.round?.playback ?? null, state.phase === 'playback'),
  }));
});

function newer(
  current: PlaybackState | null,
  incoming: PlaybackState | null,
  inPlayback: boolean,
): PlaybackState | null {
  if (!inPlayback) return null;
  if (!incoming) return current;
  return !current || incoming.rev >= current.rev ? incoming : current;
}

socket.on('playback:sync', (playback) => {
  useRoom.setState((s) => (!s.playback || playback.rev >= s.playback.rev ? { playback } : s));
});

function closed(reason: ClosedReason) {
  const code = useRoom.getState().state?.code;
  // «replaced» — игрок открыл игру в другой вкладке: сессию не трогаем.
  if (code && reason !== 'replaced') clearSession(code);
  useRoom.setState({
    status: 'idle',
    state: null,
    token: null,
    playback: null,
    closedReason: reason,
  });
}

socket.on('room:closed', ({ reason }) => closed(reason));
socket.on('server:shutdown', () => closed('shutdown'));

socket.on('disconnect', () => {
  if (useRoom.getState().state) useRoom.setState({ status: 'reconnecting' });
});

// После обрыва сети сокет переподключается сам; нам остаётся вернуть себе место в комнате.
socket.on('connect', () => {
  const { state, status } = useRoom.getState();
  if (!state || status !== 'reconnecting') return;
  const sessionToken = loadSession(state.code);
  if (!sessionToken) return closed('expired');
  request('session:resume', { roomCode: state.code, sessionToken }).then(accept, (err) => {
    if (err instanceof ApiErr && (err.code === 'TIMEOUT' || err.code === 'NETWORK')) return;
    closed('expired');
  });
});

/** Удобные селекторы. */
export function useMe() {
  return useRoom((s) => s.state?.players.find((p) => p.id === s.state?.youId) ?? null);
}
export function useIsHost() {
  return useRoom((s) => !!s.state && s.state.hostId === s.state.youId);
}
