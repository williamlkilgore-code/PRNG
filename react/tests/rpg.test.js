/* Battles, XP, classes, skills, gear and saves for the RPG. */
import { describe, it, expect } from 'vitest';
import { Game, SPELL_IDS } from '../src/engine/game.js';
import { rules as R } from '../src/engine/rules.js';
import { generateLevel } from '../src/engine/levelgen.js';
import { ENEMIES, enemyStats, kindsFor } from '../src/engine/enemies.js';
import { WEAPONS, ARMORS } from '../src/engine/items.js';
import { SKILLS } from '../src/engine/battle.js';
import { RNG } from '../src/engine/rng.js';

const MAP = ['###########', '#@........#', '#.........#', '#........>#', '###########'];

// A tiny hand-made floor (see legacy.test.js for the same idea).
function sandbox(rows, extra, cls) {
  const g = Game.create('rpg-sandbox');
  g.s.player.hp = g.s.player.maxHp = 50;
  const h = rows.length, w = rows[0].length;
  const L = { w, h, tiles: [], rooms: [], doorways: [], objects: [], trail: [], floor: 1 };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x];
    L.tiles.push(c === '#' ? 0 : 1);
    if (c === '@') L.start = { x, y };
    if (c === '>') L.stairs = { x, y };
  }
  (extra || []).forEach((o) => L.objects.push(o));
  g.s.level = L;
  g.s.player.x = L.start.x; g.s.player.y = L.start.y;
  L.trail = [[[g.s.player.x, g.s.player.y]]];
  g.rebuildIndex();
  g.s.phase = 'roll';
  if (cls) {
    g.s.player.xp = R.levelThreshold(1);
    g.chooseClass(cls, 'orb');
  }
  return g;
}
const enemy = (x, y, hp, kind) => ({ type: 'enemy', x, y, hp: hp || 5, maxHp: hp || 5, kind: kind || 'rat' });
function forceRoll(g, v) {
  g.s.phase = 'roll'; g.roll();
  g.s.dice = [v, v]; g.s.die = 0; g.computeSteps();
}
// A fixed sequence of dice results (then repeats the last one).
function dice(g, seq) { let i = 0; g.d = (n) => Math.min(n, seq[Math.min(i++, seq.length - 1)]); }
function step(g) { let n = 0; while (g.s.phase === 'moving' && n++ < 100) g.step(); }

describe('enemies', () => {
  it('every floor enemy has a kind and matching health', () => {
    for (let f = 1; f <= 40; f++) {
      const L = generateLevel(1234, f);
      for (const o of L.objects.filter((x) => x.type === 'enemy')) {
        expect(kindsFor(f)).toContain(o.kind);
        expect(o.hp).toBe(enemyStats(o.kind, f, o.stalker).hp);
      }
    }
  });
  it('kinds unlock with depth', () => {
    expect(kindsFor(1)).toEqual(['rat', 'bat']);
    expect(kindsFor(30)).not.toContain('rat');
    expect(kindsFor(30)).toContain('ogre');
    expect(kindsFor(99)).not.toContain('mimic');
  });
  it('stats scale with the floor', () => {
    const a = enemyStats('orc', 11), b = enemyStats('orc', 30);
    expect(b.hp).toBeGreaterThan(a.hp);
    expect(b.atk).toBeGreaterThan(a.atk);
    expect(enemyStats('orc', 11, true).hp).toBeGreaterThan(a.hp);
  });
});

