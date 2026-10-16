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
  const ui = { busy: false, targeting: false, preview: null, boardKey: null, rolled: false };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };
  const save = () => { if (game) store.set(SAVE_KEY, JSON.stringify(game.s)); };
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
      <span class="stat muted" title="Turns taken">Turn ${s.turn + 1}</span>`;
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
    const rollBtn = $('#rollBtn');
    rollBtn.disabled = ui.busy || s.phase !== 'roll';
    const legal = ui.busy ? [] : game.availableDirs();
    const dirs = ui.targeting ? [] : legal;
    $('#passBtn').hidden = ui.busy || ui.targeting || !(s.phase === 'choose' && legal.length === 0);

    document.querySelectorAll('#pad [data-dir]').forEach((b) => { b.disabled = !dirs.includes(b.dataset.dir); });
    const center = $('#pad .pad-center');
    if (center) center.textContent = s.dice && s.level && (s.phase === 'choose' || s.phase === 'redirect' || s.phase === 'moving') ? game.stepsLeft() : '·';

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

    const log = $('#log');
    log.innerHTML = s.log.slice(-30).reverse().map((l) => `<li class="log-${l.kind}">${esc(l.text)}</li>`).join('');
  }

  function statusText() {
    const s = game.s;
    if (ui.targeting) return 'Fireball: tap an obstacle (web, enemy or locked door) to destroy it. Tap the spell again to cancel.';
    switch (s.phase) {
      case 'roll': return s.player.webbed ? 'Still tangled in web: this roll is halved. Roll the dice.' : 'Roll the dice to move.';
      case 'choose': {
        const n = game.availableDirs().length;
        if (!n) return 'No legal move with this roll. Pass the turn (or use a spell).';
        return `Pick a ${s.parity === 'ortho' ? 'straight (orthogonal)' : 'diagonal'} direction. You'll keep going until your ${s.steps} moves run out or you're blocked.`;
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
    else if (ph === 'dead') { recordBest(); store.del(SAVE_KEY); setTimeout(showDead, reducedMotion ? 0 : 500); }
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

  function setupInput() {
    $('#rollBtn').addEventListener('click', roll);
    $('#passBtn').addEventListener('click', () => { if (game.passTurn()) { render(); save(); } });
    $('#helpBtn').addEventListener('click', () => showHelp());
    $('#menuBtn').addEventListener('click', () => showStart(true));
    $('#savesBtn').addEventListener('click', () => { if (!ui.busy) showSaves(); });
    $('#themeBtn').addEventListener('click', toggleTheme);

    const board = $('#board');
    board.addEventListener('click', (e) => {
      const t = e.target.closest('[data-target]');
      if (t && ui.targeting) {
        if (game.fireball(Number(t.dataset.target))) ui.targeting = false;
        render(); save();
        return;
      }
      const a = e.target.closest('[data-dir]');
      if (a) choose(a.dataset.dir);
    });
    const hover = (e) => {
      const a = e.target.closest('[data-dir]');
      const next = a && !ui.busy ? game.previewPath(a.dataset.dir) : null;
      if (JSON.stringify(next) === JSON.stringify(ui.preview)) return;
      ui.preview = next;
      renderPreview();
    };
    board.addEventListener('mouseover', hover);
    board.addEventListener('mouseleave', hover);

    const pad = $('#pad');
    pad.innerHTML = PAD_ORDER.map((d) => d
      ? `<button type="button" data-dir="${d}" aria-label="Move ${d}"><svg viewBox="-16 -16 32 32"><path d="M-9 0H8M1-7L8 0L1 7" transform="rotate(${ANGLE[d]})" style="fill:none;stroke:currentColor;stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round"/></svg></button>`
      : '<button type="button" class="pad-center" disabled aria-hidden="true">·</button>').join('');
    pad.addEventListener('click', (e) => { const b = e.target.closest('[data-dir]'); if (b && !b.disabled) choose(b.dataset.dir); });
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
    const saved = store.get(SAVE_KEY);
    const b = best();
    openModal(`
      <h2>Dice Delve</h2>
      <div class="hero">${RD.icon('i-start')}${RD.icon('i-sp-luck')}${RD.icon('i-enemy')}${RD.icon('i-chest')}${RD.icon('i-stairs')}</div>
      <p>A roll-and-write dungeon crawl. Roll two dice, pick a direction, and slide through procedurally generated floors to reach the staircase.</p>
      ${b ? `<p class="muted">Deepest floor reached: ${b}</p>` : ''}
      <h3>Seed</h3>
      <input type="text" id="seedInput" placeholder="Leave blank for a random dungeon" maxlength="40" autocomplete="off">
      <div class="row">
        ${saved && !fromMenu ? '<button class="btn primary" id="continueBtn" type="button">Continue</button>' : ''}
        <button class="btn ${saved && !fromMenu ? '' : 'primary'}" id="newBtn" type="button">New game</button>
        <button class="btn" id="loadBtn" type="button">Load game</button>
        <button class="btn" id="rulesBtn" type="button">Rules</button>
        ${fromMenu && game ? '<button class="btn" type="button" data-close>Cancel</button>' : ''}
      </div>`, !!(fromMenu && game));
    const cont = $('#continueBtn');
    if (cont) cont.addEventListener('click', () => {
      const g = Game.load(parseJson(saved));
      if (g) { startWith(g); } else { store.del(SAVE_KEY); showStart(); }
    });
    $('#loadBtn').addEventListener('click', () => showSaves(() => showStart(fromMenu)));
    $('#newBtn').addEventListener('click', () => startWith(Game.create($('#seedInput').value)));
    $('#seedInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') startWith(Game.create(e.target.value)); });
    $('#rulesBtn').addEventListener('click', () => showHelp(() => showStart(fromMenu)));
  }

  function startWith(g) {
    game = g;
    ui.boardKey = null; ui.targeting = false; ui.preview = null; ui.busy = false;
    closeModal();
    render();
    save();
    if (game.s.phase === 'moving') runMove();
    else afterPhase();
  }

  // --------------------------------------------------------------- save slots
  function parseJson(text) { try { return JSON.parse(text); } catch (e) { return null; } }
  function readSlots() {
    const list = parseJson(store.get(SLOTS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((sl) => sl && typeof sl.id === 'string' && sl.state) : [];
  }
  const writeSlots = (list) => store.set(SLOTS_KEY, JSON.stringify(list));
  const canSaveNow = () => game && !ui.busy && game.s.phase !== 'dead' && game.s.phase !== 'moving';
  const defaultName = () => `Floor ${game.s.floor} · ${game.s.seedText}`;
  const slotMeta = (st) => ({ floor: st.floor, hp: st.player.hp, maxHp: st.player.maxHp, coins: st.player.coins, seedText: st.seedText });
  const when = (t) => { try { return new Date(t).toLocaleString(); } catch (e) { return ''; } };

  function showSaves(back, message) {
    const slots = readSlots().sort((a, b) => b.savedAt - a.savedAt);
    const canSave = canSaveNow();
    const rows = slots.map((sl) => {
      const m = sl.meta || {};
      return `<li class="slot">
        <div class="slot-info"><span class="slot-name">${esc(String(sl.name || 'Save'))}</span>
          <span class="muted">Floor ${esc(String(m.floor))} · ${esc(String(m.hp))}/${esc(String(m.maxHp))} hp · ${esc(String(m.coins))} coins · ${esc(when(sl.savedAt))}</span></div>
        <div class="slot-actions">
          <button class="btn" type="button" data-slot-load="${esc(sl.id)}">Load</button>
          ${canSave ? `<button class="btn" type="button" data-slot-over="${esc(sl.id)}">Overwrite</button>` : ''}
          <button class="btn" type="button" data-slot-del="${esc(sl.id)}">Delete</button>
        </div></li>`;
    }).join('');
    openModal(`
      <h2>Saved games</h2>
      ${message ? `<p class="notice ${message.bad ? 'bad' : ''}">${esc(message.text)}</p>` : ''}
      ${canSave ? `<h3>Save this game</h3>
        <div class="save-row"><input type="text" id="slotName" maxlength="40" value="${esc(defaultName())}" aria-label="Save name">
        <button class="btn primary" type="button" id="slotSave">Save</button></div>` : ''}
      <h3>Save slots <span class="muted">(${slots.length}/${MAX_SLOTS}, stored in this browser)</span></h3>
      ${rows ? `<ul class="slots">${rows}</ul>` : '<p class="muted">No saved games yet.</p>'}
      <h3>Save file</h3>
      <p class="muted">Download a save file to back it up or move it to another browser or device.</p>
      <div class="row">
        ${game && game.s.phase !== 'dead' ? '<button class="btn" type="button" id="exportBtn">Export current game</button>' : ''}
        <button class="btn" type="button" id="importBtn">Import save file</button>
        <input type="file" id="importFile" accept=".json,application/json" hidden>
      </div>
      <div class="row"><button class="btn" type="button" id="savesBack">${back ? 'Back' : 'Close'}</button></div>`, !back);

    const body = $('#modalBody');
    const again = (text, bad) => showSaves(back, { text, bad });
    $('#savesBack').addEventListener('click', () => (back ? back() : closeModal()));

    const saveTo = (id, name) => {
      const list = readSlots();
      const i = list.findIndex((sl) => sl.id === id);
      if (i < 0 && list.length >= MAX_SLOTS) return again(`All ${MAX_SLOTS} slots are full. Overwrite or delete one first.`, true);
      const entry = { id, name, savedAt: Date.now(), meta: slotMeta(game.s), state: JSON.parse(JSON.stringify(game.s)) };
      if (i >= 0) list[i] = entry; else list.push(entry);
      if (!writeSlots(list)) return again('Could not save: browser storage is full or blocked. Use Export instead.', true);
      again(`Saved "${name}".`);
    };
    if (canSave) {
      const doSave = () => saveTo(`s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
        $('#slotName').value.trim() || defaultName());
      $('#slotSave').addEventListener('click', doSave);
      $('#slotName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
    }
    body.querySelectorAll('[data-slot-load]').forEach((b) => b.addEventListener('click', () => {
      const sl = readSlots().find((x) => x.id === b.dataset.slotLoad);
      const g = sl && Game.load(JSON.parse(JSON.stringify(sl.state)));
      if (g) startWith(g); else again('That save is damaged and could not be loaded.', true);
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

    const exp = $('#exportBtn');
    if (exp) exp.addEventListener('click', () => {
      const file = { app: 'dice-delve', version: 1, savedAt: new Date().toISOString(), state: game.s };
      const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dice-delve-floor-${game.s.floor}-${game.s.seedText.replace(/[^a-z0-9-]+/gi, '_')}.json`;
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
      reader.onload = () => {
        const data = parseJson(String(reader.result));
        const state = data && data.app === 'dice-delve' ? data.state : data;
        const why = Game.validate(state);
        if (why) return again(`That file isn't a valid Dice Delve save (${why}).`, true);
        startWith(Game.load(state));
      };
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
      <p class="muted">Tap the arrows on the map or the direction pad. Space/Enter: roll · Arrows or WASD: straight · Q E Z C: diagonals · Numpad works too.</p>
      <h3>Saving</h3>
      <p>Your game auto-saves after every move, so Continue picks up where you left off. Use <b>Saves</b> to keep named saves in this browser, or to export a save file and import it on another device.</p>
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
    g = saved ? Game.load(parseJson(saved)) : null;
    if (g) {
      game = g;
      render();
      showStart(false);
    } else {
      game = Game.create('');
      render();
      showStart(false);
    }
  }

  window.DiceDelve = { get game() { return game; }, render };
  boot();
})();
