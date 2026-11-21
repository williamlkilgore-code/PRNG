/* Dialogs: class choice, level-up boons, lock picks, floor summary, death,
 * the shop, the character sheet, the journal, saves and the rules. */
import { useState } from 'react';
import { SPELLS, SPELL_IDS, BOONS, CLASS_IDS } from '../engine/game.js';
import { rules as R } from '../engine/rules.js';
import { WEAPONS, ARMORS, weaponLabel, armorLabel } from '../engine/items.js';
import { ENEMIES } from '../engine/enemies.js';
import { SKILLS } from '../engine/battle.js';
import { spriteUrl, heroSprite } from '../render/sprites.js';
import { floorName } from './Hud.jsx';
import { encodeCode, decodeCode } from './storage.js';

export function Modal({ title, children, onClose, wide }) {
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && <h2>{title}</h2>}
        {children}
        {onClose && <button className="btn close-x" type="button" onClick={onClose} aria-label="Close">✕</button>}
      </div>
    </div>
  );
}

const CLASS_BLURB = {
  fighter: 'Tough and hard-hitting. Power Strike doubles damage; Shield Bash stuns.',
  rogue: 'Quick and sly. Backstab crits often, and the sling hits from afar. Good with locks.',
  wizard: 'Fragile but powerful. Magic Missile never misses, Firebolt burns, and spells shape the map.',
};

function SpellPicker({ value, onChange, filter }) {
  return (
    <div className="row wrap">
      {SPELL_IDS.filter(filter || (() => true)).map((k) => (
        <button key={k} type="button" className={`btn ${value === k ? 'primary' : ''}`} onClick={() => onChange(k)} title={SPELLS[k].desc}>{SPELLS[k].name}</button>
      ))}
    </div>
  );
}

export function LevelUp({ game, act }) {
  const p = game.s.player;
  const [spell, setSpell] = useState(null);
  const [pending, setPending] = useState(null);
  if (!p.cls) {
    return (
      <Modal title="Choose your path" wide>
        <p>Your battles have hardened you. Choose a class:</p>
        <div className="cards">
          {CLASS_IDS.map((c) => {
            const C = R.CLASSES[c];
            return (
              <div key={c} className={`card ${pending === c ? 'selected' : ''}`}>
                <img className="sprite big" src={spriteUrl(c)} alt="" />
                <h3>{C.name}</h3>
                <p className="small">{CLASS_BLURB[c]}</p>
                <ul className="small">
                  <li>+{C.hp} max HP{C.str ? `, +${C.str} STR` : ''}{C.dex ? `, +${C.dex} DEX` : ''}</li>
                  <li>{C.sp} SP · skills: {C.skills.map((k) => SKILLS[k].name).join(', ')}</li>
                  {c === 'rogue' && <li>A sling with {C.ammo} stones</li>}
                  {c === 'wizard' && <li>Learns a spell; casts per floor</li>}
                </ul>
                <button className="btn primary" type="button" onClick={() => (c === 'wizard' ? setPending(c) : act.chooseClass(c))}>Become a {C.name}</button>
              </div>
            );
          })}
        </div>
        {pending === 'wizard' && (
          <div className="sub">
            <p>Choose your first spell:</p>
            <SpellPicker value={spell} onChange={setSpell} />
            <button className="btn primary" type="button" disabled={!spell} onClick={() => act.chooseClass('wizard', spell)}>Learn it</button>
          </div>
        )}
      </Modal>
    );
  }
  const C = R.CLASSES[p.cls];
  return (
    <Modal title={`Level ${p.level + 1}!`}>
      <p>+{C.levelHp} max HP and +{C.levelSp} max SP. Choose a boon:</p>
      <div className="choice-list">
        {game.boonChoices().map((id) => (
          <button key={id} type="button" className={`btn choice ${pending === id ? 'primary' : ''}`}
            onClick={() => (id === 'spell' ? setPending('spell') : act.chooseBoon(id))}>
            <b>{BOONS[id].name}</b><span className="small">{BOONS[id].desc}</span>
          </button>
        ))}
      </div>
      {pending === 'spell' && (
        <div className="sub">
          <SpellPicker value={spell} onChange={setSpell} filter={(k) => p.known[k] < R.SPELL_MAX} />
          <button className="btn primary" type="button" disabled={!spell} onClick={() => act.chooseBoon('spell', spell)}>
            {spell && p.known[spell] ? `Raise to level ${p.known[spell] + 1}` : 'Learn it'}
          </button>
        </div>
      )}
    </Modal>
  );
}