describe('battles', () => {
  it('walking into an enemy opens a battle and pauses the slide', () => {
    const g = sandbox(MAP, [enemy(3, 1)]);
    forceRoll(g, 6); g.choose('E'); step(g);
    expect(g.s.phase).toBe('battle');
    expect(g.s.player.x).toBe(2);
    expect(g.s.battle.origin).toBe('move');
    expect(g.s.battle.target).toEqual({ x: 3, y: 1 });
    expect(g.s.battle.intent).toBeTruthy();
    expect(g.roll()).toBe(false);
  });

  it('winning kills the enemy, gives XP, and the slide continues into its square', () => {
    const g = sandbox(MAP, [enemy(3, 1, 3)]);
    forceRoll(g, 6); g.choose('E');
    dice(g, [10, 1, 20, 4]); // initiative: you 11 vs it 2; attack: natural 20, 2d4
    step(g);
    expect(g.s.battle.playerFirst).toBe(true);
    g.d = () => 20;
    expect(g.battleAct('attack')).toBe(true);
    expect(g.s.battle.over).toBe('win');
    expect(g.s.battle.xp).toBe(R.xpFor(ENEMIES.rat.xp, 1));
    const ev = g.endBattle();
    expect(g.s.player.xp).toBe(R.xpFor(ENEMIES.rat.xp, 1));
    expect(g.s.level.objects[0].done).toBe(true);
    expect(g.s.level.objects.some((o) => o.type === 'body' && o.x === 3)).toBe(true);
    expect(ev.type).not.toBe('dead');
    step(g);
    expect(g.s.player.x).toBe(7); // 2 + 5 more squares (one was spent bumping)
    expect(g.s.stats.kills).toBe(1);
  });

  it('fleeing ends your move and the enemy keeps its wounds', () => {
    const g = sandbox(MAP, [enemy(3, 1, 9)]);
    forceRoll(g, 6); g.choose('E');
    dice(g, [10, 1]); step(g);
    g.s.battle.enemy.hp = 4;
    g.d = () => 19; // 19 + 1 DEX >= 10 + tier
    expect(g.battleAct('flee')).toBe(true);
    expect(g.s.battle.over).toBe('fled');
    g.endBattle();
    expect(g.s.phase).toBe('roll');
    expect(g.s.player.x).toBe(2);
    expect(g.s.level.objects[0].hp).toBe(4);
    expect(g.s.level.objects[0].done).toBeFalsy();
  });

  it('a failed flee gives the enemy its turn', () => {
    const g = sandbox(MAP, [enemy(3, 1, 9)]);
    forceRoll(g, 6); g.choose('E');
    dice(g, [10, 1]); step(g);
    const hp = g.s.player.hp;
    dice(g, [2, 20, 3]); // flee 2 + 1 fails; it attacks: natural 20, damage
    g.battleAct('flee');
    expect(g.s.battle.over).toBe(null);
    expect(g.s.player.hp).toBeLessThan(hp);
  });

  it('losing a battle kills you', () => {
    const g = sandbox(MAP, [enemy(3, 1, 30, 'ogre')]);
    g.s.player.hp = 1;
    forceRoll(g, 6); g.choose('E');
    g.d = () => 20; step(g); // it wins initiative and crits
    expect(g.s.battle.over).toBe('lost');
    expect(g.endBattle().type).toBe('dead');
    expect(g.s.phase).toBe('dead');
    expect(g.s.stats.cause).toMatch(/ogre/);
  });

  it('defend raises AC and restores SP', () => {
    const g = sandbox(MAP, [enemy(3, 1, 9)], 'fighter');
    g.s.player.sp = 0;
    forceRoll(g, 6); g.choose('E');
    dice(g, [10, 1]); step(g);
    dice(g, [1, 1]);
    g.battleAct('defend');
    expect(g.s.battle.guard).toBe(R.DEFEND_AC);
    expect(g.s.player.sp).toBe(1);
  });

  it('potions heal in battle and on the map', () => {
    const g = sandbox(MAP, [enemy(3, 1, 9)]);
    g.s.player.hp = 10; g.s.player.potions = 2;
    expect(g.drinkPotion()).toBe(true);
    expect(g.s.player.hp).toBe(10 + R.potionHeal(1));
    forceRoll(g, 6); g.choose('E');
    dice(g, [10, 1]); step(g);
    g.s.player.hp = 5;
    dice(g, [1, 1]);
    expect(g.battleAct('potion')).toBe(true);
    expect(g.s.player.potions).toBe(0);
    expect(g.battleActions().find((a) => a.id === 'potion').ok).toBe(false);
  });

  it('a battle replays identically from the same seed', () => {
    const play = () => {
      const g = Game.create('replay-battle');
      g.s.player.hp = g.s.player.maxHp = 500;
      const pick = new RNG(5);
      const out = [];
      for (let t = 0; t < 20000 && g.s.floor < 8; t++) {
        const s = g.s;
        if (s.phase === 'levelDone' || s.phase === 'shop') g.nextFloor();
        else if (s.phase === 'battle') { if (s.battle.over) { out.push(s.battle.log.map((l) => l.text).join('|')); g.endBattle(); } else g.battleAct('attack'); }
        else if (s.phase === 'roll') { while (g.levelsOwed()) g.s.player.cls ? g.chooseBoon(g.boonChoices()[0]) : g.chooseClass('fighter'); g.roll(); if (g.s.die === null) g.pickDie(pick.int(0, 1)); }
        else if (s.phase === 'choose' || s.phase === 'redirect') { const d = g.availableDirs(); if (d.length) g.choose(pick.pick(d)); else if (!g.passTurn()) g.stopMove(); }
        else if (s.phase === 'stopPrompt') g.continueMove();
        else if (s.phase === 'pickPrompt') g.declinePick();
        else g.step();
      }
      return out;
    };
    const a = play();
    expect(a.length).toBeGreaterThan(0);
    expect(play()).toEqual(a);
  });
});

