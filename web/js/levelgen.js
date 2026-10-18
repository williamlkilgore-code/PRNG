/* Procedural floor generation.
 *
 * The map is a binary-space partition of rooms that share single-thickness
 * walls. Neighbouring rooms are joined by one-cell doorways cut into the
 * shared wall, so every doorway has wall on two orthogonally opposite sides
 * and is a valid spot for a locked door.
 *
 * tiles: 0 = wall, 1 = room floor, 2 = doorway
 */
(function (root) {
  const DC = root.DC;
  const { RNG, seedFor } = DC;

  const KEY_COLORS = ['gold', 'crimson', 'azure', 'emerald'];
  const PORTAL_COLORS = ['violet', 'teal'];
  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function splitRegions(rng, w, h) {
    const leaves = [];
    (function split(r) {
      const iw = r.x1 - r.x0 - 1, ih = r.y1 - r.y0 - 1;
      const canV = iw >= 7, canH = ih >= 7;
      const big = iw > 8 || ih > 7;
      if ((!canV && !canH) || (!big && rng.chance(0.45))) { leaves.push(r); return; }
      let vertical;
      if (canV && canH) vertical = iw > ih ? rng.chance(0.75) : iw < ih ? rng.chance(0.25) : rng.chance(0.5);
      else vertical = canV;
      if (vertical) {
        const s = rng.int(r.x0 + 4, r.x1 - 4);
        split({ x0: r.x0, y0: r.y0, x1: s, y1: r.y1 });
        split({ x0: s, y0: r.y0, x1: r.x1, y1: r.y1 });
      } else {
        const s = rng.int(r.y0 + 4, r.y1 - 4);
        split({ x0: r.x0, y0: r.y0, x1: r.x1, y1: s });
        split({ x0: r.x0, y0: s, x1: r.x1, y1: r.y1 });
      }
    })({ x0: 0, y0: 0, x1: w - 1, y1: h - 1 });
    return leaves;
  }

  // Shared-wall adjacencies between rooms with the cells a doorway could use.
  function roomEdges(rooms) {
    const edges = [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        const cells = [];
        if (a.x1 === b.x0 || b.x1 === a.x0) {
          const x = a.x1 === b.x0 ? a.x1 : a.x0;
          for (let y = Math.max(a.y0, b.y0) + 1; y <= Math.min(a.y1, b.y1) - 1; y++) cells.push([x, y]);
        } else if (a.y1 === b.y0 || b.y1 === a.y0) {
          const y = a.y1 === b.y0 ? a.y1 : a.y0;
          for (let x = Math.max(a.x0, b.x0) + 1; x <= Math.min(a.x1, b.x1) - 1; x++) cells.push([x, y]);
        }
        if (cells.length) edges.push({ a: i, b: j, cells });
      }
    }
    return edges;
  }

  // 4-way flood fill over non-wall tiles, treating `blocked` cell indexes as walls.
  function reach(L, sx, sy, blocked) {
    const seen = new Uint8Array(L.w * L.h);
    const q = [sy * L.w + sx];
    seen[q[0]] = 1;
    let n = 0;
    while (n < q.length) {
      const i = q[n++];
      const x = i % L.w, y = (i / L.w) | 0;
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
        const j = ny * L.w + nx;
        if (seen[j] || L.tiles[j] === 0 || (blocked && blocked.has(j))) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    return { seen, size: q.length, cells: q };
  }

  function tryGenerate(rng, floor, w, h, seed) {
    const rooms = splitRegions(rng, w, h);
    if (rooms.length < 3) return null;
    const tiles = new Array(w * h).fill(0);
    const roomOf = new Array(w * h).fill(-1);
    rooms.forEach((r, id) => {
      for (let y = r.y0 + 1; y < r.y1; y++)
        for (let x = r.x0 + 1; x < r.x1; x++) { tiles[y * w + x] = 1; roomOf[y * w + x] = id; }
    });

    // Random spanning tree (Kruskal) plus a few extra doors for loops.
    const edges = rng.shuffle(roomEdges(rooms));
    const parent = rooms.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const graph = rooms.map(() => []);
    const doorways = [];
    for (const e of edges) {
      const ra = find(e.a), rb = find(e.b);
      const tree = ra !== rb;
      if (tree) parent[ra] = rb;
      if (!tree && !rng.chance(0.2)) continue;
      const [x, y] = rng.pick(e.cells);
      tiles[y * w + x] = 2;
      doorways.push({ x, y });
      graph[e.a].push(e.b);
      graph[e.b].push(e.a);
    }
    if (new Set(rooms.map((_, i) => find(i))).size !== 1) return null;

    const L = { w, h, tiles, rooms, doorways, objects: [], trail: [] };
    const used = new Set();
    const cellsOfRoom = (id) => {
      const r = rooms[id], out = [];
      for (let y = r.y0 + 1; y < r.y1; y++) for (let x = r.x0 + 1; x < r.x1; x++) out.push([x, y]);
      return out;
    };

    // Start (smiley) in a random room, stairs in the room farthest from it.
    const startRoom = rng.int(0, rooms.length - 1);
    const dist = rooms.map(() => -1);
    dist[startRoom] = 0;
    const bq = [startRoom];
    while (bq.length) {
      const r = bq.shift();
      for (const n of graph[r]) if (dist[n] < 0) { dist[n] = dist[r] + 1; bq.push(n); }
    }
    const maxD = Math.max(...dist);
    const stairsRoom = rng.pick(rooms.map((_, i) => i).filter((i) => dist[i] === maxD));
    const [sx, sy] = rng.pick(cellsOfRoom(startRoom));
    const [ex, ey] = rng.pick(cellsOfRoom(stairsRoom));
    L.start = { x: sx, y: sy };
    L.stairs = { x: ex, y: ey };
    used.add(sy * w + sx);
    used.add(ey * w + ex);

    // Locked doors: only accepted where they actually cut part of the map off,
    // and only while the start zone keeps room for keys.
    const wantLocks = floor === 1 ? 0 : rng.int(floor < 4 ? 0 : 1, Math.min(3, 1 + Math.floor(floor / 8)));
    const locked = new Set();
    const lockList = [];
    let zone = reach(L, sx, sy, locked);
    for (const d of rng.shuffle(doorways.slice())) {
      if (lockList.length >= wantLocks) break;
      const i = d.y * w + d.x;
      if (!zone.seen[i]) continue;
      locked.add(i);
      const z = reach(L, sx, sy, locked);
      const free = z.cells.filter((c) => tiles[c] === 1 && !used.has(c)).length;
      // Keep at least one room besides the start room reachable without keys
      // (dark floors place their torch there).
      const otherRoom = z.cells.some((c) => tiles[c] === 1 && roomOf[c] !== startRoom && !used.has(c));
      // The doorway itself always drops out of reach; require more than that.
      if (z.size < zone.size - 1 && free >= 12 && otherRoom) { zone = z; lockList.push(d); }
      else locked.delete(i);
    }
    lockList.forEach((d, k) => {
      L.objects.push({ type: 'lock', x: d.x, y: d.y, color: KEY_COLORS[k] });
      used.add(d.y * w + d.x);
    });

    // Every key sits in the start zone: reachable from the smiley with all
    // doors still locked.
    const take = (pool) => {
      const avail = pool.filter((c) => !used.has(c));
      if (!avail.length) return null;
      const c = rng.pick(avail);
      used.add(c);
      return [c % w, (c / w) | 0];
    };
    const zoneFloor = zone.cells.filter((c) => tiles[c] === 1);
    for (let k = 0; k < lockList.length; k++) {
      const c = take(zoneFloor);
      if (!c) return null;
      L.objects.push({ type: 'key', x: c[0], y: c[1], color: KEY_COLORS[k] });
    }

    // Sometimes a lock pick lies in the start zone of a floor with locks.
    if (floor >= 4 && lockList.length && rng.chance(0.3)) {
      const c = take(zoneFloor);
      if (c) L.objects.push({ type: 'lockpick', x: c[0], y: c[1] });
    }

    // Dark floors: a torch the player can reach from the start without keys
    // (never in the start room), and a guaranteed dark chest anywhere.
    L.dark = DC.rules.isDarkFloor(seed, floor);
    if (L.dark) {
      const t = take(zoneFloor.filter((c) => roomOf[c] !== startRoom));
      if (!t) return null;
      L.objects.push({ type: 'torch', x: t[0], y: t[1] });
      const all = [];
      for (let i = 0; i < w * h; i++) if (tiles[i] === 1) all.push(i);
      const c = take(all);
      if (!c) return null;
      L.objects.push({ type: 'darkchest', x: c[0], y: c[1] });
    }

    // Portals: always in pairs, both ends inside the same locked-door zone so
    // they never bypass a lock.
    const wantPairs = floor >= 4 && rng.chance(0.4) ? (floor >= 15 && rng.chance(0.4) ? 2 : 1) : 0;
    if (wantPairs) {
      const comps = [];
      const mark = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (tiles[i] !== 1 || mark[i]) continue;
        const z = reach(L, i % w, (i / w) | 0, locked);
        z.cells.forEach((c) => (mark[c] = 1));
        comps.push(z.cells.filter((c) => tiles[c] === 1));
      }
      for (let p = 0; p < wantPairs; p++) {
        const comp = rng.pick(comps.filter((c) => new Set(c.map((i) => roomOf[i])).size >= 2));
        if (!comp) break;
        const a = take(comp);
        if (!a) break;
        const aRoom = roomOf[a[1] * w + a[0]];
        const far = comp.filter((c) => roomOf[c] !== aRoom &&
          Math.abs((c % w) - a[0]) + Math.abs(((c / w) | 0) - a[1]) >= 6);
        const b = take(far.length ? far : comp.filter((c) => roomOf[c] !== aRoom));
        if (!b) { used.delete(a[1] * w + a[0]); break; }
        const ia = L.objects.length;
        L.objects.push({ type: 'portal', x: a[0], y: a[1], color: PORTAL_COLORS[p], pair: ia + 1 });
        L.objects.push({ type: 'portal', x: b[0], y: b[1], color: PORTAL_COLORS[p], pair: ia });
      }
    }

    // Boons anywhere; obstacles kept out of the start room and away from the smiley.
    const allFloor = [];
    const awayFromStart = [];
    for (let i = 0; i < w * h; i++) {
      if (tiles[i] !== 1) continue;
      allFloor.push(i);
      const x = i % w, y = (i / w) | 0;
      if (roomOf[i] !== startRoom && Math.max(Math.abs(x - sx), Math.abs(y - sy)) > 1) awayFromStart.push(i);
    }
    const place = (type, n, pool, extra) => {
      for (let k = 0; k < n; k++) {
        const c = take(pool);
        if (!c) return;
        L.objects.push(Object.assign({ type, x: c[0], y: c[1] }, extra && extra()));
      }
    };
    const R = DC.rules;
    place('coin', rng.int(4, 7), allFloor);
    place('chest', rng.int(floor < 3 ? 0 : 1, 1 + Math.min(2, Math.floor(floor / 10))), allFloor);
    place('heart', rng.int(1, 2), allFloor);
    place('medpack', floor >= 3 ? rng.int(0, 1) : 0, allFloor);
    place('web', Math.min(6, 1 + Math.floor(floor / 3) + rng.int(0, 1)), awayFromStart);
    const hp = R.enemyHealth(floor);
    place('enemy', Math.min(8, 1 + Math.floor(floor / 3) + rng.int(0, 1)), awayFromStart, () => ({ hp, maxHp: hp }));
    // Stalkers: some of the enemies hunt the player (floor 12+).
    const enemies = L.objects.filter((o) => o.type === 'enemy');
    rng.shuffle(enemies.slice()).slice(0, R.stalkerCount(floor)).forEach((o) => { o.stalker = true; });

    // Mimics (floor 19+): at most one per floor, either a chest that bites or a
    // fake locked door in an ordinary doorway. A door mimic is only placed
    // where blocking it cuts nothing off, so it is never on the only route.
    if (floor >= R.MIMIC_FROM && rng.chance(R.MIMIC_CHANCE)) {
      const chests = L.objects.filter((o) => o.type === 'chest');
      const floorCells = tiles.filter((t) => t !== 0).length;
      const mustReach = L.objects.filter((o) => o.type === 'key' || o.type === 'torch');
      const doors = L.doorways.filter((d) => {
        const i = d.y * w + d.x;
        if (used.has(i)) return false;
        if (reach(L, sx, sy, new Set([i])).size !== floorCells - 1) return false;
        const z = reach(L, sx, sy, new Set([...locked, i]));
        return mustReach.every((o) => z.seen[o.y * w + o.x]);
      });
      const kinds = [chests.length && 'chest', doors.length && 'door'].filter(Boolean);
      if (kinds.length) {
        if (rng.pick(kinds) === 'chest') {
          rng.pick(chests).type = 'mimic';
        } else {
          const d = rng.pick(doors);
          used.add(d.y * w + d.x);
          const colors = lockList.length ? lockList.map((_, k) => KEY_COLORS[k]) : KEY_COLORS.slice(0, 2);
          L.objects.push({ type: 'lock', x: d.x, y: d.y, color: rng.pick(colors), mimic: true });
        }
      }
    }

    return L;
  }

  /* Tutorial floors 1-3: small hand-shaped layouts that introduce one idea
   * at a time. Positions still come from the seeded rng.
   *   1: one 5x5 room, coins only.
   *   2: two 5x5 rooms and a doorway; webs.
   *   3: a 2x2 grid of rooms chained start -> A -> B -> stairs, with the last
   *      door locked (key in A), an enemy, a web, a chest, a heart, a med pack. */
  function tutorialLevel(rng, floor) {
    const R = DC.rules;
    let w, h, rooms;
    if (floor === 1) { w = 7; h = 7; rooms = [{ x0: 0, y0: 0, x1: 6, y1: 6 }]; }
    else if (floor === 2) { w = 13; h = 7; rooms = [{ x0: 0, y0: 0, x1: 6, y1: 6 }, { x0: 6, y0: 0, x1: 12, y1: 6 }]; }
    else {
      w = 13; h = 11;
      // Ring order around the 2x2 grid: TL, TR, BR, BL.
      rooms = [{ x0: 0, y0: 0, x1: 6, y1: 5 }, { x0: 6, y0: 0, x1: 12, y1: 5 },
        { x0: 6, y0: 5, x1: 12, y1: 10 }, { x0: 0, y0: 5, x1: 6, y1: 10 }];
    }
    const tiles = new Array(w * h).fill(0);
    const roomOf = new Array(w * h).fill(-1);
    rooms.forEach((r, id) => {
      for (let y = r.y0 + 1; y < r.y1; y++)
        for (let x = r.x0 + 1; x < r.x1; x++) { tiles[y * w + x] = 1; roomOf[y * w + x] = id; }
    });
    const L = { w, h, tiles, rooms, doorways: [], objects: [], trail: [], floor, dark: false };
    const used = new Set();
    const cellsOf = (id) => tiles.map((t, i) => i).filter((i) => roomOf[i] === id);
    const take = (pool) => {
      const avail = pool.filter((c) => !used.has(c));
      if (!avail.length) return null;
      const c = rng.pick(avail);
      used.add(c);
      return { x: c % w, y: (c / w) | 0 };
    };
    const door = (a, b) => {
      const e = roomEdges(rooms).find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
      const [x, y] = rng.pick(e.cells);
      tiles[y * w + x] = 2;
      L.doorways.push({ x, y });
      used.add(y * w + x);
      return { x, y };
    };
    const put = (type, n, pool, extra) => {
      for (let k = 0; k < n; k++) { const c = take(pool); if (c) L.objects.push(Object.assign({ type }, c, extra)); }
    };
    const all = () => tiles.map((t, i) => i).filter((i) => tiles[i] === 1);

    if (floor === 1) {
      const corners = [[1, 1], [5, 1], [5, 5], [1, 5]];
      const k = rng.int(0, 3);
      const [sx, sy] = corners[k], [ex, ey] = corners[(k + 2) % 4];
      L.start = { x: sx, y: sy }; L.stairs = { x: ex, y: ey };
      used.add(sy * w + sx); used.add(ey * w + ex);
      put('coin', rng.int(2, 3), all());
    } else if (floor === 2) {
      door(0, 1);
      const sr = rng.int(0, 1), er = 1 - sr;
      L.start = take(cellsOf(sr)); L.stairs = take(cellsOf(er));
      put('web', rng.int(1, 2), cellsOf(er));
      put('coin', 3, all());
      put('heart', 1, all());
    } else {
      const k = rng.int(0, 3), dir = rng.chance(0.5) ? 1 : 3;
      const [p0, p1, p2, p3] = [0, 1, 2, 3].map((i) => (k + dir * i) % 4);
      door(p0, p1); door(p1, p2);
      const lock = door(p2, p3);
      L.start = take(cellsOf(p0)); L.stairs = take(cellsOf(p3));
      L.objects.push({ type: 'lock', x: lock.x, y: lock.y, color: KEY_COLORS[0] });
      put('key', 1, cellsOf(p1), { color: KEY_COLORS[0] });
      const hp = R.enemyHealth(floor);
      const [er, wr] = rng.chance(0.5) ? [p1, p2] : [p2, p1];
      put('enemy', 1, cellsOf(er), { hp, maxHp: hp });
      put('web', 1, cellsOf(wr));
      put('chest', 1, all());
      put('heart', 1, all());
      put('medpack', 1, all());
      put('coin', rng.int(3, 4), all());
    }
    return L;
  }

  function generateLevel(seed, floor) {
    const rng = new RNG(seedFor(seed, 'floor', floor));
    if (floor <= 3) return tutorialLevel(rng, floor);
    // Floors grow from 17x13 up to a cap of 21x15 (fits phone screens).
    const w = 17 + 2 * Math.min(2, Math.floor((floor - 1) / 3));
    const h = 13 + 2 * Math.min(1, Math.floor((floor - 1) / 4));
    for (let attempt = 0; attempt < 50; attempt++) {
      const L = tryGenerate(rng, floor, w, h, seed);
      if (L) { L.floor = floor; return L; }
    }
    throw new Error('Level generation failed for floor ' + floor);
  }

  DC.generateLevel = generateLevel;
  DC.reach = reach;
  DC.KEY_COLORS = KEY_COLORS;
})(typeof window !== 'undefined' ? window : globalThis);
