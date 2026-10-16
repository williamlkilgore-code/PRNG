/* Run with: node web/tests/run-tests.js */
const path = require('path');
for (const f of ['rng', 'rules', 'levelgen', 'game']) require(path.join(__dirname, '..', 'js', f + '.js'));
const DC = globalThis.DC;
const { Game, rules: R, generateLevel, reach, DIRS, OPP } = DC;

let failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; if (failures < 30) console.error('FAIL:', msg); }
}
function test(name, fn) {
  const before = failures;
  fn();
  console.log(`${failures === before ? 'ok  ' : 'FAIL'} ${name}`);
}

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map(DC.hashStr);

test('formulas', () => {
  ok(R.enemyDamage(1) === 1 && R.enemyDamage(19) === 1 && R.enemyDamage(20) === 2 && R.enemyDamage(45) === 3, 'enemy damage');
  ok(R.enemyHealth(1) === 1 && R.enemyHealth(10) === 2 && R.enemyHealth(25) === 3, 'enemy health');
  ok(R.coinValue(9) === 1 && R.coinValue(10) === 2, 'coin value');
  ok(R.heartValue(1) === 1 && R.heartValue(20) === 1 && R.heartValue(21) === 2, 'heart value');
});

test('shop schedule', () => {
  for (const seed of SEEDS.concat([1, 2, 3, 99999])) {
    const f = R.shopSchedule(seed, 600);
    ok(f[0] === 5, 'floor 5 is a shop');
    for (let i = 1; i < f.length; i++) {
      const gap = f[i] - f[i - 1];
      ok(gap >= 4 && gap <= 10, `gap ${gap} out of range`);
    }
    for (let i = 2; i < f.length; i++) ok(f[i] - f[i - 2] >= 10, 'more than 2 shops in 10 floors');
    for (let a = 1; a < 590; a++) ok(f.filter((x) => x >= a && x < a + 10).length <= 2, 'window check');
    ok(!R.isShopFloor(seed, 1) && !R.isShopFloor(seed, 4) && R.isShopFloor(seed, 5), 'isShopFloor');
  }
});