describe('class skills', () => {
  const open = (cls, hp, kind) => {
    const g = sandbox(MAP, [enemy(3, 1, hp || 40, kind)], cls);
    forceRoll(g, 6); g.choose('E');
    dice(g, [10, 1]); step(g);
    return g;
  };
  it('each class has its two skills; the base hero has none', () => {
    expect(sandbox(MAP, [enemy(3, 1)]).battleActions === undefined).toBe(false);
    const base = sandbox(MAP, [enemy(3, 1)]);
    forceRoll(base, 6); base.choose('E'); dice(base, [10, 1]); step(base);
    expect(base.battleActions().filter((a) => a.id === 'skill')).toEqual([]);
    for (const [cls, ids] of [['fighter', ['power', 'bash']], ['rogue', ['backstab', 'sling']], ['wizard', ['missile', 'firebolt']]]) {
      expect(open(cls).battleActions().filter((a) => a.id === 'skill').map((a) => a.arg)).toEqual(ids);
    }
  });
  it('skills cost SP and are refused without it', () => {
    const g = open('fighter');
    const sp = g.s.player.sp;
    dice(g, [15, 4, 1, 1]);
    expect(g.battleAct('skill', 'power')).toBe(true);
    expect(g.s.player.sp).toBe(sp - SKILLS.power.sp);
    g.s.player.sp = 0;
    expect(g.battleAct('skill', 'power')).toBe(false);
  });
  it('Power Strike doubles damage', () => {
    const g = open('fighter');
    dice(g, [15, 4, 1, 1]); // hit, d4 = 4, enemy turn
    const hp = g.s.battle.enemy.hp;
    g.battleAct('skill', 'power');
    expect(hp - g.s.battle.enemy.hp).toBe((4 + g.s.player.str) * 2);
  });
  it('Shield Bash stuns: the enemy loses its turn', () => {
    const g = open('fighter');
    const hp = g.s.player.hp;
    dice(g, [15, 2, 20, 6]); // the bash hits; without the stun its natural 20 would land
    g.battleAct('skill', 'bash');
    expect(g.s.player.hp).toBe(hp);
    expect(g.s.battle.log.some((l) => /stunned and can't act/.test(l.text))).toBe(true);
  });
  it('Backstab always crits in round 1 when you struck first', () => {
    const g = open('rogue');
    dice(g, [5, 2, 2, 1, 1]); // natural 5 still crits: 2d4 = 4
    g.battleAct('skill', 'backstab');
    expect(g.s.battle.lastRoll.crit).toBe(true);
  });
  it('Sling uses a stone', () => {
    const g = open('rogue');
    const ammo = g.s.player.ammo;
    dice(g, [15, 3, 1, 1]);
    g.battleAct('skill', 'sling');
    expect(g.s.player.ammo).toBe(ammo - 1);
  });
  it('Magic Missile never misses; Firebolt burns', () => {
    const g = open('wizard');
    const hp = g.s.battle.enemy.hp;
    dice(g, [1, 1, 1, 1]);
    g.battleAct('skill', 'missile');
    expect(g.s.battle.enemy.hp).toBeLessThan(hp);
    g.s.player.sp = 10;
    dice(g, [19, 3, 3, 1, 1]);
    g.battleAct('skill', 'firebolt');
    expect(g.s.battle.enemy.burn).toBe(2); // 3 turns, one already ticked
  });
});

describe('XP, levels and boons', () => {
  it('XP curve', () => {
    expect([1, 2, 3, 4].map(R.levelThreshold)).toEqual([15, 34, 58, 88]);
    expect(R.levelForXp(14)).toBe(0);
    expect(R.levelForXp(15)).toBe(1);
    expect(R.levelForXp(58)).toBe(3);
  });
  it('enough XP owes a class; rolling waits for the choice', () => {
    const g = sandbox(MAP);
    g.gainXp(15);
    expect(g.levelsOwed()).toBe(1);
    expect(g.roll()).toBe(false);
    const hp = g.s.player.maxHp;
    expect(g.chooseClass('fighter')).toBe(true);
    expect(g.s.player.maxHp).toBe(hp + R.CLASSES.fighter.hp);
    expect(g.s.player.maxSp).toBe(R.CLASSES.fighter.sp);
    expect(g.roll()).toBe(true);
  });
  it('boons: guard and focus', () => {
    const g = sandbox(MAP, null, 'fighter');
    g.s.player.xp = R.levelThreshold(3);
    const ac = g.ac(), sp = g.s.player.maxSp;
    expect(g.boonChoices()).toEqual(['hp', 'str', 'guard']);
    expect(g.chooseBoon('guard')).toBe(true);
    expect(g.ac()).toBe(ac + R.BOON_AC);
    expect(g.s.player.maxSp).toBe(sp + R.CLASSES.fighter.levelSp);
    const w = sandbox(MAP, null, 'wizard');
    w.s.player.xp = R.levelThreshold(2);
    const wsp = w.s.player.maxSp;
    expect(w.chooseBoon('focus')).toBe(true);
    expect(w.s.player.maxSp).toBe(wsp + R.CLASSES.wizard.levelSp + R.BOON_SP);
  });
  it('SP refills on every floor', () => {
    const g = sandbox(MAP, null, 'wizard');
    g.s.player.sp = 0;
    g.enterFloor(2);
    expect(g.s.player.sp).toBe(g.s.player.maxSp);
  });
  it('the stairs restore a quarter of max health', () => {
    const g = sandbox(MAP);
    g.s.player.hp = 10;
    g.s.player.x = 8; g.s.player.y = 3;
    forceRoll(g, 2); g.s.parity = 'ortho'; g.s.steps = 1;
    g.choose('E'); step(g);
    expect(g.s.phase).toBe('levelDone');
    expect(g.s.player.hp).toBe(10 + Math.ceil(50 * R.FLOOR_REST));
  });
});

describe('mimics', () => {
  it('a mimic chest ambushes: a battle you cannot flee', () => {
    const g = sandbox(MAP, [{ type: 'mimic', x: 3, y: 1 }]);
    g.s.floor = 20;
    forceRoll(g, 6); g.choose('E');
    g.d = () => 11; // 11 + 1 DEX = 12: dodged
    step(g);
    expect(g.s.phase).toBe('battle');
    expect(g.s.battle.origin).toBe('mimic');
    expect(g.s.level.objects[0].kind).toBe('mimic');
    expect(g.battleActions().find((a) => a.id === 'flee').ok).toBe(false);
  });
  it('failing the dodge: it strikes first with a heavy blow', () => {
    const g = sandbox(MAP, [{ type: 'mimic', x: 3, y: 1 }]);
    g.s.floor = 20;
    forceRoll(g, 6); g.choose('E');
    dice(g, [5, 19, 4]);
    step(g);
    expect(g.s.player.hp).toBeLessThan(50);
    expect(g.s.battle.playerFirst).toBe(false);
  });
  it('killing it gives the hoard, and your move ends', () => {
    const g = sandbox(MAP, [{ type: 'mimic', x: 3, y: 1 }]);
    g.s.floor = 20;
    forceRoll(g, 6); g.choose('E');
    g.d = () => 11; step(g);
    g.s.battle.enemy.hp = 1;
    const coins = g.s.player.coins;
    g.d = (n) => Math.min(n, 20); g.battleAct('attack');
    g.endBattle();
    expect(g.s.player.coins).toBeGreaterThan(coins);
    expect(g.s.phase).toBe('roll');
    expect(g.s.player.x).toBe(2);
  });
});

describe('gear', () => {
  it('better gear from a chest is equipped; worse is sold', () => {
    const g = sandbox(MAP);
    g.s.floor = 10;
    g.d = () => 2;
    g.findGear('weapon');
    expect(g.s.player.weapon).toBe(3); // 1 + floor(10/5) + 0
    const coins = g.s.player.coins;
    g.s.floor = 1;
    g.findGear('weapon');
    expect(g.s.player.weapon).toBe(3);
    expect(g.s.player.coins).toBeGreaterThan(coins);
  });
  it('weapons and armor change attack and AC', () => {
    const g = sandbox(MAP);
    const ac = g.ac();
    g.s.player.armor = 4;
    expect(g.ac()).toBe(ac + ARMORS[4].ac);
    expect(g.weapon()).toBe(WEAPONS[0]);
  });
  it('med packs become potions', () => {
    const g = sandbox(MAP, [{ type: 'medpack', x: 2, y: 1 }]);
    const n = g.s.player.potions;
    forceRoll(g, 2); g.s.steps = 1; g.choose('E'); step(g);
    expect(g.s.player.potions).toBe(n + 1);
  });
  it('the shop sells the next tier up', () => {
    let g;
    for (let k = 0; k < 40; k++) {
      g = Game.create('gearshop' + k);
      g.s.phase = 'levelDone'; g.s.floor = 4; g.nextFloor();
      if (g.s.shop.items.some((i) => i.id === 'weapon')) break;
    }
    const i = g.s.shop.items.findIndex((it) => it.id === 'weapon');
    g.s.player.coins = 999;
    expect(g.buy(i)).toBe(true);
    expect(g.s.player.weapon).toBe(1);
    expect(g.canBuy(i)).toBe(false); // once per visit
  });
});

describe('saves', () => {
  it('v5 checkpoints keep the RPG fields', () => {
    const g = sandbox(MAP, null, 'rogue');
    Object.assign(g.s.player, { weapon: 3, armor: 2, potions: 4, acBonus: 1, xp: 40 });
    const cp = JSON.parse(JSON.stringify(g.checkpointFor(3)));
    expect(cp.v).toBe(5);
    const p = Game.fromSave(cp).game.s.player;
    expect([p.weapon, p.armor, p.potions, p.acBonus, p.xp, p.cls]).toEqual([3, 2, 4, 1, 40, 'rogue']);
    expect(p.sp).toBe(p.maxSp);
    expect(Game.fromSave({ ...cp, player: { ...cp.player, weapon: 99 } }).error).toBeTruthy();
    expect(Game.fromSave({ ...cp, player: { ...cp.player, level: 9 } }).error).toBeTruthy();
  });
  it('a save from the original Dice Delve (v4) loads with defaults', () => {
    const v4 = { v: 4, seedText: 'classic', floor: 6, tutorial: false,
      player: { hp: 9, maxHp: 15, str: 2, coins: 10, spells: { invis: 0, reroll: 0, orb: 0 }, cls: 'fighter', level: 2, known: { invis: 0, reroll: 0, orb: 0 } },
      stats: { kills: 25, coins: 10, floorsCleared: 5 } };
    const g = Game.fromSave(v4).game;
    expect(g).toBeTruthy();
    const p = g.s.player;
    expect(p.xp).toBe(R.levelThreshold(2));
    expect(p.maxSp).toBe(R.CLASSES.fighter.sp + R.CLASSES.fighter.levelSp);
    expect(g.levelsOwed()).toBe(0);
    expect(SPELL_IDS.length).toBe(3);
  });
});
