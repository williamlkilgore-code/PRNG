/* DOM wiring: renders game state, handles input, runs move animation. */
(function () {
  const DC = window.DC;
  const { Game, SPELLS, rules: R } = DC;
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

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };
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
    if (game && game.s.floor > best()) store.set(BEST_KEY, String(game.s.floor));
  }

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
    for (const e of game.drainEvents()) AU.sfx(e);
  }
  function syncMusic() {
    const s = game.s;
    let mood = 'floor';
    if (!ui.hintsReady || s.phase === 'dead') mood = 'none';
    else if (s.shop) mood = 'shop';
    else if (s.level && s.level.dark) mood = 'dark';
    else if (s.floor <= 3) mood = 'tutorial';
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
      <h2>Sound</h2>
      ${AU.available ? '' : '<p class="notice bad">This browser doesn\'t support Web Audio, so the game is silent.</p>'}
      ${row('sfx', 'Sound effects')}
      ${row('music', 'Music')}
      <label class="check"><input type="checkbox" id="muteAll" ${st.muted ? 'checked' : ''}> Mute everything <span class="muted">(M key)</span></label>
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
  }
  function renderSoundBtn() {
    const b = $('#soundBtn');
    if (b) b.classList.toggle('muted-btn', !!AU.settings.muted);
  }

  // ------------------------------------------------------------------- hints
  /* One-time tips shown as pop-ups the first time something comes up.
   * Seen hints and the on/off switch live in localStorage. */
  const HINTS = {
    start: { icon: 'i-start', title: 'Welcome to the dungeon', text: 'Tap <b>Roll</b> in the middle of the direction pad. The two dice add up to how many squares you move. Reach the <b>staircase</b> to finish the floor.' },
    even: { icon: 'i-sp-reroll', title: 'Even roll: move straight', text: 'An even total moves you up, down, left or right. Tap the map in the direction you want to go (or use the pad). You keep sliding until your moves run out.' },
    odd: { icon: 'i-sp-reroll', title: 'Odd roll: move diagonally', text: 'An odd total moves you diagonally. Tap the map toward the corner you want. You keep sliding until your moves run out.' },
    blocked: { icon: 'i-stairs', title: 'Blocked!', text: "You hit something with moves left. Pick a new direction to keep going. You can't turn straight back the way you came, unless that's the only way." },
    doorway: { icon: 'i-door-open', title: 'Doorways', text: 'Rooms are joined by gaps in the wall. Slide through a doorway to reach the next room.' },
    web: { icon: 'i-web', title: 'Spider webs', text: 'Running into a web stops you on the spot, and your <b>next</b> move is halved. Steer around them when you can.' },
    enemy: { icon: 'i-enemy', title: 'Enemies', text: "When you run into an enemy it hits you, and you hit back with your strength. Kill it and you keep moving; if it survives, your move ends. The red number is its health." },
    lock: { icon: 'i-lock', title: 'Locked doors', text: 'A locked door needs the key of the same color. You can always reach the key without opening any door. Walk into the door with the key to open it.' },
    items: { icon: 'i-chest', title: 'Treasure', text: 'Coins buy things in shops (floor 5 is the first). Chests hold extra coins. Hearts and med packs heal you.' },
    portal: { icon: 'i-portal', title: 'Portals', text: 'Step into a portal and you come out of its matching twin, still moving in the same direction.' },
    dark: { icon: 'i-moon', title: 'A dark floor', text: "You can only see the squares next to you. Every dark floor has a torch you can reach without keys. Pick it up to see 4 squares around you. There's also a dark chest with a free spell." },
    shoot: { icon: 'i-sling', title: 'Your sling', text: 'After rolling you can <b>shoot instead of moving</b>: tap the sling, then a direction. The stone flies as far as your roll in a straight or diagonal line (same as your move) and hits the first enemy for 1 damage. Enemies you kill leave bodies; walk over them to collect stones.' },
    stalker: { icon: 'i-stalker', title: 'Stalkers', text: 'These hooded enemies hunt you. After each of your turns, a stalker that can see you moves one square closer, and attacks if it is next to you. On dark floors they spot you only up close, unless your torch is lit, which they can see from anywhere.' },
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
    const key = `${s.seed}:${s.floor}`;
    if (L && ui.hintFloor !== key) {
      ui.hintFloor = key;
      const has = (t) => L.objects.some((o) => o.type === t);
      queueHint('start');
      if (L.rooms.length > 1) queueHint('doorway');
      if (has('web')) queueHint('web');
      if (has('enemy')) queueHint('enemy');
      if (has('lock')) queueHint('lock');
      if (has('chest') || has('heart') || has('medpack')) queueHint('items');
      if (has('portal')) queueHint('portal');
      if (L.dark) queueHint('dark');
      if (L.objects.some((o) => o.stalker && !o.done)) queueHint('stalker');
    }
    if (s.phase === 'choose' && s.dice) queueHint(s.parity === 'ortho' ? 'even' : 'odd');
    if (s.phase === 'redirect') queueHint('blocked');
    if (Object.values(s.player.spells).some((n) => n > 0)) queueHint('spells');
    if (s.phase === 'choose' && s.floor >= 3 && game.canShoot()) queueHint('shoot');
    if (s.player.lockpicks > 0) queueHint('lockpick');
    showNextHint();
  }
  function showNextHint() {
    if (!ui.hintsReady || hintState.off || !ui.hintQueue.length || ui.busy || !$('#modal').hidden) return;
    if (!['roll', 'choose', 'redirect'].includes(game.s.phase)) return;
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
    $('#stats').innerHTML = `
      <span class="stat" title="Floor">${RD.icon('i-stairs')}<b>Floor ${s.floor}</b></span>
      <span class="stat" title="Health">${RD.icon('i-heart')}<b>${p.hp}/${p.maxHp}</b>
        <span class="hpbar"><span style="width:${(100 * p.hp) / p.maxHp}%"></span></span></span>
      <span class="stat" title="Strength">${RD.icon('i-sp-str')}<b>${p.str}</b></span>
      <span class="stat" title="Dexterity">${RD.icon('i-sp-dex', '', '#7b4fc0')}<b>${p.dex}</b></span>
      ${p.lockpicks ? `<span class="stat" title="Lock picks">${RD.icon('i-lockpick')}<b>${p.lockpicks}</b></span>` : ''}
      <span class="stat" title="Coins">${RD.icon('i-coin')}<b>${p.coins}</b></span>
      ${keys ? `<span class="stat" title="Keys">${keys}</span>` : ''}
      ${s.level && s.level.dark ? `<span class="stat dark-stat" title="${s.level.torchLit ? 'Dark floor, torch lit' : 'Dark floor'}">${RD.icon(s.level.torchLit ? 'i-torch' : 'i-moon')}<b>${s.level.torchLit ? 'Lit' : 'Dark'}</b></span>` : ''}
      <span class="stat muted stat-turn" title="Turns taken">Turn ${s.turn + 1}</span>`;
  }

  function renderBoard() {
    const s = game.s, svg = $('#board');
    const key = s.level ? `${s.seed}:${s.floor}` : `shop:${s.floor}`;
    if (ui.boardKey !== key) {
      ui.boardKey = key;
      if (s.level) {
        svg.setAttribute('viewBox', `0 0 ${s.level.w * RD.C} ${s.level.h * RD.C}`);
        svg.innerHTML = `<g class="static">${RD.staticLayer(s.level)}</g><g class="dyn"></g><g class="preview-layer"></g>`;
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
    const dice = s.dice || [0, 0];
    $('#dice').innerHTML = RD.dieSvg(dice[0], ui.rolled ? 'rolling' : '') + RD.dieSvg(dice[1], ui.rolled ? 'rolling' : '');
    ui.rolled = false;

    const info = $('#diceInfo');
    if (s.dice && s.level) {
      const left = s.phase === 'moving' || s.phase === 'redirect' ? s.move.stepsLeft : s.steps;
      const moving = s.phase === 'moving' || s.phase === 'redirect';
      info.innerHTML = `<span class="big">${left}</span>${moving ? 'moves left' : 'moves'}<br>
        <span class="tag">${s.parity === 'ortho' ? '✚ orthogonal' : '✖ diagonal'}</span>
        ${s.halved ? '<span class="tag halved">webbed ½</span>' : ''}`;
    } else {
      info.innerHTML = s.player.webbed ? '<span class="tag halved">Next move halved</span>' : '<span class="muted">Roll to move</span>';
    }

    $('#status').innerHTML = statusText();
    if (ui.aiming && !game.canShoot()) ui.aiming = false;
    const legal = ui.busy ? [] : game.availableDirs();
    const dirs = ui.targeting ? [] : ui.aiming ? game.shotDirs() : legal;
    const sling = $('#slingBtn');
    sling.disabled = ui.busy || !(ui.aiming || game.canShoot());
    sling.classList.toggle('armed', !!ui.aiming);
    sling.querySelector('.count').textContent = s.player.ammo;
    document.querySelectorAll('#pad [data-dir]').forEach((b) => { b.disabled = !dirs.includes(b.dataset.dir); });

    // The pad's center is the Roll button, becomes Pass when no move is
    // legal, and otherwise shows the moves left.
    const center = $('#padCenter');
    const canRoll = !ui.busy && !ui.targeting && s.phase === 'roll';
    const canPass = !ui.busy && !ui.targeting && !ui.aiming && s.phase === 'choose' && legal.length === 0;
    const mode = canRoll ? 'roll' : canPass ? 'pass' : 'count';
    if (center.dataset.mode !== mode || mode === 'count') {
      center.dataset.mode = mode;
      center.className = 'pad-center ' + mode;
      center.disabled = mode === 'count';
      if (mode === 'roll') { center.innerHTML = `${DIE_ICON}<span>Roll</span>`; center.setAttribute('aria-label', 'Roll dice'); }
      else if (mode === 'pass') { center.innerHTML = '<span>Pass</span>'; center.setAttribute('aria-label', 'Pass turn'); }
      else {
        const moving = s.dice && s.level && ['choose', 'redirect', 'moving'].includes(s.phase);
        center.innerHTML = moving ? `${game.stepsLeft()}<small>moves</small>` : '·';
        center.setAttribute('aria-label', moving ? `${game.stepsLeft()} moves left` : 'Waiting');
      }
    }

    document.querySelectorAll('#spells [data-spell]').forEach((b) => {
      const name = b.dataset.spell;
      const n = s.player.spells[name];
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
    if (ui.aiming) return `Sling: tap a ${s.parity === 'ortho' ? 'straight' : 'diagonal'} direction to shoot (range ${s.steps}). It hits the first enemy in line and ends your turn. Tap the sling again to cancel.`;
    switch (s.phase) {
      case 'roll': return s.player.webbed ? 'Still tangled in web: this roll is halved. Tap Roll.' : 'Tap Roll (center of the pad) or press Space.';
      case 'choose': {
        const n = game.availableDirs().length;
        if (!n) return 'No legal move with this roll. Tap Pass (or use a spell).';
        return `Tap the map in a ${s.parity === 'ortho' ? 'straight (orthogonal)' : 'diagonal'} direction. You keep going until your ${s.steps} moves run out or you're blocked.`;
      }
      case 'moving': return 'Moving…';
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

  // Sling: shoot instead of moving, flash the stone's path, then end the turn.
  async function shoot(dir) {
    if (ui.busy) return;
    const r = game.shoot(dir);
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
    ui.aiming = !ui.aiming && game.canShoot();
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
    save();
    afterPhase();
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
    if (ui.busy || !game.roll()) return;
    ui.rolled = true;
    render();
    save();
  }

  function afterPhase() {
    const ph = game.s.phase;
    if (ph === 'levelDone') { recordBest(); setTimeout(showLevelDone, reducedMotion ? 0 : 350); }
    else if (ph === 'dead') { recordBest(); store.del(SAVE_KEY); lastSaved = null; setTimeout(showDead, reducedMotion ? 0 : 500); }
    else if (ph === 'shop') showShop();
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
    const unlock = () => AU.unlock();
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
      const t = e.target.closest('[data-target]');
      if (t && ui.targeting) {
        if (game.fireball(Number(t.dataset.target))) ui.targeting = false;
        render(); save();
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
        const mode = $('#padCenter').dataset.mode;
        if (mode === 'roll') roll();
        else if (mode === 'pass' && game.passTurn()) { render(); save(); }
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
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'r') {
        if (game.s.phase === 'roll') { e.preventDefault(); roll(); }
        else if (game.s.phase === 'choose' && !game.availableDirs().length) { e.preventDefault(); game.passTurn(); render(); save(); }
        return;
      }
      if (e.key === 'm' || e.key === 'M') { AU.toggleMute(); renderSoundBtn(); return; }
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
    const savedFloor = savedLoad.game ? savedLoad.game.s.floor : 0;
    const b = best();
    openModal(`
      <h2>Dice Delve</h2>
      <div class="hero">${RD.icon('i-start')}${RD.icon('i-sp-luck')}${RD.icon('i-enemy')}${RD.icon('i-chest')}${RD.icon('i-stairs')}</div>
      <p>A roll-and-write dungeon crawl. Roll two dice, pick a direction, and slide through procedurally generated floors to reach the staircase.</p>
      ${b ? `<p class="muted">Deepest floor reached: ${b}</p>` : ''}
      <h3>Seed</h3>
      <input type="text" id="seedInput" placeholder="Leave blank for a random dungeon" maxlength="40" autocomplete="off">
      <label class="check"><input type="checkbox" id="skipTut"> Skip tutorial (start on floor 4)</label>
      <div class="row">
        ${saved && !fromMenu ? `<button class="btn primary" id="continueBtn" type="button">Continue (floor ${savedFloor})</button>` : ''}
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
    const newGame = () => startWith(Game.create($('#seedInput').value, $('#skipTut').checked ? { startFloor: 4 } : undefined));
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
  const defaultName = () => `Floor ${checkpoint().floor} · ${game.s.seedText}`;
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
          <span class="muted">Start of floor ${esc(String(m.floor))} · ${esc(String(m.hp))}/${esc(String(m.maxHp))} hp · ${esc(String(m.coins))} coins · ${esc(when(sl.savedAt))}</span></div>
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
      const entry = { id, name, savedAt: Date.now(), meta: { floor: c.floor, hp: c.player.hp, maxHp: c.player.maxHp, coins: c.player.coins }, save: c };
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
        <li>Roll 2 dice. The total is how many squares you move.</li>
        <li><b>Even</b> total: move orthogonally (↑ ↓ ← →). <b>Odd</b> total: move diagonally.</li>
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
        ${legend('i-sling', `Sling: after rolling, shoot instead of moving. The stone travels up to your roll in the roll's direction type and hits the first enemy for 1 damage, then your turn ends. You start with ${R.START_AMMO} stones.`)}
        ${legend('i-body', 'Body: enemies killed in melee or by the sling leave one. Walk over it to collect 1–2 sling stones. Fireball leaves nothing.')}
        ${legend('i-stalker', `Stalker (floor ${R.STALKER_FROM}+): after each turn, if it can see you it moves one square closer, attacking when adjacent. On dark floors it sees you only within 2 squares, or from anywhere while your torch is lit.`)}
        ${legend('i-lockpick', 'Lock pick: walk into a locked door without its key and you can try the lock: d20 + DEX vs. gold 12, crimson 14, azure 16, emerald 18. Used up either way; failure stops your move. DEX +1 is always for sale in the shop.')}
      </div>
      <h3>Shops</h3>
      <p>Floor 5 is always a shop. After that a shop turns up every 4 to 10 floors, never more than twice in 10 floors. Heal and Strength +1 are always on sale, plus 4 random offers: Max Health +2, Gamble, or spells.</p>
      <h3>Spells</h3>
      <div class="legend">
        ${SPELL_ORDER.map((n) => legend('i-sp-' + n, `<b>${SPELLS[n].name}</b>: ${SPELLS[n].desc}`)).join('')}
      </div>
      <h3>Controls</h3>
      <p class="muted">Tap Roll in the middle of the direction pad. Then tap anywhere on the map in the direction you want to go (the nearest allowed direction is used), or tap an arrow on the pad. The Journal button keeps a log of everything that happened. Keyboard: Space/Enter: roll · Arrows or WASD: straight · Q E Z C: diagonals · Numpad works too.</p>
      <h3>Saving</h3>
      <p>The game saves a checkpoint each time you reach a new floor. A checkpoint holds your seed, the floor, your stats, coins and spells. The floor itself is rebuilt from the seed, so loading always restarts that floor from its beginning (same layout, same dice). Progress inside a floor isn't saved. Use <b>Saves</b> for named save slots, a copyable save code, or a save file.</p>
      <h3>Sound</h3>
      <p>Sound effects and ambient music are generated in your browser and start after your first tap. Open <b>Sound</b> in the menu to set volumes, or press <b>M</b> to mute.</p>
      <h3>Tutorial and hints</h3>
      <p>Floors 1 to 3 are a short tutorial: one room, then two rooms with webs, then a small dungeon with every feature. You can skip it from the New game screen. Hint pop-ups explain each new thing the first time you meet it.</p>
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
    openModal(`
      <h2>Floor ${sm.floor} cleared!</h2>
      <div class="hero">${RD.icon('i-stairs')}</div>
      <p>You found the stairs in ${sm.turns} turn${sm.turns === 1 ? '' : 's'}.</p>
      <p>${sm.nextIsShop ? 'You hear a merchant humming below…' : `Floor ${sm.next} awaits.`}</p>
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
      <p>Floor reached: <b>${s.floor}</b> · Floors cleared: ${s.stats.floorsCleared}</p>
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
    gamble: { name: 'Gamble', desc: 'Roll a die: 1-2 lose wager · 3-4 money back · 5 money back +2 · 6 win double.', icon: 'i-sp-gamble' },
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
  function boot() {
    applyTheme(store.get(THEME_KEY));
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
