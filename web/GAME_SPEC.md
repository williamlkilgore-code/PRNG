# Dice Delve: Game Specification & Developer Guide

This document gives a developer or coding agent enough detail to rebuild Dice Delve from scratch, or to change the existing code without breaking it. It covers four things:

1. The game rules.
2. The architecture and data model.
3. The algorithms, with their exact constants.
4. Recipes for common changes, plus the invariants the code relies on.

> **Experimental branch (`experimental/movement`).** This branch differs from the main branch in several ways:
> - **One-die movement:** roll 2d6 and keep **one** die, chosen by the player. It gives the move count, the direction type (by its parity) and the shot range (2.2).
> - **An optional tutorial** that doesn't count as floors (2.3).
> - **Simpler floors 1–10** (2.8).
> - **A base hero with classes and level-ups** (2.12).
> - **Cut-scenes** (7).
> - **Saves mirrored to IndexedDB** (6.5).
> - **Three levelled spells:** Invisibility, Re-roll and Glowing Orb, at levels 1–5. Fireball, Dark One's Luck and No Clipping are gone (2.7).

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
| Health (`hp`) | 7 (`START_HP`) | 0 means death and the game ends |
| Max health (`maxHp`) | 7 | Healing never goes above this |
| Strength (`str`) | 1 | Damage dealt to an enemy per encounter |
| Coins | 0 | Spent in shops |
| Keys | none | Colored keys. Cleared when you enter a new floor |
| Spell charges (`spells`) | 0 of each | `invis`, `reroll`, `orb`. Anyone casts at level 1 for 3 charges; Wizards study them (2.7) |
| Dexterity (`dex`) | 1 | Added to lock-pick rolls (2.10) |
| Sling stones (`ammo`) | 0 (`START_AMMO`) | One per Rogue shot (2.10, 2.12) |
| Class (`cls`), `level` | `null`, 0 | The base hero. A class comes at 10 kills (2.12) |
| `known`, `casts` | all 0, 0 | The Wizard's spell levels and casts left this floor (2.7) |
| `range`, `moveBoost` | 0, 0 | The range and move boosts (2.12) |
| Lock picks (`lockpicks`) | 0 | Used up on every attempt (2.10) |
| Torches (`torches`) | 0 | Carried torches (2.9) |

### 2.2 Turn and movement

1. **Roll** 2d6, then **pick one die** with `pickDie(i)` (stored in `s.die`). Its value `T` is used, and the other die is discarded.
   - Doubles are picked automatically (`computeSteps()` sets `die = 0`).
   - You can switch dice until you move or shoot.
   - Until a die is chosen, `steps = 0`, `parity = null`, and no direction, shot or pass is allowed.
   - Re-roll attempts keep the chosen die and recompute.
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
6. **No doubling back.** While redirecting, every legal direction is offered except the exact reverse of the direction you were just moving in (`OPP[move.dir]`). That reverse is offered only when it's the only legal move.
   - Squares already walked this turn don't matter. For example, after a full lap around a room, you still can't turn straight back.
   - Walls and locked doors are already excluded by `legalMove`.
7. Some events end the move early: a web, an enemy that survives, or the stairs. See 2.4.

**A move into square (nx, ny) is legal when all of these hold:**
- The square is inside the map.
- The square is not a wall.
- The square is not a locked door, unless the player holds the key of that door's color.
- For a diagonal move: the two squares orthogonally between start and target are not both solid. "Solid" means wall or locked door. This rule stops a move from squeezing between two walls that touch at a corner.

### 2.3 Floors

The start square is drawn as a **smiley face**. The exit is a **staircase**. Stepping onto the stairs at any point in a slide ends the floor at once. Unused movement points are lost.

Every room's interior is at least **3×3**. Rooms are joined by one-square doorways in a shared wall that is one square thick.

**Tutorial floors.** The tutorial is optional and is played as "Tutorial 1/3" to "Tutorial 3/3" before the real floor 1. It doesn't count as floors: no floors cleared, no best-floor record, and no shops or dark floors. The layouts are hand-shaped (`generateTutorial(seed, t)` → `tutorialLevel` in `levelgen.js`, seeded with `seedFor(seed, 'tutorial', t)`, dice from `seedFor(seedText, 'tutorial-dice', t)`).