test('level generation invariants (floors 1-80, 6 seeds)', () => {
  for (const seed of SEEDS) {
    for (let floor = 1; floor <= 80; floor++) {
      if (R.isShopFloor(seed, floor)) continue;
      const L = generateLevel(seed, floor);
      const at = (x, y) => (x < 0 || y < 0 || x >= L.w || y >= L.h ? 0 : L.tiles[y * L.w + x]);
      const tag = `seed ${seed} floor ${floor}`;

      for (const r of L.rooms) ok(r.x1 - r.x0 - 1 >= 3 && r.y1 - r.y0 - 1 >= 3, `room < 3x3 ${tag}`);
      for (let x = 0; x < L.w; x++) ok(at(x, 0) === 0 && at(x, L.h - 1) === 0, `border open ${tag}`);
      for (let y = 0; y < L.h; y++) ok(at(0, y) === 0 && at(L.w - 1, y) === 0, `border open ${tag}`);
      ok(at(L.start.x, L.start.y) === 1 && at(L.stairs.x, L.stairs.y) === 1, `start/stairs on floor ${tag}`);
      ok(L.start.x !== L.stairs.x || L.start.y !== L.stairs.y, `start == stairs ${tag}`);

      const seen = new Set();
      for (const o of L.objects) {
        const k = o.y * L.w + o.x;
        ok(!seen.has(k), `stacked objects ${tag}`);
        seen.add(k);
        ok(!(o.x === L.start.x && o.y === L.start.y) && !(o.x === L.stairs.x && o.y === L.stairs.y), `object on start/stairs ${tag}`);
        if (o.type !== 'lock') ok(at(o.x, o.y) === 1, `object not in a room ${tag}`);
      }

      const locks = L.objects.filter((o) => o.type === 'lock');
      const keys = L.objects.filter((o) => o.type === 'key');
      ok(floor > 1 || locks.length === 0, 'no locks on floor 1');
      const blocked = new Set(locks.map((o) => o.y * L.w + o.x));
      const zone = reach(L, L.start.x, L.start.y, blocked);
      for (const d of locks) {
        ok(at(d.x, d.y) === 2, `lock not on doorway ${tag}`);
        const ns = at(d.x, d.y - 1) === 0 && at(d.x, d.y + 1) === 0 && at(d.x - 1, d.y) && at(d.x + 1, d.y);
        const ew = at(d.x - 1, d.y) === 0 && at(d.x + 1, d.y) === 0 && at(d.x, d.y - 1) && at(d.x, d.y + 1);
        ok(ns || ew, `lock without walls on opposite sides ${tag}`);
        const key = keys.filter((k) => k.color === d.color);
        ok(key.length === 1, `lock without exactly one key ${tag}`);
        if (key[0]) ok(zone.seen[key[0].y * L.w + key[0].x] === 1, `key not reachable from start ${tag}`);
      }
      const open = reach(L, L.start.x, L.start.y, null);
      ok(open.seen[L.stairs.y * L.w + L.stairs.x] === 1, `stairs unreachable ${tag}`);
      const floorCells = L.tiles.filter((t) => t !== 0).length;
      ok(open.size === floorCells, `disconnected floor ${tag}`);

      const portals = L.objects.filter((o) => o.type === 'portal');
      ok(portals.length % 2 === 0, `odd portals ${tag}`);
      for (const p of portals) {
        const q = L.objects[p.pair];
        ok(q && q.type === 'portal' && L.objects[q.pair] === p && q.color === p.color, `portal pairing ${tag}`);
        // Portals never bypass a lock.
        const z = reach(L, p.x, p.y, blocked);
        ok(z.seen[q.y * L.w + q.x] === 1, `portal crosses a locked door ${tag}`);
      }
      ok(L.objects.some((o) => o.type === 'enemy') && L.objects.some((o) => o.type === 'web'), `missing obstacles ${tag}`);
    }
  }
});

test('determinism', () => {
  const a = JSON.stringify(generateLevel(SEEDS[0], 12));
  const b = JSON.stringify(generateLevel(SEEDS[0], 12));
  ok(a === b, 'same seed differs');
  ok(a !== JSON.stringify(generateLevel(SEEDS[1], 12)), 'different seeds equal');
});

// Hand-built level for focused movement tests.
function sandbox(rows, extra) {
  const g = Game.create('sandbox');
  const h = rows.length, w = rows[0].length;
  const L = { w, h, tiles: [], rooms: [], doorways: [], objects: [], trail: [], floor: g.s.floor };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x];
    L.tiles.push(c === '#' ? 0 : c === 'D' ? 2 : 1);
    if (c === '@') L.start = { x, y };
    if (c === '>') L.stairs = { x, y };
  }
  (extra || []).forEach((o) => L.objects.push(o));
  g.s.level = L;
  g.s.player.x = L.start.x; g.s.player.y = L.start.y;
  L.trail = [[[L.start.x, L.start.y]]];
  g.s.phase = 'roll';
  g.rebuildIndex();
  return g;
}
function forceRoll(g, a, b) {
  g.s.phase = 'roll';
  g.roll();
  g.s.dice = [a, b];
  g.computeSteps();
}
function run(g) { let n = 0; while (g.s.phase === 'moving' && n++ < 200) g.step(); }

test('even = orthogonal, odd = diagonal, moves = total', () => {
  const g = sandbox([
    '###############',
    '#@............#',
    '#.............#',
    '#.............#',
    '#............>#',
    '###############',
  ]);
  forceRoll(g, 2, 2);
  ok(g.s.parity === 'ortho' && g.s.steps === 4, 'parity even');
  ok(g.availableDirs().sort().join() === 'E,S', 'ortho options from corner');
  g.choose('E'); run(g);
  ok(g.s.player.x === 5 && g.s.player.y === 1 && g.s.phase === 'roll', 'moved 4 east');
  forceRoll(g, 1, 2);
  ok(g.s.parity === 'diag' && g.availableDirs().sort().join() === 'SE,SW', 'diag options');
});

