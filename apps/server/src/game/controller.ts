import { MIN_PLAYERS } from '@dubparty/shared';
import { AppError } from '../util/errors';
import type { Room } from './room';
import { GameSession } from './session';

/** Операции над игрой в комнате: запуск, доступ к идущей игре, возврат в лобби. */
export class GameController {
  start(room: Room, playerId: string): void {
    room.requireHost(playerId);
    room.requirePhase('lobby');
    if (room.connectedPlayers.length < MIN_PLAYERS) {
      throw new AppError('NOT_ENOUGH_PLAYERS', `At least ${MIN_PLAYERS} players are required`);
    }
    const pack = room.deps.packs.getPlayable(room.settings.packId);
    if (!pack || pack.clips.length === 0) {
      throw new AppError('PACK_UNAVAILABLE', 'The selected pack has no clips');
    }
    // Те, кто отключился в лобби и не вернулся к старту, в игру не попадают.
    room.dropDisconnected();
    for (const p of room.players) p.score = 0;
    const session = new GameSession(room, pack);
    room.game = session;
    session.begin();
  }

  of(room: Room): GameSession {
    if (!(room.game instanceof GameSession))
      throw new AppError('BAD_PHASE', 'Game has not started');
    return room.game;
  }

  restart(room: Room, playerId: string): void {
    room.requireHost(playerId);
    room.requirePhase('final');
    room.resetToLobby();
  }
}
