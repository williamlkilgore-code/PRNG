# Dice Delve: Game Specification & Developer Guide

This document gives a developer or coding agent enough detail to rebuild Dice Delve from scratch, or to change the existing code without breaking it. It covers four things:

1. The game rules.
2. The architecture and data model.
3. The algorithms, with their exact constants.
4. Recipes for common changes, plus the invariants the code relies on.

The source of truth is the code in `web/js/`. If this document and the code disagree, the code wins. Fix this document in the same change.

---

## 1. Overview

Dice Delve is a single-player, turn-based dungeon crawler that runs in the browser and plays like a roll-and-write game.

- **Platform:** plain HTML, CSS and JavaScript. There are no dependencies, no bundler and no build step.
  - The scripts are classic scripts, not ES modules, so `index.html` also works when opened from `file://`.
- **Graphics:** everything is SVG. Inline symbols are styled through CSS custom properties, so light and dark themes both work. No raster images are used.
- **Determinism:** a text seed decides every floor layout, item, shop and die roll. The only use of `Math.random` is choosing a random seed name when the player leaves the seed blank.
- **Persistence:** checkpoint saves. A save holds only the seed, the floor to start, and what carries between floors (about 250 bytes). The floor is rebuilt from the seed, so loading always restarts that floor from its beginning. See section 6.5.
- **Length:** floors go on forever. There is no win condition. The game records the deepest floor reached.

### Running and testing

| Task | Command |
|---|---|
| Play | Open `web/index.html` in a browser, or `python3 -m http.server -d web` |
| Unit and simulation tests | `node web/tests/run-tests.js` (exits non-zero on failure) |
| Debug in the browser console | `DiceDelve.game` is the live `Game`. `DiceDelve.render()` redraws the screen. `DC` holds every module. |

---

## 2. Game rules (the specification)

"Level" and "floor" mean the same thing: the floor number `f`, starting at 1.

### 2.1 Player

| Stat | Start | Notes |
|---|---|---|
| Health (`hp`) | 10 | 0 means death and the game ends |
| Max health (`maxHp`) | 10 | Healing never goes above this |
| Strength (`str`) | 1 | Damage dealt to an enemy per encounter |
| Coins | 0 | Spent in shops |
| Keys | none | Colored keys. Cleared when you enter a new floor |
| Spells | 0 of each | `noclip`, `fireball`, `luck`, `reroll`, `invis` |

### 2.2 Turn and movement

1. **Roll** 2d6. Total `T` = d1 + d2.
2. **Movement points:**
   - Normally `steps = T`.
   - If a web caught you last turn, `steps = max(1, floor(T/2))`.
3. **Direction type** comes from the parity of `T`, even when the roll is halved:
   - Even `T`: orthogonal (N, E, S, W).
   - Odd `T`: diagonal (NE, SE, SW, NW).
4. **Choose** a legal direction of that type. If none is legal, the player must **pass** the turn.
5. **Slide:** move one square at a time in that direction. Each square costs 1 movement point. Keep going until:
   - the points run out (the turn ends), or
   - the next square is illegal. If points remain, the player **redirects**: they pick a new legal direction of the same type and keep sliding. If no direction is legal, the turn ends.
6. **No doubling back.** While redirecting, a legal direction is offered only if its next square has not been walked this turn. For a No Clipping move, that means the landing square.
   - `state.turnPath` holds the cell indexes walked this turn, including the start square and portal arrivals.
   - If every legal direction would step onto a walked square, all legal directions are offered. Retracing is the only way to go.
   - Directions are not compared at all. Only squares count, so reversing an earlier leg is fine if it heads onto fresh squares.
7. Some events end the move early: a web, an enemy that survives, or the stairs. See 2.4.

**A move into square (nx, ny) is legal when all of these hold:**
- The square is inside the map.
- The square is not a wall.
- The square is not a locked door, unless the player holds the key of that door's color.
- For a diagonal move: the two squares orthogonally between start and target are not both solid. "Solid" means wall or locked door. This rule stops a move from squeezing between two walls that touch at a corner.

### 2.3 Floors

The start square is drawn as a **smiley face**. The exit is a **staircase**. Stepping onto the stairs at any point in a slide ends the floor at once. Unused movement points are lost.

Every room's interior is at least **3×3**. Rooms are joined by one-square doorways in a shared wall that is one square thick.

### 2.4 Squares and objects

All values use the floor number `f`.

| Object | Rule |
|---|---|
| **Coin** | Gain `floor(f/10 + 1)` coins. Used up. |
| **Treasure chest** | Gain the coin value plus the sum of `max(1, ceil(f/20))` d6. Used up. |
| **Heart** | Heal `ceil(f/20)`, up to max health. Used up. |
| **Med pack** | Heal the heart value plus the sum of `max(1, ceil(f/20))` d4, up to max health. Used up. |
| **Key** | Picked up. It has a color. |
| **Locked door** | Solid unless you hold the key of the same color. Walking in with the key opens the door, uses up the key, and the slide continues. It always sits in a doorway with walls on two orthogonally opposite sides. |
| **Spider web** | Movement stops at once on the web square. The web is used up. Your next roll's movement is halved. |
| **Enemy** | Has `floor(f/10 + 1)` health. See "Encounters" below. |
| **Torch** | Only on dark floors (see 2.9). Lights at once when picked up and burns until the floor ends. |
| **Dark chest** | Only on dark floors. Gives the chest's coins plus 1 random spell (one of the 5 kinds, rolled on the floor's dice). |
| **Portal** | Comes in colored pairs. Stepping onto one moves you to its twin, and the slide continues from the twin in the same direction. Landing on the twin does not trigger it again. Portals are never used up. |

