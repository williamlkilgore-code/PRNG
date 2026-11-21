/* The side panel: dice, the direction pad (Roll in the middle), shooting,
 * spells, potions and torches, and the status line. */
import { SPELLS, SPELL_IDS } from '../engine/game.js';
import { rules as R } from '../engine/rules.js';

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function Die({ value, chosen, discarded, onClick, label, rolling }) {
  return (
    <button type="button" className={`die ${chosen ? 'chosen' : ''} ${discarded ? 'discarded' : ''} ${rolling ? 'rolling' : ''}`}
      onClick={onClick} disabled={!onClick} aria-label={label || `Die showing ${value}`}>
      {Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[value] && PIPS[value].includes(i) ? 'pip' : ''} />)}
    </button>
  );
}

const PAD = [['NW', '↖'], ['N', '↑'], ['NE', '↗'], ['W', '←'], ['ROLL', ''], ['E', '→'], ['SW', '↙'], ['S', '↓'], ['SE', '↘']];

export default function Controls({ game, ui, act }) {
  const s = game.s, p = s.player;
  const dirs = ui.aiming ? game.shotDirs() : game.availableDirs();
  const canRoll = s.phase === 'roll' && game.levelsOwed() === 0 && !ui.busy;
  const canPass = s.phase === 'choose' && s.die !== null && !game.availableDirs().length;
  const ranged = game.canShoot() || game.freeTargets().length > 0;

  return (
    <aside className="controls" aria-label="Controls">
      <div className="dice-row">
        {s.dice ? s.dice.map((v, i) => (
          <Die key={i} value={v} rolling={ui.rolling}
            chosen={s.die === i} discarded={s.die !== null && s.die !== i}
            onClick={s.phase === 'choose' && !ui.busy ? () => act.pickDie(i) : null}
            label={`Die ${i + 1}: ${v}${s.die === i ? ' (chosen)' : ''}`} />
        )) : <p className="muted small">Roll to begin.</p>}
        {s.dice && s.die !== null && ['choose', 'redirect', 'moving', 'stopPrompt'].includes(s.phase) && (
          <div className="dice-info">
            <b>{game.stepsLeft()}</b> {s.parity === 'ortho' ? 'straight' : 'diagonal'}
            {s.halved ? <small> (webbed)</small> : null}
          </div>
        )}
      </div>

      <p className="status" aria-live="polite">{statusText(game, ui)}</p>

      {s.phase === 'stopPrompt' && (
        <div className="row">
          <button className="btn primary" type="button" onClick={act.stopMove}>Stop here</button>
          <button className="btn" type="button" onClick={act.continueMove}>Keep going</button>
        </div>
      )}

      <div className="pad" aria-label="Direction pad">
        {PAD.map(([d, label]) => d === 'ROLL' ? (
          canPass ? <button key={d} type="button" className="pad-btn roll" onClick={act.pass}>Pass</button>
            : <button key={d} type="button" className="pad-btn roll" disabled={!canRoll} onClick={act.roll}>Roll</button>
        ) : (
          <button key={d} type="button" className={`pad-btn ${ui.aiming ? 'aim' : ''}`} disabled={ui.busy || !dirs.includes(d)}
            onClick={() => act.choose(d)} onMouseEnter={() => act.hover(d)} onMouseLeave={() => act.hover(null)} aria-label={`Go ${d}`}>{label}</button>
        ))}
      </div>

      <div className="tools">
        {game.hasRanged() && (
          <button type="button" className={`btn ${ui.aiming ? 'primary' : ''}`} disabled={!ranged || ui.busy} onClick={act.toggleAim}
            title={p.cls === 'wizard' ? 'Magic missile instead of moving' : 'Sling a stone instead of moving'}>
            {p.cls === 'wizard' ? 'Missile' : `Sling (${p.ammo})`}
          </button>
        )}
        <button type="button" className="btn" disabled={!game.canDrink() || ui.busy} onClick={act.drink}
          title={`Heal ${R.potionHeal(Math.max(1, s.floor))}`}>Potion ({p.potions})</button>
        {s.level && s.level.dark && (
          <button type="button" className="btn" disabled={!game.canLightTorch() || ui.busy} onClick={act.lightTorch}>Torch ({p.torches})</button>
        )}
      </div>

      {(p.cls === 'wizard' || SPELL_IDS.some((k) => p.spells[k] > 0)) && (
        <div className="spells">
          {SPELL_IDS.map((k) => {
            const known = p.cls === 'wizard' ? p.known[k] : 0;
            if (p.cls === 'wizard' ? !known && !p.spells[k] : !p.spells[k]) return null;
            return (
              <button key={k} type="button" className="btn spell" disabled={!game.canCast(k) || ui.busy} onClick={() => act.cast(k)}
                title={`${SPELLS[k].desc} ${known ? `Level ${known}: ${SPELLS[k].at(known)}.` : `Costs ${R.CHARGES_PER_CAST} charges.`}`}>
                {SPELLS[k].name}{known ? ` L${known}` : ''} <small>{p.cls === 'wizard' ? `${p.casts} cast${p.casts === 1 ? '' : 's'}` : `${p.spells[k]}✦`}</small>
              </button>
            );
          })}
        </div>
      )}
      {s.rerolls && s.rerolls.left > 0 && s.phase === 'choose' && (
        <div className="row">
          {s.dice.map((v, i) => s.rerolls.choose
            ? <select key={i} className="btn" aria-label={`Set die ${i + 1}`} value={v} onChange={(e) => act.setDie(i, +e.target.value)}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            : <button key={i} type="button" className="btn" onClick={() => act.rerollDie(i)}>Re-roll die {i + 1}</button>)}
        </div>
      )}
    </aside>
  );
}

export function statusText(game, ui) {
  const s = game.s;
  if (ui.aiming) return `Aim: click a ${s.parity === 'ortho' ? 'straight' : 'diagonal'} direction (range ${game.shotRange()}, ${game.rangedDamage()} damage), or an enemy within ${s.player.range} steps.`;
  if (game.levelsOwed() > 0 && s.phase === 'roll') return s.player.cls ? 'Level up! Choose a boon.' : 'Choose your class!';
  switch (s.phase) {
    case 'roll': return s.player.webbed ? 'Still tangled in web: this roll is halved. Press Roll.' : 'Press Roll (or Space).';
    case 'choose':
      if (s.die === null) return 'Pick a die. Its number is how far you move: even goes straight, odd goes diagonally.';
      if (!game.availableDirs().length) return 'No legal move with this roll. Pass the turn.';
      return `Click the map in a ${s.parity === 'ortho' ? 'straight' : 'diagonal'} direction. You slide until your ${s.steps} moves run out.`;
    case 'moving': return 'Moving…';
    case 'stopPrompt': return `You've moved your die's worth. Stop here, or keep going (${s.move.stepsLeft} more).`;
    case 'redirect': return `Blocked with ${s.move.stepsLeft} move${s.move.stepsLeft > 1 ? 's' : ''} left. Choose a new direction.`;
    case 'battle': return 'Battle!';
    case 'levelDone': return 'Floor cleared!';
    case 'dead': return 'You have fallen.';
  }
  return '';
}
