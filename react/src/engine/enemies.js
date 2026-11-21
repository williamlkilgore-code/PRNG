/* The monster roster. Every enemy on a floor gets a `kind` from its own seeded
 * stream (so the floor layout from levelgen.js is unchanged), and its battle
 * stats come from the kind plus the floor number. */
import { RNG } from './rng.js';

// dmg: [dice, sides, bonus]. moves: what it may do on its turn (picked at
// random each round and shown to the player as its intent).
export const ENEMIES = {
  rat:      { name: 'Giant Rat', from: 1,  hp: 6,  ac: 9,  atk: 2, dmg: [1, 3, 0], xp: 3,  moves: ['attack', 'attack', 'heavy'] },
  bat:      { name: 'Cave Bat',  from: 1,  hp: 5,  ac: 12, atk: 3, dmg: [1, 2, 0], xp: 3,  moves: ['attack', 'attack', 'guard'] },
  slime:    { name: 'Slime',     from: 2,  hp: 9,  ac: 7,  atk: 2, dmg: [1, 3, 0], xp: 4,  moves: ['attack', 'poison'] },
  goblin:   { name: 'Goblin',    from: 4,  hp: 10, ac: 11, atk: 3, dmg: [1, 6, 0], xp: 6,  moves: ['attack', 'attack', 'heavy'] },
  skeleton: { name: 'Skeleton',  from: 7,  hp: 14, ac: 12, atk: 4, dmg: [1, 6, 1], xp: 9,  moves: ['attack', 'guard', 'heavy'] },
  orc:      { name: 'Orc',       from: 11, hp: 18, ac: 12, atk: 5, dmg: [1, 8, 1], xp: 13, moves: ['attack', 'attack', 'heavy'] },
  wraith:   { name: 'Wraith',    from: 16, hp: 18, ac: 14, atk: 6, dmg: [1, 8, 1], xp: 16, moves: ['attack', 'drain', 'poison'] },
  ogre:     { name: 'Ogre',      from: 22, hp: 34, ac: 11, atk: 6, dmg: [2, 6, 3], xp: 24, moves: ['attack', 'heavy', 'guard'] },
  mimic:    { name: 'Mimic',     from: Infinity, hp: 22, ac: 13, atk: 5, dmg: [1, 8, 2], xp: 20, moves: ['attack', 'heavy', 'drain'] },
};
export const ENEMY_IDS = Object.keys(ENEMIES);

export const MOVES = {
  attack: { name: 'Attack', desc: 'A normal attack.' },
  heavy: { name: 'Heavy blow', desc: '1.5× damage, but -2 to hit.' },
  guard: { name: 'Guard', desc: '+4 AC until its next turn.' },
  poison: { name: 'Poison', desc: 'An attack that poisons you for 3 turns.' },
  drain: { name: 'Drain', desc: 'An attack that heals it by half the damage.' },
};

// Kinds that can appear on floor f: the four newest ones unlocked.
export function kindsFor(f) {
  const ok = ENEMY_IDS.filter((k) => ENEMIES[k].from <= Math.max(1, f));
  return ok.slice(-4);
}

// Battle stats for a kind on floor f (stalkers are a bit tougher).
export function enemyStats(kind, f, stalker) {
  const E = ENEMIES[kind] || ENEMIES.rat;
  f = Math.max(1, f);
  const hp = Math.round(E.hp * (1 + 0.04 * (f - 1)) * (stalker ? 1.2 : 1));
  return {
    kind, name: (stalker ? 'Stalking ' : '') + E.name,
    hp, ac: E.ac + Math.floor(f / 10), atk: E.atk + Math.floor(f / 6),
    dmg: [E.dmg[0], E.dmg[1], E.dmg[2] + Math.floor(f / 10)],
    xp: E.xp + (stalker ? 2 : 0), tier: ENEMY_IDS.indexOf(kind) + 1, moves: E.moves,
  };
}

// Give every enemy on a freshly generated level a kind and its health.
export function assignEnemies(L, seed, f) {
  const rng = new RNG(seed);
  const kinds = kindsFor(f);
  for (const o of L.objects) {
    if (o.type !== 'enemy') continue;
    o.kind = rng.pick(kinds);
    const st = enemyStats(o.kind, f, o.stalker);
    o.hp = o.maxHp = st.hp;
  }
}