**Encounters.** Moving into an enemy's square counts as an encounter:
1. The enemy deals `floor(f/20 + 1)` damage to you.
2. You deal `str` damage to the enemy.
3. Then:
   - If the enemy's health drops to 0 or below, it dies. You move into its square and keep sliding.
   - If it survives, you stay where you were and your turn ends.
   - If your health reaches 0, you die.

**Invisibility.** While Invisibility is active, enemies are passed through with no encounter. You may end your move on an enemy's square.

### 2.5 Guarantees from the level generator

- Every floor square is connected to every other (using 4-way connectivity, with locked doors treated as open).
- Every key is reachable from the start while **all** locked doors are still closed. This holds even for keys of other colors.
- Each locked door has exactly one key of its color.
- Both ends of a portal pair are in the same "lock zone": the area reachable without passing a locked door. So a portal never lets you skip a lock.
- Webs and enemies are never placed in the start room, or on any square next to the start (including diagonals).
- At most one object occupies a square. No object sits on the start or the stairs.
- Floor 1 has no locked doors.
- A door is locked only if at least one room besides the start room stays reachable from the start without keys.
- Every dark floor has exactly one torch and one dark chest. The torch is reachable from the start with all doors locked, and is never in the start room.

### 2.6 Shops

- **Floor 5 is always a shop.** A shop floor has no map. It shows the shop screen, then you leave to floor `f+1`.
- **Schedule after floor 5.** Each gap between shops is 4–10 floors. There are never more than 2 shops in any 10 consecutive floors, which is the same as `shop[i+2] - shop[i] >= 10`.
  - It is generated this way: `next = prev + randInt(max(4, prev2 + 10 - prev), 10)`, where `prev2` is the shop before `prev`.
- **Always on sale:** **Heal** (restore to full) and **Strength +1**. Both can be bought again and again.
- **Random offers:** 4 more, drawn without repeats from `maxhp, gamble, noclip, fireball, luck, reroll, invis, torch`. These can each be bought once, except Gamble, which can be played again and again.

**Prices.** `t = floor(f/10)`.

| Item | Price |
|---|---|
| Heal (to full) | `2 + ceil((maxHp - hp)/2) + t`. Can't be bought at full health. |
| Strength +1 | `8 + 4*(str - 1) + 2t` |
| Max Health +2 | `6 + 2t`. Also raises current health by 2. |
| Re-roll | `3 + t` |
| Fireball | `5 + t` |
| Invisibility | `6 + t` |
| No Clipping | `7 + t` |
| Dark One's Luck | `9 + t` |
| Torch (carried) | `4 + t` |

**Gamble.** Wager from 1 up to your coins, then roll 1d6:

| Roll | Result |
|---|---|
| 1–2 | Lose the wager |
| 3–4 | Money back (net 0) |
| 5 | Money back plus 2 (net +2) |
| 6 | Win double (net + wager) |

### 2.7 Spells