| Floor | Map | Rooms | Contents |
|---|---|---|---|
| 1 | 7×7 | One 5×5 room | The start in a random corner and the stairs in the opposite corner. 2–3 coins. Nothing else. |
| 2 | 13×7 | Two 5×5 rooms, joined by one doorway | The start in one room and the stairs in the other. 1–2 webs, always in the stairs room. 3 coins, 1 heart. |
| 3 | 13×11 | A 2×2 grid of 5×4 rooms, chained start → A → B → stairs (random corner and direction) | The door into the stairs room is locked, and its key is in A. 1 enemy and 1 web, in A and B (either way round). 1 chest, 1 heart, 1 med pack, 3–4 coins. No portals. |

Real floors 1 and up use the normal generator.

**Playing or skipping it.** `Game.create(seed, { tutorial: true })` sets `s.tutorial = true` and starts on tutorial 1. Without it, the game starts on floor 1. After tutorial 3, `nextFloor()` clears `s.tutorial` and enters floor 1.
- The New game screen has a "Play the tutorial first" checkbox. It defaults to on for a new player, and the choice is remembered (`dicedelve-tutorial-v1`).
- Floor-based rules (shops from 5, dark floors from 6, stalkers from 12, mimics from 19) count real floors only.

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
| **Body** | Left where an enemy dies in melee or to a stone or missile. Holds 1–2 sling stones (d2), picked up when you pass over it. |
| **Lock pick** | From floor 4, a floor with a lock has a 30% chance of a lock pick in the start zone. Picked up and carried. |
| **Stalker** | An enemy with `stalker: true` (floor 12+). It hunts you (2.10). |
| **Dark chest** | Only on dark floors. Gives the chest's coins plus 1 random spell (one of the 5 kinds, rolled on the floor's dice). |
| **Mimic** | From floor 19 (2.11). A hidden chest mimic (`type: 'mimic'`) looks like a chest, or a fake door (`type: 'lock', mimic: true`) looks like a locked door. Touching one starts an ambush. |
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
- **Always on sale:** **Heal** (restore to full), **Strength +1** and **Dexterity +1**. All can be bought again and again.
- **Random offers:** 4 more, drawn without repeats from `maxhp, gamble, torch, ammo, lockpick` (stones only for Rogues; spells are never sold). These can each be bought once, except Gamble, which can be played again and again.

**Prices.** `t = floor(f/10)`.

| Item | Price |
|---|---|
| Heal (to full) | `2 + ceil((maxHp - hp)/2) + t`. Can't be bought at full health. |
| Strength +1 | `8 + 4*(str - 1) + 2t` |
| Max Health +2 | `6 + 2t`. Also raises current health by 2. |
| Torch (carried) | `4 + t` |
| Dexterity +1 | `8 + 4*(dex - 1) + 2t` |
| Sling stones ×3 | `3 + t` |
| Lock pick | `4 + t` |

**Gamble.** Wager from 1 up to your coins, then roll 1d6:

| Roll | Result |
|---|---|
| 1–2 | Lose the wager |
| 3–4 | Money back (net 0) |
| 5 | Money back plus 2 (net +2) |
| 6 | Win double: money back plus twice the wager (net +2 × wager) |

### 2.7 Spells (experimental)

There are three spells, each with levels 1 to 5. Their data is `SPELLS` in `game.js`, and `at(lv)` describes a level.

| Spell | When | Level x (1–4) | Level 5 |
|---|---|---|---|
| **Invisibility** (`invis`) | roll, choose or redirect, if not already invisible | `s.invis = {turns: x, level, wall}`. Enemies are passed through with no encounter, hidden mimics aren't triggered, and stalkers can't see you. The cast turn counts as turn 1, and `finishTurnFlags` counts down. | 5 turns, plus walking through walls: `legalMove` returns `kind: 'noclip'` when the run of solid squares `k` is followed by an in-map square and `steps left ≥ k + 1`. Passing a wall sets `invis.wall`, and the spell ends at the end of that turn. |
| **Re-roll** (`reroll`) | choose, once per roll | `s.rerolls = {left: x}`. Each `rerollDie(i)` re-rolls one die on the floor's dice, keeping the chosen die. | `setDie(i, v)`: choose one die's value. |
| **Glowing Orb** (`orb`) | roll, choose or redirect, **dark floors only**, and only if stronger than an orb already cast | `L.orbRadius = rules.orbRadius(x)` = 4, 5, 6 or 7 for the rest of the floor. It works like a torch: walls block it, and the bigger of the torch and orb radius applies. | `L.floodTurns = 2`: every square is visible for 2 turns, then radius 8. `L.enemyMemory`: each enemy seen keeps `lastSeen`, drawn faded when out of sight, for the rest of the floor. |

