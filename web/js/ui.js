/* DOM wiring: renders game state, handles input, runs move animation. */
(function () {
  const DC = window.DC;
  const { Game, SPELLS, rules: R } = DC;
  const RD = DC.render;
  const $ = (sel) => document.querySelector(sel);
  const SAVE_KEY = 'dicedelve-save-v1';
  const SLOTS_KEY = 'dicedelve-slots-v1';
  const MAX_SLOTS = 12;
  const BEST_KEY = 'dicedelve-best-v1';
  const THEME_KEY = 'dicedelve-theme';
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
  // Journal entries of these kinds also pop up briefly over the map.
  const TOAST_KINDS = new Set(['good', 'bad', 'fight', 'warn', 'spell', 'floor', 'shop']);
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
  }

  function renderHud() {
    const s = game.s, p = s.player;
    const keys = p.keys.map((k) => RD.icon('i-key', '', RD.COLORS[k])).join('');
    $('#stats').innerHTML = `
      <span class="stat" title="Floor">${RD.icon('i-stairs')}<b>Floor ${s.floor}</b></span>
      <span class="stat" title="Health">${RD.icon('i-heart')}<b>${p.hp}/${p.maxHp}</b>
        <span class="hpbar"><span style="width:${(100 * p.hp) / p.maxHp}%"></span></span></span>
      <span class="stat" title="Strength">${RD.icon('i-sp-str')}<b>${p.str}</b></span>
      <span class="stat" title="Coins">${RD.icon('i-coin')}<b>${p.coins}</b></span>
      ${keys ? `<span class="stat" title="Keys">${keys}</span>` : ''}
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
    if (layer) layer.innerHTML = game.s.level ? RD.previewLayer(game, ui.preview) : '';
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
    const legal = ui.busy ? [] : game.availableDirs();
    const dirs = ui.targeting ? [] : legal;
    document.querySelectorAll('#pad [data-dir]').forEach((b) => { b.disabled = !dirs.includes(b.dataset.dir); });

    // The pad's center is the Roll button, becomes Pass when no move is
    // legal, and otherwise shows the moves left.
    const center = $('#padCenter');
    const canRoll = !ui.busy && !ui.targeting && s.phase === 'roll';
    const canPass = !ui.busy && !ui.targeting && s.phase === 'choose' && legal.length === 0;
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
    switch (s.phase) {
      case 'roll': return s.player.webbed ? 'Still tangled in web: this roll is halved. Tap Roll.' : 'Tap Roll (center of the pad) or press Space.';
      case 'choose': {
        const n = game.availableDirs().length;
        if (!n) return 'No legal move with this roll. Tap Pass (or use a spell).';
        return `Tap the map in a ${s.parity === 'ortho' ? 'straight (orthogonal)' : 'diagonal'} direction. You keep going until your ${s.steps} moves run out or you're blocked.`;
      }
      case 'moving': return 'Moving…';
      case 'redirect': return `Blocked with ${s.move.stepsLeft} move${s.move.stepsLeft > 1 ? 's' : ''} left. Choose a new direction (no doubling back unless it's the only way).`;
      case 'levelDone': return 'Floor cleared!';
      case 'shop': return 'Welcome to the shop.';
      case 'dead': return 'You have fallen.';
    }
    return '';
  }

  // ------------------------------------------------------------------- input
  async function choose(dir) {
    if (ui.busy || ui.targeting || !game.choose(dir)) return;
    runMove();
  }

  // Animate the current move step by step until it stops.
  async function runMove() {
    ui.preview = null;
    ui.busy = true;
    render();
    while (game.s.phase === 'moving') {
      const ev = game.step();
      render();
      await sleep(ev.type === 'teleport' ? 380 : ev.type === 'fight' || ev.type === 'web' ? 300 : 120);
    }
    ui.busy = false;
    render();
    save();
    afterPhase();
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
  function dirFromEvent(e) {
    if (!game || !game.s.level) return null;
    const legal = game.availableDirs();
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
      else if (game.availableDirs().length) {
        board.classList.remove('nudge'); void board.getBoundingClientRect(); board.classList.add('nudge');
        setTimeout(() => board.classList.remove('nudge'), 1100);
      }
    });
    const setPreview = (dir) => {
      const next = dir && !ui.busy && !ui.targeting ? game.previewPath(dir) : null;
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
        ${RD.icon('i-sp-' + n)}<span class="count">0</span></button>`).join('');
    $('#spells').addEventListener('click', (e) => { const b = e.target.closest('[data-spell]'); if (b) castSpell(b.dataset.spell); });

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
      if (e.key === 'Escape' && ui.targeting) { ui.targeting = false; render(); return; }
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
  function closeModal() { $('#modal').hidden = true; }
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
    $('#newBtn').addEventListener('click', () => startWith(Game.create($('#seedInput').value)));
    $('#seedInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') startWith(Game.create(e.target.value)); });
    $('#rulesBtn').addEventListener('click', () => showHelp(() => showStart(fromMenu)));
  }

  function startWith(g) {
    game = g;
    ui.boardKey = null; ui.targeting = false; ui.preview = null; ui.busy = false;
    ui.journalSeen = g.s.logSeq || 0;
    ui.toastSeq = (g.s.logSeq || 1) - 1;
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
        <li>Pick a direction and you keep going that way until your moves run out. If you're blocked with moves left, pick a new legal direction. You can't reverse a direction you've used this turn. If that leaves no move, you may only step onto squares you haven't walked this turn. Retracing your path is allowed only when it's the only move.</li>
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
      <div class="row"><button class="btn primary" type="button" id="helpClose">Got it</button></div>`, !back);
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
    gamble: { name: 'Gamble', desc: 'Roll a die: 1-2 lose wager · 3-4 money back · 5 money back +2 · 6 win double.', icon: 'i-sp-gamble' },
  };
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
        <div class="head">${RD.icon(info.icon)}<span class="name">${info.name}${SPELLS[it.id] ? ` <span class="muted">(own ${p.spells[it.id]})</span>` : ''}</span></div>
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
