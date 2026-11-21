/* Game balance formulas and the shop schedule (ported from web/js/rules.js,
 * rebalanced for battles). "level" is the floor number. */
import { RNG, seedFor } from './rng.js';

const rules = {
  // The base hero (before choosing a class): 24 health, a potion, STR 1, DEX 1,
  // no ranged weapon, no skills and no spells.
  START_HP: 24,
  START_POTIONS: 1,
  START_STR: 1,

  // Coin = floor(level/10 + 1)
  coinValue: (lvl) => Math.floor(lvl / 10 + 1),
  // Heart heals 4 + floor(level/5) (health pools are bigger in the RPG).
  heartValue: (lvl) => 4 + Math.floor(lvl / 5),
  // Chests roll 1d6 "per level/20" (at least one die).
  bonusDice: (lvl) => Math.max(1, Math.ceil(lvl / 20)),
};

/* Shop floors: floor 5 always; afterwards every 4-10 floors, and never more
 * than 2 shops in any 10 consecutive floors (shop[i+2] - shop[i] >= 10). */
const scheduleCache = new Map();
function shopSchedule(seed, upTo) {
  let s = scheduleCache.get(seed);
  if (!s) {
    s = { rng: new RNG(seedFor(seed, 'shops')), floors: [5] };
    scheduleCache.set(seed, s);
  }
  const f = s.floors;
  while (f[f.length - 1] < upTo) {
    const prev = f[f.length - 1];
    const prev2 = f.length >= 2 ? f[f.length - 2] : -Infinity;
    const minGap = Math.max(4, prev2 + 10 - prev);
    f.push(prev + s.rng.int(minGap, 10));
  }
  return f;
}
rules.shopSchedule = shopSchedule;
rules.isShopFloor = (seed, floor) => shopSchedule(seed, floor).includes(floor);

/* Dark floors: never floors 1-5 or shops, never two in a row. The chance
 * is 15% at floor 6, +1 point per floor, capped at 40%. Each floor rolls
 * on its own seeded stream; floors are walked in order (and cached) so the
 * "never two in a row" rule is consistent. */
rules.TORCH_RADIUS = 4;
rules.darkChance = (f) => Math.min(0.40, 0.15 + 0.01 * (f - 6));
const darkCache = new Map();
rules.isDarkFloor = (seed, f) => {
  if (f < 6) return false;
  let d = darkCache.get(seed);
  if (!d) { d = [false]; darkCache.set(seed, d); }
  for (let k = d.length; k <= f; k++) {
    const roll = new RNG(seedFor(seed, 'dark', k)).next();
    d[k] = k >= 6 && !rules.isShopFloor(seed, k) && !d[k - 1] && roll < rules.darkChance(k);
  }
  return d[f];
};
// What a dark floor remembers once out of sight: 'full' (layout and
// items), 'layout' (walls and floor only) or 'none'. Seen stairs always stay.
rules.darkMemory = (f) => (f >= 35 ? 'none' : f >= 20 ? 'layout' : 'full');

// Sling: stones carried at the start of a run (the base hero has no sling,
// but keeps any stones found for later).
rules.START_AMMO = 0;
// Lock picks: d20 + DEX must reach the door color's target.
rules.LOCK_TARGET = { gold: 12, crimson: 14, azure: 16, emerald: 18 };
// Chance (0..1) that d20 + dex >= target.
rules.pickChance = (dex, color) => Math.max(0, Math.min(20, 21 - (rules.LOCK_TARGET[color] - dex))) / 20;
// Stalkers: enemies that hunt you, from floor 12 (1, +1 every 8 floors, max 3).
rules.STALKER_FROM = 12;
rules.stalkerCount = (f) => (f < rules.STALKER_FROM ? 0 : Math.min(3, 1 + Math.floor((f - rules.STALKER_FROM) / 8)));

// Mimics: from floor 19, a 30% chance per floor of one mimic (a chest or a
// fake locked door). Its ambush bites for double damage unless d20 + DEX
// reaches MIMIC_DODGE.
rules.MIMIC_FROM = 19;
rules.MIMIC_CHANCE = 0.3;
rules.MIMIC_DODGE = 12;

/* Floors 1-10 are simpler: bigger rooms (interior at least 5x5), more
 * doorways, at most one lock and no portals before floor 6. */
rules.EARLY_FLOORS = 10;
rules.BLEND_FLOORS = 15; // floors 11-15: rooms at least 4x4, at most 2 locks
rules.PORTALS_FROM = 6;

/* Classes and levels. Battles give XP. Level 1 (choosing a class) needs
 * FIRST_LEVEL_XP; each later level needs LEVEL_XP_GROWTH times the last. */
