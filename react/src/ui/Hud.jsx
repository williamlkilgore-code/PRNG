/* The status bar: floor, health, skill points, XP, level, gear and items. */
import { rules as R } from '../engine/rules.js';
import { WEAPONS, ARMORS } from '../engine/items.js';
import { spriteUrl, heroSprite } from '../render/sprites.js';

export function Bar({ value, max, kind, label }) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={`bar bar-${kind}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label || kind}>
      <div className="bar-fill" style={{ width: `${f * 100}%` }} />
      <span className="bar-text">{label ? `${label} ` : ''}{value}/{max}</span>
    </div>
  );
}

export const floorName = (s) => (s.tutorial ? `Tutorial ${s.floor}/3` : `Floor ${s.floor}`);

export function xpProgress(p) {
  const lo = R.levelThreshold(p.level), hi = R.levelThreshold(p.level + 1);
  return { have: Math.min(p.xp, hi) - lo, need: hi - lo };
}

export default function Hud({ game, onOpen }) {
  const s = game.s, p = s.player;
  const cls = p.cls ? R.CLASSES[p.cls].name : 'Adventurer';
  const xp = xpProgress(p);
  return (
    <header className="hud">
      <button className="hero-badge" type="button" onClick={() => onOpen('character')} title="Character sheet">
        <img className="sprite" src={spriteUrl(heroSprite(p.cls))} alt="" />
        <span><b>{cls}</b><small>Level {p.level}</small></span>
      </button>
      <div className="bars">
        <Bar value={p.hp} max={p.maxHp} kind="hp" label="HP" />
        {p.maxSp > 0 && <Bar value={p.sp} max={p.maxSp} kind="sp" label="SP" />}
        <Bar value={xp.have} max={xp.need} kind="xp" label="XP" />
      </div>
      <div className="hud-items">
        <span className="floor-plaque">{floorName(s)}{s.level && s.level.dark ? ' · dark' : ''}</span>
        <span title="Coins"><img className="sprite sm" src={spriteUrl('coin')} alt="" />{p.coins}</span>
        <span title={`Potions: heal ${R.potionHeal(Math.max(1, s.floor))}`}><img className="sprite sm" src={spriteUrl('potion')} alt="" />{p.potions}</span>
        <span title={WEAPONS[p.weapon].name}><img className="sprite sm" src={spriteUrl('sword')} alt="" />d{WEAPONS[p.weapon].die}</span>
        <span title={`${ARMORS[p.armor].name} · armor class`}><img className="sprite sm" src={spriteUrl('shield')} alt="" />{game.ac()}</span>
        {p.keys.map((k, i) => <span key={k + i} title={`${k} key`}><img className="sprite sm" src={spriteUrl('key', k)} alt={`${k} key`} /></span>)}
        {p.lockpicks > 0 && <span title="Lock picks"><img className="sprite sm" src={spriteUrl('lockpick')} alt="" />{p.lockpicks}</span>}
        {p.torches > 0 && <span title="Torches"><img className="sprite sm" src={spriteUrl('torch')} alt="" />{p.torches}</span>}
        {(p.cls === 'rogue' || p.ammo > 0) && <span title="Sling stones">●{p.ammo}</span>}
      </div>
    </header>
  );
}
