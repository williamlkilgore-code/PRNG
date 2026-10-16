/* Game balance formulas and the shop schedule. "level" is the floor number. */
(function (root) {
  const DC = root.DC;
  const { RNG, seedFor } = DC;

  const rules = {
    START_HP: 10,
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

  DC.rules = rules;
})(typeof window !== 'undefined' ? window : globalThis);