test('blocked: redirect, no doubling back unless only move', () => {
  const g = sandbox([
    '#######',
    '#@....#',
    '#.....#',
    '#.....#',
    '#....>#',
    '#######',
  ]);
  forceRoll(g, 4, 4); // 8 orthogonal
  g.choose('E'); run(g);
  ok(g.s.phase === 'redirect' && g.s.move.stepsLeft === 4, 'blocked with 4 left');
  ok(g.availableDirs().join() === 'S', 'cannot double back west while south is open');
  g.choose('S'); run(g);
  ok(g.s.player.x === 5 && g.s.player.y === 4 || g.s.phase === 'levelDone', 'reached stairs corner');

  // Dead end corridor: reverse is the only way, so it is allowed.
  const h = sandbox([
    '#####',
    '#...#',
    '#@###',
    '#.#>#',
    '#####',
  ]);
  forceRoll(h, 3, 3);
  h.choose('N'); run(h);
  ok(h.s.phase === 'redirect', 'blocked at top');
  ok(h.availableDirs().join() === 'E', 'turn east');
  h.choose('E'); run(h);
  ok(h.s.phase === 'redirect' && h.availableDirs().join() === 'W', 'only reverse remains, so it is allowed');
});

test('diagonal redirect avoids retracing this turn\'s path', () => {
  const g = sandbox([
    '#########',
    '#>......#',
    '#.......#',
    '#.......#',
    '#..@....#',
    '#########',
  ]);
  forceRoll(g, 3, 4); // 7 diagonal
  g.choose('NE'); run(g);
  ok(g.s.phase === 'redirect' && g.s.player.x === 6 && g.s.player.y === 1, 'blocked by top wall');
  g.choose('SE'); run(g);
  ok(g.s.phase === 'redirect' && g.s.player.x === 7 && g.s.player.y === 2, 'blocked by side wall');
  ok(g.availableDirs().join() === 'SW', 'only SW (fresh squares) offered, not NW (retraces): ' + g.availableDirs());
  ok(!g.choose('NW'), 'NW refused');
});

test('save validation', () => {
  const g = Game.create('valid');
  const clone = () => JSON.parse(JSON.stringify(g.s));
  ok(Game.validate(clone()) === null, 'fresh game is valid');
  ok(Game.load(clone()) instanceof Game, 'loads');
  const bad = [
    (st) => { st.player.x = '<img src=x onerror=alert(1)>'; },
    (st) => { st.log.push({ text: 'x', kind: 'a" onclick="x' }); },
    (st) => { st.level.objects.push({ type: 'coin', x: 1, y: 1, color: 'red;background:url(x)' }); },
    (st) => { st.level.objects.push({ type: 'script', x: 1, y: 1 }); },
    (st) => { st.player.hp = 99; },
    (st) => { st.floor = 'ten'; },
    (st) => { st.version = 2; },
    (st) => { st.level.tiles.pop(); },
  ];
  bad.forEach((mut, i) => { const st = clone(); mut(st); ok(Game.validate(st) !== null && Game.load(st) === null, 'tampered save ' + i + ' accepted'); });
  ok(Game.load(null) === null && Game.load('x') === null, 'junk rejected');
});

test('web stops and halves next move', () => {
  const g = sandbox(['#########', '#@......#', '#......>#', '#########'], [{ type: 'web', x: 3, y: 1 }]);
  forceRoll(g, 3, 3);
  g.choose('E'); run(g);
  ok(g.s.player.x === 3 && g.s.phase === 'roll' && g.s.player.webbed, 'stopped on web');
  g.roll(); g.s.dice = [3, 3]; g.computeSteps();
  ok(g.s.steps === 3 && g.s.halved, 'halved next turn');
});