**Who casts** (`canCast`, `cast`):
- **Wizards** cast any spell in `player.known` (its level 1–5), using one of `player.casts`.
  - `casts` refills to `rules.wizardSlots(level)` on every floor: one slot at Wizard levels 1, 2, 4 and 8.
  - A level-up that gains a slot adds a cast at once.
- **Everyone else** (the base hero, Fighter, Rogue) casts at level 1 by spending `CHARGES_PER_CAST = 3` charges.
- **Charges** (`player.spells`) come from dark chests and mimic hoards (one random spell each), and every class keeps them.
- **Studying** (`upgradeSpell`): a Wizard spends `upgradeCost(n) = 5n` charges of a known spell to raise it to level n. That's 10, 15, 20 and 25 charges. It's allowed in the roll, levelDone and shop phases.
- **Learning:** a Wizard learns one spell when choosing the class, and the **Spellcraft** boon (`chooseBoon('spell', name)`) learns a spell or raises it by 1.

### 2.8 Floor content and size

This section covers floors 4 and up. Floors 1–3 are the tutorial layouts in 2.3.

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
| **What darkness limits** | The hover preview stops at the first square you can't see. A level 5 Invisibility wall-walk arrow whose landing square is unseen is drawn on the wall instead. The Glowing Orb (2.7) extends the light. |

### 2.10 Sling, stalkers and lock picks

