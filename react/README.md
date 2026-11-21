# Dice Delve RPG (React)

A sprite-based remake of Dice Delve (`../web/`) built with React. You still move by rolling dice and sliding, but walking into a monster now opens a **turn-based battle screen**, and the hero grows through XP, classes, skills and gear.

## Run

```bash
cd react
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests (Vitest)
npm run build      # static site in dist/ (works from any folder)
```

In the browser console, `DiceDelve.game` is the live game and `DiceDelve.refresh()` redraws after you change it.

## What changed from the original

**Kept the same:** one-die movement (roll 2d6, keep one; even = straight, odd = diagonal), floors from the seed, keys and locks, webs, portals, dark floors and torches, stalkers, mimics, the three spells, shops, the tutorial and checkpoint saves.

**Battles** (`src/engine/battle.js`): walking into an enemy, a stalker reaching you, or a mimic waking up opens a battle.
- Initiative: d20 + DEX against d20 + the enemy's tier. Stalkers and failed mimic dodges strike first.
- **Attack:** d20 + STR + weapon bonus against the enemy's AC; damage is the weapon die + STR. A natural 20 crits (double dice); a natural 1 misses.
- **Skills** cost SP, which refills every floor:
  - Fighter: Power Strike (×2 damage), Shield Bash (stun).
  - Rogue: Backstab (×1.5, crits on 18+, always crits in round 1 if you struck first), Sling (uses a stone).
  - Wizard: Magic Missile (never misses), Firebolt (burns).
- **Defend** gives +4 AC and +1 SP. **Potion** heals. **Flee** is d20 + DEX against 10 + tier; you can't flee a mimic.
- The enemy shows its **intent** for its next turn: attack, heavy blow, guard, poison or drain.
- Winning gives XP and the slide continues into the enemy's square. Fleeing ends your move.

**RPG layer:**
- **Monsters** (`src/engine/enemies.js`): rat, bat, slime, goblin, skeleton, orc, wraith, ogre and mimic. New kinds unlock with depth, and stats scale with the floor.
- **XP and levels:** level 1 picks a class. Each level after that gives HP and SP plus a boon; Guard (+AC) and Focus (+SP) are new boons.
- **Gear** (`src/engine/items.js`): one weapon and one armor slot. Chests sometimes hold better gear, which you equip automatically if it's an upgrade (otherwise it's sold). Shops sell the next tier up and potions.
- **Healing:** med packs are now carried potions. The stairs restore a quarter of your max health.
- **Saves:** checkpoint version 5. Saves from the original game (v2–v4) still load.

## Art

Every sprite is original 16×16 pixel art defined as character maps in `src/render/sprites.js`, so there are no image files and nothing to license. To use a sprite sheet instead (for example a CC0 pack such as Kenney's *Tiny Dungeon*):

1. Put the PNG in `public/sprites/`.
2. Set `SHEET.src` and map sprite ids to `[col, row]` in `SHEET.map`.

Any id you leave out of the map keeps using the built-in art.

## Files

- `src/engine/`: the game rules, with no DOM code. `rng.js`, `rules.js` and `levelgen.js` are ported from `web/js`. `game.js` is the turn engine plus the battle, XP and gear hooks. `battle.js`, `enemies.js` and `items.js` are new.
- `src/render/`: the sprites and the `<canvas>` dungeon view.
- `src/ui/`: React components (HUD, controls, battle screen, dialogs), sound (`audio.js`, generated with Web Audio), and saves.
- `tests/`: `legacy.test.js` is the original suite, ported and adapted. `rpg.test.js` covers battles, skills, XP, gear and saves.