export function PickLock({ game, act }) {
  const door = game.pickDoor();
  if (!door) return null;
  const p = game.s.player, target = R.LOCK_TARGET[door.color];
  return (
    <Modal title={`Pick the ${door.color} lock?`}>
      <img className="sprite big center" src={spriteUrl('lock', door.color)} alt="" />
      <p>Roll d20 + DEX ({p.dex}): you need <b>{target}</b> ({Math.round(R.pickChance(p.dex, door.color) * 100)}%).</p>
      <p className="muted small">Success opens the door and you keep moving. Failure breaks the pick and stops you. You have {p.lockpicks}.</p>
      <div className="row">
        <button className="btn primary" type="button" onClick={act.pickLock}>Pick the lock</button>
        <button className="btn" type="button" onClick={act.declinePick}>Leave it</button>
      </div>
    </Modal>
  );
}

export function LevelDone({ game, act }) {
  const sm = game.s.summary || {};
  return (
    <Modal title={sm.tutorial ? `Tutorial ${sm.floor} complete` : `Floor ${sm.floor} cleared`}>
      <p>{sm.turns} turn{sm.turns === 1 ? '' : 's'}.{sm.rest ? ` You catch your breath: +${sm.rest} HP.` : ''}</p>
      <p className="muted">Next: {sm.nextTutorial ? `Tutorial ${sm.next}` : sm.nextIsShop ? `a shop (floor ${sm.next})` : `floor ${sm.next}`}.</p>
      <button className="btn primary" type="button" onClick={act.nextFloor} autoFocus>Descend</button>
    </Modal>
  );
}

export function GameOver({ game, best, act }) {
  const s = game.s, st = s.stats, p = s.player;
  return (
    <Modal title="You have fallen">
      <img className="sprite big center fallen" src={spriteUrl(heroSprite(p.cls))} alt="" />
      <p>Slain by {st.cause || 'the dungeon'}.</p>
      <div className="stats-grid">
        <span>Reached</span><b>{floorName(s)}</b>
        <span>Level</span><b>{p.level} {p.cls ? R.CLASSES[p.cls].name : ''}</b>
        <span>Kills</span><b>{st.kills}</b>
        <span>Coins found</span><b>{st.coins}</b>
        <span>Best floor</span><b>{best}</b>
      </div>
      <div className="row">
        <button className="btn primary" type="button" onClick={act.retryFloor}>Retry this floor</button>
        <button className="btn" type="button" onClick={act.toTitle}>Title screen</button>
      </div>
    </Modal>
  );
}

const SHOP_INFO = {
  heal: ['Heal', 'Restore to full health.'],
  potion: ['Healing potion', 'Carry it; drink in battle or on the map.'],
  str: ['Strength +1', 'Hit more often and harder.'],
  dex: ['Dexterity +1', 'Better initiative, fleeing, lock picks and AC.'],
  maxhp: ['Max health +2', 'And heal 2.'],
  torch: ['Torch', 'Light it on a dark floor.'],
  ammo: ['Sling stones ×3', 'For the Rogue’s sling.'],
  lockpick: ['Lock pick', 'Try a locked door without its key.'],
  gamble: ['Gamble', 'Roll a d6: 1-2 lose, 3-4 even, 5 +2, 6 double.'],
};