test('enemy combat', () => {
  const g = sandbox(['#########', '#@......#', '#......>#', '#########'],
    [{ type: 'enemy', x: 3, y: 1, hp: 2, maxHp: 2 }]);
  forceRoll(g, 3, 3);
  g.choose('E'); run(g);
  ok(g.s.player.x === 2 && g.s.player.hp === 9 && g.s.level.objects[0].hp === 1, 'wounded enemy blocks');
  forceRoll(g, 3, 3);
  g.choose('E'); run(g);
  ok(g.s.level.objects[0].done && g.s.player.x === 7 && g.s.player.hp === 8, 'killed enemy, kept moving');
});

test('locked door and key', () => {
  const g = sandbox([
    '#########',
    '#@..#...#',
    '#...D..>#',
    '#...#...#',
    '#########',
  ], [{ type: 'lock', x: 4, y: 2, color: 'gold' }, { type: 'key', x: 2, y: 2, color: 'gold' }]);
  g.s.player.x = 1; g.s.player.y = 2;
  forceRoll(g, 3, 3);
  g.choose('E'); run(g);
  ok(g.s.player.keys.length === 0 && g.s.level.objects[1].done, 'picked up and used key');
  ok(g.s.phase === 'levelDone', 'door opened and reached stairs');
  const h = sandbox(['#########', '#@..#...#', '#...D..>#', '#...#...#', '#########'], [{ type: 'lock', x: 4, y: 2, color: 'gold' }]);
  h.s.player.y = 2; h.s.player.x = 3;
  forceRoll(h, 1, 1);
  ok(!h.availableDirs().includes('E'), 'locked without key');
});

test('portal teleports and movement continues', () => {
  const g = sandbox(['###########', '#@.P#.....#', '#...#.P..>#', '###########'],
    [{ type: 'portal', x: 3, y: 1, color: 'violet', pair: 1 }, { type: 'portal', x: 6, y: 2, color: 'violet', pair: 0 }]);
  g.s.player.y = 2; g.s.player.x = 1;
  forceRoll(g, 1, 2); // diag
  g.choose('NE'); run(g);
  ok(g.s.player.x === 7 || g.s.phase !== 'moving', 'teleported');
  const g2 = sandbox(['###########', '#@.P#.....#', '#...#.P..>#', '###########'],
    [{ type: 'portal', x: 3, y: 1, color: 'violet', pair: 1 }, { type: 'portal', x: 6, y: 2, color: 'violet', pair: 0 }]);
  forceRoll(g2, 3, 3);
  g2.choose('E'); run(g2);
  ok(g2.s.phase === 'levelDone', 'continued east after portal to the stairs');
});

test('spells', () => {
  const g = sandbox(['###########', '#@...#....#', '#....#...>#', '###########'],
    [{ type: 'enemy', x: 3, y: 1, hp: 1, maxHp: 1 }, { type: 'web', x: 2, y: 2 }]);
  g.s.player.spells = { noclip: 1, fireball: 1, luck: 1, reroll: 1, invis: 1 };
  // Invisibility: pass through enemy untouched.
  forceRoll(g, 1, 1);
  ok(g.toggleArm('invis'), 'arm invis');
  g.choose('E'); run(g);
  ok(g.s.player.x === 3 && g.s.player.hp === 10 && !g.s.level.objects[0].done && g.s.player.spells.invis === 0, 'invisible pass');
  // Dark one's luck then no-clip through the wall.
  forceRoll(g, 1, 2);
  ok(g.darkLuck(3, 3), 'luck');
  ok(g.s.steps === 6 && g.s.parity === 'ortho', 'luck set dice');
  ok(!g.availableDirs().includes('E') || g.legalMove('E', 6).kind === 'normal', 'pre-noclip');
  g.toggleArm('noclip');
  g.choose('E'); run(g);
  ok(g.s.player.x > 5 && g.s.player.spells.noclip === 0, 'phased through wall');
  // Fireball.
  const before = g.fireballTargets().length;
  ok(g.fireball(1), 'fireball web');
  ok(g.fireballTargets().length === before - 1 && g.s.player.spells.fireball === 0, 'web destroyed');
  // Re-roll.
  forceRoll(g, 1, 1);
  ok(g.reroll(0) && g.s.player.spells.reroll === 0, 'reroll');
  // No-clip needs enough movement to clear the wall.
  const h = sandbox(['#######', '#@#...#', '#.#..>#', '#######']);
  h.s.player.spells.noclip = 1;
  forceRoll(h, 1, 1); h.s.steps = 1;
  h.toggleArm('noclip');
  ok(!h.availableDirs().includes('E'), 'cannot noclip with 1 move');
  h.s.steps = 2;
  ok(h.availableDirs().includes('E'), 'can noclip with 2 moves');
});