| Spell | When | Effect |
|---|---|---|
| **Re-roll** | After rolling, before moving | Re-roll one chosen die. Points and direction type are recalculated, and webbed halving still applies. |
| **Dark One's Luck** | After rolling, before moving | Set both dice to any faces from 1 to 6. |
| **No Clipping** | Armed during roll, choose or redirect | If the next square is solid, count the run of solid squares `k`. If the square after the run is inside the map, `steps left >= k + 1`, and that square is not an enemy (unless you're invisible), the move passes through the walls. Each wall square costs 1 point. Then you land normally. One charge = one wall crossing. |
| **Invisibility** | Armed during roll, choose or redirect | Lasts the rest of the turn. Pass through enemies with no encounter. |
| **Fireball** | During roll, choose or redirect | Destroy any one active web, enemy or locked door on the floor. A burned door becomes an open doorway. |

Armed spells cost a charge only if they take effect. An armed but unused spell is disarmed at the end of the turn and keeps its charge.

### 2.8 Floor content and size

Floor `f` is `w × h` squares, including the outer wall:

```
w = 17 + 2 * min(2, floor((f-1)/3))   // 17 … 21 (capped so floors fit phone screens)
h = 13 + 2 * min(1, floor((f-1)/4))   // 13 … 15
```

| Content | Count (`rng.int(a, b)` includes both ends) |
|---|---|
| Coins | `int(4, 7)` |
| Chests | `int(f < 3 ? 0 : 1, 1 + min(2, floor(f/10)))` |
| Hearts | `int(1, 2)` |
| Med packs | `f >= 3 ? int(0, 1) : 0` |
| Webs | `min(6, 1 + floor(f/3) + int(0, 1))` |
| Enemies | `min(8, 1 + floor(f/3) + int(0, 1))` |
| Locked doors (wanted) | `f == 1 ? 0 : int(f < 4 ? 0 : 1, min(3, 1 + floor(f/8)))`. Fewer may be placed (see 4.3). |
| Portal pairs | `f >= 4` and a 40% chance: 1 pair. If also `f >= 15`, a further 40% chance makes it 2 pairs. |

Key and lock colors, in order: `gold, crimson, azure, emerald`. Portal pair colors, in order: `violet, teal`.

### 2.9 Dark floors

| Rule | Detail |
|---|---|
| **Which floors** | `rules.isDarkFloor(seed, f)`. Never floors 1–5, never shop floors, never two in a row. The chance is `min(40%, 15% + 1% × (f − 6))`. Each floor rolls on `seedFor(seed, 'dark', f)`. Floors are walked in order and cached per seed, so the "never two in a row" rule is consistent. |
| **Vision** | Without light: the 8 squares around the player. With a lit torch: every square within `TORCH_RADIUS = 4` (Chebyshev distance) with a clear line of sight. Line of sight is a Bresenham line, and the squares strictly between the ends must not be solid (walls and locked doors block light). |
| **Memory** | `rules.darkMemory(f)`:<br>• **Floors 6–19, `'full'`:** seen squares stay sketched (dimmed), and seen items stay marked.<br>• **Floors 20–34, `'layout'`:** seen squares stay sketched, but items show only while lit.<br>• **Floor 35+, `'none'`:** nothing is remembered.<br><br>On every dark floor, enemies show only while lit, seen stairs always stay clearly marked, and your own pencil trail is always drawn. |
| **Torches** | A found torch lights at once. A torch bought in the shop is carried (`player.torches`) and lit with the torch button, only on a dark floor that isn't already lit. A lit torch lasts until the floor ends. |
| **Rules unchanged** | Movement works the same, so you can walk blind into anything. |
| **What darkness limits** | The hover preview stops at the first square you can't see. Fireball can only target obstacles you can see. A No Clipping arrow whose landing square is unseen is drawn on the wall instead. |

---

## 3. Architecture

```
web/
├── index.html        page shell; loads scripts in dependency order
├── css/style.css     theme tokens (light/dark), layout, SVG element styles
├── js/rng.js         hashStr, RNG (mulberry32), seedFor
├── js/rules.js       formulas + shop schedule           (needs rng)
├── js/levelgen.js    generateLevel, reach                (needs rng, rules)
├── js/game.js        Game class: state machine & rules   (needs all above)
├── js/render.js      SVG symbols & board/dice markup     (needs DC only)
├── js/ui.js          DOM, input, animation, modals, save (needs all)
└── tests/run-tests.js  Node test suite (loads rng, rules, levelgen, game)
```

**Module pattern.** Every file is an IIFE that attaches to a shared global namespace:

```js
(function (root) {
  const DC = (root.DC = root.DC || {});   // only rng.js creates it; later files use root.DC
  ...
  DC.thing = thing;
})(typeof window !== 'undefined' ? window : globalThis);
```

This lets the same files run in the browser and under Node (`require` puts them on `globalThis`). `ui.js` is browser-only.

**Layering rules.**
- `game.js` and everything below it must never touch the DOM. That is what makes them testable in Node.
- `render.js` returns markup strings and never changes game state.
- `ui.js` is the only file that changes the page or calls `localStorage`.

---

## 4. Algorithms

### 4.1 Randomness (`rng.js`)

- `hashStr(str)` is a cyrb53-style 32-bit hash.
- `seedFor(...parts)` returns `hashStr(parts.join('|'))`. It derives an independent seed for each stream.
- `RNG` is mulberry32. Its whole state is a single uint32 (`rng.state`), so it is easy to save. Methods: `next()` (a float in [0, 1)), `int(a, b)` (both ends included), `die(n)`, `chance(p)`, `pick(arr)`, `shuffle(arr)` (shuffles in place and returns the array).

**Random streams.** Keep them separate, so that changing one doesn't shift the others.

| Stream | Seed | Used for |
|---|---|---|
| Floor layout | `seedFor(seed, 'floor', f)` | `generateLevel` |
| Shop schedule | `seedFor(seed, 'shops')` | `rules.shopSchedule` (cached per seed) |
| Shop stock | `seedFor(seed, 'shop', f)` | `Game.makeShop` |
| Dice | `seedFor(seedText, 'dice', f)`, reset on entering each floor | Every in-game die: movement, chest d6, med pack d4, Re-roll, Gamble. The current state is `state.diceState`. |

`seed` is `hashStr(seedText)`. The dice stream restarts at each floor, so a floor loaded from its checkpoint replays identically when the player makes the same choices. This "retry" is accepted by design.

### 4.2 Room layout (binary space partition)

Regions are measured on wall lines. A region `{x0, y0, x1, y1}` has walls at `x0`, `x1`, `y0` and `y1`. Its interior runs from `x0+1 … x1-1` by `y0+1 … y1-1`, so it is `iw × ih` where `iw = x1-x0-1`.

```
split(region):
  canV = iw >= 7 ; canH = ih >= 7           // 3 + wall + 3
  big  = iw > 8 || ih > 7
  if (!canV && !canH) or (!big and chance(0.45)): leaf → room
  orientation: if both possible → vertical with p=0.75 when wider, 0.25 when taller, else 0.5
  vertical cut at s = int(x0+4, x1-4)  (horizontal similarly) → recurse on both halves
```

Neighboring rooms share a one-square wall, which gives the "graph paper" look. Every square that is not inside a room is wall: `tiles[i] = 0`. Room interiors are `1`.

### 4.3 Doorways, start, stairs and locks (`levelgen.js` → `tryGenerate`)

1. **Find neighbors.** Rooms A and B are neighbors if they share a wall line (for example `A.x1 == B.x0`) and their interiors overlap along it. The candidate doorway squares are the overlapping squares on that shared wall.
2. **Connect the rooms.** Run Kruskal's algorithm on the shuffled list of neighbor pairs to build a spanning tree, so every room is connected. Each pair that isn't needed for the tree still gets a door with a 20% chance, which creates loops.
   - For each chosen pair, pick one random candidate square and set it to doorway: `tiles = 2`.
   - Because a doorway sits inside a straight wall, the squares on either side of it along the wall are always wall.
3. **Start and stairs.** The start goes on a random square of a random room. The stairs go on a random square of a room that is farthest from the start room, measured as a breadth-first search over the room graph.
4. **Locks.** Shuffle the doorways. For each one that is still reachable from the start, lock it as a trial. Keep the lock only if both of these hold:
   - the area reachable from the start shrinks by **more than 1 square** (the doorway itself always drops out), and
   - at least 12 free room squares remain reachable.

   Otherwise unlock it. Stop once the wanted number of locks is reached.
5. **Keys.** Each key goes on a random free room square in the final start zone, which is the area reachable with every lock closed.
6. **Portals.** Find the connected areas with all locks closed. Pick an area that spans at least 2 rooms. Put end A on a random square in it. Put end B in a different room of the same area, preferring squares at least 6 apart (Manhattan distance) from A. The two ends store each other's index in `objects` as `pair`.
7. **Items and obstacles.** Boons go on any free room square. Webs and enemies go only on squares outside the start room that are more than 1 square away from the start (Chebyshev distance).
8. **Retries.** If a step fails (no free square, or the room graph isn't connected), `tryGenerate` returns `null`. `generateLevel` then tries again with the same random stream, up to 50 times, and throws an error after that.

`reach(L, sx, sy, blockedSet)` is a 4-way flood fill over squares that aren't walls. It returns `{seen: Uint8Array, size, cells}`. Squares whose index is in `blockedSet` are skipped.

### 4.4 Movement engine (`game.js`)

**The core functions:**

- `legalMove(dir, stepsLeft, fx?, fy?)` returns `{kind: 'normal'|'noclip', x, y, walls}` or `null`. It applies the rules in 2.2 and 2.7.
- `availableDirs()`:
  - Takes the four directions of the current type and keeps the legal ones.
  - In the `redirect` phase it also removes the opposites of `usedDirs`, unless that would leave nothing.
- `step()` advances one square and returns an event.
  - The UI calls `step()` in a loop, about every 120 ms, while `phase === 'moving'`.

**What `step()` does, in order:**
1. Check `legalMove`.
2. If the move is illegal, switch to `redirect`, or end the turn if no direction is available.
3. If it's a No Clipping move, walk through the walls, adding them to the trail, and spend the charge.
4. Spend 1 point.
5. Resolve an enemy or locked door on the target square.
6. Call `moveTo`.
7. Call `onEnter`, which handles the stairs, items, webs and portals.

**Events returned by `step()`:**

| Event | Meaning | UI pause |
|---|---|---|
| `step` | Moved one square | 120 ms |
| `teleport` | Went through a portal | 380 ms |
| `redirect` | Blocked; waiting for a new direction | — |
| `fight` | A surviving enemy ended the move | 300 ms |
| `web` | Caught in a web | 300 ms |
| `stairs` | Floor finished | — |
| `end` | Turn over | — |
| `dead` | Player died | — |
| `idle` | `step()` called when not moving | — |

**Ending a turn.** `endTurn(msg)` calls `finishTurnFlags()`, which:
- spends the Invisibility charge if it was used,
- clears the armed spells, `move` and `usedDirs`,
- adds 1 to `turn`,
- sets the phase back to `roll` (unless the player is dead).

### 4.5 Phase state machine

```
            roll() ──────────────► choose ──choose(dir)──► moving ──step()…──┐
   ▲                                │  ▲                     │  ▲            │
   │                       passTurn()  └─ reroll/luck/arm     │  └ choose(dir)
   │                                ▼                         ▼     redirect
  roll ◄──────── endTurn() ◄──── (no moves / web / fight / out of steps)
   │
   ├─ stairs reached ─► levelDone ──nextFloor()──► roll (new floor) | shop
   ├─ hp == 0 ───────► dead
   └─ shop floor ────► shop ──nextFloor()──► roll | shop
```

| Phase | Allowed actions |
|---|---|
| `roll` | Roll, Fireball, arm No Clipping or Invisibility |
| `choose` | Choose a direction, Pass (only when no direction is legal), Re-roll, Dark One's Luck, Fireball, arm spells |
| `moving` | Nothing (the UI is animating) |
| `redirect` | Choose a direction, Fireball, arm spells |
| `levelDone` | `nextFloor()` |
| `shop` | `buy(i)`, `gamble(w)`, `nextFloor()` |
| `dead` | Start a new game |

Every action method in `game.js` returns `false` (or `null`) when it isn't allowed. That makes it safe to call from any input handler.

---

## 5. Data model (`game.s`, the in-memory state)

```js
{
  version: 1,                 // in-memory shape; only checkpoints are saved (section 6.5)
  seedText: 'moss-rune-42', seed: <uint32>,
  floor: 1, turn: 0, floorStartTurn: 0,
  phase: 'roll',              // see 4.5
  player: { x, y, hp, maxHp, str, coins, keys: ['gold'], webbed: false, torches: 0,
            spells: { noclip, fireball, luck, reroll, invis } },
  diceState: <uint32>,        // dice RNG state
  dice: [d1, d2] | null, steps: 0, parity: 'ortho'|'diag', halved: false,
  usedDirs: ['E', 'S'],       // directions taken this turn
  turnPath: [37, 38, 39],     // cell indexes (y*w+x) walked this turn; reset each turn
  move: { dir, stepsLeft } | null,
  armed: { noclip: false, invis: false }, invisUsed: false,
  level: Level | null,        // null on shop floors
  shop: { floor, items: [{ id, sold }], lastGamble } | null,
  log: [{ text, kind, turn }],// newest last, capped at 60
  checkpoint: Checkpoint,     // what gets saved: start of this floor, or of the next once finished
  stats: { kills, coins, floorsCleared },
  summary: { floor, turns, next, nextIsShop }   // set on levelDone
}
```

**Level:**

```js
{
  floor, w, h,
  tiles: number[w*h],          // 0 wall, 1 room floor, 2 doorway; index = y*w + x
  rooms: [{ x0, y0, x1, y1 }], // wall-line coordinates
  doorways: [{ x, y }],
  start: { x, y }, stairs: { x, y },
  objects: [Obj],
  trail: [[[x, y], ...], ...], // drawn path; a new segment starts after each portal jump
  dark?: true,                 // dark floor (2.9)
  torchLit?, seenStairs?,      // set during play on dark floors
  seen?: (0|1)[w*h]            // squares ever seen on this floor (dark floors)
}
```

**Obj:**

```js
{ type: 'coin'|'chest'|'darkchest'|'heart'|'medpack'|'key'|'lock'|'web'|'enemy'|'portal'|'torch',
  x, y,
  color?,         // key, lock, portal
  hp?, maxHp?,    // enemy
  pair?,          // portal: index of its twin in objects
  done?,          // used up, killed, or opened. Kept so the renderer can cross it out.
  seen?,          // dark floors: has been in sight (for 'full' memory)
  burned?         // destroyed by Fireball
}
```

Objects are never removed from the array, because portals point at each other by array index. Instead they get `done: true`.

`Game.objAt` is an index built at runtime (`Int32Array` of size `w*h`, with -1 meaning empty) that lists **active** objects only. It is not saved. `rebuildIndex()` rebuilds it after a load or a floor change, and `clearObj(o)` keeps it in sync during play.

---

## 6. Rendering (`render.js`)

- **Symbol sheet.** `SYMBOLS` is a string of `<pattern>` and `<symbol>` definitions. `ui.js` injects it once into a hidden `<svg>` in `#sprites`. The board and every HTML icon draw from it with `<use href="#id">`.
  - **Map symbols:** `i-start`, `i-stairs`, `i-coin`, `i-chest`, `i-heart`, `i-medpack`, `i-web`, `i-enemy`, `i-key`, `i-lock`, `i-door-open`, `i-portal`, `i-player`, `i-cross`
  - **Spell and shop icons:** `i-sp-noclip`, `i-sp-fireball`, `i-sp-luck`, `i-sp-reroll`, `i-sp-invis`, `i-sp-maxhp`, `i-sp-heal`, `i-sp-str`, `i-sp-gamble`
  - **Patterns:** `grid`, `hatch`
- **Theming inside symbols.** Use `style="fill:var(--token)"`. Don't use CSS classes. Custom properties pass into `<use>` shadow trees reliably; class selectors don't.
  - Per-instance color (keys, locks, portals) comes from `currentColor`, set with `style="color:…"` on the `<use>`.
- **Grid.** Each square is `C = 32` SVG units. The board's `viewBox` is `0 0 w*C h*C`.
- **Layers.** `#board` contains three `<g>` layers:
  1. `.static`: paper, grid, wall fill plus hatch, and the outline edges. Rebuilt only when the floor changes (`ui.boardKey`).
  2. `.dyn`: start, trail, objects, then (on dark floors) the fog, then stairs, player, and the direction arrows or Fireball targets. Rebuilt on every `render()`.
     - **Fog** (`fogLayer`): one `.fog` rect covering the map, filled with `--fog`. An SVG mask (`#fog-mask`) cuts it open: lit squares black (fully clear), remembered squares grey (dimmed). The mask is softened by the `#fog-soft` blur.
     - Objects hidden by darkness aren't drawn at all, so nothing leaks through.
     - `game.vis` (a Set of cell indexes, or `null` on lit floors) and `game.isVisible(x, y)` come from `game.updateVision()`. That runs after every move, teleport, torch, fireball and floor change.
  3. `.preview-layer`: the dashed hover preview from `game.previewPath(dir)`. It has `pointer-events: none`, and it is redrawn **without** touching `.dyn`. If hovering rebuilt the arrows, the element under the mouse would be replaced and the click would be lost.
- **Clickable elements.** Arrows are `<g class="arrow" data-dir="NE">`. Fireball targets are `<rect class="target" data-target="<objIndex>">`. `ui.js` handles them through event delegation on `#board`.
- **Roll-and-write look.**
  - Used-up objects get the `.done` class (half opacity) and an `i-cross` pencil X.
  - Opened locks switch to `i-door-open`.
  - The trail is a red pencil polyline.
- **Other drawing.** `dieSvg(v)` draws a die face (`v = 0` shows "?"). `shopScene()` draws the shop floor's storefront. `icon(id, cls, color)` returns a small standalone `<svg>` for HTML.

### CSS tokens (`style.css`)

The tokens are defined on `:root`: `--fog --paper --page --grid --ink --muted --pencil --wall --hatch --stone --sun --web --enemy --player --die --good --bad --warn --spell --accent --card --line --shadow --font`.

The dark values are written out twice:
- under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`
- under `:root[data-theme="dark"]`

When you add a token, add it in **all three places**. The theme button saves its choice in `localStorage` under `dicedelve-theme`.

Journal entries use the classes `log-<kind>`. Don't use a bare `<kind>`: the `spell` kind once clashed with the `.spell` button style.

---

## 6.5 Saves (checkpoints)

Everything about a floor (layout, items, enemies, shop stock, dice) comes from the seed and the floor number. So a save stores only what carries between floors:

```js
// Checkpoint (CHECKPOINT_VERSION = 2)
{
  v: 2,
  seedText: 'moss-rune-42',
  floor: 7,                                   // the floor to start
  player: { hp, maxHp, str, coins, torches, spells: { noclip, fireball, luck, reroll, invis } },  // torches optional (0)
  stats: { kills, coins, floorsCleared },     // optional; score screen only
  turn: 123                                   // optional; turn counter
}
```

**API in `game.js`:**

| Call | What it does |
|---|---|
| `game.checkpointFor(floor)` | Builds a checkpoint from the current stats |
| `enterFloor(f)` | Sets `s.checkpoint = checkpointFor(f)` and resets the dice to `seedFor(seedText, 'dice', f)` |
| `completeFloor()` | Sets `s.checkpoint = checkpointFor(floor + 1)`, so a save made on the "floor cleared" screen resumes on the next floor |
| `Game.validateCheckpoint(cp)` | Returns `null` if valid, otherwise a short reason. Every field is type- and range-checked (`hp` from 1 to `maxHp`, all five spells present, and so on). |
| `Game.fromSave(data)` | Returns `{ game }` or `{ error }` |

`Game.fromSave` accepts three kinds of input:
- a bare checkpoint;
- an export wrapper (`{app: 'dice-delve', save}`);
- an older version-1 full-snapshot save. That is converted to a checkpoint for its current floor, or the next floor if it was finished. A dead run is refused.

**Rules for saves:**
- **Progress inside a floor is never saved.** Loading starts the floor fresh, with the stats the player had when they entered it.
- **Retrying is accepted.** A reloaded floor has the same layout and the same dice. On a shop floor, reloading undoes purchases along with the coins spent.
- **Generator changes are safe.** If a code update changes how floors are generated, an old save simply gets a new (valid) floor at the start, so a player can never be placed inside a wall.
- **Spoofing.** Saves are plain JSON on the player's machine and can be edited (for example, coins). Validation stops malformed or malicious data, not cheating. It's a single-player game, so this is accepted.
- **When something new carries between floors** (for example a new spell, or a new stat): add it to `checkpointFor`, `validateCheckpoint` and `fromSave`. If an old checkpoint can't be read the same way any more, bump `CHECKPOINT_VERSION`. For an addition, give old saves a default value instead.

## 7. UI layer (`ui.js`)

- **Saving.** `render()` draws the HUD, the board and the side panel from `game.s`. After every state change, call `render(); save();`.
- **Moving.** `choose(dir)` is async:
  1. Call `game.choose`.
  2. Set `ui.busy = true`.
  3. While the phase is `moving`, call `step()`, then `render()`, then wait.
  4. Set `ui.busy = false`, then save, then call `afterPhase()`. That opens the level-done, death or shop screen.
- **Page layout** (`index.html`, `style.css`):
  - **Header:** stats on the left. On the right: a **Journal** button with an unread count, then the menu buttons (Rules, New, Saves, theme).
  - **Main area:** the map (`.board-wrap`, with a `#toast` over it), plus one `.controls` panel holding the dice, status, direction pad and spells.
  - **Three layouts, chosen by CSS media queries on screen size, never by detecting the device:**
    - **Desktop:** controls in a column on the right.
    - **Phone portrait** (≤ 860 px wide): the map fills the screen and the controls dock at the bottom.
    - **Phone landscape** (≤ 560 px tall): the map on the left and a slim control column on the right.
  - On narrow or short screens, the brand and turn counter are hidden, and the menu buttons fold into a ☰ dropdown (`#menuToggle`, `#menuItems`).
- **Journal.**
  - The log is never shown in the main page. `showJournal()` opens it in a modal and marks entries read.
  - Every entry has an increasing `seq` (`state.logSeq`).
  - `renderJournal()` shows the unread count on the button. It also shows the newest entry of an important kind (`TOAST_KINDS`) as a toast for about 2.6 s.
- **Roll and Pass.**
  - `#padCenter` is the middle of the direction pad. Its `data-mode` is one of:
    - `roll` in the roll phase;
    - `pass` when no direction is legal;
    - `count` otherwise, showing the moves left (disabled).
  - There is no separate Roll button.
- **Tap to move.**
  - A click or tap anywhere on `.board-wrap`, including just outside the drawn map, picks a direction with `dirFromEvent(e)`. It measures the angle from the player's square to the tap and picks the legal direction nearest that angle, if it is within 45°.
  - Taps closer than half a square to the player are ignored. If no legal direction is near the tap angle, the arrows pulse (`#board.nudge`).
  - With a mouse, the same calculation drives the dashed preview while hovering.
  - The on-map arrows and the pad still work. There is no swipe.
- **Phase checks.** Input handlers check `ui.busy` and `ui.targeting`. Game rules are enforced by `game.js`, not by the UI.
- **Modals.** `openModal(html, dismissable)` and `closeModal()`. Screens: start (seed, Continue, New, Rules), help, level done, death, shop, Re-roll picker, Dark One's Luck picker.
- **Keys.**
  - Space, Enter or R: roll, or pass when no move is legal (the same as tapping the pad center).
  - Arrow keys or WASD: orthogonal moves. Q, E, Z, C: diagonal moves.
  - Number pad: 8, 2, 4, 6 for orthogonal and 7, 9, 1, 3 for diagonal.
  - Esc: cancel Fireball targeting or close a modal.
- **Saving** (details in section 6.5).
  - Auto-save writes `game.s.checkpoint` to `localStorage` whenever it changes, which happens when a floor starts or is finished. It is deleted when the player dies.
  - **Saves** menu (`showSaves`):
    - Up to 12 named slots in the browser, each `{id, name, savedAt, meta, save: Checkpoint}`. It has Save, Load, Overwrite and Delete (Delete asks to confirm).
    - A **save code**: `DD2.` followed by the checkpoint JSON in base64url. Copy and paste.
    - **Export** downloads `{app: 'dice-delve', savedAt, save: Checkpoint}` as `.json`. **Import** loads one.
  - Every load (auto-save, slot, code or file) goes through `Game.fromSave`.
- **Storage keys.**
  - `dicedelve-save-v1`: the auto-save checkpoint. Deleted when the player dies. (The key name predates checkpoints.)
  - `dicedelve-slots-v1`: the save slots.
  - `dicedelve-best-v1`: the deepest floor reached.
  - `dicedelve-theme`
  - Every storage call is wrapped in try/catch, so the game still runs when storage is blocked.
- **Reduced motion.** `prefers-reduced-motion` cuts animation delays to 40 ms or less and turns off the pulse and tumble animations.

---

## 8. Tests (`tests/run-tests.js`)

The suite loads `rng`, `rules`, `levelgen` and `game` into Node and checks:

- **Formulas** at boundary values.
- **The shop schedule:** floor 5, gap range, and the at-most-2-in-10 rule for every window up to floor 600, across several seeds.
- **Level invariants** for floors 1–80 on 6 seeds: room size ≥ 3×3, closed border, object placement, lock walls on opposite sides, one key per lock, keys reachable with all locks closed, full connectivity, stairs reachable, portal pairing and lock zones, obstacles present.
- **Determinism:** the same seed gives the same level.
- **Scripted scenarios** on small hand-made maps (`sandbox([...rows])`, where `#` is wall, `D` is doorway, `@` is start and `>` is stairs). They cover parity, sliding, redirect and no doubling back, webs, combat, keys and locks, portals, every spell, and the shop and gamble payouts.
- **Dark floors:** the selection rules (never floors 1–5, shops or two in a row, and a sensible frequency); one torch reachable without keys outside the start room, plus one dark chest; vision radius; walls blocking light; memory; stairs staying marked; preview and fireball limited to what you can see; carried, found and shop torches; the torch resetting each floor; torches in checkpoints.
- **Saves:** a checkpoint round-trips; a reloaded floor replays identically with the same choices; stats carry over; shop checkpoints open the shop; older saves convert; tampered checkpoints are rejected.
- **Random play:** 25 simulated games choosing random legal moves (with huge health) for 30 floors or 4,000 actions. It checks that the player never ends up inside a wall, that the game never loops forever, and that the phases are always valid.

Run it after **every** change. For UI changes, also open the page and play a few turns, checking both themes and a phone-width (about 390 px) window.

---

## 9. Recipes for common changes

### Change a balance number
- **Formulas** (damage, health, coins, hearts, dice count): `rules.js`.
- **Starting stats:** `rules.START_HP` and `rules.START_STR`.
- **Content counts and map size:** the `place(...)` calls and `w`/`h` in `levelgen.js`.
- **Prices:** `Game.price()`.

Update the matching rows in section 2 of this file and any boundary values in the `formulas` test.

### Add a new map object (for example a "trap")
1. **`levelgen.js`:** add `place('trap', count, pool)`. Use the `awayFromStart` pool if it is harmful.
2. **`game.js`:** handle it.
   - For an effect when you step on it, add a `case 'trap':` in `onEnter`. Return an event, and call `endTurn` if it should stop movement.
   - For an effect that blocks or happens on contact, add it in `step()` before `moveTo`.
   - If it should block movement, include it in `isSolid` and `blocksEntry`.
3. **`render.js`:** add `<symbol id="i-trap" viewBox="0 0 32 32">` using `var(--…)` styles. `objectSvg` finds it automatically as `'i-' + o.type`.
4. **`ui.js`:** add a line to the help screen's map key.
5. **Tests:** add a sandbox scenario, and extend the generation checks if it has placement rules.
6. Update section 2.4 of this file.

### Add a new spell (for example "teleport")
1. **`game.js`:**
   - Add it to `SPELLS` (name and description).
   - Add a starting count of 0 in `player.spells` inside `Game.create`.
   - Add a price in `price()`.
   - Add it to `SHOP_POOL`.
   - Add a `canCast` case saying which phases allow it.
   - Write the method that applies it. It should spend the charge and log the result.
   - Spell counts carry between floors, so add the spell to `Game.validateCheckpoint` (and to `fromSave`, defaulting to 0 for older saves). See 6.5.
2. **`render.js`:** add an icon `i-sp-<id>`.
3. **`ui.js`:** add the id to `SPELL_ORDER`. Add a branch in `castSpell` (and a modal if it needs input). Check the spell grid's column count in CSS (`.spells`, currently 5).
4. Add a test in the `spells` scenario.

### Add a shop item that isn't a spell
Add it to `SHOP_POOL`, then add cases in `price()` and `buy()`. Add an entry in `SHOP_INFO` in `ui.js` (name, description, icon).

To make it always available, as Heal and Strength are, add it to the fixed list `['heal', 'str', ...]` in `makeShop`, and don't mark it `sold` in `buy()`. Keep the test `shop items` in step with the new item count.

### Change the shop schedule
Edit `rules.shopSchedule`. The `shop schedule` test encodes the current rule. Update that test together with the rule.

### Change the level generator
Keep the invariants in 2.5. The `level generation invariants` test catches most mistakes. Note that changing the order or number of RNG calls in `tryGenerate` changes every floor for every seed. That is fine, but saves made before the change will keep the floor they were on (because `level` is stored in the save) and get new floors after it.

### Change movement rules
- **Legality:** `legalMove`.
- **The no-doubling-back rule:** `availableDirs`.
- **What happens on each square:** `step` and `onEnter`.

Update the matching sandbox tests and section 2.2.

---

## 10. Invariants and pitfalls

- **Use the dice RNG.** In game logic, every random number must come from `this.d(n)` (the dice stream) or a seeded `RNG`. Never use `Math.random`, or determinism and replays break.
- **Keep `game.s` as plain JSON.** No class instances, no `Map` or `Set`, no typed arrays, no functions. Rebuildable caches such as `objAt` belong on the `Game` object, not in `s`.
- **Never splice `level.objects`.** Portal `pair` values are array indexes. Mark objects `done` instead.
- **Use `clearObj(o)`** to deactivate an object, so `objAt` stays in sync.
- **The UI never sets `s.phase` directly.** It goes through `Game` methods.
- **Classic scripts only.** Keep the `<script>` tags in dependency order. Switching to ES modules breaks opening the page from `file://`.
- **External resources.** The only one is the Google Font *Patrick Hand*, and the CSS falls back to system fonts. Don't add other remote assets. The game should work offline.
- **Keep mobile working.** The layout must not scroll sideways at 390 px width. Touch targets must stay at least 44 px (pad, spell and shop buttons).
- **When rules change, update three things together:** the code, the help screen in `ui.js` (`showHelp`), and section 2 of this document.
