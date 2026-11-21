/* The battle screen: the enemy and the hero face off, the enemy's intent is
 * shown, and you pick an action. Damage numbers and shakes come from the
 * engine's per-action fx list (battle.fx). */
import { useEffect, useRef, useState } from 'react';
import { spriteUrl, heroSprite } from '../render/sprites.js';
import { MOVES } from '../engine/enemies.js';
import { playerAc, enemyAc, weaponOf } from '../engine/battle.js';
import { Bar } from './Hud.jsx';

const INTENT_ICON = { attack: '⚔', heavy: '💥', guard: '🛡', poison: '☠', drain: '🩸' };

export default function BattleScreen({ game, version, onAct, onContinue, reduced }) {
  const s = game.s, b = s.battle, p = s.player;
  const [shake, setShake] = useState({ enemy: 0, player: 0 });
  const [floats, setFloats] = useState([]);
  const logRef = useRef(null);
  const seq = useRef(0);

  // Turn this action's fx into shakes and floating numbers.
  useEffect(() => {
    if (!b || !b.fx || !b.fx.length) return;
    const add = b.fx.map((f, i) => ({ ...f, id: ++seq.current, delay: i * 350 }));
    setFloats((cur) => cur.concat(add));
    add.forEach((f) => {
      if (['hit', 'crit', 'magic', 'burn', 'poison'].includes(f.kind)) {
        setTimeout(() => setShake((sh) => ({ ...sh, [f.who]: sh[f.who] + 1 })), f.delay);
      }
    });
    const t = setTimeout(() => setFloats((cur) => cur.filter((f) => !add.includes(f))), 1600 + add.length * 350);
    return () => clearTimeout(t);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [version]);

  if (!b) return null;
  const e = b.enemy;
  const acts = game.battleActions();
  const over = b.over;
  const intent = MOVES[b.intent] || MOVES.attack;

  const floatsFor = (who) => floats.filter((f) => f.who === who).map((f) => (
    <span key={f.id} className={`bfloat ${f.kind}`} style={{ animationDelay: `${f.delay}ms` }}>
      {f.kind === 'miss' ? 'Miss' : f.kind === 'guard' ? 'Guard' : f.kind === 'heal' ? `+${f.amount}` : `-${f.amount}`}
      {f.kind === 'crit' ? '!' : ''}
    </span>
  ));

  return (
    <div className="battle" role="dialog" aria-label={`Battle with ${e.name}`}>
      <div className="battle-stage">
        <div className="combatant enemy">
          <div className="nameplate">
            <b>{e.name}</b>
            <span className="muted">AC {enemyAc(b)}</span>
          </div>
          <Bar value={Math.max(0, e.hp)} max={e.maxHp} kind="hp" />
          <div className="statuses">
            {e.stun > 0 && <span className="chip">Stunned</span>}
            {e.burn > 0 && <span className="chip burn">Burning {e.burn}</span>}
            {e.guard > 0 && <span className="chip">Guarding</span>}
          </div>
          <div className={`sprite-wrap ${over === 'win' ? 'defeated' : ''}`} key={'e' + shake.enemy}>
            <img className={`sprite big ${shake.enemy && !reduced ? 'shake' : ''}`} src={spriteUrl(e.kind)} alt={e.name} />
            {floatsFor('enemy')}
          </div>
          {!over && (
            <div className="intent" title={intent.desc}>
              <span className="intent-icon" aria-hidden="true">{INTENT_ICON[b.intent] || '⚔'}</span>
              Next: <b>{intent.name}</b> <span className="muted">— {intent.desc}</span>
            </div>
          )}
        </div>

        <div className="combatant hero">
          <div className={`sprite-wrap ${over === 'lost' ? 'defeated' : ''}`} key={'p' + shake.player}>
            <img className={`sprite big flip ${shake.player && !reduced ? 'shake' : ''}`} src={spriteUrl(heroSprite(p.cls))} alt="You" />
            {floatsFor('player')}
          </div>
          <div className="nameplate">
            <b>You</b>
            <span className="muted">AC {playerAc(game)} · {weaponOf(p).name}</span>
          </div>
          <Bar value={p.hp} max={p.maxHp} kind="hp" />
          {p.maxSp > 0 && <Bar value={p.sp} max={p.maxSp} kind="sp" />}
          <div className="statuses">
            {b.guard > 0 && <span className="chip">Defending</span>}
            {b.poison > 0 && <span className="chip poison">Poisoned {b.poison}</span>}
          </div>
        </div>
      </div>

      <div className="battle-log" ref={logRef} aria-live="polite">
        {b.log.slice(-8).map((l, i) => <p key={b.log.length - 8 + i} className={`log-${l.kind}`}>{l.text}</p>)}
      </div>

      {!over ? (
        <div className="battle-actions">
          {acts.map((a, i) => (
            <button key={a.id + (a.arg || '')} type="button" className={`btn act act-${a.id}`} disabled={!a.ok}
              title={a.ok ? a.desc : `${a.desc} (${a.why})`} onClick={() => onAct(a.id, a.arg)}>
              <span className="kbd">{i + 1}</span>
              <span className="act-label">{a.label}</span>
              {a.cost ? <span className="cost">{a.cost} SP</span> : null}
              <span className="act-desc">{a.ok ? a.desc : a.why}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="battle-result">
          <h2>{over === 'win' ? 'Victory!' : over === 'fled' ? 'You got away' : 'Defeated'}</h2>
          {over === 'win' && <p>+{b.xp} XP</p>}
          <button className="btn primary" type="button" onClick={onContinue} autoFocus>Continue</button>
        </div>
      )}
    </div>
  );
}

export function battleKeyAction(game, key) {
  const n = parseInt(key, 10);
  if (!(n >= 1 && n <= 9)) return null;
  const a = game.battleActions()[n - 1];
  return a && a.ok ? a : null;
}
