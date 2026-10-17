# Dice Delve (web)

A procedurally generated roll-and-write dungeon crawler that runs in the browser. All graphics are inline SVG, and there are no dependencies or build step.

**Play:** open `web/index.html` in a browser. It works straight from the file system, or you can serve the folder with any static server (`python3 -m http.server -d web`).

**Test:** `node web/tests/run-tests.js`

**Rebuilding or changing the game?** Start with [GAME_SPEC.md](GAME_SPEC.md). It has the full rules, architecture, data model, algorithms, and step-by-step guides for common changes.

## Rules implemented

- **Movement:** roll 2d6. The total is how many squares you move. An even total moves orthogonally and an odd total moves diagonally. Once you pick a direction you keep going until your moves run out. If you're blocked with moves left, you pick a new legal direction. The only direction you can't pick is straight back the way you came, unless that's the only legal move. Diagonal moves can't squeeze between two walls that meet at a corner.
- **Tutorial:** floors 1–3 teach the game. Floor 1 is a single 5×5 room. Floor 2 is two rooms with webs. Floor 3 is a small four-room dungeon with every feature except portals. One-time hint pop-ups explain each new thing; turn them off from the pop-up or the Rules screen. Skip the tutorial with the checkbox on the New game screen.
- **Floors:** from floor 4, floors grow from 17×13 to at most 21×15. Rooms are at least 3×3 and joined by one-cell doorways. The start square is a smiley face. Stepping onto the staircase ends the floor.
- **Spider web:** stops movement at once, and the next roll's movement is halved (rounded down, minimum 1). The roll's parity still decides orthogonal or diagonal.
- **Enemy:** when you run into one, it deals `floor(level/20 + 1)` damage and you hit it for your strength. Enemies have `floor(level/10 + 1)` health. If you kill it, you move into its square and keep going. If it survives, your move ends.
- **Locked door:** always sits in a doorway with wall on two orthogonally opposite sides. It opens with the key of the same color. Every key is placed where it can be reached from the start with all doors still locked.
- **Coin:** `floor(level/10 + 1)` coins.
- **Treasure chest:** coin value + 1d6 per `ceil(level/20)`.
- **Heart:** heals `ceil(level/20)`, up to max health.
- **Med pack:** heart value + 1d4 per `ceil(level/20)`.
- **Dark floors:** from floor 6, some floors (never two in a row, never shops) are dark. You see only the squares next to you until you light a torch, which shows 4 squares (walls block light) until the floor ends. Every dark floor has a torch you can reach without keys and a dark chest (coins plus a random spell). Torches can also be bought in the shop and carried. Seen areas stay sketched in pencil, but deeper floors remember less: items are forgotten from floor 20 and walls from floor 35. Seen stairs always stay marked.
- **Sling:** after rolling you can shoot instead of moving. The stone flies as far as your roll, in a straight or diagonal line matching the roll, and hits the first enemy for 1 damage. Your turn then ends. You start with 3 stones. Enemies killed in melee or by the sling leave bodies with 1–2 stones to collect. Stones can also be bought.
- **Stalkers:** from floor 12, some enemies hunt you. After each turn, a stalker that can see you moves 1 square closer, and attacks if it's next to you. On dark floors it only spots you within 2 squares, unless your torch is lit.
- **Lock picks and Dexterity:** walking into a locked door without its key, while carrying a lock pick, asks whether to try it: d20 + DEX against the door color (gold 12, crimson 14, azure 16, emerald 18). Success opens the door and you keep moving. Failure breaks the pick and stops your move. DEX starts at 1, and DEX +1 is always for sale in the shop. Picks are found on some floors with locks, or bought.
- **Portals:** come in color-matched pairs and appear from floor 4. Entering one moves you to its twin and you keep moving. Both ends are always in the same locked-door zone.
- **Shops:** floor 5 is always a shop. After that a shop appears every 4–10 floors, and never more than 2 in any 10 consecutive floors. Heal, Strength +1 and Dexterity +1 are always offered, plus 4 random offers from: Max Health +2, Gamble, the spells, a torch, sling stones and a lock pick.
  - **Gamble** results: 1–2 lose the wager, 3–4 money back, 5 money back + 2, 6 win double.
- **Spells:**
  - **No Clipping:** pass through a wall when the current move carries you all the way through it.
  - **Fireball:** destroy one web, enemy or locked door.
  - **Dark One's Luck:** set both dice to any values.
  - **Re-roll:** re-roll one die.
  - **Invisibility:** pass through enemies for one turn.
  - No Clipping and Invisibility are "armed" first, and a charge is used up only if the spell actually takes effect.

**Sound:** sound effects and ambient music, all generated in the browser with Web Audio. There are no audio files. The music changes with the floor: calm in the tutorial, tense on dark floors, cheerful in shops. Sound starts after your first tap. Set volumes from **Sound** in the menu, or press **M** to mute.

**Controls:** tap Roll in the center of the direction pad, then tap anywhere on the map in the direction you want to go (or use the pad or keyboard). The layout adapts to desktop, phone portrait and phone landscape. The journal sits behind a button, and important events pop up briefly over the map.

The game seed decides every floor, so the same seed always gives the same dungeon. **Saving:** the game saves a small checkpoint each time you reach a new floor: the seed, the floor number, your stats, coins and spells. The floor itself is rebuilt from the seed, so loading restarts that floor from its beginning, and progress inside a floor isn't saved. The **Saves** menu offers up to 12 named slots in the browser, a copyable save code, and export/import of a `.json` save file.

## Files

- `js/rng.js`: seeded PRNG (mulberry32) and hashing.
- `js/rules.js`: formulas and the shop schedule.
- `js/levelgen.js`: room layout (BSP), doorways, locks and keys, portals, and placement of items and obstacles.
- `js/game.js`: game state and the turn and movement engine. It has no DOM code.
- `js/render.js`: SVG symbols, the board, and the dice.
- `js/audio.js`: generated sound effects and music (Web Audio).
- `js/ui.js`: input, animation, modals, and the shop.
