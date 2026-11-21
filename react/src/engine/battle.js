/* Turn-based battles. Walking into an enemy (or a stalker reaching you, or a
 * mimic waking up) opens a battle screen. Each round you pick an action,
 * then the enemy carries out the intent it showed you, then poison and burns
 * tick. Every roll comes from the floor's dice stream (game.d), so a seed
 * still replays exactly.
 *
 * Battle state lives in game.s.battle (plain JSON):
 *   { enemyIndex, origin: 'move'|'stalker'|'mimic', target: {x, y} | null,
 *     enemy: {...stats, hp, maxHp, stun, burn, guard}, intent, guard, poison,
 *     round, playerFirst, log: [], fx: [], over: null|'win'|'fled'|'lost', xp }
 */
import { rules as R } from './rules.js';
import { enemyStats, MOVES } from './enemies.js';
import { WEAPONS, ARMORS } from './items.js';

export const SKILLS = {
  power: { name: 'Power Strike', sp: 3, desc: '+2 to hit and double damage.' },
  bash: { name: 'Shield Bash', sp: 2, desc: 'Normal damage, and a hit stuns: the enemy loses its next turn.' },
  backstab: { name: 'Backstab', sp: 2, desc: '+2 to hit, 1.5× damage, crits on 18-20. Always crits in round 1 if you struck first.' },
  sling: { name: 'Sling', sp: 0, ammo: 1, desc: 'd20 + DEX to hit; d4 + ranged damage. Uses a stone.' },
  missile: { name: 'Magic Missile', sp: 2, desc: 'Never misses: 2d4 + level/2 + Arcane power.' },
  firebolt: { name: 'Firebolt', sp: 3, desc: 'd20 + DEX + level to hit; 2d6 fire, and it burns for 3 turns.' },
};

const roll = (g, n, sides) => {
  let t = 0;
  const rolls = [];
  for (let i = 0; i < n; i++) { const v = g.d(sides); rolls.push(v); t += v; }
  return { total: t, rolls };
};

function blog(b, text, kind) {
  b.log.push({ text, kind: kind || 'info' });
  if (b.log.length > 40) b.log.splice(0, b.log.length - 40);
}

export function weaponOf(p) { return WEAPONS[p.weapon || 0]; }
export function armorOf(p) { return ARMORS[p.armor || 0]; }
export function playerAc(g) {
  const s = g.s, p = s.player;
  return R.playerAc(p, armorOf(p).ac) + (s.battle ? s.battle.guard : 0);
}
export function attackBonus(p) { return p.str + weaponOf(p).hit; }

/* Open a battle with enemy object `o`.
 * opts.surprise: the enemy strikes first with a heavy blow (failed mimic dodge).
 * opts.enemyFirst: the enemy acts first (a stalker lunging at you). */
export function startBattle(g, o, origin, target, opts) {
  const s = g.s, p = s.player, f = Math.max(1, s.floor);
  opts = opts || {};
  const st = enemyStats(o.kind || 'rat', f, o.stalker);
  const b = s.battle = {
    enemyIndex: g.objIndex(o), origin, target: target || null,
    enemy: Object.assign({}, st, { hp: o.hp, maxHp: o.maxHp, stun: 0, burn: 0, guard: 0 }),
    intent: null, guard: 0, poison: 0, round: 1, playerFirst: true,
    log: [], fx: [], over: null, xp: R.xpFor(st.xp, f), resolvedPhase: s.phase,
  };
  s.phase = 'battle';
  g.emit('battle');
  blog(b, `A ${st.name} blocks your way!`, 'warn');
  let enemyFirst = !!(opts.enemyFirst || opts.surprise);
  if (!enemyFirst) {
    const pi = g.d(20) + p.dex, ei = g.d(20) + st.tier;
    enemyFirst = ei > pi;
    blog(b, `Initiative: you ${pi}, ${st.name} ${ei}. ${enemyFirst ? 'It strikes first!' : 'You act first.'}`, 'roll');
  }
  b.playerFirst = !enemyFirst;
  if (enemyFirst) {
    b.intent = opts.surprise ? 'heavy' : pickIntent(g, b);
    enemyTurn(g, b);
    if (p.hp <= 0) { lose(g, b); return b; }
  }
  b.intent = pickIntent(g, b);
  return b;
}