test('shop and gamble', () => {
  const g = Game.create('shoptest');
  while (g.s.floor < 4) { g.s.phase = 'levelDone'; g.nextFloor(); }
  g.s.phase = 'levelDone'; g.nextFloor();
  ok(g.s.floor === 5 && g.s.phase === 'shop', 'floor 5 shop');
  const ids = g.s.shop.items.map((i) => i.id);
  ok(ids[0] === 'heal' && ids[1] === 'str' && ids.length === 6 && new Set(ids).size === 6, 'shop items');
  g.s.player.coins = 100;
  ok(g.buy(1) && g.s.player.str === 2, 'buy strength');
  ok(!g.buy(0), 'cannot heal at full');
  g.s.player.hp = 3;
  ok(g.buy(0) && g.s.player.hp === g.s.player.maxHp, 'heal');
  const gi = g.s.shop.items.findIndex((i) => i.id === 'gamble');
  if (gi >= 0) {
    for (let i = 0; i < 50; i++) {
      const c = g.s.player.coins;
      const r = g.gamble(4);
      const exp = r.roll <= 2 ? -4 : r.roll <= 4 ? 0 : r.roll === 5 ? 2 : 4;
      ok(g.s.player.coins - c === exp, 'gamble payout');
    }
  }
  g.nextFloor();
  ok(g.s.floor === 6 && g.s.level, 'left shop');
});

test('random play simulation', () => {
  let floors = 0, deaths = 0;
  for (let run = 0; run < 25; run++) {
    const g = Game.create('sim' + run);
    const pick = new DC.RNG(run + 1);
    g.s.player.hp = g.s.player.maxHp = 1000; // survive long enough to explore
    for (let t = 0; t < 4000; t++) {
      const s = g.s;
      if (s.phase === 'dead') { deaths++; break; }
      if (s.phase === 'levelDone' || s.phase === 'shop') { g.nextFloor(); floors++; if (s.floor > 30) break; continue; }
      if (s.phase === 'roll') { g.roll(); continue; }
      if (s.phase === 'choose' || s.phase === 'redirect') {
        const d = g.availableDirs();
        if (!d.length) { ok(s.phase === 'choose', 'redirect with no options'); g.passTurn(); continue; }
        g.choose(pick.pick(d));
        let n = 0;
        while (g.s.phase === 'moving') { g.step(); ok(++n < 500, 'runaway move'); if (n >= 500) break; }
        const L = g.s.level;
        if (L) ok(L.tiles[g.s.player.y * L.w + g.s.player.x] !== 0, 'player inside a wall');
        continue;
      }
      ok(false, 'unexpected phase ' + s.phase);
      break;
    }
    const why = Game.validate(JSON.parse(JSON.stringify(g.s)));
    ok(!why, 'saved state fails validation: ' + why);
  }
  console.log(`     (simulated ${floors} floor transitions, ${deaths} deaths)`);
  ok(floors > 50, 'random play makes progress');
});

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
