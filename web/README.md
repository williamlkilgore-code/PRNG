# Dice Delve (web)

A procedurally generated roll-and-write dungeon crawler that runs in the browser. All graphics are inline SVG, and there are no dependencies or build step.

**Play:** open `web/index.html` in a browser. It works straight from the file system, or you can serve the folder with any static server (`python3 -m http.server -d web`).

**Test:** `node web/tests/run-tests.js`

**Rebuilding or changing the game?** Start with [GAME_SPEC.md](GAME_SPEC.md). It has the full rules, architecture, data model, algorithms, and step-by-step guides for common changes.

## Rules implemented

- **Movement:** roll 2d6. The total is how many squares you move. An even total moves orthogonally and an odd total moves diagonally. Once you pick a direction you keep going until your moves run out. If you're blocked with moves left, you pick a new legal direction. You can't reverse a direction already used this turn. If that leaves no move, you may only step onto squares you haven't walked this turn, and retracing is allowed only when it is the only move. Diagonal moves can't squeeze between two walls that meet at a corner.
- **Floors:** grow from 17×13 to at most 21×15. Rooms are at least 3×3 and joined by one-cell doorways. The start square is a smiley face. Stepping onto the staircase ends the floor.
- **Spider web:** stops movement at once, and the next roll's movement is halved (rounded down, minimum 1). The roll's parity still decides orthogonal or diagonal.
- **Enemy:** when you run into one, it deals `floor(level/20 + 1)` damage and you hit it for your strength. Enemies have `floor(level/10 + 1)` health. If you kill it, you move into its square and keep going. If it survives, your move ends.
- **Locked door:** always sits in a doorway with wall on two orthogonally opposite sides. It opens with the key of the same color. Every key is placed where it can be reached from the start with all doors still locked.
- **Coin:** `floor(level/10 + 1)` coins.
- **Treasure chest:** coin value + 1d6 per `ceil(level/20)`.
- **Heart:** heals `ceil(level/20)`, up to max health.
- **Med pack:** heart value + 1d4 per `ceil(level/20)`.
- **Dark floors:** from floor 6, some floors (never two in a row, never shops) are dark. You see only the squares next to you until you light a torch, which shows 4 squares (walls block light) until the floor ends. Every dark floor has a torch you can reach without keys and a dark chest (coins plus a random spell). Torches can also be bought in the shop and carried. Seen areas stay sketched in pencil, but deeper floors remember less: items are forgotten from floor 20 and walls from floor 35. Seen stairs always stay marked.
- **Portals:** come in color-matched pairs and appear from floor 4. Entering one moves you to its twin and you keep moving. Both ends are always in the same locked-door zone.
- **Shops:** floor 5 is always a shop. After that a shop appears every 4–10 floors, and never more than 2 in any 10 consecutive floors. Heal and Strength +1 are always offered, plus 4 random offers from: Max Health +2, Gamble, and the spells.
  - **Gamble** results: 1–2 lose the wager, 3–4 money back, 5 money back + 2, 6 win double.
- **Spells:**
  - **No Clipping:** pass through a wall when the current move carries you all the way through it.
  - **Fireball:** destroy one web, enemy or locked door.
  - **Dark One's Luck:** set both dice to any values.
  - **Re-roll:** re-roll one die.
  - **Invisibility:** pass through enemies for one turn.
  - No Clipping and Invisibility are "armed" first, and a charge is used up only if the spell actually takes effect.

**Controls:** tap Roll in the center of the direction pad, then tap anywhere on the map in the direction you want to go (or use the pad or keyboard). The layout adapts to desktop, phone portrait and phone landscape. The journal sits behind a button, and important events pop up briefly over the map.

The game seed decides every floor, so the same seed always gives the same dungeon. **Saving:** the game saves a small checkpoint each time you reach a new floor: the seed, the floor number, your stats, coins and spells. The floor itself is rebuilt from the seed, so loading restarts that floor from its beginning, and progress inside a floor isn't saved. The **Saves** menu offers up to 12 named slots in the browser, a copyable save code, and export/import of a `.json` save file.

## Files

- `js/rng.js`: seeded PRNG (mulberry32) and hashing.
- `js/rules.js`: formulas and the shop schedule.
- `js/levelgen.js`: room layout (BSP), doorways, locks and keys, portals, and placement of items and obstacles.
- `js/game.js`: game state and the turn and movement engine. It has no DOM code.
- `js/render.js`: SVG symbols, the board, and the dice.
- `js/ui.js`: input, animation, modals, and the shop.