function pickIntent(g, b) {
  const m = b.enemy.moves;
  return m[g.d(m.length) - 1];
}

// The actions you can take right now: [{id, label, ok, why}]
export function battleActions(g) {
  const s = g.s, b = s.battle, p = s.player;
  if (!b || b.over) return [];
  const out = [
    { id: 'attack', label: 'Attack', ok: true, desc: `d20 + ${attackBonus(p)} vs AC ${enemyAc(b)}; ${weaponOf(p).name} d${weaponOf(p).die} + ${p.str}.` },
  ];
  const cls = p.cls ? R.CLASSES[p.cls] : null;
  for (const id of cls ? cls.skills : []) {
    const sk = SKILLS[id];
    let why = null;
    if (p.sp < sk.sp) why = `needs ${sk.sp} SP`;
    if (sk.ammo && p.ammo < sk.ammo) why = 'no stones';
    out.push({ id: 'skill', arg: id, label: sk.name, cost: sk.sp, ok: !why, why, desc: sk.desc });
  }
  out.push({ id: 'defend', label: 'Defend', ok: true, desc: `+${R.DEFEND_AC} AC this round and recover ${R.DEFEND_SP} SP.` });
  out.push({ id: 'potion', label: `Potion (${p.potions || 0})`, ok: (p.potions || 0) > 0 && p.hp < p.maxHp,
    why: (p.potions || 0) > 0 ? 'at full health' : 'no potions', desc: `Heal ${R.potionHeal(s.floor)}.` });
  const canFlee = s.battle.origin !== 'mimic';
  out.push({ id: 'flee', label: 'Flee', ok: canFlee, why: canFlee ? null : "a mimic won't let go",
    desc: `d20 + DEX ${p.dex} vs ${fleeTarget(b)}. Failing gives it a free turn.` });
  return out;
}

export const fleeTarget = (b) => R.FLEE_BASE + b.enemy.tier;
export const enemyAc = (b) => b.enemy.ac + (b.enemy.guard ? R.DEFEND_AC : 0);

/* Take an action. Returns false if it isn't allowed. */
export function battleAct(g, action, arg) {
  const s = g.s, b = s.battle, p = s.player;
  if (!b || b.over) return false;
  const a = battleActions(g).find((x) => x.id === action && (action !== 'skill' || x.arg === arg));
  if (!a || !a.ok) return false;
  b.fx = [];
  b.guard = 0; // last round's Defend wears off when you act again

  switch (action) {
    case 'attack': playerStrike(g, b, { label: 'You attack' }); break;
    case 'defend':
      b.guard = R.DEFEND_AC;
      p.sp = Math.min(p.maxSp || 0, p.sp + R.DEFEND_SP);
      blog(b, `You raise your guard (+${R.DEFEND_AC} AC).`, 'status');
      b.fx.push({ who: 'player', kind: 'guard' });
      break;
    case 'potion': {
      p.potions--;
      const v = g.heal(R.potionHeal(s.floor));
      g.emit('heal');
      blog(b, `You drink a potion and recover ${v} health.`, 'good');
      b.fx.push({ who: 'player', kind: 'heal', amount: v });
      break;
    }
    case 'flee': {
      const r = g.d(20), t = r + p.dex, need = fleeTarget(b);
      if (t >= need) {
        blog(b, `Flee: ${r} + ${p.dex} = ${t} (needed ${need}). You escape!`, 'good');
        b.over = 'fled';
        g.emit('flee');
        return true;
      }
      blog(b, `Flee: ${r} + ${p.dex} = ${t} (needed ${need}). It cuts you off!`, 'bad');
      break;
    }
    case 'skill': useSkill(g, b, arg); break;
  }

  if (b.enemy.hp <= 0) { win(g, b); return true; }
  // The enemy's turn (a stun skips it).
  if (b.enemy.stun > 0) {
    b.enemy.stun--;
    blog(b, `The ${b.enemy.name} is stunned and can't act.`, 'status');
  } else {
    enemyTurn(g, b);
  }
  if (p.hp <= 0) { lose(g, b); return true; }
  // Burns and poison tick at the end of the round.
  if (b.enemy.burn > 0) {
    b.enemy.burn--;
    b.enemy.hp -= R.BURN_DMG;
    b.fx.push({ who: 'enemy', kind: 'burn', amount: R.BURN_DMG });
    blog(b, `The ${b.enemy.name} burns for ${R.BURN_DMG}.`, 'fight');
    if (b.enemy.hp <= 0) { win(g, b); return true; }
  }
  if (b.poison > 0) {
    b.poison--;
    p.hp = Math.max(0, p.hp - R.POISON_DMG);
    b.fx.push({ who: 'player', kind: 'poison', amount: R.POISON_DMG });
    blog(b, `Poison burns in your veins: ${R.POISON_DMG} damage.`, 'bad');
    if (p.hp <= 0) { lose(g, b); return true; }
  }
  b.round++;
  b.intent = pickIntent(g, b);
  return true;
}