rules.FIRST_LEVEL_XP = 15;
rules.LEVEL_XP_GROWTH = 1.25;
// XP needed to go from level n-1 to level n.
rules.xpForLevel = (n) => {
  let k = rules.FIRST_LEVEL_XP;
  for (let i = 2; i <= n; i++) k = Math.ceil(k * rules.LEVEL_XP_GROWTH);
  return k;
};
// Total XP needed to reach level n (0 for level 0).
rules.levelThreshold = (n) => {
  let t = 0;
  for (let i = 1; i <= n; i++) t += rules.xpForLevel(i);
  return t;
};
rules.levelForXp = (xp) => {
  let n = 0;
  while (rules.levelThreshold(n + 1) <= xp) n++;
  return n;
};
rules.CLASSES = {
  fighter: { name: 'Fighter', hp: 10, str: 1, dex: 0, ammo: 0, sp: 4, levelHp: 4, levelSp: 1,
    skills: ['power', 'bash'], boons: ['hp', 'str', 'guard'] },
  rogue: { name: 'Rogue', hp: 7, str: 1, dex: 2, ammo: 5, sp: 4, levelHp: 3, levelSp: 1,
    skills: ['backstab', 'sling'], boons: ['str', 'focus', 'move', 'range'] },
  wizard: { name: 'Wizard', hp: 3, str: 0, dex: 0, ammo: 0, sp: 6, levelHp: 2, levelSp: 2,
    skills: ['missile', 'firebolt'], boons: ['spell', 'power', 'focus'] },
};
rules.BOON_HP = 6;          // Toughness boon
rules.BOON_SP = 2;          // Focus boon
rules.BOON_AC = 1;          // Guard boon
// Stones and missiles on the map: 2 damage, +1 per class level, +2 per
// Arcane power boon (battles use the Sling and Magic Missile skills).
rules.rangedDamage = (level, power) => 2 + level + 2 * (power || 0);
// Spell charges from chests: a normal chest sometimes holds one; a dark
// chest always holds two.
rules.CHEST_CHARGE_CHANCE = 0.15;
rules.DARK_CHEST_CHARGES = 2;
// Loot a class can't use turns into coins (stones; old-save spells).
rules.spellCoinValue = (f) => 2 * rules.coinValue(f);
rules.STONE_COINS = 1;

/* Spells: Invisibility, Re-roll and Glowing Orb, each at level 1-5.
 * Wizards learn spells and cast any known spell, `wizardSlots(level)`
 * times per floor (a slot at Wizard levels 1, 2, 4 and 8). Everyone else
 * casts at level 1 by spending 3 charges of that spell. A Wizard raises a
 * known spell to level n by studying 3(n-1) charges of any spells (30 in
 * all to reach level 5). */
rules.SPELL_MAX = 5;
rules.CHARGES_PER_CAST = 3;
rules.upgradeCost = (n) => 3 * (n - 1);
rules.WIZARD_SLOT_LEVELS = [1, 2, 4, 8];
rules.wizardSlots = (level) => rules.WIZARD_SLOT_LEVELS.filter((l) => level >= l).length;
// Glowing Orb light radius: 4, 5, 6, 7, then 8 at level 5 (after flooding
// the whole floor with light for ORB_FLOOD_TURNS turns).
rules.orbRadius = (lv) => (lv >= 5 ? 8 : rules.TORCH_RADIUS + lv - 1);
rules.ORB_FLOOD_TURNS = 2;


/* ---- Battles ----
 * Armor class: 10 + armor + floor(DEX / 2). Attack: d20 + STR + weapon hit
 * against the target's AC. A natural 20 always hits and doubles the damage
 * dice; a natural 1 always misses. */
rules.BASE_AC = 10;
rules.DEFEND_AC = 4;          // Defend: +4 AC until your next action
rules.DEFEND_SP = 1;          // ...and recover 1 SP
rules.FLEE_BASE = 10;         // Flee: d20 + DEX >= 10 + enemy tier
rules.CRIT = 20;
rules.ROGUE_CRIT = 18;        // Backstab crits on 18-20
rules.playerAc = (p, armorAc) => rules.BASE_AC + (armorAc || 0) + Math.floor(p.dex / 2) + (p.acBonus || 0);
// XP for a kill scales gently with depth.
rules.xpFor = (baseXp, f) => Math.round(baseXp * (1 + f / 8));
// Reaching a new floor you catch your breath: heal a quarter of max health.
rules.FLOOR_REST = 0.25;
// An enemy's heavy blow: x1.5 damage at -2 to hit.
rules.HEAVY_MULT = 1.5;
// Potions (from med packs, the shop and loot) heal 8 + floor(f/2).
rules.potionHeal = (f) => 8 + Math.floor(f / 2);
// Chance a normal chest also holds a weapon or armor.
rules.CHEST_GEAR_CHANCE = 0.25;
// Ammo for the Rogue's sling and burn/poison ticks.
rules.POISON_DMG = 1;
rules.BURN_DMG = 2;

export { rules };
