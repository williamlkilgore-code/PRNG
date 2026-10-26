/* DOM wiring: renders game state, handles input, runs move animation. */
(function () {
  const DC = window.DC;
  const { Game, SPELLS, BOONS, rules: R } = DC;
  const RD = DC.render;
  // Sound is optional: without audio.js (or Web Audio) these do nothing.
  const AU = DC.audio || { sfx() {}, setMusic() {}, unlock() {}, setVolume() {}, setOn() {}, toggleMute() { return true; }, settings: {}, available: false };
  const $ = (sel) => document.querySelector(sel);
  const SAVE_KEY = 'dicedelve-save-v1';
  const SLOTS_KEY = 'dicedelve-slots-v1';
  const MAX_SLOTS = 12;
  const BEST_KEY = 'dicedelve-best-v1';
  const THEME_KEY = 'dicedelve-theme';
  const HINTS_KEY = 'dicedelve-hints-v1';
  const TUTORIAL_KEY = 'dicedelve-tutorial-v1';
  const FX_KEY = 'dicedelve-fx-v1';
  const PAD_ORDER = ['NW', 'N', 'NE', 'W', null, 'E', 'SW', 'S', 'SE'];
  const ANGLE = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };
  const SPELL_ORDER = ['reroll', 'luck', 'noclip', 'invis', 'fireball'];
  const KEYMAP = {
    ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E',
    w: 'N', s: 'S', a: 'W', d: 'E', q: 'NW', e: 'NE', z: 'SW', c: 'SE',
    8: 'N', 2: 'S', 4: 'W', 6: 'E', 7: 'NW', 9: 'NE', 1: 'SW', 3: 'SE',
  };
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let game = null;
  const ui = { busy: false, targeting: false, preview: null, boardKey: null, rolled: false, journalSeen: 0, toastSeq: 0 };
  // Journal entries of these kinds also pop up briefly over the map: status
  // changes (webs, torches), item pickups and combat. Everything else
  // (blocked moves, spells, floor notes) stays in the journal only.
  const TOAST_KINDS = new Set(['status', 'good', 'fight', 'bad']);
  const DIE_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="5" width="22" height="22" rx="5" style="fill:#fff;stroke:currentColor" stroke-width="2.4"/><circle cx="11" cy="11" r="2.3" style="fill:#2b2a33"/><circle cx="16" cy="16" r="2.3" style="fill:#2b2a33"/><circle cx="21" cy="21" r="2.3" style="fill:#2b2a33"/></svg>';

  /* Saves live in localStorage, mirrored to IndexedDB: if the browser
   * clears one, the other restores it at startup. The game also asks the
   * browser to keep its storage persistent (not evicted to free space). */
  const MIRRORED = new Set([SAVE_KEY, SLOTS_KEY]);
  const mirror = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('dicedelve', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }));
    return {
      set(k, v) {
        open().then((db) => {
          const st = db.transaction('kv', 'readwrite').objectStore('kv');
          if (v === null) st.delete(k); else st.put(v, k);
        }).catch(() => { /* no IndexedDB: localStorage only */ });
      },
      get(k) {
        return open().then((db) => new Promise((res) => {
          const r = db.transaction('kv').objectStore('kv').get(k);
          r.onsuccess = () => res(typeof r.result === 'string' ? r.result : null);
          r.onerror = () => res(null);
        })).catch(() => null);
      },
    };
  })();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) {
      if (MIRRORED.has(k)) mirror.set(k, v);
      try { localStorage.setItem(k, v); return true; } catch (e) { return MIRRORED.has(k); }
    },
    del(k) {
      if (MIRRORED.has(k)) mirror.set(k, null);
      try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ }
    },
  };
  // Restore saves from the IndexedDB copy if localStorage lost them.
  async function restoreMirror() {
    for (const k of MIRRORED) {
      if (store.get(k) !== null) { mirror.set(k, store.get(k)); continue; }
      const v = await mirror.get(k);
      if (v !== null) { try { localStorage.setItem(k, v); } catch (e) { ui.mirrorOnly = true; } }
    }
  }
  const storageInfo = { persisted: null };
  function askPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then((v) => { storageInfo.persisted = v; }).catch(() => {});
      }
    } catch (e) { /* not supported */ }
  }
  // Auto-save writes the checkpoint, which only changes when a floor starts or is finished.
  let lastSaved = null;
  const save = () => {
    if (!game || game.s.phase === 'dead' || !game.s.checkpoint) return;
    const text = JSON.stringify(game.s.checkpoint);
    if (text !== lastSaved && store.set(SAVE_KEY, text)) lastSaved = text;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? Math.min(ms, 40) : ms));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function best() { return parseInt(store.get(BEST_KEY) || '0', 10) || 0; }
  function recordBest() {
    if (game && !game.s.tutorial && game.s.floor > best()) store.set(BEST_KEY, String(game.s.floor));
  }
  // "Floor 7" or "Tutorial 2/3" (tutorial floors don't count as floors).
  const floorName = (s) => (s.tutorial ? `Tutorial ${s.floor}/3` : `Floor ${s.floor}`);
  const boardKeyOf = (s) => `${s.seed}:${s.tutorial ? 't' : ''}${s.floor}`;

  // ------------------------------------------------------------------ render
  function render() {
    if (!game) return;
    renderHud();
    renderBoard();
    renderPanel();
    playEvents();
    syncMusic();
    checkHints();
  }

  // ------------------------------------------------------------------- sound
  // Engine events (coin, hit, web, ...) become sound effects; the music
  // follows the floor's mood.
  function playEvents() {
    for (const e of game.drainEvents()) {
      AU.sfx(e);
      if (e === 'kill' && game.lastKill) queueScene({ type: 'kill', at: game.lastKill });
      else if (e === 'mimic' && game.lastMimic) queueScene({ type: 'mimic', at: game.lastMimic });
      else if (e === 'levelUp') queueScene({ type: 'levelUp', level: game.s.player.level + game.levelsOwed(), cls: game.s.player.cls });
      else if (e === 'classChosen') queueScene({ type: 'class', cls: game.s.player.cls });
    }
  }
  function syncMusic() {
    const s = game.s;
    let mood = 'floor';
    if (!ui.hintsReady || s.phase === 'dead') mood = 'none';
    else if (s.shop) mood = 'shop';
    else if (s.level && s.level.dark) mood = 'dark';
    else if (s.tutorial) mood = 'tutorial';
    AU.setMusic(mood, s.seed, s.floor);
  }

  function showSound() {
    const st = AU.settings;
    const row = (bus, label) => `
      <div class="sound-row">
        <label class="check"><input type="checkbox" id="${bus}On" ${st[bus + 'On'] ? 'checked' : ''}> ${label}</label>
        <input type="range" id="${bus}Vol" min="0" max="100" value="${Math.round((st[bus] || 0) * 100)}" aria-label="${label} volume">
      </div>`;
    openModal(`
      <h2>Sound &amp; effects</h2>
      ${AU.available ? '' : '<p class="notice bad">This browser doesn\'t support Web Audio, so the game is silent.</p>'}
      ${row('sfx', 'Sound effects')}
      ${row('music', 'Music')}
      <label class="check"><input type="checkbox" id="muteAll" ${st.muted ? 'checked' : ''}> Mute everything <span class="muted">(M key)</span></label>
      <label class="check"><input type="checkbox" id="fxOn" ${fx.on ? 'checked' : ''}> Cut-scenes (kills, mimics, level-ups)${reducedMotion ? ' <span class="muted">· off while your device asks for reduced motion</span>' : ''}</label>
      <p class="muted">All sounds are generated in your browser. The music changes with the floor: calmer in the tutorial, tense on dark floors, cheerful in shops.</p>
      <div class="row">
        <button class="btn" type="button" id="soundTest">Test</button>
        <button class="btn primary" type="button" data-close>Done</button>
      </div>`);
    ['sfx', 'music'].forEach((bus) => {
      $(`#${bus}On`).addEventListener('change', (e) => AU.setOn(bus, e.target.checked));
      $(`#${bus}Vol`).addEventListener('input', (e) => AU.setVolume(bus, e.target.value / 100));
    });
    $('#muteAll').addEventListener('change', (e) => { if (AU.settings.muted !== e.target.checked) AU.toggleMute(); renderSoundBtn(); });
    $('#soundTest').addEventListener('click', () => { AU.unlock(); AU.sfx('coin'); });
    $('#fxOn').addEventListener('change', (e) => { fx.on = e.target.checked; store.set(FX_KEY, fx.on ? '1' : '0'); });
  }
  function renderSoundBtn() {
    const b = $('#soundBtn');
    if (b) b.classList.toggle('muted-btn', !!AU.settings.muted);
  }

  // ------------------------------------------------------------------- hints
  /* One-time tips shown as pop-ups the first time something comes up.
   * Seen hints and the on/off switch live in localStorage. */
  const HINTS = {
    start: { icon: 'i-start', title: 'Welcome to the dungeon', text: 'Tap <b>Roll</b> in the middle of the direction pad. Then <b>tap one of the two dice</b>: its number is how many squares you move, and the other die is discarded. Reach the <b>staircase</b> to finish the floor.' },
    even: { icon: 'i-sp-reroll', title: 'Even die: move straight', text: 'An even die moves you up, down, left or right. Tap the map in the direction you want to go (or use the pad). You keep sliding until your moves run out.' },
    odd: { icon: 'i-sp-reroll', title: 'Odd die: move diagonally', text: 'An odd die moves you diagonally. Tap the map toward the corner you want. You keep sliding until your moves run out.' },
    blocked: { icon: 'i-stairs', title: 'Blocked!', text: "You hit something with moves left. Pick a new direction to keep going. You can't turn straight back the way you came, unless that's the only way." },
    doorway: { icon: 'i-door-open', title: 'Doorways', text: 'Rooms are joined by gaps in the wall. Slide through a doorway to reach the next room.' },
    web: { icon: 'i-web', title: 'Spider webs', text: 'Running into a web stops you on the spot, and your <b>next</b> move is halved. Steer around them when you can.' },
    enemy: { icon: 'i-enemy', title: 'Enemies', text: "When you run into an enemy it hits you, and you hit back with your strength. Kill it and you keep moving; if it survives, your move ends. The red number is its health." },
    lock: { icon: 'i-lock', title: 'Locked doors', text: 'A locked door needs the key of the same color. You can always reach the key without opening any door. Walk into the door with the key to open it.' },
    items: { icon: 'i-chest', title: 'Treasure', text: 'Coins buy things in shops (floor 5 is the first). Chests hold extra coins. Hearts and med packs heal you.' },
    portal: { icon: 'i-portal', title: 'Portals', text: 'Step into a portal and you come out of its matching twin, still moving in the same direction.' },
    dark: { icon: 'i-moon', title: 'A dark floor', text: "You can only see the squares next to you. Every dark floor has a torch you can reach without keys. Pick it up to see 4 squares around you. There's also a dark chest with a free spell." },
    shoot: { icon: 'i-sling', title: 'Ranged attacks', text: 'After rolling and picking a die you can <b>shoot instead of moving</b>: tap the ranged button, then a direction. The shot flies as far as your chosen die in a straight or diagonal line (same as your move) and hits the first enemy for 1 damage. Rogues use sling stones (collect more from bodies); a Wizard\'s magic missile never runs out.' },
    hero: { icon: 'i-cls-base', title: 'Your hero', text: `You start plain: ${R.START_HP} health, no ranged weapon and no spells. After <b>${R.FIRST_LEVEL_KILLS} kills</b> you choose a class: Fighter, Wizard or Rogue. Stones and spells you find before then are kept for later.` },
    level: { icon: 'i-levelup', title: 'Levels', text: 'More kills bring more levels: each one needs 1.5× as many kills as the last. Every level adds health and lets you pick one of two boons for your class. The bar next to your class shows your progress.' },
    freeaim: { icon: 'i-missile', title: 'Range', text: 'With a range boost, enemies within that many steps (counting straight squares) glow when you aim. Tap one to shoot it directly, in any direction, whatever the dice say. Farther enemies still need a shot along the die\'s direction.' },
    stop: { icon: 'i-cls-rogue', title: 'Fleet foot', text: 'With a move boost you slide your die plus the boost. Once you have moved at least the die\'s number, you can tap <b>Stop here</b> on any square, or keep going.' },
    stalker: { icon: 'i-stalker', title: 'Stalkers', text: 'These hooded enemies hunt you. After each of your turns, a stalker that can see you moves one square closer, and attacks if it is next to you. On dark floors they spot you only up close, unless your torch is lit, which they can see from anywhere.' },
    mimic: { icon: 'i-mimic-open', title: 'Mimic!', text: "Deep in the dungeon, some chests and locked doors are monsters in disguise. When one wakes it bites first: d20 + DEX of 12 or more takes a normal bite, anything less doubles it. It has double an enemy's health and never moves. Kill it for twice a chest's coins plus a random spell. Look closely: a mimic shows tiny teeth at its seam." },
    lockpick: { icon: 'i-lockpick', title: 'Lock picks', text: "With a lock pick, walking into a locked door you don't have the key for lets you try the lock: d20 + DEX must reach the door's number (gold 12, crimson 14, azure 16, emerald 18). Buy DEX in the shop to get better at it." },
    spells: { icon: 'i-sp-fireball', title: 'You have a spell', text: 'Spells sit in the bar under the direction pad. Tap one to use it. Hover or long-press to read what it does, or open <b>Rules</b>.' },
  };
  const hintState = (() => {
    try { const v = JSON.parse(store.get(HINTS_KEY) || '{}'); return { off: !!v.off, seen: v.seen && typeof v.seen === 'object' ? v.seen : {} }; }
    catch (e) { return { off: false, seen: {} }; }
  })();
  const saveHints = () => store.set(HINTS_KEY, JSON.stringify(hintState));
  ui.hintQueue = [];
  function queueHint(id) {
    if (hintState.off || hintState.seen[id] || ui.hintQueue.includes(id)) return;
    ui.hintQueue.push(id);
  }
  function checkHints() {
    if (!ui.hintsReady || hintState.off) return;
    const s = game.s, L = s.level;
    const key = boardKeyOf(s);
    if (L && ui.hintFloor !== key) {
      ui.hintFloor = key;
      const has = (t) => L.objects.some((o) => o.type === t);
      queueHint('start');
      if (!s.player.cls && !s.tutorial) queueHint('hero');
      if (L.rooms.length > 1) queueHint('doorway');
      if (has('web')) queueHint('web');
      if (has('enemy')) queueHint('enemy');
      if (has('lock')) queueHint('lock');
      if (has('chest') || has('heart') || has('medpack')) queueHint('items');
      if (has('portal')) queueHint('portal');
      if (L.dark) queueHint('dark');
      if (L.objects.some((o) => o.stalker && !o.done)) queueHint('stalker');
    }
    if (L && L.objects.some((o) => o.type === 'enemy' && o.mimic && !o.done)) queueHint('mimic');
    if (s.phase === 'choose' && s.dice && s.die !== null) queueHint(s.parity === 'ortho' ? 'even' : 'odd');
    if (s.phase === 'redirect') queueHint('blocked');
    if (s.player.cls === 'wizard') queueHint('spells');
    if (s.player.level >= 2) queueHint('level');
    if (s.phase === 'choose' && game.canShoot()) queueHint('shoot');
    if (s.phase === 'choose' && game.freeTargets().length) queueHint('freeaim');
    if (s.phase === 'stopPrompt') queueHint('stop');
    if (s.player.lockpicks > 0) queueHint('lockpick');
    showNextHint();
  }
  function showNextHint() {
    if (!ui.hintsReady || hintState.off || !ui.hintQueue.length || ui.busy || !$('#modal').hidden) return;
    if (!['roll', 'choose', 'redirect', 'stopPrompt'].includes(game.s.phase) || game.levelsOwed() > 0 || ui.scene) return;
    const id = ui.hintQueue.shift();
    const h = HINTS[id];
    hintState.seen[id] = true;
    saveHints();
    openModal(`
      <div class="hint">
        ${RD.icon(h.icon, 'hint-icon', h.icon === 'i-lock' ? RD.COLORS.gold : h.icon === 'i-portal' ? RD.COLORS.violet : '')}
        <div><h2>${h.title}</h2><p>${h.text}</p></div>
      </div>
      <label class="check"><input type="checkbox" id="hintsOff"> Don't show hints</label>
      <div class="row"><button class="btn primary" type="button" id="hintOk">Got it</button></div>`);
    $('#hintOk').addEventListener('click', () => {
      if ($('#hintsOff').checked) { hintState.off = true; ui.hintQueue = []; saveHints(); }
      closeModal();
    });
  }

  function renderHud() {
    const s = game.s, p = s.player;
    const keys = p.keys.map((k) => RD.icon('i-key', '', RD.COLORS[k])).join('');
    const C = p.cls ? R.CLASSES[p.cls] : null;
    const lo = R.levelThreshold(p.level), hi = R.levelThreshold(p.level + 1);
    const prog = Math.max(0, Math.min(1, (s.stats.kills - lo) / (hi - lo)));
    $('#stats').innerHTML = `
      <span class="stat" title="${s.tutorial ? 'Tutorial floor (does not count)' : 'Floor'}">${RD.icon('i-stairs')}<b>${floorName(s)}</b></span>
      <span class="stat cls-stat" title="${C ? C.name : 'Base hero'}, level ${p.level}: ${s.stats.kills} kills, next level at ${hi}">${RD.icon('i-cls-' + (p.cls || 'base'))}<b>${C ? 'Lv ' + p.level : 'Hero'}</b>
        <span class="xpbar"><span style="width:${(100 * prog).toFixed(0)}%"></span></span></span>
      <span class="stat" title="Health">${RD.icon('i-heart')}<b>${p.hp}/${p.maxHp}</b>
        <span class="hpbar"><span style="width:${(100 * p.hp) / p.maxHp}%"></span></span></span>
      <span class="stat" title="Strength">${RD.icon('i-sp-str')}<b>${p.str}</b></span>
      <span class="stat" title="Dexterity">${RD.icon('i-sp-dex', '', '#7b4fc0')}<b>${p.dex}</b></span>
      ${p.range ? `<span class="stat" title="Range: shoot enemies within ${p.range} steps">${RD.icon('i-missile')}<b>${p.range}</b></span>` : ''}
      ${p.moveBoost ? `<span class="stat" title="Move boost: up to ${p.moveBoost} extra squares">${RD.icon('i-cls-rogue')}<b>+${p.moveBoost}</b></span>` : ''}
      ${p.lockpicks ? `<span class="stat" title="Lock picks">${RD.icon('i-lockpick')}<b>${p.lockpicks}</b></span>` : ''}
      <span class="stat" title="Coins">${RD.icon('i-coin')}<b>${p.coins}</b></span>
      ${keys ? `<span class="stat" title="Keys">${keys}</span>` : ''}
      ${s.level && s.level.dark ? `<span class="stat dark-stat" title="${s.level.torchLit ? 'Dark floor, torch lit' : 'Dark floor'}">${RD.icon(s.level.torchLit ? 'i-torch' : 'i-moon')}<b>${s.level.torchLit ? 'Lit' : 'Dark'}</b></span>` : ''}
      <span class="stat muted stat-turn" title="Turns taken">Turn ${s.turn + 1}</span>`;
  }

  function renderBoard() {
    const s = game.s, svg = $('#board');
    const key = s.level ? boardKeyOf(s) : `shop:${s.floor}`;
    if (ui.boardKey !== key) {
      ui.boardKey = key;
      if (s.level) {
        svg.setAttribute('viewBox', `0 0 ${s.level.w * RD.C} ${s.level.h * RD.C}`);
        svg.innerHTML = `<g class="static">${RD.staticLayer(s.level)}</g><g class="dyn"></g><g class="preview-layer"></g><g class="fx-layer"></g>`;
      } else {
        svg.setAttribute('viewBox', `0 0 ${17 * RD.C} ${13 * RD.C}`);
        svg.innerHTML = `<g class="static">${RD.shopScene()}</g><g class="dyn"></g><g class="preview-layer"></g>`;
      }
    }
    if (s.level) svg.querySelector('.dyn').innerHTML = RD.dynamicLayer(game, ui);
    renderPreview();
  }

  function renderPreview() {
    const layer = $('#board .preview-layer');
    if (layer) layer.innerHTML = game.s.level ? RD.previewLayer(game, ui.aiming ? null : ui.preview, ui.shotFlash || (ui.aiming ? ui.preview : null)) : '';
  }

  function renderPanel() {
    const s = game.s;
    // One-die variant: in the choose phase the dice are buttons. The chosen
    // die is highlighted and the other is marked as discarded once you move.
    const dice = s.dice || [0, 0];
    const picking = !ui.busy && s.phase === 'choose' && !!s.dice;
    $('#dice').innerHTML = dice.map((v, i) => {
      const cls = !s.dice || s.die === null ? '' : s.die === i ? ' chosen' : ' discarded';
      return `<button type="button" class="die-pick${cls}" data-die="${i}" ${picking ? '' : 'disabled'}
        aria-label="Use die ${i + 1}${v ? ' (' + v + ')' : ''}" aria-pressed="${s.die === i}">${RD.dieSvg(v, ui.rolled ? 'rolling' : '')}</button>`;
    }).join('');
    ui.rolled = false;

    const info = $('#diceInfo');
    if (s.dice && s.level && s.die === null) {
      info.innerHTML = `<span class="big">Pick</span>a die${s.halved ? '<br><span class="tag halved">webbed ½</span>' : ''}`;
    } else if (s.dice && s.level) {
      const moving = ['moving', 'redirect', 'stopPrompt'].includes(s.phase) && !!s.move;
      const left = moving ? s.move.stepsLeft : s.steps;
      info.innerHTML = `<span class="big">${left}</span>${moving ? 'moves left' : 'moves'}<br>
        <span class="tag">${s.parity === 'ortho' ? '✚ orthogonal' : '✖ diagonal'}</span>
        ${s.halved ? '<span class="tag halved">webbed ½</span>' : ''}`;
    } else {
      info.innerHTML = s.player.webbed ? '<span class="tag halved">Next move halved</span>' : '<span class="muted">Roll to move</span>';
    }

    $('#status').innerHTML = statusText();
    const canAim = () => game.canShoot() || game.freeTargets().length > 0;
    if (ui.aiming && !canAim()) ui.aiming = false;
    const legal = ui.busy ? [] : game.availableDirs();
    const dirs = ui.targeting ? [] : ui.aiming ? game.shotDirs() : legal;
    // Ranged button: the Rogue's sling or the Wizard's magic missile.
    const sling = $('#slingBtn'), p = s.player;
    const ranged = p.cls === 'rogue' || p.cls === 'wizard';
    sling.hidden = !ranged;
    sling.disabled = ui.busy || !(ui.aiming || canAim());
    sling.classList.toggle('armed', !!ui.aiming);
    sling.querySelector('use').setAttribute('href', p.cls === 'wizard' ? '#i-missile' : '#i-sling');
    sling.title = p.cls === 'wizard' ? 'Magic missile: shoot instead of moving (unlimited)' : 'Sling: shoot instead of moving';
    sling.querySelector('.count').textContent = p.cls === 'wizard' ? '∞' : p.ammo;
    // Move boost: stop anywhere once the die's value has been moved.
    const canStop = !ui.busy && game.canStop() && s.phase !== 'moving';
    $('#stopRow').hidden = !canStop;
    if (canStop) $('#keepBtn').hidden = s.phase !== 'stopPrompt';
    document.querySelectorAll('#pad [data-dir]').forEach((b) => { b.disabled = !dirs.includes(b.dataset.dir); });

    // The pad's center is the Roll button, becomes Pass when no move is
    // legal, and otherwise shows the moves left.
    const center = $('#padCenter');
    const canRoll = !ui.busy && !ui.targeting && s.phase === 'roll';
    const canPass = !ui.busy && !ui.targeting && !ui.aiming && s.phase === 'choose' && s.die !== null && legal.length === 0;
    const mode = canRoll ? 'roll' : canPass ? 'pass' : canStop ? 'stop' : 'count';
    const modeKey = mode + (game.levelsOwed() > 0 ? '+lvl' : '');
    if (center.dataset.mode !== modeKey || mode === 'count') {
      center.dataset.mode = modeKey;
      center.className = 'pad-center ' + mode;
      center.disabled = mode === 'count';
      if (mode === 'roll' && game.levelsOwed() > 0) { center.innerHTML = `${RD.icon('i-levelup')}<span>Level</span>`; center.setAttribute('aria-label', 'Choose your level-up'); }
      else if (mode === 'roll') { center.innerHTML = `${DIE_ICON}<span>Roll</span>`; center.setAttribute('aria-label', 'Roll dice'); }
      else if (mode === 'pass') { center.innerHTML = '<span>Pass</span>'; center.setAttribute('aria-label', 'Pass turn'); }
      else if (mode === 'stop') { center.innerHTML = '<span>Stop</span>'; center.setAttribute('aria-label', 'Stop here'); }
      else {
        const moving = s.dice && s.level && s.die !== null && ['choose', 'redirect', 'moving', 'stopPrompt'].includes(s.phase);
        center.innerHTML = moving ? `${game.stepsLeft()}<small>moves</small>` : '·';
        center.setAttribute('aria-label', moving ? `${game.stepsLeft()} moves left` : 'Waiting');
      }
    }

    // Only Wizards cast; slots and charges both count.
    document.querySelectorAll('#spells [data-spell]').forEach((b) => {
      const name = b.dataset.spell;
      const n = game.spellCount(name);
      b.hidden = s.player.cls !== 'wizard';
      const armed = (name === 'noclip' || name === 'invis') && s.armed[name];
      const active = armed || (name === 'fireball' && ui.targeting);
      b.disabled = ui.busy || !(active || game.canCast(name));
      b.classList.toggle('armed', active);
      b.classList.toggle('empty', !n);
      b.querySelector('.count').textContent = n;
    });

    const tb = $('#torchBtn');
    tb.disabled = ui.busy || !game.canLightTorch();
    tb.classList.toggle('armed', !!(s.level && s.level.torchLit));
    tb.classList.toggle('empty', !s.player.torches);
    tb.querySelector('.count').textContent = s.player.torches;

    renderJournal();
  }

  // Journal button badge plus a short-lived toast for the newest important entry.
  let toastTimer = null;
  function renderJournal() {
    const log = game.s.log;
    const unread = log.filter((l) => (l.seq || 0) > ui.journalSeen).length;
    const badge = $('#journalCount');
    badge.hidden = !unread;
    badge.textContent = unread > 9 ? '9+' : unread;
    $('#journalBtn').setAttribute('aria-label', unread ? `Journal, ${unread} new` : 'Journal');

    const fresh = log.filter((l) => (l.seq || 0) > ui.toastSeq && TOAST_KINDS.has(l.kind));
    ui.toastSeq = Math.max(ui.toastSeq, game.s.logSeq || 0);
    if (!fresh.length) return;
    const last = fresh[fresh.length - 1];
    const toast = $('#toast');
    toast.className = 'toast log-' + last.kind;
    toast.textContent = last.text;
    toast.hidden = false;
    // Restart the entrance animation for back-to-back messages.
    toast.style.animation = 'none'; void toast.offsetWidth; toast.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function showJournal() {
    ui.journalSeen = game.s.logSeq || 0;
    renderJournal();
    const items = game.s.log.slice().reverse().map((l) => `<li class="log-${l.kind}">${esc(l.text)}</li>`).join('');
    openModal(`
      <h2>Journal</h2>
      <ol class="log">${items || '<li class="muted">Nothing yet.</li>'}</ol>
      <div class="row"><button class="btn primary" type="button" data-close>Close</button></div>`);
  }

  function statusText() {
    const s = game.s;
    if (ui.targeting) return 'Fireball: tap an obstacle (web, enemy or locked door) to destroy it. Tap the spell again to cancel.';
    if (ui.aiming) {
      const what = s.player.cls === 'wizard' ? 'Magic missile' : 'Sling';
      const free = game.freeTargets().length ? ` Or tap a glowing enemy (within ${s.player.range} steps) to shoot it directly.` : '';
      const dirs = game.shotDirs().length ? `tap a ${s.parity === 'ortho' ? 'straight' : 'diagonal'} direction to shoot (range ${s.steps}).` : (s.die === null ? 'pick a die to shoot along its direction.' : 'no clear line this roll.');
      return `${what}: ${dirs}${free} It hits the first enemy in line and ends your turn. Tap the button again to cancel.`;
    }
    if (game.levelsOwed() > 0 && s.phase === 'roll') return game.s.player.cls ? 'Level up! Choose a boon.' : 'Choose your class!';
    switch (s.phase) {
      case 'roll': return s.player.webbed ? 'Still tangled in web: this roll is halved. Tap Roll.' : 'Tap Roll (center of the pad) or press Space.';
      case 'choose': {
        if (s.die === null) return 'Tap a die to use it. Its number is how far you move or shoot: odd goes diagonally, even goes straight. The other die is discarded.';
        const n = game.availableDirs().length;
        if (!n) return 'No legal move with this roll. Tap Pass (or use a spell).';
        return `Tap the map in a ${s.parity === 'ortho' ? 'straight (orthogonal)' : 'diagonal'} direction. You keep going until your ${s.steps} moves run out or you're blocked.`;
      }
      case 'moving': return 'Moving…';
      case 'stopPrompt': return `You've moved your die's worth. Stop here, or keep going (${s.move.stepsLeft} more).`;
      case 'redirect': return `Blocked with ${s.move.stepsLeft} move${s.move.stepsLeft > 1 ? 's' : ''} left. Choose a new direction (not straight back the way you came, unless that's the only way).`;
      case 'levelDone': return 'Floor cleared!';
      case 'shop': return 'Welcome to the shop.';
      case 'dead': return 'You have fallen.';
    }
    return '';
  }

  // ------------------------------------------------------------------- input
  async function choose(dir) {
    if (ui.aiming) { shoot(dir); return; }
    if (ui.busy || ui.targeting || !game.choose(dir)) return;
    runMove();
  }

  // Shoot instead of moving (along a direction, or straight at an enemy
  // within range), flash the shot's path, then end the turn.
  async function shoot(dir, targetIndex) {
    if (ui.busy) return;
    const r = targetIndex === undefined ? game.shoot(dir) : game.shootAt(targetIndex);
    if (!r) return;
    ui.aiming = false; ui.preview = null;
    ui.busy = true;
    ui.shotFlash = r.cells.length ? r.cells : null;
    render();
    await sleep(450);
    ui.shotFlash = null;
    ui.busy = false;
    render();
    save();
    afterPhase();
  }

  function toggleAim() {
    if (ui.busy) return;
    ui.aiming = !ui.aiming && (game.canShoot() || game.freeTargets().length > 0);
    if (ui.aiming) ui.targeting = false;
    ui.preview = null;
    render();
  }

  // Animate the current move step by step until it stops.
  async function runMove() {
    ui.preview = null;
    ui.busy = true;
    render();
    while (game.s.phase === 'moving') {
      const ev = game.step();
      render();
      if (ev.type === 'pick') break;
      await sleep(ev.type === 'teleport' ? 380 : ev.type === 'fight' || ev.type === 'web' ? 300 : 120);
    }
    ui.busy = false;
    render();
    if (game.s.phase === 'pickPrompt') { showPickDialog(); return; }
    if (game.s.phase === 'stopPrompt') return; // waiting for Stop here / Keep going
    save();
    afterPhase();
  }

  function stopHere() {
    if (ui.busy || !game.stopMove()) return;
    render(); save(); afterPhase();
  }
  function keepGoing() {
    if (ui.busy || !game.continueMove()) return;
    runMove();
  }

  // Walking into a locked door with a lock pick: ask before using it.
  function showPickDialog() {
    const door = game.pickDoor();
    if (!door) return;
    const p = game.s.player, target = R.LOCK_TARGET[door.color];
    const chance = Math.round(R.pickChance(p.dex, door.color) * 100);
    openModal(`
      <div class="hint">
        ${RD.icon('i-lock', 'hint-icon', RD.COLORS[door.color])}
        <div><h2>Pick the ${door.color} lock?</h2>
        <p>Roll d20 + your DEX (${p.dex}). You need <b>${target}</b> or more, so a roll of ${Math.max(1, target - p.dex)}+ (<b>${chance}%</b>).</p>
        <p class="muted">Success opens the door and you keep moving. Failure breaks the pick and your move stops here. Either way the pick is used up (you have ${p.lockpicks}).</p></div>
      </div>
      <div class="row">
        <button class="btn primary" type="button" id="pickYes">Pick the lock</button>
        <button class="btn" type="button" id="pickNo">Leave it</button>
      </div>`, false);
    const done = (fn) => {
      fn();
      closeModal();
      if (game.s.phase === 'moving') runMove();
      else { render(); save(); afterPhase(); }
    };
    $('#pickYes').addEventListener('click', () => done(() => game.pickLock()));
    $('#pickNo').addEventListener('click', () => done(() => game.declinePick()));
  }

  function roll() {
    if (ui.busy) return;
    if (game.levelsOwed() > 0) { afterPhase(); return; } // choose first
    if (!game.roll()) return;
    ui.rolled = true;
    render();
    save();
  }

  function afterPhase() {
    // Class and level-up choices come first (after their cut-scene).
    if (game.levelsOwed() > 0 && game.s.phase !== 'dead') { whenScenesDone(showLevelChoice); return; }
    const ph = game.s.phase;
    if (ph === 'levelDone') { recordBest(); setTimeout(showLevelDone, reducedMotion ? 0 : 350); }
    else if (ph === 'dead') { recordBest(); store.del(SAVE_KEY); lastSaved = null; setTimeout(showDead, reducedMotion ? 0 : 500); }
    else if (ph === 'shop') showShop();
  }

  // ------------------------------------------------------- class & level-up
  const CLASS_INFO = {
    fighter: { icon: 'i-cls-fighter', blurb: 'A wall of muscle. No ranged weapon and no spells, but tough and hard-hitting.',
      perks: [`+${R.CLASSES.fighter.hp} max health`, `+${R.CLASSES.fighter.levelHp} health per level`, 'Boons: +2 health or +1 strength', 'Sells stones and spells for coins'] },
    wizard: { icon: 'i-cls-wizard', blurb: 'Fragile, but casts spells from slots that recharge every floor, and an endless magic missile.',
      perks: ['1 spell slot (you pick the spell)', 'Unlimited magic missile', 'Boons: +1 spell slot or +1 range', 'Sells sling stones for coins'] },
    rogue: { icon: 'i-cls-rogue', blurb: 'Quick and nimble with a sling. Good at locks and dodging mimics.',
      perks: [`+${R.CLASSES.rogue.hp} max health, +${R.CLASSES.rogue.dex} DEX`, `Sling with ${R.CLASSES.rogue.ammo} stones`, 'Boons: +1 move or +1 range', 'Sells spells for coins'] },
  };
  const BOON_ICON = { hp: 'i-sp-maxhp', str: 'i-sp-str', slot: 'i-cls-wizard', range: 'i-missile', move: 'i-cls-rogue' };

  function showLevelChoice() {
    if (!game || game.levelsOwed() < 1 || game.s.phase === 'dead') return;
    const p = game.s.player;
    const done = () => { closeModal(); render(); save(); afterPhase(); };
    if (!p.cls) {
      openModal(`
        <h2>Choose your class</h2>
        <p>${game.s.stats.kills} kills: you've proven yourself. Pick a path for the rest of the run.</p>
        <div class="class-cards">
          ${DC.CLASS_IDS.map((id) => `<button type="button" class="class-card" data-cls="${id}">
            ${RD.icon(CLASS_INFO[id].icon, 'class-icon')}
            <span class="name">${R.CLASSES[id].name}</span>
            <span class="desc">${CLASS_INFO[id].blurb}</span>
            <ul>${CLASS_INFO[id].perks.map((t) => `<li>${t}</li>`).join('')}</ul></button>`).join('')}
        </div>`, false);
      $('#modalBody').querySelectorAll('[data-cls]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.cls;
        if (id === 'wizard') pickSpell('Choose the spell for your slot', (sp) => { game.chooseClass('wizard', sp); done(); }, showLevelChoice);
        else { game.chooseClass(id); done(); }
      }));
      return;
    }
    const C = R.CLASSES[p.cls], lvl = p.level + 1;
    openModal(`
      <h2>Level ${lvl}!</h2>
      <p>${RD.icon(CLASS_INFO[p.cls].icon, 'inline')} ${C.name} · max health +${C.levelHp}. Choose a boon:</p>
      <div class="class-cards two">
        ${game.boonChoices().map((id) => `<button type="button" class="class-card" data-boon="${id}">
          ${RD.icon(BOON_ICON[id], 'class-icon')}
          <span class="name">${BOONS[id].name}</span>
          <span class="desc">${BOONS[id].desc}</span>
          <span class="muted">${id === 'range' ? `Now ${p.range}` : id === 'move' ? `Now +${p.moveBoost}` : id === 'str' ? `STR ${p.str}` : id === 'hp' ? `Max ${p.maxHp}` : `${p.slots.length} slot${p.slots.length === 1 ? '' : 's'}`}</span></button>`).join('')}
      </div>`, false);
    $('#modalBody').querySelectorAll('[data-boon]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.boon;
      if (id === 'slot') pickSpell('Choose the spell for your new slot', (sp) => { game.chooseBoon('slot', sp); done(); }, showLevelChoice);
      else { game.chooseBoon(id); done(); }
    }));
  }

  function pickSpell(title, then, back) {
    openModal(`
      <h2>${title}</h2>
      <p class="muted">A slot casts its spell once per floor and recharges when you reach the next one.</p>
      <div class="legend spell-pick">
        ${SPELL_ORDER.map((n) => `<button type="button" class="spell-choice" data-pick="${n}">${RD.icon('i-sp-' + n)}<span><b>${SPELLS[n].name}</b>: ${SPELLS[n].desc}</span></button>`).join('')}
      </div>
      <div class="row"><button class="btn" type="button" id="pickBack">Back</button></div>`, false);
    $('#modalBody').querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => then(b.dataset.pick)));
    $('#pickBack').addEventListener('click', back);
  }

  // -------------------------------------------------------------- cut-scenes
  /* Short animations for kills (on the map square), and for mimic ambushes,
   * level-ups and class choices (over the map). They never hold up the game:
   * the state has already changed. Tap to skip; turn off in Sound & effects. */
  const fx = { on: store.get(FX_KEY) !== '0' };
  ui.scenes = []; ui.scene = null; ui.sceneWaiters = [];
  const fxEnabled = () => fx.on && !reducedMotion;
  function queueScene(sc) {
    if (!fxEnabled()) return;
    if (sc.type === 'kill') { killFx(sc.at); return; }
    ui.scenes.push(sc);
    if (!ui.scene) nextScene();
  }
  function killFx(at) {
    const layer = $('#board .fx-layer');
    if (!layer) return;
    const C = RD.C, cx = (at.x + 0.5) * C, cy = (at.y + 0.5) * C;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'kill-fx' + (at.kind === 'mimic' ? ' big' : ''));
    g.setAttribute('transform', `translate(${cx} ${cy})`);
    const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path class="ray" d="M0 -8V-18" transform="rotate(${a})"/>`).join('');
    g.innerHTML = `<g class="burst">${rays}</g><path class="slash" d="M-14 -14L14 14"/><path class="slash two" d="M14 -14L-14 14"/><circle class="puff" r="10"/>`;
    layer.appendChild(g);
    setTimeout(() => g.remove(), 800);
  }
  function nextScene() {
    const el = $('#scene');
    const sc = ui.scenes.shift();
    clearTimeout(ui.sceneTimer);
    if (!sc) {
      ui.scene = null; el.hidden = true; el.innerHTML = '';
      const w = ui.sceneWaiters; ui.sceneWaiters = [];
      w.forEach((fn) => fn());
      return;
    }
    ui.scene = sc;
    el.innerHTML = sceneSvg(sc);
    el.hidden = false;
    ui.sceneTimer = setTimeout(nextScene, sc.type === 'mimic' ? 1500 : 1600);
  }
  function skipScene() { if (ui.scene) nextScene(); }
  function clearScenes() { ui.scenes = []; ui.sceneWaiters = []; if (ui.scene) nextScene(); }
  function whenScenesDone(fn) { if (ui.scene) ui.sceneWaiters.push(fn); else fn(); }
  function sceneSvg(sc) {
    const use = (id, x, y, w, color) => `<use href="#${id}" x="${x}" y="${y}" width="${w}" height="${w}"${color ? ` style="color:${color}"` : ''}/>`;
    const rays = Array.from({ length: 12 }, (_, i) => `<path d="M0 -70V-150" transform="rotate(${i * 30})"/>`).join('');
    let body = '';
    if (sc.type === 'mimic') {
      const door = sc.at.kind === 'door', color = RD.COLORS[sc.at.color];
      body = `<g class="sc-shake">
          <g class="sc-before">${use(door ? 'i-mimic-lock' : 'i-mimic', -60, -60, 120, color)}</g>
          <g class="sc-after">${use(door ? 'i-mimic-door' : 'i-mimic-open', -75, -75, 150, color)}</g>
        </g>
        <text class="sc-title bad" y="112">MIMIC!</text>
        <text class="sc-sub" y="140">${sc.at.dodged ? 'You twist away' : 'It bites deep'}: ${sc.at.dmg} damage</text>`;
    } else if (sc.type === 'levelUp') {
      body = `<g class="sc-rays">${rays}</g>
        <g class="sc-pop">${use(sc.cls ? 'i-levelup' : 'i-cls-base', -55, -70, 110)}</g>
        <text class="sc-title" y="92">${sc.cls ? `LEVEL ${sc.level}` : 'CHOOSE YOUR PATH'}</text>`;
    } else if (sc.type === 'class') {
      body = `<g class="sc-rays">${rays}</g>
        <g class="sc-pop">${use('i-cls-' + sc.cls, -60, -75, 120)}</g>
        <text class="sc-title" y="92">${R.CLASSES[sc.cls].name.toUpperCase()}</text>`;
    }
    return `<svg viewBox="-200 -170 400 340" class="scene-svg sc-${sc.type}" aria-hidden="true">
      <rect class="sc-bg" x="-200" y="-170" width="400" height="340"/>${body}</svg>`;
  }

  function castSpell(name) {
    if (ui.busy) return;
    if (name === 'fireball') {
      ui.targeting = !ui.targeting && game.canCast('fireball');
      if (ui.targeting) ui.aiming = false;
    } else if (name === 'noclip' || name === 'invis') {
      game.toggleArm(name);
    } else if (name === 'reroll' && game.canCast('reroll')) {
      showReroll();
      return;
    } else if (name === 'luck' && game.canCast('luck')) {
      showLuck();
      return;
    }
    ui.preview = null;
    render();
    save();
  }

  /* Direction of a click/tap on the map, relative to the player: the legal
   * direction nearest the tap's angle, if it is within 45 degrees. */
  function dirFromEvent(e, dirs) {
    if (!game || !game.s.level) return null;
    const legal = dirs || (ui.aiming ? game.shotDirs() : game.availableDirs());
    if (!legal.length) return null;
    const svg = $('#board');
    const m = svg.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const p = game.s.player;
    const dx = pt.x - (p.x + 0.5) * RD.C, dy = pt.y - (p.y + 0.5) * RD.C;
    if (Math.hypot(dx, dy) < RD.C * 0.45) return null;
    const ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    let best = null, bestDiff = 999;
    for (const d of legal) {
      const diff = Math.abs((((ang - ANGLE[d]) % 360) + 540) % 360 - 180);
      if (diff < bestDiff) { bestDiff = diff; best = d; }
    }
    return bestDiff <= 45 ? best : null;
  }

  function setupInput() {
    $('#journalBtn').addEventListener('click', () => { if (game) showJournal(); });
    $('#slingBtn').addEventListener('click', toggleAim);
    $('#soundBtn').addEventListener('click', () => showSound());
    // Browsers only allow sound after a gesture: start audio on the first one.
    let asked = false;
    const unlock = () => { AU.unlock(); if (!asked) { asked = true; askPersist(); } };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    renderSoundBtn();
    const menuItems = $('#menuItems'), menuToggle = $('#menuToggle');
    const setMenu = (open) => { menuItems.classList.toggle('open', open); menuToggle.setAttribute('aria-expanded', String(open)); };
    menuToggle.addEventListener('click', (e) => { e.stopPropagation(); setMenu(!menuItems.classList.contains('open')); });
    menuItems.addEventListener('click', () => setMenu(false));
    document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) setMenu(false); });
    $('#helpBtn').addEventListener('click', () => showHelp());
    $('#menuBtn').addEventListener('click', () => showStart(true));
    $('#savesBtn').addEventListener('click', () => { if (!ui.busy) showSaves(); });
    $('#themeBtn').addEventListener('click', toggleTheme);

    const board = $('#board');
    // Listen on the whole map area so taps just outside the drawn map count too.
    const boardWrap = board.parentElement;
    boardWrap.addEventListener('click', (e) => {
      const fs = e.target.closest('[data-shoot]');
      if (fs && ui.aiming) { shoot(null, Number(fs.dataset.shoot)); return; }
      const t = e.target.closest('[data-target]');
      if (t && ui.targeting) {
        if (game.fireball(Number(t.dataset.target))) ui.targeting = false;
        render(); save();
        if (game.levelsOwed() > 0) afterPhase();
        return;
      }
      if (ui.targeting) return;
      const a = e.target.closest('[data-dir]');
      if (a) { choose(a.dataset.dir); return; }
      // Tap anywhere: move in the direction of the tap.
      if (ui.busy || (game.s.phase !== 'choose' && game.s.phase !== 'redirect')) return;
      const dir = dirFromEvent(e);
      if (dir) choose(dir);
      else if ((ui.aiming ? game.shotDirs() : game.availableDirs()).length) {
        board.classList.remove('nudge'); void board.getBoundingClientRect(); board.classList.add('nudge');
        setTimeout(() => board.classList.remove('nudge'), 1100);
      }
    });
    const setPreview = (dir) => {
      let next = null;
      if (dir && !ui.busy && !ui.targeting) {
        // Aiming: the stone's path, cut off where you can't see.
        if (ui.aiming) {
          next = [];
          for (const c of game.shotPath(dir).cells) { if (!game.isVisible(c[0], c[1])) break; next.push(c); }
        } else next = game.previewPath(dir);
      }
      if (JSON.stringify(next) === JSON.stringify(ui.preview)) return;
      ui.preview = next;
      renderPreview();
    };
    const hover = (e) => { const a = e.target.closest('[data-dir]'); setPreview(a && a.dataset.dir); };
    // With a mouse, preview wherever a click on the map would go.
    boardWrap.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') setPreview(dirFromEvent(e)); });
    boardWrap.addEventListener('mouseleave', () => setPreview(null));

    const pad = $('#pad');
    pad.innerHTML = PAD_ORDER.map((d) => d
      ? `<button type="button" data-dir="${d}" aria-label="Move ${d}"><svg viewBox="-16 -16 32 32"><path d="M-9 0H8M1-7L8 0L1 7" transform="rotate(${ANGLE[d]})" style="fill:none;stroke:currentColor;stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round"/></svg></button>`
      : '<button type="button" class="pad-center" id="padCenter" disabled>·</button>').join('');
    pad.addEventListener('click', (e) => {
      if (e.target.closest('#padCenter')) {
        const mode = $('#padCenter').dataset.mode.replace('+lvl', '');
        if (mode === 'roll') roll();
        else if (mode === 'pass' && game.passTurn()) { render(); save(); }
        else if (mode === 'stop') stopHere();
        return;
      }
      const b = e.target.closest('[data-dir]');
      if (b && !b.disabled) choose(b.dataset.dir);
    });
    pad.addEventListener('mouseover', hover);
    pad.addEventListener('mouseleave', hover);

    $('#spells').innerHTML = SPELL_ORDER.map((n) =>
      `<button type="button" class="spell" data-spell="${n}" title="${esc(SPELLS[n].name + ': ' + SPELLS[n].desc)}" aria-label="${esc(SPELLS[n].name)}">
        ${RD.icon('i-sp-' + n)}<span class="count">0</span></button>`).join('') +
      `<button type="button" class="spell torch-btn" id="torchBtn" title="Torch: light it on a dark floor to see up to ${R.TORCH_RADIUS} squares away until the floor ends." aria-label="Light a torch">
        ${RD.icon('i-torch')}<span class="count">0</span></button>`;
    $('#stopBtn').addEventListener('click', stopHere);
    $('#keepBtn').addEventListener('click', keepGoing);
    $('#scene').addEventListener('click', skipScene);
    $('#dice').addEventListener('click', (e) => {
      const b = e.target.closest('[data-die]');
      if (b && !b.disabled && !ui.busy && game.pickDie(+b.dataset.die)) render();
    });

    $('#spells').addEventListener('click', (e) => {
      if (e.target.closest('#torchBtn')) { if (!ui.busy && game.lightTorch()) { render(); save(); } return; }
      const b = e.target.closest('[data-spell]');
      if (b) castSpell(b.dataset.spell);
    });

    document.addEventListener('keydown', (e) => {
      if (!game || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!$('#modal').hidden) {
        if (e.key === 'Escape' && modalDismissable) closeModal();
        return;
      }
      if (ui.scene && (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); skipScene(); return; }
      if (game.s.phase === 'stopPrompt' || (game.s.phase === 'redirect' && game.canStop())) {
        if (e.key === 'x' || e.key === 'X' || e.key === 'Backspace') { e.preventDefault(); stopHere(); return; }
        if (game.s.phase === 'stopPrompt' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); keepGoing(); return; }
      }
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'r') {
        if (game.s.phase === 'roll') { e.preventDefault(); roll(); }
        else if (game.s.phase === 'choose' && !game.availableDirs().length) { e.preventDefault(); game.passTurn(); render(); save(); }
        return;
      }
      if (e.key === 'm' || e.key === 'M') { AU.toggleMute(); renderSoundBtn(); return; }
      if ((e.key === '[' || e.key === ']') && !ui.busy && game.pickDie(e.key === '[' ? 0 : 1)) { render(); return; }
      if (e.key === 'Escape' && (ui.targeting || ui.aiming)) { ui.targeting = false; ui.aiming = false; render(); return; }
      const dir = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (dir) { e.preventDefault(); choose(dir); }
    });
  }

  // ------------------------------------------------------------------ modals
  let modalDismissable = true;
  function openModal(html, dismissable = true) {
    modalDismissable = dismissable;
    $('#modalBody').innerHTML = html;
    $('#modal').hidden = false;
    const first = $('#modalBody').querySelector('[autofocus], .btn.primary, button, input');
    if (first) first.focus();
  }
  function closeModal() {
    $('#modal').hidden = true;
    // Queued hints follow once any pop-up closes.
    setTimeout(() => { if (game) showNextHint(); }, 0);
  }
  document.addEventListener('click', (e) => {
    if (e.target.id === 'modal' && modalDismissable) closeModal();
    const c = e.target.closest('[data-close]');
    if (c) closeModal();
  });

  function showStart(fromMenu) {
    const savedLoad = Game.fromSave(parseJson(store.get(SAVE_KEY)));
    const saved = savedLoad.game ? store.get(SAVE_KEY) : null;
    const savedFloor = savedLoad.game ? floorName(savedLoad.game.s).toLowerCase() : '';
    const tutPref = store.get(TUTORIAL_KEY);
    const playTut = tutPref === null ? !best() : tutPref === '1';
    const b = best();
    openModal(`
      <h2>Dice Delve</h2>
      <div class="hero">${RD.icon('i-start')}${RD.icon('i-sp-luck')}${RD.icon('i-enemy')}${RD.icon('i-chest')}${RD.icon('i-stairs')}</div>
      <p>A roll-and-write dungeon crawl. Roll two dice, keep one, pick a direction, and slide through procedurally generated floors to reach the staircase.</p>
      ${b ? `<p class="muted">Deepest floor reached: ${b}</p>` : ''}
      <h3>Seed</h3>
      <input type="text" id="seedInput" placeholder="Leave blank for a random dungeon" maxlength="40" autocomplete="off">
      <label class="check"><input type="checkbox" id="playTut" ${playTut ? 'checked' : ''}> Play the tutorial first <span class="muted">(3 short practice floors that don't count)</span></label>
      <div class="row">
        ${saved && !fromMenu ? `<button class="btn primary" id="continueBtn" type="button">Continue (${savedFloor})</button>` : ''}
        <button class="btn ${saved && !fromMenu ? '' : 'primary'}" id="newBtn" type="button">New game</button>
        <button class="btn" id="loadBtn" type="button">Load game</button>
        <button class="btn" id="rulesBtn" type="button">Rules</button>
        ${fromMenu && game ? '<button class="btn" type="button" data-close>Cancel</button>' : ''}
      </div>`, !!(fromMenu && game));
    const cont = $('#continueBtn');
    if (cont) cont.addEventListener('click', () => {
      const r = Game.fromSave(parseJson(store.get(SAVE_KEY)));
      if (r.game) { startWith(r.game); } else { store.del(SAVE_KEY); showStart(); }
    });
    $('#loadBtn').addEventListener('click', () => showSaves(() => showStart(fromMenu)));
    const newGame = () => {
      const tut = $('#playTut').checked;
      store.set(TUTORIAL_KEY, tut ? '1' : '0');
      startWith(Game.create($('#seedInput').value, { tutorial: tut }));
    };
    $('#newBtn').addEventListener('click', newGame);
    $('#seedInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') newGame(); });
    $('#rulesBtn').addEventListener('click', () => showHelp(() => showStart(fromMenu)));
  }

  function startWith(g) {
    game = g;
    ui.boardKey = null; ui.targeting = false; ui.aiming = false; ui.shotFlash = null; ui.preview = null; ui.busy = false;
    ui.journalSeen = g.s.logSeq || 0;
    ui.toastSeq = (g.s.logSeq || 1) - 1;
    ui.hintQueue = []; ui.hintFloor = null; ui.hintsReady = true;
    clearScenes();
    closeModal();
    render();
    save();
    afterPhase();
  }

  // --------------------------------------------------------------- save slots
  /* Every save (auto-save, slots, files, codes) is a checkpoint: the seed,
   * the floor to start, and what carries between floors. Progress inside a
   * floor isn't saved; loading starts that floor fresh. */
  function parseJson(text) { try { return JSON.parse(text); } catch (e) { return null; } }
  function readSlots() {
    const list = parseJson(store.get(SLOTS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((sl) => sl && typeof sl.id === 'string' && (sl.save || sl.state)) : [];
  }
  const writeSlots = (list) => store.set(SLOTS_KEY, JSON.stringify(list));
  const checkpoint = () => (game && game.s.phase !== 'dead' ? game.s.checkpoint : null);
  const defaultName = () => `${checkpoint().tutorial ? 'Tutorial' : 'Floor'} ${checkpoint().floor} · ${game.s.seedText}`;
  const when = (t) => { try { return new Date(t).toLocaleString(); } catch (e) { return ''; } };
  const CODE_PREFIX = 'DD2.';
  function encodeCode(cp) {
    const bytes = new TextEncoder().encode(JSON.stringify(cp));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return CODE_PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeCode(code) {
    try {
      code = code.trim();
      if (!code.startsWith(CODE_PREFIX)) return null;
      const bin = atob(code.slice(CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    } catch (e) { return null; }
  }

  function showSaves(back, message) {
    const slots = readSlots().sort((a, b) => b.savedAt - a.savedAt);
    const cp = checkpoint();
    const midFloor = cp && game.s.phase !== 'levelDone' && cp.floor === game.s.floor && game.s.turn > game.s.floorStartTurn;
    const rows = slots.map((sl) => {
      const m = sl.meta || {};
      return `<li class="slot">
        <div class="slot-info"><span class="slot-name">${esc(String(sl.name || 'Save'))}</span>
          <span class="muted">Start of ${m.tutorial ? 'tutorial' : 'floor'} ${esc(String(m.floor))} · ${esc(String(m.hp))}/${esc(String(m.maxHp))} hp · ${esc(String(m.coins))} coins · ${esc(when(sl.savedAt))}</span></div>
        <div class="slot-actions">
          <button class="btn" type="button" data-slot-load="${esc(sl.id)}">Load</button>
          ${cp ? `<button class="btn" type="button" data-slot-over="${esc(sl.id)}">Overwrite</button>` : ''}
          <button class="btn" type="button" data-slot-del="${esc(sl.id)}">Delete</button>
        </div></li>`;
    }).join('');
    openModal(`
      <h2>Saved games</h2>
      ${message ? `<p class="notice ${message.bad ? 'bad' : ''}">${esc(message.text)}</p>` : ''}
      <p class="muted">Saves record the start of a floor. Your game also saves automatically each time you reach a new floor.</p>
      <p class="muted">Storage: ${storageInfo.persisted ? 'persistent (the browser won\'t clear it to free space)' : 'may be cleared by the browser'}, with a backup copy kept in a second browser store. Clearing site data removes both, so keep a save code or file for anything important.</p>
      ${cp ? `<h3>Save this game</h3>
        ${midFloor ? `<p class="muted">This saves the start of floor ${cp.floor}. Progress on this floor so far isn't included.</p>` : ''}
        <div class="save-row"><input type="text" id="slotName" maxlength="40" value="${esc(defaultName())}" aria-label="Save name">
        <button class="btn primary" type="button" id="slotSave">Save</button></div>` : ''}
      <h3>Save slots <span class="muted">(${slots.length}/${MAX_SLOTS}, stored in this browser)</span></h3>
      ${rows ? `<ul class="slots">${rows}</ul>` : '<p class="muted">No saved games yet.</p>'}
      <h3>Save code</h3>
      <p class="muted">A short code you can copy somewhere safe or paste on another device.</p>
      ${cp ? `<div class="save-row"><input type="text" id="codeOut" readonly value="${esc(encodeCode(cp))}" aria-label="Save code for this game">
        <button class="btn" type="button" id="codeCopy">Copy</button></div>` : ''}
      <div class="save-row"><input type="text" id="codeIn" placeholder="Paste a save code" aria-label="Paste a save code" autocomplete="off">
        <button class="btn" type="button" id="codeLoad">Load</button></div>
      <h3>Save file</h3>
      <div class="row">
        ${cp ? '<button class="btn" type="button" id="exportBtn">Export current game</button>' : ''}
        <button class="btn" type="button" id="importBtn">Import save file</button>
        <input type="file" id="importFile" accept=".json,application/json" hidden>
      </div>
      <div class="row"><button class="btn" type="button" id="savesBack">${back ? 'Back' : 'Close'}</button></div>`, !back);

    const body = $('#modalBody');
    const again = (text, bad) => showSaves(back, { text, bad });
    const loadOrComplain = (data, what) => {
      const r = Game.fromSave(data);
      if (r.game) startWith(r.game);
      else again(`That ${what} isn't a valid Dice Delve save (${r.error}).`, true);
    };
    $('#savesBack').addEventListener('click', () => (back ? back() : closeModal()));

    const saveTo = (id, name) => {
      const list = readSlots();
      const i = list.findIndex((sl) => sl.id === id);
      if (i < 0 && list.length >= MAX_SLOTS) return again(`All ${MAX_SLOTS} slots are full. Overwrite or delete one first.`, true);
      const c = checkpoint();
      const entry = { id, name, savedAt: Date.now(), meta: { floor: c.floor, tutorial: !!c.tutorial, hp: c.player.hp, maxHp: c.player.maxHp, coins: c.player.coins }, save: c };
      if (i >= 0) list[i] = entry; else list.push(entry);
      if (!writeSlots(list)) return again('Could not save: browser storage is full or blocked. Use a save code or file instead.', true);
      again(`Saved "${name}".`);
    };
    if (cp) {
      const doSave = () => saveTo(`s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
        $('#slotName').value.trim() || defaultName());
      $('#slotSave').addEventListener('click', doSave);
      $('#slotName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
      $('#codeCopy').addEventListener('click', async () => {
        const out = $('#codeOut');
        out.select();
        let copied = false;
        try { await navigator.clipboard.writeText(out.value); copied = true; } catch (e) {
          try { copied = document.execCommand('copy'); } catch (e2) { copied = false; }
        }
        $('#codeCopy').textContent = copied ? 'Copied' : 'Select & copy';
      });
    }
    body.querySelectorAll('[data-slot-load]').forEach((b) => b.addEventListener('click', () => {
      const sl = readSlots().find((x) => x.id === b.dataset.slotLoad);
      if (sl) loadOrComplain(sl.save || sl.state, 'slot');
    }));
    body.querySelectorAll('[data-slot-over]').forEach((b) => b.addEventListener('click', () => {
      const sl = readSlots().find((x) => x.id === b.dataset.slotOver);
      if (sl) saveTo(sl.id, sl.name);
    }));
    body.querySelectorAll('[data-slot-del]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm delete'; b.classList.add('danger'); return; }
      writeSlots(readSlots().filter((x) => x.id !== b.dataset.slotDel));
      again('Save deleted.');
    }));
    const codeLoad = () => {
      const data = decodeCode($('#codeIn').value);
      if (!data) return again("That doesn't look like a save code. Codes start with " + CODE_PREFIX, true);
      loadOrComplain(data, 'code');
    };
    $('#codeLoad').addEventListener('click', codeLoad);
    $('#codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') codeLoad(); });

    const exp = $('#exportBtn');
    if (exp) exp.addEventListener('click', () => {
      const c = checkpoint();
      const file = { app: 'dice-delve', savedAt: new Date().toISOString(), save: c };
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dice-delve-floor-${c.floor}-${c.seedText.replace(/[^a-z0-9-]+/gi, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const fileInput = $('#importFile');
    $('#importBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 2e6) return again('That file is too large to be a save file.', true);
      const reader = new FileReader();
      reader.onload = () => loadOrComplain(parseJson(String(reader.result)), 'file');
      reader.onerror = () => again('Could not read that file.', true);
      reader.readAsText(f);
    });
  }

  function showHelp(back) {
    const f = game ? game.s.floor : 1;
    const legend = (id, text, color) => `${RD.icon(id, '', color)}<span>${text}</span>`;
    openModal(`
      <h2>How to play</h2>
      <h3>Moving</h3>
      <ul>
        <li>Roll 2 dice, then pick <b>one</b> of them (tap it, or press <b>[</b> / <b>]</b>). Its number is how many squares you move, or how far your sling shoots. The other die is discarded. Doubles are picked for you.</li>
        <li><b>Even</b> die: move orthogonally (↑ ↓ ← →). <b>Odd</b> die: move diagonally.</li>
        <li>Pick a direction and you keep going that way until your moves run out. If you're blocked with moves left, pick a new legal direction. The only direction you can't pick is straight back the way you came, unless that's the only legal move.</li>
        <li>Reach the staircase to descend. Your pencil trail shows where you've been.</li>
      </ul>
      <h3>Map key</h3>
      <div class="legend">
        ${legend('i-start', 'Start square')}
        ${legend('i-stairs', 'Staircase: exit to the next floor')}
        ${legend('i-web', 'Spider web: stops you at once, and your next move is halved')}
        ${legend('i-enemy', `Enemy: deals ⌊level/20+1⌋ damage when you run into it (${R.enemyDamage(f)} here) and has ⌊level/10+1⌋ health (${R.enemyHealth(f)} here). You strike for your strength. Kill it and you keep moving; otherwise it stops you.`)}
        ${legend('i-lock', 'Locked door: needs the matching key, which can always be reached from the start', RD.COLORS.gold)}
        ${legend('i-key', 'Key: opens the door of the same color', RD.COLORS.gold)}
        ${legend('i-portal', 'Portal: step in and come out of its twin, still moving', RD.COLORS.violet)}
        ${legend('i-coin', `Coin: ⌊level/10+1⌋ coins (${R.coinValue(f)} here)`)}
        ${legend('i-chest', 'Treasure chest: coin value + 1d6 per 20 levels')}
        ${legend('i-heart', `Heart: heals ⌈level/20⌉ (${R.heartValue(f)} here), up to max health`)}
        ${legend('i-medpack', 'Med pack: heart value + 1d4 per 20 levels')}
        ${legend('i-moon', 'Dark floor (from floor 6, never two in a row): you only see the squares next to you. Seen walls stay sketched; deeper down you stop remembering items (floor 20+) and then walls too (floor 35+). Seen stairs always stay marked.')}
        ${legend('i-torch', `Torch: every dark floor has one you can reach without keys. It lights at once and lets you see ${R.TORCH_RADIUS} squares (walls block light) until the floor ends. Torches bought in the shop are carried; tap the torch button to light one on a dark floor.`)}
        ${legend('i-darkchest', 'Dark chest: on every dark floor. Chest coins plus a random spell.')}
        ${legend('i-sling', "Sling (Rogue): after rolling and picking a die, shoot instead of moving. The stone travels up to your die's number, in its direction type, and hits the first enemy for 1 damage, then your turn ends.")}
        ${legend('i-missile', "Magic missile (Wizard): works like the sling but never runs out. With a range boost, Rogues and Wizards can also shoot any visible enemy within that many steps directly.")}
        ${legend('i-body', 'Body: enemies killed in melee or by the sling leave one. Walk over it to collect 1–2 sling stones. Fireball leaves nothing.')}
        ${legend('i-stalker', `Stalker (floor ${R.STALKER_FROM}+): after each turn, if it can see you it moves one square closer, attacking when adjacent. On dark floors it sees you only within 2 squares, or from anywhere while your torch is lit.`)}
        ${legend('i-mimic-open', `Mimic (floor ${R.MIMIC_FROM}+): some chests and locked doors are monsters. Touch one and it ambushes you: d20 + DEX ≥ ${R.MIMIC_DODGE} takes normal damage, otherwise double, and your move stops. It has twice an enemy's health and never moves. Killing it gives twice a chest's coins plus a random spell.`)}
        ${legend('i-lockpick', 'Lock pick: walk into a locked door without its key and you can try the lock: d20 + DEX vs. gold 12, crimson 14, azure 16, emerald 18. Used up either way; failure stops your move. DEX +1 is always for sale in the shop.')}
      </div>
      <h3>Your hero, classes and levels</h3>
      <p>You start as a plain hero: ${R.START_HP} health, STR 1, DEX 1, no ranged weapon and no spells. After <b>${R.FIRST_LEVEL_KILLS} kills</b> you choose a class. Each later level needs 1.5× as many kills as the one before (${[2, 3, 4].map((n) => R.levelThreshold(n)).join(', ')}… kills in total), adds health and lets you pick a boon.</p>
      <div class="legend">
        ${legend('i-cls-fighter', `<b>Fighter</b>: +${R.CLASSES.fighter.hp} max health, +${R.CLASSES.fighter.levelHp} per level. No ranged weapon, no spells. Boons: +${R.BOON_HP} max health or +1 strength.`)}
        ${legend('i-cls-wizard', '<b>Wizard</b>: 1 spell slot (recharges each floor) and an unlimited magic missile. Boons: +1 spell slot or +1 range.')}
        ${legend('i-cls-rogue', `<b>Rogue</b>: +${R.CLASSES.rogue.hp} max health, +${R.CLASSES.rogue.dex} DEX, a sling with ${R.CLASSES.rogue.ammo} stones. Boons: +1 move (slide up to die + boost, stopping anywhere from the die's value) or +1 range.`)}
      </div>
      <p class="muted">Stones and spells a class can't use are sold for coins (before choosing, you keep them). Shops only offer what your class can use.</p>
      <h3>Shops</h3>
      <p>Floor 5 is always a shop. After that a shop turns up every 4 to 10 floors, never more than twice in 10 floors. Heal, Strength +1 and Dexterity +1 are always on sale, plus 4 random offers your class can use: Max Health +2, Gamble, a torch, a lock pick, sling stones (Rogues) or spells (Wizards).</p>
      <h3>Spells (Wizards)</h3>
      <div class="legend">
        ${SPELL_ORDER.map((n) => legend('i-sp-' + n, `<b>${SPELLS[n].name}</b>: ${SPELLS[n].desc}`)).join('')}
      </div>
      <h3>Controls</h3>
      <p class="muted">Tap Roll in the middle of the direction pad. Then tap anywhere on the map in the direction you want to go (the nearest allowed direction is used), or tap an arrow on the pad. The Journal button keeps a log of everything that happened. Keyboard: Space/Enter: roll · [ ]: pick a die · Arrows or WASD: straight · Q E Z C: diagonals · Numpad works too · X: stop here (move boost).</p>
      <h3>Saving</h3>
      <p>The game saves a checkpoint each time you reach a new floor. A checkpoint holds your seed, the floor, your stats, class, coins and spells. The floor itself is rebuilt from the seed, so loading always restarts that floor from its beginning (same layout, same dice). Progress inside a floor isn't saved. Use <b>Saves</b> for named save slots, a copyable save code, or a save file.</p>
      <h3>Sound</h3>
      <p>Sound effects and ambient music are generated in your browser and start after your first tap. Open <b>Sound</b> in the menu to set volumes, turn cut-scenes on or off, or press <b>M</b> to mute. Tap a cut-scene to skip it.</p>
      <h3>Tutorial and hints</h3>
      <p>The tutorial is 3 practice floors that don't count: one room, then two rooms with webs, then a small dungeon with every feature. Turn it on or off on the New game screen. Floors 1 to 10 have bigger rooms and simpler layouts. Hint pop-ups explain each new thing the first time you meet it.</p>
      <div class="row">
        <button class="btn" type="button" id="hintsToggle">${hintState.off ? 'Turn hints on' : 'Turn hints off'}</button>
        <button class="btn primary" type="button" id="helpClose">Got it</button>
      </div>`, !back);
    $('#hintsToggle').addEventListener('click', (e) => {
      hintState.off = !hintState.off;
      if (!hintState.off) { hintState.seen = {}; ui.hintFloor = null; } else ui.hintQueue = [];
      saveHints();
      e.target.textContent = hintState.off ? 'Turn hints on' : 'Turn hints off';
    });
    $('#helpClose').addEventListener('click', () => (back ? back() : closeModal()));
  }

  function showLevelDone() {
    const sm = game.s.summary;
    const next = sm.nextTutorial ? `Tutorial ${sm.next}/3 awaits.` : sm.tutorial ? 'The tutorial is over: the real dungeon begins at floor 1.' : `Floor ${sm.next} awaits.`;
    openModal(`
      <h2>${sm.tutorial ? `Tutorial ${sm.floor}/3 complete!` : `Floor ${sm.floor} cleared!`}</h2>
      <div class="hero">${RD.icon('i-stairs')}</div>
      <p>You found the stairs in ${sm.turns} turn${sm.turns === 1 ? '' : 's'}.</p>
      <p>${sm.nextIsShop ? 'You hear a merchant humming below…' : next}</p>
      <div class="row"><button class="btn primary" type="button" id="descendBtn">Descend</button></div>`, false);
    $('#descendBtn').addEventListener('click', () => {
      game.nextFloor();
      closeModal();
      render(); save(); afterPhase();
    });
  }

  function showDead() {
    const s = game.s;
    openModal(`
      <h2>You have fallen</h2>
      <div class="hero">${RD.icon('i-enemy')}</div>
      <p>Reached: <b>${floorName(s)}</b> · Floors cleared: ${s.stats.floorsCleared}</p>
      <p>${s.player.cls ? `${R.CLASSES[s.player.cls].name}, level ${s.player.level}` : 'Base hero, no class yet'}</p>
      <p>Enemies slain: ${s.stats.kills} · Coins earned: ${s.stats.coins} · Turns: ${s.turn}</p>
      <p class="muted">Seed "${esc(s.seedText)}" · Deepest ever: ${best()}</p>
      <div class="row">
        <button class="btn primary" type="button" id="againBtn">Same seed</button>
        <button class="btn" type="button" id="newRunBtn">New dungeon</button>
      </div>`, false);
    $('#againBtn').addEventListener('click', () => startWith(Game.create(s.seedText)));
    $('#newRunBtn').addEventListener('click', () => startWith(Game.create('')));
  }

  const SHOP_INFO = {
    heal: { name: 'Healing Draught', desc: 'Restore health to full.', icon: 'i-sp-heal' },
    str: { name: 'Strength +1', desc: 'Strike enemies harder.', icon: 'i-sp-str' },
    maxhp: { name: 'Max Health +2', desc: 'Raise your maximum (and current) health by 2.', icon: 'i-sp-maxhp' },
    dex: { name: 'Dexterity +1', desc: 'Better at picking locks: adds 1 to every lock-pick roll.', icon: 'i-sp-dex' },
    ammo: { name: 'Sling stones ×3', desc: 'Three more shots for your sling.', icon: 'i-sling' },
    lockpick: { name: 'Lock pick', desc: 'Try a locked door without its key: d20 + DEX against the door color. Used up either way.', icon: 'i-lockpick' },
    torch: { name: 'Torch', desc: `Carry it; light it on a dark floor to see ${R.TORCH_RADIUS} squares around you until the floor ends.`, icon: 'i-torch' },
    gamble: { name: 'Gamble', desc: 'Roll a die: 1-2 lose wager · 3-4 money back · 5 money back +2 · 6 money back + 2× wager.', icon: 'i-sp-gamble' },
  };
  // "(own N)" next to shop items you can stock up on.
  function ownLabel(id, p) {
    const own = SPELLS[id] ? p.spells[id] : { torch: p.torches, ammo: p.ammo, lockpick: p.lockpicks }[id];
    if (own !== undefined) return ` <span class="muted">(own ${own})</span>`;
    if (id === 'dex') return ` <span class="muted">(DEX ${p.dex})</span>`;
    if (id === 'str') return ` <span class="muted">(STR ${p.str})</span>`;
    return '';
  }
  let wager = 1;

  function showShop() {
    const s = game.s, p = s.player;
    wager = Math.max(1, Math.min(wager, p.coins));
    const items = s.shop.items.map((it, i) => {
      const info = SHOP_INFO[it.id] || { name: SPELLS[it.id].name, desc: SPELLS[it.id].desc, icon: 'i-sp-' + it.id };
      if (it.id === 'gamble') {
        const g = s.shop.lastGamble;
        return `<div class="shop-item wide">
          <div class="head">${RD.icon(info.icon)}<span class="name">${info.name}</span></div>
          <div class="desc">${info.desc}</div>
          <div class="wager">Wager
            <button class="btn" type="button" data-wager="-5">−5</button>
            <button class="btn" type="button" data-wager="-1">−</button>
            <output>${p.coins ? wager : 0}</output>
            <button class="btn" type="button" data-wager="1">+</button>
            <button class="btn" type="button" data-wager="5">+5</button>
            <button class="btn primary" type="button" id="gambleBtn" ${p.coins < 1 ? 'disabled' : ''}>Roll</button>
          </div>
          <div class="gamble-result">${g ? `${RD.dieSvg(g.roll)} <span>${esc(g.text)} (${g.delta >= 0 ? '+' : ''}${g.delta})</span>` : ''}</div>
        </div>`;
      }
      const price = game.price(it.id);
      const full = it.id === 'heal' && p.hp >= p.maxHp;
      const label = it.sold ? 'Sold' : full ? 'Full health' : `Buy · ${price} ${RD.icon('i-coin', 'inline')}`;
      return `<div class="shop-item${it.sold ? ' sold' : ''}">
        <div class="head">${RD.icon(info.icon)}<span class="name">${info.name}${ownLabel(it.id, p)}</span></div>
        <div class="desc">${info.desc}</div>
        <button class="btn" type="button" data-buy="${i}" ${game.canBuy(i) ? '' : 'disabled'}>${label}</button>
      </div>`;
    }).join('');
    openModal(`
      <h2>Shop · Floor ${s.floor}</h2>
      <p>${RD.icon('i-coin', 'inline')} <b>${p.coins}</b> coins · ${RD.icon('i-heart', 'inline')} ${p.hp}/${p.maxHp} · ${RD.icon('i-sp-str', 'inline')} ${p.str}</p>
      <div class="shop-items">${items}</div>
      <div class="row"><button class="btn primary" type="button" id="leaveShop">Leave and descend</button></div>`, false);
    const body = $('#modalBody');
    body.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      if (game.buy(Number(b.dataset.buy))) { render(); save(); showShop(); }
    }));
    body.querySelectorAll('[data-wager]').forEach((b) => b.addEventListener('click', () => {
      wager = Math.max(1, Math.min(p.coins, wager + Number(b.dataset.wager)));
      body.querySelector('.wager output').textContent = p.coins ? wager : 0;
    }));
    const gb = $('#gambleBtn');
    if (gb) gb.addEventListener('click', () => { if (game.gamble(wager)) { render(); save(); showShop(); } });
    $('#leaveShop').addEventListener('click', () => { game.nextFloor(); closeModal(); render(); save(); afterPhase(); });
  }

  function showReroll() {
    const d = game.s.dice;
    openModal(`
      <h2>Re-roll</h2><p>Choose a die to roll again.</p>
      <div class="pick-dice">
        <button class="die-btn" type="button" data-die="0">${RD.dieSvg(d[0])}</button>
        <button class="die-btn" type="button" data-die="1">${RD.dieSvg(d[1])}</button>
      </div>
      <div class="row"><button class="btn" type="button" data-close>Cancel</button></div>`);
    $('#modalBody').querySelectorAll('[data-die]').forEach((b) => b.addEventListener('click', () => {
      game.reroll(Number(b.dataset.die));
      closeModal(); ui.rolled = true; render(); save();
    }));
  }

  function showLuck() {
    const pick = game.s.dice.slice();
    const draw = () => {
      openModal(`
        <h2>Dark One's Luck</h2><p>Set each die to any face. Total ${pick[0] + pick[1]}: ${(pick[0] + pick[1]) % 2 ? 'diagonal' : 'orthogonal'}.</p>
        <div class="pick-dice">
          ${[0, 1].map((i) => `<div class="die-col"><span>Die ${i + 1}</span><div class="face-grid">
            ${[1, 2, 3, 4, 5, 6].map((v) => `<button type="button" class="${pick[i] === v ? 'sel' : ''}" data-i="${i}" data-v="${v}" aria-label="Die ${i + 1} to ${v}">${RD.dieSvg(v)}</button>`).join('')}
          </div></div>`).join('')}
        </div>
        <div class="row"><button class="btn primary" type="button" id="luckOk">Bend fate</button><button class="btn" type="button" data-close>Cancel</button></div>`);
      $('#modalBody').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
        pick[Number(b.dataset.i)] = Number(b.dataset.v);
        draw();
      }));
      $('#luckOk').addEventListener('click', () => {
        game.darkLuck(pick[0], pick[1]);
        closeModal(); ui.rolled = true; render(); save();
      });
    };
    draw();
  }

  // ------------------------------------------------------------------- theme
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    store.set(THEME_KEY, next);
  }

  // -------------------------------------------------------------------- boot
  async function boot() {
    applyTheme(store.get(THEME_KEY));
    // Wait briefly for the IndexedDB backup (it never blocks for long).
    await Promise.race([restoreMirror().catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
    try { if (navigator.storage && navigator.storage.persisted) storageInfo.persisted = await navigator.storage.persisted(); } catch (e) { /* not supported */ }
    $('#sprites').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><defs>${RD.SYMBOLS}</defs></svg>`;
    setupInput();
    const saved = store.get(SAVE_KEY);
    let g = null;
    g = saved ? Game.fromSave(parseJson(saved)).game || null : null;
    game = g || Game.create('');
    ui.journalSeen = ui.toastSeq = game.s.logSeq || 0;
    render();
    showStart(false);
  }

  window.DiceDelve = { get game() { return game; }, render };
  boot();
})();