export function Shop({ game, act }) {
  const s = game.s, p = s.player;
  const [wager, setWager] = useState(1);
  const info = (id) => {
    if (id === 'weapon') {
      const w = WEAPONS[p.weapon + 1];
      return w ? [weaponLabel(w), `Replaces your ${WEAPONS[p.weapon].name}.`] : ['Weapon', 'You have the best weapon.'];
    }
    if (id === 'armor') {
      const a = ARMORS[p.armor + 1];
      return a ? [armorLabel(a), `Replaces your ${ARMORS[p.armor].name}.`] : ['Armor', 'You have the best armor.'];
    }
    return SHOP_INFO[id];
  };
  const g = s.shop.lastGamble;
  return (
    <Modal title={`The merchant · floor ${s.floor}`} wide>
      <p>You have <b>{p.coins}</b> coins, {p.hp}/{p.maxHp} HP.</p>
      <div className="shop-list">
        {s.shop.items.map((it, i) => {
          const [name, desc] = info(it.id);
          if (it.id === 'gamble') {
            return (
              <div key={i} className="shop-item">
                <div><b>{name}</b><span className="small muted">{desc}</span></div>
                <div className="row">
                  <input type="number" min="1" max={Math.max(1, p.coins)} value={wager} onChange={(e) => setWager(+e.target.value)} aria-label="Wager" />
                  <button className="btn" type="button" disabled={s.shop.gambleClosed || wager < 1 || wager > p.coins} onClick={() => act.gamble(wager)}>
                    {s.shop.gambleClosed ? 'Closed' : 'Bet'}
                  </button>
                </div>
              </div>
            );
          }
          const price = game.price(it.id);
          return (
            <div key={i} className={`shop-item ${it.sold ? 'sold' : ''}`}>
              <div><b>{name}</b><span className="small muted">{desc}</span></div>
              <button className="btn" type="button" disabled={!game.canBuy(i)} onClick={() => act.buy(i)}>
                {it.sold ? 'Sold' : `${price} coins`}
              </button>
            </div>
          );
        })}
      </div>
      {g && <p className="small">Gamble {g.wager}: rolled {g.roll}. {g.text}</p>}
      <button className="btn primary" type="button" onClick={act.nextFloor}>Leave the shop</button>
    </Modal>
  );
}

