import { common } from './en/common';
import { game } from './en/game';
import { lobby } from './en/lobby';
import { packs } from './en/packs';
import { studio } from './en/studio';

export const en = { ...common, ...lobby, ...studio, ...game, ...packs };
