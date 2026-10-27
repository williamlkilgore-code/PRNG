/* Game balance formulas and the shop schedule. "level" is the floor number. */
(function (root) {
  const DC = root.DC;
  const { RNG, seedFor } = DC;

  const rules = {
    // The base hero (before choosing a class): 7 health, STR 1, DEX 1,
    // no ranged weapon and no spells.
    START_HP: 7,
    START_STR: 1,

    // Enemies: damage = floor(level/20 + 1), health = floor(level/10 + 1)
    enemyDamage: (lvl) => Math.floor(lvl / 20 + 1),
    enemyHealth: (lvl) => Math.floor(lvl / 10 + 1),

    // Coin = floor(level/10 + 1)
    coinValue: (lvl) => Math.floor(lvl / 10 + 1),
    // Heart = ceil(level/20)
    heartValue: (lvl) => Math.ceil(lvl / 20),
    // Chests roll 1d6 and med packs 1d4 "per level/20" (at least one die).
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
  rules.PORTALS_FROM = 6;

  /* Classes and levels. Level 1 (choosing a class) needs 10 kills; each later
   * level needs 1.5x as many kills as the one before (rounded up). */
  rules.FIRST_LEVEL_KILLS = 10;
  rules.LEVEL_KILL_GROWTH = 1.5;
  // Kills needed to go from level n-1 to level n.
  rules.killsForLevel = (n) => {
    let k = rules.FIRST_LEVEL_KILLS;
    for (let i = 2; i <= n; i++) k = Math.ceil(k * rules.LEVEL_KILL_GROWTH);
    return k;
  };
  // Total kills needed to reach level n (0 for level 0).
  rules.levelThreshold = (n) => {
    let t = 0;
    for (let i = 1; i <= n; i++) t += rules.killsForLevel(i);
    return t;
  };
  rules.levelForKills = (kills) => {
    let n = 0;
    while (rules.levelThreshold(n + 1) <= kills) n++;
    return n;
  };
  rules.CLASSES = {
    fighter: { name: 'Fighter', hp: 5, dex: 0, ammo: 0, levelHp: 2, boons: ['hp', 'str'] },
    rogue: { name: 'Rogue', hp: 2, dex: 2, ammo: 5, levelHp: 1, boons: ['move', 'range'] },
    wizard: { name: 'Wizard', hp: 0, dex: 0, ammo: 0, levelHp: 1, boons: ['spell', 'range'] },
  };
  rules.BOON_HP = 2;          // Fighter's health boon
  // Loot a class can't use turns into coins (stones; old-save spells).
  rules.spellCoinValue = (f) => 2 * rules.coinValue(f);
  rules.STONE_COINS = 1;

  /* Spells: Invisibility, Re-roll and Glowing Orb, each at level 1-5.
   * Wizards learn spells and cast any known spell, `wizardSlots(level)`
   * times per floor (a slot at Wizard levels 1, 2, 4 and 8). Everyone else
   * casts at level 1 by spending 3 charges. A Wizard raises a known spell to
   * level n by spending 5n charges of it. */
  rules.SPELL_MAX = 5;
  rules.CHARGES_PER_CAST = 3;
  rules.upgradeCost = (n) => 5 * n;
  rules.WIZARD_SLOT_LEVELS = [1, 2, 4, 8];
  rules.wizardSlots = (level) => rules.WIZARD_SLOT_LEVELS.filter((l) => level >= l).length;
  // Glowing Orb light radius: 4, 5, 6, 7, then 8 at level 5 (after flooding
  // the whole floor with light for ORB_FLOOD_TURNS turns).
  rules.orbRadius = (lv) => (lv >= 5 ? 8 : rules.TORCH_RADIUS + lv - 1);
  rules.ORB_FLOOD_TURNS = 2;

  DC.rules = rules;
})(typeof window !== 'undefined' ? window : globalThis);