export function Character({ game, onClose, act }) {
  const p = game.s.player;
  const cls = p.cls ? R.CLASSES[p.cls] : null;
  return (
    <Modal title="Character" onClose={onClose}>
      <div className="char-head">
        <img className="sprite big" src={spriteUrl(heroSprite(p.cls))} alt="" />
        <div>
          <h3>{cls ? cls.name : 'Adventurer'} · level {p.level}</h3>
          <p className="small muted">XP {p.xp} (next level at {R.levelThreshold(p.level + 1)})</p>
        </div>
      </div>
      <div className="stats-grid">
        <span>Health</span><b>{p.hp}/{p.maxHp}</b>
        <span>Skill points</span><b>{p.sp}/{p.maxSp}</b>
        <span>Strength</span><b>{p.str}</b>
        <span>Dexterity</span><b>{p.dex}</b>
        <span>Armor class</span><b>{game.ac()}</b>
        <span>Weapon</span><b>{weaponLabel(WEAPONS[p.weapon])}</b>
        <span>Armor</span><b>{armorLabel(ARMORS[p.armor])}</b>
        <span>Potions</span><b>{p.potions}</b>
        {p.range > 0 && <><span>Range</span><b>{p.range}</b></>}
        {p.moveBoost > 0 && <><span>Move boost</span><b>+{p.moveBoost}</b></>}
        {p.power > 0 && <><span>Arcane power</span><b>+{p.power}</b></>}
      </div>
      {cls && (
        <>
          <h3>Skills</h3>
          <ul className="small">{cls.skills.map((k) => <li key={k}><b>{SKILLS[k].name}</b> ({SKILLS[k].sp} SP): {SKILLS[k].desc}</li>)}</ul>
        </>
      )}
      <h3>Spells</h3>
      <ul className="small">
        {SPELL_IDS.map((k) => (
          <li key={k}><b>{SPELLS[k].name}</b>{p.known[k] ? ` level ${p.known[k]}` : ''} · {p.spells[k]} charge{p.spells[k] === 1 ? '' : 's'}
            {game.canUpgrade(k) && <> <button className="btn tiny" type="button" onClick={() => act.upgradeSpell(k)}>Study ({game.upgradeCost(k)} charges)</button></>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function Journal({ game, onClose }) {
  return (
    <Modal title="Journal" onClose={onClose}>
      <div className="journal">
        {game.s.log.slice().reverse().map((l) => <p key={l.seq} className={`log-${l.kind}`}>{l.text}</p>)}
      </div>
    </Modal>
  );
}

export function Saves({ game, onClose, onLoad }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);
  const cp = game && game.s.phase !== 'dead' ? game.s.checkpoint : null;
  const mine = cp ? encodeCode(cp) : '';
  return (
    <Modal title="Saves" onClose={onClose}>
      <p className="small">The game saves itself at the start of every floor. A save code lets you move it to another browser.</p>
      {cp && (
        <>
          <label className="small" htmlFor="mycode">Your save code ({cp.tutorial ? 'tutorial' : 'floor'} {cp.floor}):</label>
          <textarea id="mycode" readOnly value={mine} rows={3} onFocus={(e) => e.target.select()} />
          <button className="btn" type="button" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(mine); setMsg('Copied.'); }}>Copy</button>
        </>
      )}
      <label className="small" htmlFor="loadcode">Load a save code:</label>
      <textarea id="loadcode" value={code} rows={3} onChange={(e) => setCode(e.target.value)} />
      <button className="btn primary" type="button" disabled={!code.trim()} onClick={() => {
        const err = onLoad(decodeCode(code));
        setMsg(err ? `Can't load that: ${err}.` : null);
      }}>Load</button>
      {msg && <p className="small">{msg}</p>}
    </Modal>
  );
}

export function Help({ onClose }) {
  return (
    <Modal title="How to play" onClose={onClose} wide>
      <h3>Moving</h3>
      <p>Roll two dice and pick one. Its number is how far you slide: <b>even</b> goes straight, <b>odd</b> goes diagonally. You keep sliding until the moves run out; if blocked, pick a new direction (not straight back). Find the stairs.</p>
      <h3>Battles</h3>
      <p>Walk into a monster to fight it. Each round choose <b>Attack</b> (d20 + STR + weapon vs its AC), a class <b>skill</b> (costs SP, which refills every floor), <b>Defend</b> (+4 AC, +1 SP), a <b>Potion</b>, or <b>Flee</b> (d20 + DEX). The monster shows what it will do next, so plan around it. Win and your slide carries on; flee and your move ends.</p>
      <h3>Growing stronger</h3>
      <p>Battles give XP. Your first level lets you pick a class (Fighter, Rogue or Wizard); later levels give HP, SP and a boon. Chests can hold better weapons and armor; shops sell upgrades. Taking the stairs restores a quarter of your health.</p>
      <h3>Monsters</h3>
      <div className="bestiary">
        {Object.entries(ENEMIES).map(([k, e]) => (
          <div key={k}><img className="sprite" src={spriteUrl(k)} alt="" /><span>{e.name}{e.from < 99 ? <small> · floor {e.from}+</small> : <small> · hides as a chest or door</small>}</span></div>
        ))}
      </div>
      <h3>Keys</h3>
      <p className="small">Arrows / WASD: straight · Q E Z C: diagonals · Space: roll · [ ]: pick die · 1-6: battle actions · J: journal · M: mute</p>
    </Modal>
  );
}
