/* The app: title screen, then the dungeon (map + controls), with the battle
 * screen and dialogs shown according to the game's phase. The engine
 * (src/engine) holds all rules; this file only drives it and re-renders. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../engine/game.js';
import DungeonCanvas from '../render/DungeonCanvas.jsx';
import { spriteUrl } from '../render/sprites.js';
import Hud from './Hud.jsx';
import Controls from './Controls.jsx';
import BattleScreen, { battleKeyAction } from './BattleScreen.jsx';
import { LevelUp, PickLock, LevelDone, GameOver, Shop, Character, Journal, Saves, Help, Modal } from './Modals.jsx';
import { audio } from './audio.js';
import * as store from './storage.js';

const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? Math.min(ms, 30) : ms));
const KEY_DIRS = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E', w: 'N', s: 'S', a: 'W', d: 'E',
  q: 'NW', e: 'NE', z: 'SW', c: 'SE', 8: 'N', 2: 'S', 4: 'W', 6: 'E', 7: 'NW', 9: 'NE', 1: 'SW', 3: 'SE' };

export default function App() {
  const gref = useRef(null);
  const [game, setGame] = useState(null);
  const [version, setVersion] = useState(0);
  const [popups, setPopups] = useState([]);
  const [ui, setUiState] = useState({ busy: false, aiming: false, rolling: false, modal: null, hover: null, shot: null });
  const uiRef = useRef(ui);
  const setUi = useCallback((patch) => { uiRef.current = { ...uiRef.current, ...patch }; setUiState(uiRef.current); }, []);
  const [muted, setMuted] = useState(audio.settings.muted);

  // After any engine call: sounds, floating numbers, autosave, music, redraw.
  const refresh = useCallback(() => {
    const g = gref.current;
    if (!g) return;
    // Debug handle in the browser console (like the original game's DiceDelve.game).
    window.DiceDelve = { game: g, refresh };
    for (const e of g.drainEvents()) audio.sfx(e);
    const pp = g.drainPopups();
    if (pp.length) setPopups(pp);
    const s = g.s;
    if (s.phase !== 'dead' && s.checkpoint) store.writeSave(s.checkpoint);
    if (s.phase === 'dead') { store.clearSave(); store.recordBest(s.tutorial ? 0 : s.floor); }
    if (s.phase === 'levelDone' && !s.summary.tutorial) store.recordBest(s.summary.floor);
    const mood = s.phase === 'battle' ? 'battle' : s.shop ? 'shop' : s.tutorial ? 'tutorial' : s.level && s.level.dark ? 'dark' : 'floor';
    audio.setMusic(s.phase === 'dead' ? 'none' : mood, s.seed, s.floor);
    setVersion((v) => v + 1);
  }, []);

  const start = useCallback((g) => {
    gref.current = g;
    setGame(g);
    setUi({ busy: false, aiming: false, modal: null, hover: null, shot: null });
    refresh();
  }, [refresh, setUi]);

  // ---- turn flow
  const runMove = useCallback(async () => {
    const g = gref.current;
    setUi({ busy: true, hover: null });
    while (g.s.phase === 'moving') {
      const ev = g.step();
      refresh();
      if (ev.type === 'pick' || ev.type === 'battle') break;
      await sleep(ev.type === 'teleport' ? 380 : ev.type === 'web' ? 300 : 120);
    }
    if (g.s.phase === 'battle') await sleep(250);
    setUi({ busy: false });
    refresh();
  }, [refresh, setUi]);

  const act = {
    roll: async () => {
      const g = gref.current;
      if (uiRef.current.busy || !g.roll()) return;
      setUi({ rolling: !reducedMotion });
      refresh();
      if (!reducedMotion) { await sleep(350); setUi({ rolling: false }); }
    },
    pickDie: (i) => { if (gref.current.pickDie(i)) refresh(); },
    choose: (d) => {
      const g = gref.current;
      if (uiRef.current.busy) return;
      if (uiRef.current.aiming) { act.shoot(d); return; }
      if (g.choose(d)) runMove();
    },
    shoot: async (d, target) => {
      const g = gref.current;
      const r = target === undefined ? g.shoot(d) : g.shootAt(target);
      if (!r) return;
      setUi({ aiming: false, busy: true, shot: r.cells });
      refresh();
      await sleep(400);
      setUi({ busy: false, shot: null });
      refresh();
    },
    toggleAim: () => { const g = gref.current; setUi({ aiming: !uiRef.current.aiming && (g.canShoot() || g.freeTargets().length > 0) }); },
    hover: (d) => setUi({ hover: d }),
    pass: () => { if (gref.current.passTurn()) refresh(); },
    stopMove: () => { if (gref.current.stopMove()) refresh(); },
    continueMove: () => { if (gref.current.continueMove()) runMove(); },
    drink: () => { if (gref.current.drinkPotion()) refresh(); },
    lightTorch: () => { if (gref.current.lightTorch()) refresh(); },
    cast: (k) => { if (gref.current.cast(k)) refresh(); },
    rerollDie: (i) => { if (gref.current.rerollDie(i)) refresh(); },
    setDie: (i, v) => { if (gref.current.setDie(i, v)) refresh(); },
    upgradeSpell: (k) => { if (gref.current.upgradeSpell(k)) refresh(); },
    chooseClass: (c, sp) => { if (gref.current.chooseClass(c, sp)) refresh(); },
    chooseBoon: (id, sp) => { if (gref.current.chooseBoon(id, sp)) refresh(); },
    pickLock: () => { const g = gref.current; g.pickLock(); refresh(); if (g.s.phase === 'moving') runMove(); },
    declinePick: () => { const g = gref.current; g.declinePick(); refresh(); if (g.s.phase === 'moving') runMove(); },
    nextFloor: () => { if (gref.current.nextFloor()) refresh(); },
    buy: (i) => { if (gref.current.buy(i)) refresh(); },
    gamble: (w) => { if (gref.current.gamble(w)) refresh(); },
    battle: (id, arg) => {
      const g = gref.current;
      if (!g.battleAct(id, arg)) return;
      if (g.s.battle.over === 'win') audio.sfx('victory');
      refresh();
    },
    endBattle: () => {
      const g = gref.current;
      g.endBattle();
      refresh();
      if (g.s.phase === 'moving') runMove();
    },
    retryFloor: () => {
      const g = gref.current, r = Game.fromSave(g.s.checkpoint);
      if (r.game) start(r.game);
    },
    toTitle: () => { gref.current = null; setGame(null); audio.setMusic('none'); },
  };

  // ---- keyboard
  useEffect(() => {
    const onKey = (e) => {
      audio.unlock();
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      const g = gref.current;
      if (e.key === 'm' || e.key === 'M') { setMuted(audio.toggleMute()); return; }
      if (!g) return;
      const s = g.s;
      if (s.phase === 'battle') {
        if (s.battle.over && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act.endBattle(); return; }
        const a = battleKeyAction(g, e.key);
        if (a) { e.preventDefault(); act.battle(a.id, a.arg); }
        return;
      }
      if (uiRef.current.modal) { if (e.key === 'Escape') setUi({ modal: null }); return; }
      if (e.key === 'j' || e.key === 'J') { setUi({ modal: 'journal' }); return; }
      if ((e.key === ' ' || e.key === 'Enter') && s.phase === 'roll') { e.preventDefault(); act.roll(); return; }
      if (e.key === '[' || e.key === ']') { act.pickDie(e.key === '[' ? 0 : 1); return; }
      const d = KEY_DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (d) { e.preventDefault(); act.choose(d); }
    };
    const unlock = () => audio.unlock();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', unlock);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', unlock); };
  });

  if (!game) return <TitleScreen onStart={start} />;

  const s = game.s;
  const dirs = ui.busy ? [] : ui.aiming ? game.shotDirs() : game.availableDirs();
  const preview = ui.hover && !ui.busy ? (ui.aiming ? game.shotPath(ui.hover).cells : game.previewPath(ui.hover)) : null;
  const closeModal = () => setUi({ modal: null });

  let dialog = null;
  if (s.phase === 'pickPrompt') dialog = <PickLock game={game} act={act} />;
  else if (s.phase === 'levelDone') dialog = <LevelDone game={game} act={act} />;
  else if (s.phase === 'shop') dialog = <Shop game={game} act={act} />;
  else if (s.phase === 'dead') dialog = <GameOver game={game} best={store.best()} act={act} />;
  else if (s.phase === 'roll' && game.levelsOwed() > 0) dialog = <LevelUp key={s.player.level} game={game} act={act} />;
  else if (ui.modal === 'character') dialog = <Character game={game} onClose={closeModal} act={act} />;
  else if (ui.modal === 'journal') dialog = <Journal game={game} onClose={closeModal} />;
  else if (ui.modal === 'help') dialog = <Help onClose={closeModal} />;
  else if (ui.modal === 'saves') dialog = <Saves game={game} onClose={closeModal} onLoad={(cp) => {
    const r = Game.fromSave(cp);
    if (r.error) return r.error;
    start(r.game); return null;
  }} />;

  const last = s.log[s.log.length - 1];
  return (
    <div className="app">
      <Hud game={game} onOpen={(m) => setUi({ modal: m })} />
      <nav className="menu">
        <button className="btn tiny" type="button" onClick={() => setUi({ modal: 'journal' })}>Journal</button>
        <button className="btn tiny" type="button" onClick={() => setUi({ modal: 'saves' })}>Saves</button>
        <button className="btn tiny" type="button" onClick={() => setUi({ modal: 'help' })}>Help</button>
        <button className="btn tiny" type="button" onClick={() => setMuted(audio.toggleMute())} aria-pressed={muted}>{muted ? 'Sound off' : 'Sound on'}</button>
        <button className="btn tiny" type="button" onClick={act.toTitle}>Quit</button>
      </nav>
      <main className="play">
        <section className="board">
          {s.level && (
            <DungeonCanvas game={game} version={version} popups={popups} preview={preview} shotCells={ui.shot}
              dirs={dirs} reduced={reducedMotion}
              onHover={(d) => setUi({ hover: d })}
              onPick={(d, enemy) => {
                if (ui.aiming && enemy >= 0 && game.freeTargets().includes(enemy)) act.shoot(null, enemy);
                else if (d) act.choose(d);
              }} />
          )}
          {last && <p className={`ticker log-${last.kind}`} key={last.seq}>{last.text}</p>}
        </section>
        <Controls game={game} ui={ui} act={act} />
      </main>
      {s.phase === 'battle' && (
        <BattleScreen game={game} version={version} onAct={act.battle} onContinue={act.endBattle} reduced={reducedMotion} />
      )}
      {dialog}
    </div>
  );
}

function TitleScreen({ onStart }) {
  const prefs = store.loadPrefs();
  const [seed, setSeed] = useState('');
  const [tutorial, setTutorial] = useState(prefs.tutorial);
  const [help, setHelp] = useState(false);
  const [err, setErr] = useState(null);
  const saved = store.loadSave();
  const begin = () => {
    store.savePrefs({ ...prefs, tutorial });
    onStart(Game.create(seed, { tutorial }));
  };
  return (
    <div className="title">
      <div className="title-art" aria-hidden="true">
        {['fighter', 'rogue', 'wizard'].map((k) => <img key={k} className="sprite big" src={spriteUrl(k)} alt="" />)}
        <span className="vs">vs</span>
        {['goblin', 'skeleton', 'ogre'].map((k) => <img key={k} className="sprite big" src={spriteUrl(k)} alt="" />)}
      </div>
      <h1>Dice Delve</h1>
      <p className="subtitle">A dice-driven dungeon RPG</p>
      {saved && (
        <button className="btn primary big" type="button" onClick={() => {
          const r = Game.fromSave(saved);
          if (r.error) setErr(r.error); else onStart(r.game);
        }}>Continue · {saved.tutorial ? 'Tutorial' : 'Floor'} {saved.floor}</button>
      )}
      <div className="new-game">
        <label htmlFor="seed">Seed (optional)</label>
        <input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="random" maxLength={60}
          onKeyDown={(e) => { if (e.key === 'Enter') begin(); }} />
        <label className="check"><input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} /> Play the tutorial first</label>
        <button className={`btn ${saved ? '' : 'primary'} big`} type="button" onClick={begin}>New game</button>
        <button className="btn" type="button" onClick={() => setHelp(true)}>How to play</button>
      </div>
      {err && <p className="error">Couldn't load the save: {err}.</p>}
      <p className="muted small">Best floor: {store.best() || '—'}</p>
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}

export { Modal };