/* A weapon or skill strike. o.hit: extra to hit; o.mult: damage multiplier;
 * o.critMin: lowest natural roll that crits; o.forceCrit; o.stat: 'str'|'dex'
 * for the to-hit stat; o.dice: [n, sides] to replace the weapon die. */
function playerStrike(g, b, o) {
  const p = g.s.player, w = weaponOf(p);
  const nat = g.d(20);
  const bonus = (o.stat === 'dex' ? p.dex : attackBonus(p)) + (o.hit || 0);
  const total = nat + bonus, ac = enemyAc(b);
  const crit = o.forceCrit || nat >= (o.critMin || R.CRIT);
  const hit = nat !== 1 && (crit || total >= ac);
  b.lastRoll = { who: 'player', nat, bonus, total, ac, hit, crit };
  if (!hit) {
    blog(b, `${o.label}: ${nat} + ${bonus} = ${total} vs AC ${ac}. Miss!`, 'info');
    b.fx.push({ who: 'enemy', kind: 'miss' });
    g.emit('miss');
    return false;
  }
  const [n, sides] = o.dice || [1, w.die];
  const r = roll(g, crit ? 2 * n : n, sides);
  const flat = o.flat !== undefined ? o.flat : p.str;
  const dmg = Math.max(1, Math.round((r.total + flat) * (o.mult || 1)));
  b.enemy.hp -= dmg;
  b.fx.push({ who: 'enemy', kind: crit ? 'crit' : 'hit', amount: dmg });
  g.emit(b.enemy.hp <= 0 ? 'kill' : 'hit');
  blog(b, `${o.label}: ${nat} + ${bonus} = ${total} vs AC ${ac}. ${crit ? 'Critical! ' : ''}` +
    `${dmg} damage [${r.rolls.join(', ')}${flat ? ` + ${flat}` : ''}${o.mult > 1 ? ` ×${o.mult}` : ''}].`, 'fight');
  return true;
}

