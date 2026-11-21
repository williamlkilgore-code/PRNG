// The engine modules gathered under one object, like the old global `DC`.
import * as rng from '../src/engine/rng.js';
import { rules } from '../src/engine/rules.js';
import * as levelgen from '../src/engine/levelgen.js';
import * as game from '../src/engine/game.js';
export const DC = { ...rng, rules, ...levelgen, ...game };