| Rule | Detail |
|---|---|
| **Shooting** | Only in the `choose` phase (after rolling, before moving), with ammo, as an alternative to moving. `shoot(dir)` uses one of the roll's 4 direction types, and `shotDirs()` lists only directions with at least one open square. The stone flies up to `steps` squares (the chosen die, halved if webbed). It stops before walls and locked doors (and at a corner squeeze), and hits the first enemy for 1 damage. Ammo −1, then the turn ends. A miss still costs the stone. |
| **Bodies** | `killEnemy(o, dropBody)`. Melee, stone and missile kills push a `body` object with `ammo: d2` onto the enemy's square. |
| **Stalkers** | `rules.stalkerCount(f)` = 0 below floor 12, then `min(3, 1 + floor((f − 12)/8))`. `levelgen` flags that many of the placed enemies as `stalker`, chosen at random. |
| **Stalker turns** | `endTurn()` calls `moveStalkers()` after every turn except reaching the stairs. Each stalker that **sees** you moves 1 square toward you: the step that most reduces Chebyshev distance, then Manhattan distance, preferring straight steps. It never enters walls, locks, webs, items or other enemies, and obeys the corner rule. If it's already next to you, it attacks instead: the same `encounter()` as melee (it deals floor damage, you hit back with STR, and a kill leaves a body). |
| **Stalker sight** | `stalkerSees(o)`: a clear line of sight (`lineOfSight`). On a dark floor without your torch lit, only within 2 squares. With your torch lit, from any distance. |
| **Lock picks** | `legalMove` returns `kind: 'pick'` for a step into a locked door when you don't hold its key, you have a pick, the corner rule allows it, and you haven't declined that door this turn. Reaching it sets `phase = 'pickPrompt'` (`pickTarget` is the door's index), and the UI asks whether to use the pick. |
| **Picking** | `pickLock()` rolls d20 + DEX against `LOCK_TARGET` (gold 12, crimson 14, azure 16, emerald 18) and always uses up the pick. Success opens the door and continues the move (phase back to `moving`). Failure ends the turn in front of the door. |
| **Declining** | `declinePick()` adds the door to `declinedPicks`, so it counts as solid until the turn ends, and the slide goes on to the normal redirect. |
| **Odds** | `rules.pickChance(dex, color)` = `clamp(21 − (target − dex), 0, 20) / 20`. With DEX 1: gold 50%, crimson 40%, azure 30%, emerald 20%. Each extra DEX adds 5%. |

### 2.12 Classes and levels (experimental)

**The base hero** has 7 health, STR 1 and DEX 1. It has no ranged weapon (`canShoot()` is false) and can't cast. Stones and spells it finds are kept for later.

**Kills and levels.** Every kill counts, whatever the source: melee, a stalker fight, or a stone or missile.
- `rules.killsForLevel(n)`: level 1 needs 10 kills, and each later level needs `ceil(previous × 1.5)` more.
- `levelThreshold(n)` is the total: 10, 25, 48, 83, 136…
- `levelForKills(k)` turns a kill count into a level.
- `countKill(o)` emits `levelUp` when a threshold is crossed.
- `levelsOwed()` = `levelForKills(kills) − player.level`. While it is above 0, `roll()` refuses, and the UI opens the chooser.

**Choosing a class** (level 1): `chooseClass(cls, spell?)`. The values are in `rules.CLASSES`.

| Class | On choosing | Per level | Boons (`chooseBoon(id, spell?)`) |
|---|---|---|---|
| Fighter | +5 max health | +2 max health | `hp` (+2 max health) or `str` (+1) |
| Wizard | Learns 1 spell (the player picks it), 1 cast per floor, and an unlimited magic missile | +1 (a cast slot at levels 2, 4 and 8) | `spell` (learn or upgrade a spell; dropped once all are at 5) or `range` (+1) |
| Rogue | +2 max health, +2 DEX, 5 stones | +1 | `move` (+1) or `range` (+1) |

Each level-up adds the class's per-level health, and current health goes up by the same amount.

**What each class can use** (`canUse(kind)`):
- **Spells:** see 2.7. Wizards cast from known spells and `casts`, and everyone else from charges.
- **Ranged:** `hasRanged()` is a Wizard (no ammo needed) or a Rogue with stones.
- **Unusable loot is sold:**
  - Fighters and Wizards sell stones for 1 coin each (from bodies).
  - Anything already held is sold when the class is chosen (`sellUnusable`).
- **Shops:** `makeShop` never offers spells, and offers stones only to Rogues.

**Move boost (Rogue).** `choose()` makes the move `steps + moveBoost` long, with `move.extra = moveBoost`.
- After any square where `stepsLeft ≤ extra` (so at least the die's value has been moved), `step()` switches the phase to `stopPrompt`.
- `stopMove()` ends the turn there, and `continueMove()` goes on.
- During a `redirect`, `canStop()` also allows stopping.

**Range boost (Rogue and Wizard).**
- `freeTargets()` lists enemies that are visible, within Manhattan distance `range`, and in clear line of sight (`lineOfSight`).
- `shootAt(i)` shoots one of them directly. This works in the `choose` phase, before or after picking a die.
- Farther enemies still need `shoot(dir)` along the die's direction type, with the die's distance.

### 2.11 Mimics

| Rule | Detail |
|---|---|
| **Where** | Normal floors from `MIMIC_FROM = 19`. `levelgen` rolls `MIMIC_CHANCE = 0.3` once per floor, so there is never more than 1 mimic per floor. It picks a kind at random from the kinds that have a candidate, then one candidate. |
| **Chest mimic** | One of the floor's ordinary `chest` objects (never a dark chest) becomes `type: 'mimic'`. |
| **Door mimic** | A `lock` with `mimic: true` and no key, placed in an empty, unlocked doorway. That doorway is never on the only route anywhere: blocking it leaves every other floor square connected. With the real locks and this doorway closed, every key and the torch are still reachable. Its color is one of the floor's real lock colors (or a random one if there are none). Until it wakes it behaves exactly like a lock: it's solid, blocks light and stops shots. |
| **The tell** | The hidden sprites (`i-mimic`, `i-mimic-lock`) match the real ones except for tiny teeth at the seam. |
| **Waking** | Walking onto a chest mimic (unless Invisibility is armed: you slip past and it stays hidden). Walking into a door mimic with a key of its color (the key is kept). Choosing **Pick the lock** on it (the pick is kept, and there's no pick roll). |
| **Ambush** | `ambushMimic(o)`: d20 + DEX against `MIMIC_DODGE = 12`. If you reach it, you take `enemyDamage(f)`; otherwise twice that. The object becomes `{type: 'enemy', mimic: 'chest'\|'door', hp: maxHp: 2 × enemyHealth(f)}` on the same square. You stop on the square before it, and the turn ends (or you die). |
| **Fight** | After that it is an ordinary enemy that never moves: melee, sling and missile all work. It draws as `i-mimic-open` or `i-mimic-door`. |
| **Reward** | `mimicReward(o)`, from `killEnemy()`: `2 × (coinValue + sum of bonusDice d6)` coins plus 1 random spell charge, and the usual body. A dead door mimic is drawn as an open doorway. |

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
├── js/audio.js       Web Audio sound effects & music       (needs rng)
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
- `ui.js` is the only file that changes the page. `audio.js` also uses `localStorage`, but only for its own volume settings.
- The engine never plays sound. It records what happened with `this.emit(type)`; the UI drains `game.drainEvents()` and hands each event to `DC.audio.sfx()`.

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
3. If it's a wall-walk (level 5 Invisibility), walk through the walls, adding them to the trail, and mark the spell to end this turn.
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
| `roll` | Roll, cast Invisibility or Glowing Orb, study spells (Wizard) |
| `choose` | Pick a die (`pickDie(i)`, required before anything below), choose a direction, Pass (only when no direction is legal), cast any spell (Re-roll: then `rerollDie`/`setDie`) |
| `moving` | Nothing (the UI is animating) |
| `choose` (extra) | Shoot with the sling (`shoot(dir)`) instead of moving |
| `redirect` | Choose a direction, cast Invisibility or Glowing Orb, `stopMove()` when `canStop()` |
| `stopPrompt` | `stopMove()` or `continueMove()` (move boost, 2.12) |
| `roll` (level owed) | `chooseClass()` / `chooseBoon()` first: `roll()` refuses while `levelsOwed() > 0` |
| `pickPrompt` | `pickLock()` or `declinePick()` (a slide reached a pickable door) |
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
  floor: 1, tutorial: false, turn: 0, floorStartTurn: 0,
  phase: 'roll',              // see 4.5
  player: { x, y, hp, maxHp, str, coins, keys: ['gold'], webbed: false, torches: 0, ammo: 0, dex: 1, lockpicks: 0,
            spells: { invis, reroll, orb },              // spell charges
            cls: null|'fighter'|'wizard'|'rogue', level: 0, range: 0, moveBoost: 0,
            known: { invis, reroll, orb }, casts: 0 },   // Wizard spell levels and casts left this floor
  invis: { turns, level, wall } | null, rerolls: { left, choose } | null,
  diceState: <uint32>,        // dice RNG state
  dice: [d1, d2] | null, steps: 0, parity: 'ortho'|'diag', halved: false,
  usedDirs: ['E', 'S'],       // directions taken this turn
  move: { dir, stepsLeft, extra } | null,   // extra = move boost (2.12)
  level: Level | null,        // null on shop floors
  shop: { floor, items: [{ id, sold }], lastGamble } | null,
  log: [{ text, kind, turn }],// newest last, capped at 60
  checkpoint: Checkpoint,     // what gets saved: start of this floor, or of the next once finished
  stats: { kills, coins, floorsCleared },
  summary: { floor, tutorial, turns, next, nextTutorial, nextIsShop }   // set on levelDone
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
  orbLevel?, orbRadius?, floodTurns?, enemyMemory?,  // Glowing Orb (2.7)
  seen?: (0|1)[w*h]            // squares ever seen on this floor (dark floors)
}
```

**Obj:**

```js
{ type: 'coin'|'chest'|'darkchest'|'heart'|'medpack'|'key'|'lock'|'web'|'enemy'|'portal'|'torch'|'body'|'lockpick'|'mimic',
  stalker?,       // enemy: hunts the player (2.10)
  mimic?,         // lock: true for a fake door; enemy: 'chest' or 'door' once revealed (2.11)
  ammo?,          // body: sling stones it holds
  x, y,
  color?,         // key, lock, portal
  hp?, maxHp?,    // enemy
  pair?,          // portal: index of its twin in objects
  done?,          // used up, killed, or opened. Kept so the renderer can cross it out.
  seen?,          // dark floors: has been in sight (for 'full' memory)
  lastSeen?       // enemy: [x, y] last seen (level 5 Glowing Orb)
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
// Checkpoint (CHECKPOINT_VERSION = 4)
{
  v: 4,
  seedText: 'moss-rune-42',
  floor: 7,                                   // the floor to start
  tutorial: false,                            // true: floor is tutorial 1-3
  player: { hp, maxHp, str, coins, torches, ammo, dex, lockpicks, spells: { invis, reroll, orb },
            cls, level, known: { invis, reroll, orb }, range, moveBoost },
  // known: levels 0-5, non-zero only (and at least one) for a Wizard. casts is not saved: it refills on load.
  // torches, ammo, dex, lockpicks and the class fields are optional; older saves get defaults (the base hero).
  // A level must match the class (0 with no class) and can't exceed levelForKills(stats.kills).
  // Version 2 saves load too: their floors 1-3 become tutorial floors, and later floors move up by 3.
  // Version 3 saves (five single-use spells) convert: invis and reroll charges are kept, fireball, luck and
  // noclip charges are sold for spellCoinValue each, and a Wizard's slots become known spells at level 1
  // (removed spells become the Orb).
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

**Browser storage (`ui.js`).** The autosave and the slots live in localStorage and are mirrored to IndexedDB (database `dicedelve`, store `kv`).
- At startup, `restoreMirror()` copies the mirror back if localStorage lost a key.
- After the first tap, the game calls `navigator.storage.persist()`. The Saves screen says whether storage is persistent.
- Cookies were considered and rejected: they're cleared together with other site data, Safari expires script-set cookies after 7 days, each holds only about 4 KB, and Chrome doesn't store them for `file://`.

**Rules for saves:**
- **Progress inside a floor is never saved.** Loading starts the floor fresh, with the stats the player had when they entered it.
- **Retrying is accepted.** A reloaded floor has the same layout and the same dice. On a shop floor, reloading undoes purchases along with the coins spent.
- **Generator changes are safe.** If a code update changes how floors are generated, an old save simply gets a new (valid) floor at the start, so a player can never be placed inside a wall.
- **Spoofing.** Saves are plain JSON on the player's machine and can be edited (for example, coins). Validation stops malformed or malicious data, not cheating. It's a single-player game, so this is accepted.
- **When something new carries between floors** (for example a new spell, or a new stat): add it to `checkpointFor`, `validateCheckpoint` and `fromSave`. If an old checkpoint can't be read the same way any more, bump `CHECKPOINT_VERSION`. For an addition, give old saves a default value instead.

## 7. UI layer (`ui.js`)

**Cut-scenes (experimental).** `playEvents()` turns engine events into scenes:
- **`kill`:** a burst and slash on the enemy's square, in the board's `.fx-layer`, using `game.lastKill`.
- **`mimic`:** the chest or door jolts, then its jaws snap open, using `game.lastMimic`.
- **`levelUp`:** a "LEVEL n" banner (or "CHOOSE YOUR PATH").
- **`classChosen`:** the class emblem.

The last three play one at a time in the `#scene` overlay, about 1.5 s each. Tap or Space skips a scene.
- The level chooser waits for the queue to finish (`whenScenesDone`).
- The scenes are turned on or off in Sound & effects (`dicedelve-fx-v1`), and are always off with `prefers-reduced-motion`.
- `lastKill` and `lastMimic` live on the Game instance and are never saved.


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
- **Sound** (`audio.js`, `DC.audio`).
  - Everything is synthesized with the Web Audio API. There are no audio files. Without Web Audio, every call does nothing.
  - **Starting:** browsers block audio until a gesture, so `unlock()` runs on the first `pointerdown` or `keydown`. It creates or resumes the `AudioContext` and starts any music that was waiting.
  - **Signal chain:** master gain → compressor → output, with an `sfxBus` and a `musicBus`. The context is suspended while the tab is hidden.
  - **Effects:** `sfx(name)` plays a short recipe made of tone and noise envelopes. The engine events map 1:1 to recipe names:

    | Event | When |
    |---|---|
    | `roll` | rolling, Re-roll, a neutral gamble |
    | `step` | each square moved |
    | `blocked` | a redirect is needed |
    | `web` | caught in a web |
    | `hurt`, `hit`, `kill` | in `encounter()` and `shoot()` |
    | `coin`, `chest`, `heal`, `key`, `ammo`, `pickup`, `torch` | picking things up |
    | `door` | a key opens a door |
    | `pickOk`, `pickFail` | lock-pick results |
    | `mimic` | a mimic wakes (followed by `hurt`) |
    | `portal` | teleporting |
    | `shoot`, `miss` | the sling |
    | `stalker` | a stalker moves |
    | `spell` | No Clipping, Invisibility, Dark One's Luck, arming a spell |
    | `fireball` | Fireball |
    | `stairs` | `completeFloor()` |
    | `death` | `die()` |
    | `buy`, `gambleWin`, `gambleLose` | the shop |

    A limiter allows at most 4 copies of one sound per 100 ms (2 for footsteps).
  - **Music:** `setMusic(mood, seed, floor)`. `syncMusic()` in `ui.js` picks the mood:

    | Mood | When | Sound |
    |---|---|---|
    | `none` | start screen and death | silence |
    | `shop` | shop floors | major pentatonic jingle |
    | `dark` | dark floors | low Phrygian drone, sparse plucks, wind noise |
    | `tutorial` | floors 1–3 | gentle major pentatonic |
    | `floor` | everything else | seeded root note and mode (Aeolian, Dorian or minor pentatonic) |

    Each voice is a detuned drone through a slowly swept low-pass filter, plus plucked notes scheduled ahead of time through a feedback delay. Mood changes crossfade over about 2 s.
  - **Settings:** `localStorage` key `dicedelve-audio-v1` holds `{sfx, music, sfxOn, musicOn, muted}`, set from the **Sound** menu modal (`showSound`). **M** toggles mute.
  - **Debugging:** `DC.audio.recent` lists the last effect names played. `DC.audio.mood` is the current music mood.
  - **To add a sound:** call `this.emit('name')` at the right place in `game.js`, then add a `name()` recipe to `SFX` in `audio.js`.
- **Hints.**
  - One-time tips (`HINTS` in `ui.js`) are shown with `openModal`. Each has a "Don't show hints" checkbox.
  - `checkHints()` runs at the end of every `render()`, once `startWith()` has set `ui.hintsReady`. It queues hints as follows:
    - **On entering a floor:** `start`; `doorway` (if there's more than one room); and `web`, `enemy`, `lock`, `items`, `portal` and `dark` when the floor has those things.
    - **In the choose phase:** `even` or `odd`.
    - **When blocked:** `blocked`.
    - **When holding a spell:** `spells`.
  - `showNextHint()` shows one at a time, only while no modal is open and nothing is moving. `closeModal()` triggers the next.
  - `localStorage` key `dicedelve-hints-v1` holds `{off, seen}`.
  - The Rules screen has a button to turn hints on or off. Turning them on resets which hints count as seen.
  - **To add a hint:** add an entry to `HINTS`, then a `queueHint(id)` call in `checkHints()`.
- **Journal.**
  - The log is never shown in the main page. `showJournal()` opens it in a modal and marks entries read.
  - Every entry has an increasing `seq` (`state.logSeq`).
  - `renderJournal()` shows the unread count on the button. It also shows the newest entry of a toast kind (`TOAST_KINDS`) as a toast for about 2.6 s. The toast kinds are:
    - `status`: being caught in a web, or lighting a carried torch;
    - `good`: item pickups, keys, opened doors and the found torch;
    - `fight`: combat;
    - `bad`: death.

    Blocked moves (`warn`), spells, floor notes and shop messages stay in the journal only.
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
- **One-die movement:** no directions, shots or pass before a die is picked. Each die's value and parity are used, you can switch before moving but not after, doubles are auto-picked, and a web halves the die (minimum 1). The sling range equals the die. Re-roll and Luck keep the choice. `forceRoll(g, a, b)` in the tests sets both dice to `a + b` and picks die 0, so older scenarios keep their step counts.
- **Scripted scenarios** on small hand-made maps (`sandbox([...rows])`, where `#` is wall, `D` is doorway, `@` is start and `>` is stairs). They cover parity, sliding, redirect and no doubling back, webs, combat, keys and locks, portals, every spell, and the shop and gamble payouts.
- **Sound events:** a move emits `roll`, `step`, `coin`, `hurt`, `kill` and `web` as it happens. Shots emit `shoot` plus `hit` or `miss`, and you also get `stairs` and `pickFail`. `drainEvents()` empties the list, and events never appear in the state or in checkpoints. `audio.js` isn't loaded in Node; check it in a browser through `DC.audio.recent` and `DC.audio.mood`.
- **Sling, stalkers and lock picks:**
  - Shots: range, walls, the first enemy, ammo, the turn ending, and no shots straight into a wall.
  - Bodies from melee and sling kills (none from Fireball), and collecting their ammo.
  - Stalker counts per floor.
  - Stalker movement: it closes in when it can see you, waits behind walls, and avoids webs and items.
  - Stalker attacks: adjacent stalkers attack, can kill you, and leave bodies.
  - Stalker sight on dark floors: within 2 squares without your torch, and from anywhere with it.
  - Lock picks: a pickable door is a legal direction only while you hold a pick. The prompt appears. Success continues the move, failure breaks the pick and stops, and declining makes the door solid for the turn. The odds are checked.
  - The shop: DEX is always on sale and its price rises.
  - Checkpoints: the new fields round-trip, get defaults in older saves, and bad values are rejected.
- **Mimics:**
  - Generation on 6 seeds, floors 4–80: none before floor 19, at most 1 per floor, a rate near 30%, both kinds appear. A door mimic sits alone in a doorway, never cuts the floor apart, and leaves every key and the torch reachable.
  - The ambush with forced dice: a passed DEX check does normal damage and a failed one double. The move stops before it, the turn ends, it's revealed with double health, and it can kill you. Invisibility slips past a hidden chest mimic.
  - Fake doors: solid without a key or a pick. A key or a pick wakes it and is kept. A dead door mimic leaves the doorway open.
  - The reward from melee (plus a body), sling and Fireball kills, and from Fireball on a hidden door mimic.
- **Classes and levels (experimental):**
  - The kill curve (10/25/48/83).
  - The base hero: 7 health, and can't shoot or cast.
  - The 10th kill owes a class, and `roll()` refuses until it's chosen. Bad choices are refused.
  - Each class's bonuses, and unusable loot (held and found) is sold.
  - Shops offer only usable items.
  - Boons, and several owed levels at once.
  - Wizard: the missile needs no stones.
  - Move boost: the stop prompt comes only after the die's value, Stop and Keep going work, and the full move is die + boost.
  - Range boost: Manhattan distance, line of sight, and stones needed.
  - Version 4 checkpoints round-trip, and bad class or spell-level fields are rejected. Version 3 saves convert (spells sold or kept, slots become known spells), and version 2 saves convert (floors shift, a class is owed).
  - The random-play simulation makes class and boon choices, free shots and stop or continue decisions. Half its runs start at 40 kills.
- **Spells (experimental):**
  - Charges: 3 for a level 1 cast by non-Wizards.
  - Wizards: known spells only, casts per floor from slots (1, 2, 2, 3, …, 4), refilling each floor, and study costs of 10/15/20/25 with a cap of 5.
  - Invisibility: x turns, stalkers blind, level 5 wall-walk that ends the spell.
  - Re-roll: x attempts, level 5 picks a value, attempts expire on moving.
  - Orb: radius per level, dark floors only, a level 5 flood for 2 turns then radius 8, and remembered enemies.
  - The simulation casts and studies spells at random.
- **Early floors:** floors 1–10 have rooms of at least 5×5, at most one lock and no portals before floor 6.
- **Tutorial floors:** floor 1 is one 5×5 room with the stairs in the opposite corner and no obstacles. Floor 2 is two rooms with webs, none in the start room. Floor 3 is four chained rooms with a lock guarding the stairs (key reachable), plus an enemy, a web and every item, and no portal. Floor 4 uses the normal generator. `startFloor: 4` skips the tutorial.
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