function useSkill(g, b, id) {
  const s = g.s, p = s.player, sk = SKILLS[id];
  p.sp -= sk.sp;
  if (sk.ammo) p.ammo -= sk.ammo;
  g.emit('skill');
  switch (id) {
    case 'power': playerStrike(g, b, { label: 'Power Strike', hit: 2, mult: 2 }); break;
    case 'bash':
      if (playerStrike(g, b, { label: 'Shield Bash' }) && b.enemy.hp > 0) {
        b.enemy.stun = 1;
        blog(b, `The ${b.enemy.name} reels, stunned!`, 'status');
      }
      break;
    case 'backstab':
      playerStrike(g, b, { label: 'Backstab', hit: 2, mult: 1.5, critMin: R.ROGUE_CRIT, forceCrit: b.round === 1 && b.playerFirst });
      break;
    case 'sling':
      playerStrike(g, b, { label: 'Sling', stat: 'dex', dice: [1, 4], flat: R.rangedDamage(p.level, 0) });
      break;
    case 'missile': {
      const r = roll(g, 2, 4);
      const dmg = r.total + Math.floor(p.level / 2) + (p.power || 0);
      b.enemy.hp -= dmg;
      b.fx.push({ who: 'enemy', kind: 'magic', amount: dmg });
      g.emit(b.enemy.hp <= 0 ? 'kill' : 'hit');
      blog(b, `Magic Missile: ${dmg} damage [${r.rolls.join(', ')} + ${dmg - r.total}].`, 'fight');
      break;
    }
    case 'firebolt':
      if (playerStrike(g, b, { label: 'Firebolt', stat: 'dex', hit: p.level, dice: [2, 6], flat: p.power || 0 }) && b.enemy.hp > 0) {
        b.enemy.burn = 3;
        blog(b, `The ${b.enemy.name} catches fire!`, 'status');
      }
      break;
  }
}

function enemyTurn(g, b) {
  const s = g.s, p = s.player, e = b.enemy, move = b.intent || 'attack';
  e.guard = 0;
  if (move === 'guard') {
    e.guard = 1;
    blog(b, `The ${e.name} braces itself (+${R.DEFEND_AC} AC).`, 'status');
    b.fx.push({ who: 'enemy', kind: 'guard' });
    return;
  }
  const heavy = move === 'heavy';
  const nat = g.d(20), bonus = e.atk - (heavy ? 2 : 0), total = nat + bonus, ac = playerAc(g);
  const crit = nat >= R.CRIT, hit = nat !== 1 && (crit || total >= ac);
  b.lastEnemyRoll = { nat, bonus, total, ac, hit, crit };
  const what = MOVES[move].name.toLowerCase();
  if (!hit) {
    blog(b, `The ${e.name}'s ${what}: ${nat} + ${bonus} = ${total} vs your AC ${ac}. It misses!`, 'good');
    b.fx.push({ who: 'player', kind: 'miss' });
    g.emit('miss');
    return;
  }
  const r = roll(g, crit ? 2 * e.dmg[0] : e.dmg[0], e.dmg[1]);
  const dmg = Math.max(1, Math.ceil((r.total + e.dmg[2]) * (heavy ? R.HEAVY_MULT : 1)));
  p.hp = Math.max(0, p.hp - dmg);
  s.stats.cause = `a ${e.name.toLowerCase()} on ${s.tutorial ? 'tutorial ' + s.floor : 'floor ' + s.floor}`;
  b.fx.push({ who: 'player', kind: crit ? 'crit' : 'hit', amount: dmg });
  g.emit('hurt');
  let extra = '';
  if (move === 'poison') { b.poison = 3; extra = ' You are poisoned!'; }
  if (move === 'drain') {
    const h = Math.min(e.maxHp - e.hp, Math.ceil(dmg / 2));
    e.hp += h;
    if (h) extra = ` It drains ${h} health.`;
  }
  blog(b, `The ${e.name}'s ${what}: ${nat} + ${bonus} = ${total} vs your AC ${ac}. ${crit ? 'Critical! ' : ''}${dmg} damage.${extra}`, 'bad');
}

function win(g, b) {
  b.over = 'win';
  b.enemy.hp = 0;
  blog(b, `The ${b.enemy.name} is defeated! +${b.xp} XP.`, 'good');
}

function lose(g, b) {
  b.over = 'lost';
  blog(b, 'You fall...', 'bad');
}
