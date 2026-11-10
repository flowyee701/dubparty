import { common } from './ru/common';
import { game } from './ru/game';
import { lobby } from './ru/lobby';
import { packs } from './ru/packs';
import { studio } from './ru/studio';

export const ru = { ...common, ...lobby, ...studio, ...game, ...packs };
