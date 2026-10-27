/* Game state and rules engine. Pure logic, no DOM: the UI drives it and
 * renders `game.s`, which is plain JSON so it can be saved and restored.
 *
 * Phases: roll -> choose -> moving <-> redirect -> roll ...
 *         plus pickPrompt, stopPrompt, levelDone, shop and dead.
 */
(function (root) {
  const DC = root.DC;
  const { RNG, seedFor, hashStr } = DC;
  const R = DC.rules;

  const DIRS = {
    N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
    NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
  };
  const ORTHO = ['N', 'E', 'S', 'W'];
  const DIAG = ['NE', 'SE', 'SW', 'NW'];
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' };

  // The three spells. `at(lv)` describes what a level does.
  const SPELLS = {
    invis: { name: 'Invisibility', desc: "Pass through enemies, and they can't see you, for 1 turn per level.",
      at: (lv) => (lv >= 5 ? '5 turns, and you can walk through a wall (the spell ends that turn)' : `${lv} turn${lv > 1 ? 's' : ''}`) },
    reroll: { name: 'Re-roll', desc: 'After rolling, re-roll a die: 1 attempt per level.',
      at: (lv) => (lv >= 5 ? "choose one die's value" : `${lv} re-roll${lv > 1 ? 's' : ''}`) },
    orb: { name: 'Glowing Orb', desc: 'Dark floors only: light around you for the rest of the floor, like a torch but farther.',
      at: (lv) => (lv >= 5 ? 'the whole floor lit for 2 turns, then radius 8; enemies you see stay marked' : `light radius ${R.orbRadius(lv)}`) },
  };
  const SPELL_IDS = Object.keys(SPELLS);
  const OLD_SPELL_IDS = ['noclip', 'fireball', 'luck', 'reroll', 'invis']; // checkpoint versions 2-3
  const SHOP_POOL = ['maxhp', 'gamble', 'torch', 'ammo', 'lockpick'];
  const SHOP_FIXED = ['heal', 'str', 'dex'];
  const CHECKPOINT_VERSION = 4;
  const CLASS_IDS = ['fighter', 'wizard', 'rogue'];
  const BOONS = {
    hp: { name: 'Toughness', desc: `Max health +${R.BOON_HP}.` },
    str: { name: 'Strength', desc: 'Strength +1: hit enemies harder.' },
    spell: { name: 'Spellcraft', desc: 'Learn a new spell (level 1), or raise a known spell by 1 level (max 5).' },
    range: { name: 'Range', desc: 'Range +1: shoot any enemy within that many steps, in any direction.' },
    move: { name: 'Fleet foot', desc: 'Move +1: you may slide up to 1 extra square and stop anywhere from your die onward.' },
  };

  function randomSeedText() {
    const words = ['moss', 'grim', 'ember', 'vault', 'crypt', 'rune', 'bone', 'gloom', 'ash', 'iron', 'wyrm', 'hex'];
    const pick = () => words[Math.floor(Math.random() * words.length)];
    return `${pick()}-${pick()}-${Math.floor(Math.random() * 1000)}`;
  }

  class Game {
    constructor(state) {
      this.s = state;
      // Things that just happened (for sound effects). Not part of the saved state.
      this.events = [];
      this.rebuildIndex();
    }

    emit(type) { if (this.events) this.events.push(type); }
    drainEvents() { const e = this.events || []; this.events = []; return e; }

    static newState(seedText) {
      return {
        version: 1,
        seedText,
        seed: hashStr(seedText),
        floor: 0,
        tutorial: false,
        turn: 0,
        phase: 'roll',
        player: {
          x: 0, y: 0, hp: R.START_HP, maxHp: R.START_HP, str: R.START_STR, coins: 0,
          keys: [], webbed: false, torches: 0,
          ammo: R.START_AMMO, dex: 1, lockpicks: 0,
          spells: { invis: 0, reroll: 0, orb: 0 },     // charges
          // Class and level: chosen after the first kills (see rules.js).
          cls: null, level: 0, range: 0, moveBoost: 0,
          known: { invis: 0, reroll: 0, orb: 0 },      // Wizard spell levels
          casts: 0,                                    // Wizard casts left this floor
        },
        diceState: 0,
        dice: null, die: null, steps: 0, parity: null, halved: false,
        usedDirs: [], move: null,
        invis: null,   // { turns, level, wall } while Invisibility is active
        rerolls: null, // { left, choose } after casting Re-roll
        declinedPicks: [], pickTarget: -1,
        level: null, shop: null,
        log: [], logSeq: 0,
        stats: { kills: 0, coins: 0, floorsCleared: 0 },
        floorStartTurn: 0,
        checkpoint: null,
      };
    }

    // opts.tutorial plays the 3 tutorial floors first; they don't count as floors.
    static create(seedText, opts) {
      seedText = String(seedText || '').trim() || randomSeedText();
      const g = new Game(Game.newState(seedText));
      g.log(`A new descent begins. Seed "${seedText}".`);
      g.s.tutorial = !!(opts && opts.tutorial);
      g.enterFloor(1);
      return g;
    }

    /* ---- Saves ----
     * A save is a checkpoint: the seed, the floor to start, and what carries
     * between floors. The floor itself (map, items, dice) is rebuilt from the
     * seed, so loading always starts a floor fresh. */
    checkpointFor(floor, tutorial) {
      const s = this.s, p = s.player;
      return {
        v: CHECKPOINT_VERSION,
        seedText: s.seedText,
        floor,
        tutorial: tutorial === undefined ? !!s.tutorial : tutorial,
        player: {
          hp: p.hp, maxHp: p.maxHp, str: p.str, coins: p.coins, torches: p.torches,
          ammo: p.ammo, dex: p.dex, lockpicks: p.lockpicks, spells: Object.assign({}, p.spells),
          cls: p.cls, level: p.level, known: Object.assign({}, p.known), range: p.range, moveBoost: p.moveBoost,
        },
        stats: Object.assign({}, s.stats),
        turn: s.turn,
      };
    }

    // Returns null when `cp` is a valid checkpoint, otherwise a short reason.
    static validateCheckpoint(cp) {
      const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
      const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
      if (!obj(cp)) return 'not a save';
      if (![2, 3, CHECKPOINT_VERSION].includes(cp.v)) return 'unsupported save version';
      if (typeof cp.seedText !== 'string' || !cp.seedText.trim() || cp.seedText.length > 100) return 'bad seed';
      if (!int(cp.floor, 1, 100000)) return 'bad floor';
      const p = cp.player;
      if (!obj(p) || !int(p.maxHp, 1, 100000) || !int(p.hp, 1, p.maxHp) || !int(p.str, 0, 100000) || !int(p.coins, 0, 1e9)) return 'bad player stats';
      if (!obj(p.spells) || !(cp.v >= 4 ? SPELL_IDS : OLD_SPELL_IDS).every((k) => int(p.spells[k], 0, 10000))) return 'bad spells';
      // Optional fields: older saves don't have them and get defaults.
      if (p.torches !== undefined && !int(p.torches, 0, 10000)) return 'bad torches';
      if (p.ammo !== undefined && !int(p.ammo, 0, 10000)) return 'bad ammo';
      if (p.dex !== undefined && !int(p.dex, 0, 1000)) return 'bad dexterity';
      if (p.lockpicks !== undefined && !int(p.lockpicks, 0, 10000)) return 'bad lock picks';
      if (cp.stats !== undefined && !(obj(cp.stats) && ['kills', 'coins', 'floorsCleared'].every((k) => int(cp.stats[k], 0, 1e9)))) return 'bad stats';
      if (cp.turn !== undefined && !int(cp.turn, 0, 1e9)) return 'bad turn';
      if (cp.v === 2) return null;
      // Version 3: tutorial floors, class and level (all optional; missing
      // fields mean "no tutorial" and the base hero).
      if (cp.tutorial !== undefined && (typeof cp.tutorial !== 'boolean' || (cp.tutorial && cp.floor > 3))) return 'bad tutorial';
      const cls = p.cls === undefined ? null : p.cls, level = p.level === undefined ? 0 : p.level;
      if (!(cls === null || CLASS_IDS.includes(cls))) return 'bad class';
      if (!int(level, 0, 1000) || (level > 0) !== (cls !== null)) return 'bad level';
      if (level > R.levelForKills(cp.stats ? cp.stats.kills : 0)) return 'bad level';
      if ((p.range !== undefined && !int(p.range, 0, 100)) || (p.moveBoost !== undefined && !int(p.moveBoost, 0, 100))) return 'bad boosts';
      if (cp.v === 3) {
        const slots = p.slots === undefined ? [] : p.slots;
        if (!Array.isArray(slots) || slots.length > 100 || !slots.every((k) => typeof k === 'string' && OLD_SPELL_IDS.includes(k)) ||
            (slots.length > 0 && cls !== 'wizard')) return 'bad spell slots';
        return null;
      }
      // Version 4: known spell levels (Wizards only; a Wizard knows at least one).
      if (p.known !== undefined) {
        if (!obj(p.known) || !SPELL_IDS.every((k) => int(p.known[k], 0, R.SPELL_MAX))) return 'bad spell levels';
        const n = SPELL_IDS.reduce((a, k) => a + p.known[k], 0);
        if ((n > 0) !== (cls === 'wizard')) return 'bad spell levels';
      } else if (cls === 'wizard') return 'bad spell levels';
      return null;
    }

    /* Accepts a checkpoint, an export file ({app, save}), or an older
     * full-snapshot save, and returns { game } or { error }. */
    static fromSave(data) {
      if (data && data.app === 'dice-delve') data = data.save || data.state;
      let cp = data;
      if (data && data.version === 1 && data.player) {
        // Older full-snapshot save: resume at the start of its current floor
        // (or the next one, if the floor was already finished).
        if (data.phase === 'dead') return { error: 'that run has ended' };
        const p = data.player;
        cp = {
          v: 2, seedText: data.seedText,
          floor: data.phase === 'levelDone' ? data.floor + 1 : data.floor,
          player: { hp: p.hp, maxHp: p.maxHp, str: p.str, coins: p.coins,
            spells: Object.fromEntries(OLD_SPELL_IDS.map((k) => [k, (p.spells && p.spells[k]) || 0])) },
          stats: data.stats, turn: data.turn,
        };
      }
      if (cp && cp.v === 2) {
        // Version 2 had no classes, and its floors 1-3 were the tutorial: those
        // become tutorial floors, and later floors move up by 3.
        const why = Game.validateCheckpoint(cp);
        if (why) return { error: why };
        cp = Object.assign({}, cp, {
          v: 3, tutorial: cp.floor <= 3, floor: cp.floor <= 3 ? cp.floor : cp.floor - 3,
          player: Object.assign({}, cp.player, { cls: null, level: 0, slots: [], range: 0, moveBoost: 0 }),
        });
      }
      if (cp && cp.v === 3) {
        // Version 3 had five single-use spells. Invisibility and Re-roll
        // charges carry over; the removed spells are sold for coins. A Wizard's
        // slots become known spells at level 1 (removed ones become the Orb).
        const why = Game.validateCheckpoint(cp);
        if (why) return { error: why };
        const op = cp.player, f = cp.floor;
        const sold = ['noclip', 'fireball', 'luck'].reduce((a, k) => a + op.spells[k], 0) * R.spellCoinValue(f);
        const known = { invis: 0, reroll: 0, orb: 0 };
        if (op.cls === 'wizard') {
          for (const k of op.slots || []) known[SPELLS[k] ? k : 'orb'] = 1;
          if (!known.invis && !known.reroll && !known.orb) known.orb = 1;
        }
        const player = Object.assign({}, op, { coins: op.coins + sold, spells: { invis: op.spells.invis, reroll: op.spells.reroll, orb: 0 }, known });
        delete player.slots;
        cp = Object.assign({}, cp, { v: CHECKPOINT_VERSION, player });
      }
      const why = Game.validateCheckpoint(cp);
      if (why) return { error: why };
      const g = new Game(Game.newState(cp.seedText.trim()));
      const s = g.s, p = s.player;
      const cpp = cp.player;
      Object.assign(p, {
        hp: cpp.hp, maxHp: cpp.maxHp, str: cpp.str, coins: cpp.coins, torches: cpp.torches || 0,
        ammo: cpp.ammo === undefined ? R.START_AMMO : cpp.ammo,
        dex: cpp.dex === undefined ? 1 : cpp.dex,
        lockpicks: cpp.lockpicks || 0,
        cls: cpp.cls || null, level: cpp.level || 0,
        range: cpp.range || 0, moveBoost: cpp.moveBoost || 0,
      });
      s.tutorial = !!cp.tutorial;
      for (const k of SPELL_IDS) { p.spells[k] = cpp.spells[k]; p.known[k] = cpp.known ? cpp.known[k] : 0; }
      if (cp.stats) Object.assign(s.stats, { kills: cp.stats.kills, coins: cp.stats.coins, floorsCleared: cp.stats.floorsCleared });
      s.turn = cp.turn || 0;
      g.log(`Resumed seed "${s.seedText}" at ${cp.tutorial ? 'tutorial ' + cp.floor : 'floor ' + cp.floor}.`);
      g.enterFloor(cp.floor);
      return { game: g };
    }

    // ---------------------------------------------------------------- helpers
    log(text, kind) {
      this.s.logSeq = (this.s.logSeq || 0) + 1;
      this.s.log.push({ text, kind: kind || 'info', turn: this.s.turn, seq: this.s.logSeq });
      if (this.s.log.length > 60) this.s.log.splice(0, this.s.log.length - 60);
    }

    d(n) {
      const r = new RNG(this.s.diceState);
      const v = r.die(n);
      this.s.diceState = r.state;
      return v;
    }

    rebuildIndex() {
      const L = this.s.level;
      this.objAt = null;
      if (!L) return;
      this.objAt = new Int32Array(L.w * L.h).fill(-1);
      L.objects.forEach((o, i) => { if (!o.done) this.objAt[o.y * L.w + o.x] = i; });
      this.updateVision();
    }

    inB(x, y) { const L = this.s.level; return x >= 0 && y >= 0 && x < L.w && y < L.h; }
    tile(x, y) { return this.s.level.tiles[y * this.s.level.w + x]; }
    obj(x, y) {
      if (!this.inB(x, y)) return null;
      const i = this.objAt[y * this.s.level.w + x];
      return i >= 0 ? this.s.level.objects[i] : null;
    }
    objIndex(o) { return this.s.level.objects.indexOf(o); }
    clearObj(o) {
      o.done = true;
      const L = this.s.level;
      if (this.objAt[o.y * L.w + o.x] === this.objIndex(o)) this.objAt[o.y * L.w + o.x] = -1;
    }

    // Walls and still-locked doors are solid.
    isSolid(x, y) {
      if (!this.inB(x, y) || this.tile(x, y) === 0) return true;
      const o = this.obj(x, y);
      return !!(o && o.type === 'lock');
    }
    blocksEntry(x, y) {
      if (!this.inB(x, y) || this.tile(x, y) === 0) return true;
      const o = this.obj(x, y);
      return !!(o && o.type === 'lock' && !this.s.player.keys.includes(o.color));
    }

    /* Can the player take one move in `dir` from (fx, fy) with `stepsLeft`
     * movement remaining? Returns {kind, x, y, walls} or null. */
    legalMove(dir, stepsLeft, fx, fy) {
      const p = this.s.player;
      if (fx === undefined) { fx = p.x; fy = p.y; }
      const [dx, dy] = DIRS[dir];
      const nx = fx + dx, ny = fy + dy;
      let ok = !this.blocksEntry(nx, ny);
      // Diagonals can't squeeze between two walls touching at a corner.
      if (ok && dx && dy && this.isSolid(fx + dx, fy) && this.isSolid(fx, fy + dy)) ok = false;
      if (ok) return { kind: 'normal', x: nx, y: ny, walls: 0 };

      // A locked door you hold a lock pick for (and haven't declined this turn).
      const door = this.obj(nx, ny);
      if (door && door.type === 'lock' && !p.keys.includes(door.color) && p.lockpicks > 0 &&
          !(this.s.declinedPicks || []).includes(ny * this.s.level.w + nx) &&
          !(dx && dy && this.isSolid(fx + dx, fy) && this.isSolid(fx, fy + dy))) {
        return { kind: 'pick', x: nx, y: ny, walls: 0 };
      }

      // Level 5 Invisibility: walk through a wall if the move carries you
      // all the way through it.
      if (this.wallWalk()) {
        let k = 0, cx = nx, cy = ny;
        while (this.inB(cx, cy) && this.isSolid(cx, cy)) { k++; cx += dx; cy += dy; }
        if (k >= 1 && this.inB(cx, cy) && stepsLeft >= k + 1) return { kind: 'noclip', x: cx, y: cy, walls: k };
      }
      return null;
    }

    stepsLeft() {
      return ['redirect', 'moving', 'stopPrompt', 'pickPrompt'].includes(this.s.phase) && this.s.move ? this.s.move.stepsLeft : this.s.steps;
    }

    // Directions the player may pick right now.
    availableDirs() {
      const s = this.s;
      if (s.phase !== 'choose' && s.phase !== 'redirect') return [];
      if (s.die === null) return []; // pick a die first
      const steps = this.stepsLeft();
      const legal = (s.parity === 'ortho' ? ORTHO : DIAG).filter((d) => this.legalMove(d, steps));
      if (s.phase === 'choose') return legal;
      // No doubling back: the only extra rule is that you can't turn straight
      // back the way you were just moving, unless that's the only legal move.
      const back = OPP[s.move.dir];
      const fwd = legal.filter((d) => d !== back);
      return fwd.length ? fwd : legal;
    }

    // Straight-line preview of where a direction leads (stops at the first event).
    previewPath(dir) {
      const out = [];
      let steps = this.stepsLeft();
      let { x, y } = this.s.player;
      while (steps > 0) {
        const m = this.legalMove(dir, steps, x, y);
        if (!m || !this.isVisible(m.x, m.y)) break;
        if (m.kind === 'pick') { out.push([m.x, m.y]); break; }
        x = m.x; y = m.y; steps -= m.walls + 1;
        out.push([x, y]);
        const o = this.obj(x, y);
        const L = this.s.level;
        if ((x === L.stairs.x && y === L.stairs.y) || (o && ['web', 'enemy', 'portal'].includes(o.type))) break;
      }
      return out;
    }

    // ----------------------------------------------------------------- floors
    enterFloor(f) {
      const s = this.s, p = s.player;
      s.floor = f;
      s.dice = null; s.die = null; s.move = null; s.usedDirs = []; s.halved = false;
      s.invis = null; s.rerolls = null;
      s.declinedPicks = []; s.pickTarget = -1;
      p.keys = []; p.webbed = false;
      s.floorStartTurn = s.turn;
      // Dice restart per floor, so a floor replays identically from its checkpoint.
      s.diceState = s.tutorial ? seedFor(s.seedText, 'tutorial-dice', f) : seedFor(s.seedText, 'dice', f);
      s.checkpoint = this.checkpointFor(f);
      if (p.cls === 'wizard') p.casts = R.wizardSlots(p.level); // casts refill every floor
      if (s.tutorial) {
        s.shop = null;
        s.level = DC.generateTutorial(s.seed, f);
        p.x = s.level.start.x; p.y = s.level.start.y;
        s.level.trail = [[[p.x, p.y]]];
        s.phase = 'roll';
        this.log(`Tutorial ${f} of 3. Find the staircase.`, 'floor');
      } else if (R.isShopFloor(s.seed, f)) {
        s.level = null;
        s.shop = this.makeShop(f);
        s.phase = 'shop';
        this.log(`Floor ${f}: a merchant has set up shop.`, 'shop');
      } else {
        s.shop = null;
        s.level = DC.generateLevel(s.seed, f);
        p.x = s.level.start.x; p.y = s.level.start.y;
        s.level.trail = [[[p.x, p.y]]];
        s.phase = 'roll';
        this.log(`Floor ${f}. Find the staircase.`, 'floor');
        if (s.level.dark) this.log('This floor is dark. Find the torch, or light one of your own.', 'warn');
      }
      this.rebuildIndex();
      this.updateVision();
    }

    // ---------------------------------------------------------------- vision
    /* On dark floors you see the 8 squares around you, or everything within
     * TORCH_RADIUS (Chebyshev) with a clear line of sight once a torch is lit,
     * or the Glowing Orb's radius (L.orbRadius). A level 5 Orb lights the
     * whole floor for a few turns (L.floodTurns). Seen squares are remembered
     * in level.seen; how much of that memory is drawn depends on
     * rules.darkMemory(floor). With L.enemyMemory, seen enemies keep a
     * lastSeen position. */
    updateVision() {
      const L = this.s.level;
      this.vis = null;
      if (!L || !L.dark) return;
      if (!Array.isArray(L.seen) || L.seen.length !== L.w * L.h) L.seen = new Array(L.w * L.h).fill(0);
      const p = this.s.player;
      const r = Math.max(L.torchLit ? R.TORCH_RADIUS : 1, L.orbRadius || 0);
      const vis = new Set();
      if (L.floodTurns > 0) {
        for (let i = 0; i < L.w * L.h; i++) vis.add(i);
      } else {
        for (let y = Math.max(0, p.y - r); y <= Math.min(L.h - 1, p.y + r); y++) {
          for (let x = Math.max(0, p.x - r); x <= Math.min(L.w - 1, p.x + r); x++) {
            if (r === 1 || this.lineOfSight(p.x, p.y, x, y)) vis.add(y * L.w + x);
          }
        }
      }
      for (const i of vis) L.seen[i] = 1;
      if (vis.has(L.stairs.y * L.w + L.stairs.x)) L.seenStairs = true;
      for (const o of L.objects) {
        if (!vis.has(o.y * L.w + o.x)) continue;
        o.seen = true;
        if (L.enemyMemory && o.type === 'enemy') o.lastSeen = [o.x, o.y];
      }
      this.vis = vis;
    }
    // Lit beyond your own squares (torch, Orb or flood): stalkers see you from afar.
    isLit() {
      const L = this.s.level;
      return !!(L && (L.torchLit || L.orbRadius || L.floodTurns > 0));
    }

    // Bresenham line; squares strictly between the ends must not be solid.
    lineOfSight(x0, y0, x1, y1) {
      let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy, x = x0, y = y0;
      while (x !== x1 || y !== y1) {
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
        if ((x !== x1 || y !== y1) && this.isSolid(x, y)) return false;
      }
      return true;
    }

    isVisible(x, y) {
      return !this.vis || this.vis.has(y * this.s.level.w + x);
    }

    canLightTorch() {
      const s = this.s, L = s.level;
      return !!(L && L.dark && !L.torchLit && s.player.torches > 0 && ['roll', 'choose', 'redirect'].includes(s.phase));
    }

    lightTorch() {
      if (!this.canLightTorch()) return false;
      this.s.player.torches--;
      this.s.level.torchLit = true;
      this.emit('torch');
      this.log('You light a torch. It will burn until you leave this floor.', 'status');
      this.updateVision();
      return true;
    }

    completeFloor() {
      const s = this.s;
      this.finishTurnFlags();
      s.stats.floorsCleared++;
      s.phase = 'levelDone';
      this.emit('stairs');
      const lastTut = s.tutorial && s.floor >= 3;
      const next = lastTut ? 1 : s.floor + 1, nextTut = s.tutorial && !lastTut;
      s.summary = { floor: s.floor, tutorial: s.tutorial, turns: s.turn - s.floorStartTurn, next, nextTutorial: nextTut,
        nextIsShop: !nextTut && R.isShopFloor(s.seed, next) };
      if (s.tutorial) s.stats.floorsCleared--; // the tutorial doesn't count
      s.checkpoint = this.checkpointFor(next, nextTut);
      this.log(s.tutorial ? `Tutorial ${s.floor} complete!` : `You descend the stairs of floor ${s.floor}!`, 'floor');
    }

    nextFloor() {
      const s = this.s;
      if (s.phase !== 'levelDone' && s.phase !== 'shop') return false;
      if (s.tutorial && s.floor >= 3) {
        s.tutorial = false;
        this.log('The tutorial is over. The real descent begins.', 'floor');
        this.enterFloor(1);
      } else this.enterFloor(s.floor + 1);
      return true;
    }

    // ------------------------------------------------------------------ turns
    /* One-die movement: you pick one of the two dice and the other is
     * discarded. The chosen die is both the move count and, by its parity,
     * the direction type. Equal dice are chosen automatically. */
    computeSteps() {
      // (A re-rolled die keeps the player's choice of die.)
      const s = this.s;
      if (s.die === null && s.dice[0] === s.dice[1]) s.die = 0;
      if (s.die === null) { s.parity = null; s.steps = 0; return; }
      const v = s.dice[s.die];
      s.parity = v % 2 === 0 ? 'ortho' : 'diag';
      s.steps = s.halved ? Math.max(1, Math.floor(v / 2)) : v;
    }

    // Choose which die to use (can be changed until you move or shoot).
    pickDie(i) {
      const s = this.s;
      if (s.phase !== 'choose' || !s.dice || (i !== 0 && i !== 1)) return false;
      s.die = i;
      this.computeSteps();
      return true;
    }

    roll() {
      const s = this.s, p = s.player;
      if (s.phase !== 'roll' || this.levelsOwed() > 0) return false;
      s.dice = [this.d(6), this.d(6)];
      s.die = null; s.rerolls = null;
      this.emit('roll');
      s.halved = p.webbed;
      p.webbed = false;
      s.usedDirs = [];
      this.computeSteps();
      s.phase = 'choose';
      this.log(`Rolled ${s.dice[0]} and ${s.dice[1]}: ${s.die === null ? 'pick one' : 'a double'}` +
        (s.halved ? ' (halved by the web)' : '') + '.', 'roll');
      return true;
    }

    choose(dir) {
      const s = this.s;
      if (!this.availableDirs().includes(dir)) return false;
      if (s.phase === 'choose') {
        s.rerolls = null;
        // Rogue's move boost: up to `extra` more squares, stopping any time
        // once the die's value has been moved.
        const extra = s.player.cls === 'rogue' ? s.player.moveBoost : 0;
        s.move = { stepsLeft: s.steps + extra, dir, extra };
      } else s.move.dir = dir;
      s.usedDirs.push(dir);
      s.phase = 'moving';
      return true;
    }

    passTurn() {
      if (this.s.phase !== 'choose' || this.s.die === null || this.availableDirs().length) return false;
      this.endTurn('No legal move. The turn passes.');
      return true;
    }

    finishTurnFlags() {
      const s = this.s;
      if (s.invis && (s.invis.wall || --s.invis.turns <= 0)) { s.invis = null; this.log('Your invisibility fades.', 'spell'); }
      s.rerolls = null;
      if (s.level && s.level.floodTurns > 0 && --s.level.floodTurns === 0) {
        this.log("The orb's flood of light fades.", 'spell');
        this.updateVision();
      }
      s.move = null;
      s.usedDirs = [];
      s.declinedPicks = [];
      s.pickTarget = -1;
      s.turn++;
    }

    endTurn(msg, kind) {
      if (msg) this.log(msg, kind);
      this.finishTurnFlags();
      if (this.s.phase !== 'dead') this.moveStalkers();
      if (this.s.phase !== 'dead') this.s.phase = 'roll';
    }

    die() {
      this.s.phase = 'dead';
      this.emit('death');
      this.s.move = null;
      this.log('You have fallen in the dungeon.', 'bad');
    }

    moveTo(x, y, jump) {
      const p = this.s.player, L = this.s.level;
      p.x = x; p.y = y;
      if (jump) L.trail.push([[x, y]]);
      else L.trail[L.trail.length - 1].push([x, y]);
      this.updateVision();
    }

    /* Advance the current move by one step. Returns an event for the UI:
     * step | teleport | redirect | fight | web | stairs | end | dead | idle | pick
     * With a move boost, the slide pauses (phase 'stopPrompt') on each square
     * where stopping is allowed. */
    step() {
      const ev = this.stepOnce(), s = this.s;
      if (s.phase === 'moving' && this.canStop()) s.phase = 'stopPrompt';
      return ev;
    }

    // Stopping early is allowed once the die's value has been moved.
    canStop() {
      const m = this.s.move;
      return !!(m && m.extra && m.stepsLeft > 0 && m.stepsLeft <= m.extra &&
        ['moving', 'stopPrompt', 'redirect'].includes(this.s.phase));
    }
    stopMove() {
      if (!this.canStop() || this.s.phase === 'moving') return false;
      this.endTurn('You stop here.');
      return true;
    }
    continueMove() {
      if (this.s.phase !== 'stopPrompt') return false;
      this.s.phase = 'moving';
      return true;
    }

    stepOnce() {
      const s = this.s, p = s.player, m = s.move, L = s.level;
      if (s.phase !== 'moving') return { type: 'idle' };
      if (m.stepsLeft <= 0) { this.endTurn(); return { type: 'end' }; }

      const lm = this.legalMove(m.dir, m.stepsLeft);
      if (!lm) {
        s.phase = 'redirect';
        if (!this.availableDirs().length) {
          this.endTurn(`Blocked with ${m.stepsLeft} move${m.stepsLeft > 1 ? 's' : ''} left and nowhere to go.`);
          return { type: 'end' };
        }
        this.emit('blocked');
        this.log(`Blocked! ${m.stepsLeft} move${m.stepsLeft > 1 ? 's' : ''} left: pick a new direction.`, 'warn');
        return { type: 'redirect' };
      }

      if (lm.kind === 'pick') {
        const door = this.obj(lm.x, lm.y);
        s.phase = 'pickPrompt';
        s.pickTarget = this.objIndex(door);
        return { type: 'pick', door };
      }

      if (lm.kind === 'noclip') {
        const [dx, dy] = DIRS[m.dir];
        for (let k = 1; k <= lm.walls; k++) this.moveTo(p.x + dx, p.y + dy);
        m.stepsLeft -= lm.walls;
        s.invis.wall = true; // the spell ends at the end of this turn
        this.emit('spell');
        this.log('Unseen, you slip straight through the wall!', 'spell');
      }

      m.stepsLeft -= 1;
      const o = this.obj(lm.x, lm.y);
      // A chest that is really a mimic: it ambushes you (Invisibility slips past
      // unnoticed, and it stays hidden).
      if (o && o.type === 'mimic' && !s.invis) return this.ambushMimic(o);
      // A fake locked door: touching it with a key wakes it (the key is kept).
      if (o && o.type === 'lock' && o.mimic) return this.ambushMimic(o);
      if (o && o.type === 'enemy') {
        if (s.invis) {
          this.log('You slip past an enemy unseen.', 'spell');
        } else {
          const r = this.encounter(o);
          if (r === 'dead') return { type: 'dead' };
          if (r === 'survived') { this.endTurn(); return { type: 'fight' }; }
        }
      } else if (o && o.type === 'lock') {
        this.clearObj(o);
        p.keys.splice(p.keys.indexOf(o.color), 1);
        this.emit('door');
        this.log(`Your ${o.color} key opens the door.`, 'good');
      }

      this.moveTo(lm.x, lm.y);
      this.emit('step');
      return this.onEnter(lm.x, lm.y);
    }

    onEnter(x, y) {
      const s = this.s, p = s.player, L = s.level, f = s.floor;
      if (x === L.stairs.x && y === L.stairs.y) { this.completeFloor(); return { type: 'stairs' }; }
      const o = this.obj(x, y);
      let ev = { type: 'step' };
      const sound = { coin: 'coin', chest: 'chest', darkchest: 'chest', body: 'ammo', lockpick: 'pickup', torch: 'torch',
        heart: 'heal', medpack: 'heal', key: 'key', web: 'web', portal: 'portal' };
      if (o && sound[o.type]) this.emit(sound[o.type]);
      if (o) {
        switch (o.type) {
          case 'coin': {
            const v = R.coinValue(f);
            this.gainCoins(v);
            this.clearObj(o);
            this.log(`+${v} coin${v > 1 ? 's' : ''}.`, 'good');
            break;
          }
          case 'chest': {
            const rolls = [];
            for (let i = 0; i < R.bonusDice(f); i++) rolls.push(this.d(6));
            const v = R.coinValue(f) + rolls.reduce((a, b) => a + b, 0);
            this.gainCoins(v);
            this.clearObj(o);
            this.log(`Treasure chest! ${R.coinValue(f)} + d6 [${rolls.join(', ')}] = ${v} coins.`, 'good');
            break;
          }
          case 'darkchest': {
            const rolls = [];
            for (let i = 0; i < R.bonusDice(f); i++) rolls.push(this.d(6));
            const v = R.coinValue(f) + rolls.reduce((a, b) => a + b, 0);
            const spell = SPELL_IDS[this.d(SPELL_IDS.length) - 1];
            this.gainCoins(v);
            this.clearObj(o);
            this.log(`Dark chest! ${v} coins and ${this.gainSpell(spell)}.`, 'good');
            break;
          }
          case 'body':
            this.clearObj(o);
            if (this.canUse('ammo')) {
              p.ammo += o.ammo;
              this.log(`You gather ${o.ammo} sling stone${o.ammo > 1 ? 's' : ''} from the body.`, 'good');
            } else {
              const v = o.ammo * R.STONE_COINS;
              this.gainCoins(v);
              this.log(`You sell the body's ${o.ammo} stone${o.ammo > 1 ? 's' : ''} for ${v} coin${v > 1 ? 's' : ''}.`, 'good');
            }
            break;
          case 'lockpick':
            p.lockpicks++;
            this.clearObj(o);
            this.log('You found a lock pick.', 'good');
            break;
          case 'torch':
            this.clearObj(o);
            L.torchLit = true;
            this.log('You found a torch and light it. It burns until you leave this floor.', 'good');
            this.updateVision();
            break;
          case 'heart': {
            const v = this.heal(R.heartValue(f));
            this.clearObj(o);
            this.log(`A heart restores ${v} health.`, 'good');
            break;
          }
          case 'medpack': {
            const rolls = [];
            for (let i = 0; i < R.bonusDice(f); i++) rolls.push(this.d(4));
            const amt = R.heartValue(f) + rolls.reduce((a, b) => a + b, 0);
            const v = this.heal(amt);
            this.clearObj(o);
            this.log(`Med pack: ${R.heartValue(f)} + d4 [${rolls.join(', ')}] = ${amt}, restored ${v} health.`, 'good');
            break;
          }
          case 'key':
            p.keys.push(o.color);
            this.clearObj(o);
            this.log(`You found the ${o.color} key.`, 'good');
            break;
          case 'web':
            this.clearObj(o);
            p.webbed = true;
            this.endTurn('Caught in a spider web! Movement stops, and your next move is halved.', 'status');
            return { type: 'web' };
          case 'portal': {
            const pair = L.objects[o.pair];
            this.moveTo(pair.x, pair.y, true);
            this.log('The portal whisks you away!', 'spell');
            ev = { type: 'teleport' };
            break;
          }
        }
      }
      if (s.move.stepsLeft <= 0) { this.endTurn(); return ev.type === 'teleport' ? ev : { type: 'end' }; }
      return ev;
    }

    // ----------------------------------------------------------------- combat
    /* One melee exchange with an enemy (you walking into it, or a stalker
     * reaching you): it deals floor damage, you strike back with STR.
     * Returns 'killed', 'survived' or 'dead'. */
    encounter(o) {
      const s = this.s, p = s.player;
      const dmg = R.enemyDamage(s.floor);
      const name = o.stalker ? 'stalker' : 'enemy';
      p.hp = Math.max(0, p.hp - dmg);
      o.hp -= p.str;
      this.emit('hurt');
      this.emit(o.hp <= 0 ? 'kill' : 'hit');
      if (o.hp <= 0) {
        this.killEnemy(o, true);
        this.log(`You take ${dmg} damage and slay the ${name}!`, 'fight');
      } else {
        this.log(`You take ${dmg} damage and wound the ${name} (${o.hp}/${o.maxHp} left).`, 'fight');
      }
      if (p.hp <= 0) { this.die(); return 'dead'; }
      return o.hp <= 0 ? 'killed' : 'survived';
    }

    // Removes a dead enemy; melee and sling kills leave a body with 1-2 ammo.
    killEnemy(o, dropBody) {
      const L = this.s.level;
      this.clearObj(o);
      this.countKill(o);
      if (o.mimic) this.mimicReward(o);
      if (!dropBody) return;
      const body = { type: 'body', x: o.x, y: o.y, ammo: this.d(2) };
      L.objects.push(body);
      this.objAt[o.y * L.w + o.x] = L.objects.length - 1;
    }

    // ----------------------------------------------------------------- mimics
    /* A mimic (chest or fake door) wakes up: d20 + DEX against MIMIC_DODGE
     * decides whether its bite does normal or double damage. It then becomes
     * a 2x-health enemy on the same square, and your move stops. */
    ambushMimic(o) {
      const s = this.s, p = s.player, f = s.floor;
      const kind = o.type === 'mimic' ? 'chest' : 'door';
      const roll = this.d(20), total = roll + p.dex, dodged = total >= R.MIMIC_DODGE;
      const dmg = R.enemyDamage(f) * (dodged ? 1 : 2);
      const hp = 2 * R.enemyHealth(f);
      p.hp = Math.max(0, p.hp - dmg);
      Object.assign(o, { type: 'enemy', mimic: kind, hp, maxHp: hp });
      this.lastMimic = { x: o.x, y: o.y, kind, color: o.color, dodged, dmg };
      s.pickTarget = -1;
      this.emit('mimic');
      this.emit('hurt');
      this.log(`It's a mimic! The ${kind === 'chest' ? 'chest' : o.color + ' door'} lunges at you. ` +
        `DEX ${roll} + ${p.dex} = ${total} (needed ${R.MIMIC_DODGE}): ${dodged ? 'you twist away' : 'it bites deep'}, ${dmg} damage.`, 'fight');
      if (p.hp <= 0) { this.die(); return { type: 'dead' }; }
      this.updateVision();
      this.endTurn();
      return { type: 'fight', mimic: kind };
    }

    // Killing a mimic: twice a chest's coins plus a random spell.
    mimicReward(o) {
      const s = this.s, f = s.floor;
      const rolls = [];
      for (let i = 0; i < R.bonusDice(f); i++) rolls.push(this.d(6));
      const v = 2 * (R.coinValue(f) + rolls.reduce((a, b) => a + b, 0));
      const spell = SPELL_IDS[this.d(SPELL_IDS.length) - 1];
      this.gainCoins(v);
      this.emit('chest');
      this.log(`The mimic's hoard: ${v} coins and ${this.gainSpell(spell)}!`, 'good');
    }

    // ---------------------------------------------------------- class & level
    countKill(o) {
      const s = this.s;
      s.stats.kills++;
      // Where the last kill happened (for the UI's effects; not saved).
      if (o) this.lastKill = { x: o.x, y: o.y, kind: o.mimic ? 'mimic' : o.stalker ? 'stalker' : 'enemy' };
      if (R.levelForKills(s.stats.kills) > R.levelForKills(s.stats.kills - 1)) {
        this.emit('levelUp');
        this.log(s.player.cls ? 'Level up! Choose a boon.' : 'You feel stronger. Time to choose your path!', 'good');
      }
    }
    // Levels earned by kills but not yet chosen. Rolling waits until they are.
    levelsOwed() {
      return Math.max(0, R.levelForKills(this.s.stats.kills) - this.s.player.level);
    }
    // Can the current class use this kind of loot? The base hero keeps
    // everything for later; a class sells what it can't use.
    canUse(kind) {
      const c = this.s.player.cls;
      if (!c) return true;
      if (kind === 'ammo') return c === 'rogue';
      return true; // everyone keeps spell charges
    }
    gainSpell(spell) {
      this.s.player.spells[spell]++;
      return `a ${SPELLS[spell].name} charge`;
    }
    // Turn anything the new class can't use into coins.
    sellUnusable() {
      const s = this.s, p = s.player;
      let v = 0;
      if (!this.canUse('ammo') && p.ammo) { v += p.ammo * R.STONE_COINS; p.ammo = 0; }
      if (v) { this.gainCoins(v); this.log(`You sell gear your class can't use for ${v} coins.`, 'good'); }
    }

    chooseClass(cls, spell) {
      const s = this.s, p = s.player, C = R.CLASSES[cls];
      if (p.cls || !C || this.levelsOwed() < 1) return false;
      if (cls === 'wizard' && !SPELLS[spell]) return false;
      p.cls = cls; p.level = 1;
      p.maxHp += C.hp; p.hp += C.hp;
      p.dex += C.dex;
      p.ammo += C.ammo;
      if (cls === 'wizard') { p.known[spell] = 1; p.casts = R.wizardSlots(1); }
      this.sellUnusable();
      this.emit('classChosen');
      this.log(`You are now a ${C.name}!`, 'good');
      return true;
    }

    boonChoices() {
      const p = this.s.player, c = p.cls;
      if (!c) return [];
      // Spellcraft drops out once every spell is at the top level.
      return R.CLASSES[c].boons.filter((id) => id !== 'spell' || SPELL_IDS.some((k) => p.known[k] < R.SPELL_MAX));
    }

    chooseBoon(id, spell) {
      const s = this.s, p = s.player;
      if (!p.cls || this.levelsOwed() < 1 || !this.boonChoices().includes(id)) return false;
      if (id === 'spell' && !(SPELLS[spell] && p.known[spell] < R.SPELL_MAX)) return false;
      const gain = R.CLASSES[p.cls].levelHp;
      p.level++;
      if (p.cls === 'wizard') p.casts += R.wizardSlots(p.level) - R.wizardSlots(p.level - 1); // a new slot is ready at once
      p.maxHp += gain; p.hp = Math.min(p.maxHp, p.hp + gain);
      switch (id) {
        case 'hp': p.maxHp += R.BOON_HP; p.hp += R.BOON_HP; break;
        case 'str': p.str++; break;
        case 'spell': p.known[spell]++; break;
        case 'range': p.range++; break;
        case 'move': p.moveBoost++; break;
      }
      const what = id === 'spell' ? (p.known[spell] === 1 ? `learned ${SPELLS[spell].name}` : `${SPELLS[spell].name} level ${p.known[spell]}`) : BOONS[id].name.toLowerCase();
      this.log(`Level ${p.level}! Max health +${gain}, ${what}.`, 'good');
      return true;
    }

    // ------------------------------------------------------------------ sling
    // Rogues shoot sling stones; Wizards cast an unlimited magic missile.
    hasRanged() {
      const p = this.s.player;
      return p.cls === 'wizard' || (p.cls === 'rogue' && p.ammo > 0);
    }
    canShoot() {
      const s = this.s;
      return !!(s.level && s.phase === 'choose' && s.die !== null && this.hasRanged());
    }
    // Range boost: any visible enemy within `range` steps (|dx| + |dy|) with a
    // clear line of sight can be shot directly, whatever the dice say.
    freeTargets() {
      const s = this.s, p = s.player, L = s.level;
      if (!L || s.phase !== 'choose' || !p.range || !this.hasRanged()) return [];
      return L.objects.map((o, i) => i).filter((i) => {
        const o = L.objects[i];
        return o.type === 'enemy' && !o.done && Math.abs(o.x - p.x) + Math.abs(o.y - p.y) <= p.range &&
          this.isVisible(o.x, o.y) && this.lineOfSight(p.x, p.y, o.x, o.y);
      });
    }
    shootAt(index) {
      if (!this.freeTargets().includes(index)) return null;
      const t = this.s.level.objects[index], p = this.s.player;
      return this.fire([[t.x, t.y]], t, [p.x, p.y]);
    }

    // Directions of the roll's type with at least one open square to fly through.
    shotDirs() {
      if (!this.canShoot()) return [];
      return (this.s.parity === 'ortho' ? ORTHO : DIAG).filter((d) => this.shotPath(d).cells.length > 0);
    }

    /* Squares a shot crosses: up to the chosen die, stopping before walls and
     * locked doors, and at the first enemy. */
    shotPath(dir) {
      const s = this.s, [dx, dy] = DIRS[dir];
      let { x, y } = s.player;
      const cells = [];
      let target = null;
      for (let k = 0; k < s.steps; k++) {
        const nx = x + dx, ny = y + dy;
        if (this.isSolid(nx, ny)) break;
        if (dx && dy && this.isSolid(x + dx, y) && this.isSolid(x, y + dy)) break;
        x = nx; y = ny;
        cells.push([x, y]);
        const o = this.obj(x, y);
        if (o && o.type === 'enemy') { target = o; break; }
      }
      return { cells, target };
    }

    // Shoot instead of moving: 1 damage to the first enemy in line; ends the turn.
    shoot(dir) {
      if (!this.shotDirs().includes(dir)) return null;
      const { cells, target } = this.shotPath(dir);
      return this.fire(cells, target);
    }

    fire(cells, target, from) {
      const s = this.s, p = s.player, wizard = p.cls === 'wizard';
      const what = wizard ? 'magic missile' : 'sling stone';
      if (!wizard) p.ammo--;
      this.emit('shoot');
      this.emit(!target ? 'miss' : target.hp <= 1 ? 'kill' : 'hit');
      if (target) {
        target.hp -= 1;
        const name = target.mimic ? 'mimic' : target.stalker ? 'stalker' : 'enemy';
        if (target.hp <= 0) { this.killEnemy(target, true); this.log(`Your ${what} fells the ${name}!`, 'fight'); }
        else this.log(`Your ${what} hits the ${name} (${target.hp}/${target.maxHp} left).`, 'fight');
      } else {
        this.log(wizard ? 'Your magic missile fizzles against the wall.' : 'Your sling stone clatters off the wall.', 'info');
      }
      this.endTurn();
      return { cells, hit: !!target, from: from || null };
    }

    // --------------------------------------------------------------- stalkers
    // A stalker notices you by line of sight; on dark floors only within 2
    // squares, unless your torch is lit (then from any distance).
    stalkerSees(o) {
      const s = this.s, L = s.level, p = s.player;
      const dist = Math.max(Math.abs(o.x - p.x), Math.abs(o.y - p.y));
      if (s.invis) return false; // invisible: enemies can't see you
      if (L.dark && !this.isLit() && dist > 2) return false;
      return this.lineOfSight(o.x, o.y, p.x, p.y);
    }

    // After each turn, every stalker that notices you moves 1 square closer,
    // or attacks if it is already next to you.
    moveStalkers() {
      const s = this.s, L = s.level, p = s.player;
      if (!L || !this.objAt) return;
      const stalkers = L.objects.filter((o) => o.type === 'enemy' && o.stalker && !o.done);
      for (const o of stalkers) {
        if (s.phase === 'dead' || o.done || !this.stalkerSees(o)) continue;
        const cheb = (x, y) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
        const man = (x, y) => Math.abs(x - p.x) + Math.abs(y - p.y);
        let best = null, bestKey = [cheb(o.x, o.y), man(o.x, o.y), 2];
        for (const d of ORTHO.concat(DIAG)) {
          const [dx, dy] = DIRS[d];
          const nx = o.x + dx, ny = o.y + dy;
          if (dx && dy && this.isSolid(o.x + dx, o.y) && this.isSolid(o.x, o.y + dy)) continue;
          if (nx === p.x && ny === p.y) { best = { attack: true }; break; }
          if (!this.inB(nx, ny) || this.tile(nx, ny) === 0 || this.obj(nx, ny)) continue;
          const key = [cheb(nx, ny), man(nx, ny), dx && dy ? 1 : 0];
          if (key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
            best = { x: nx, y: ny }; bestKey = key;
          }
        }
        if (!best) continue;
        if (best.attack) {
          this.log('A stalker lunges at you!', 'fight');
          this.encounter(o);
        } else {
          const i = this.objIndex(o);
          this.objAt[o.y * L.w + o.x] = -1;
          o.x = best.x; o.y = best.y;
          this.emit('stalker');
          this.objAt[o.y * L.w + o.x] = i;
        }
      }
    }

    // -------------------------------------------------------------- lock pick
    pickDoor() {
      const s = this.s;
      return s.phase === 'pickPrompt' && s.pickTarget >= 0 ? s.level.objects[s.pickTarget] : null;
    }

    // Roll d20 + DEX against the door's target. Either way the pick is used up.
    pickLock() {
      const s = this.s, p = s.player, door = this.pickDoor();
      if (!door) return null;
      // A fake door wakes as soon as the pick touches it (the pick survives).
      if (door.mimic) return Object.assign({ ok: false, mimic: true }, this.ambushMimic(door));
      const roll = this.d(20), total = roll + p.dex, target = R.LOCK_TARGET[door.color];
      p.lockpicks--;
      s.pickTarget = -1;
      if (total >= target) {
        this.clearObj(door);
        this.emit('pickOk');
        this.log(`Lock pick: ${roll} + ${p.dex} DEX = ${total} (needed ${target}). The ${door.color} door clicks open!`, 'good');
        this.updateVision();
        s.phase = 'moving';
        return { ok: true, roll, total, target };
      }
      this.emit('pickFail');
      this.log(`Lock pick: ${roll} + ${p.dex} DEX = ${total} (needed ${target}). The pick snaps.`, 'status');
      this.endTurn();
      return { ok: false, roll, total, target };
    }

    // Leave the door alone: it counts as solid for the rest of this turn.
    declinePick() {
      const s = this.s, door = this.pickDoor();
      if (!door) return false;
      s.declinedPicks.push(door.y * s.level.w + door.x);
      s.pickTarget = -1;
      s.phase = 'moving';
      return true;
    }

    gainCoins(v) { this.s.player.coins += v; this.s.stats.coins += v; }
    heal(n) {
      const p = this.s.player;
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + n);
      return p.hp - before;
    }

    // ----------------------------------------------------------------- spells
    /* Wizards cast any known spell at its level, using one of their casts for
     * this floor. Everyone else casts at level 1 by spending 3 charges. */
    castLevel(name) {
      const p = this.s.player;
      return p.cls === 'wizard' ? p.known[name] : 1;
    }
    canAfford(name) {
      const p = this.s.player;
      if (p.cls === 'wizard') return p.known[name] > 0 && p.casts > 0;
      return p.spells[name] >= R.CHARGES_PER_CAST;
    }
    wallWalk() {
      return !!(this.s.invis && this.s.invis.level >= R.SPELL_MAX && !this.s.invis.wall);
    }

    canCast(name) {
      const s = this.s, L = s.level;
      if (!L || !SPELLS[name] || !this.canAfford(name)) return false;
      switch (name) {
        case 'invis': return !s.invis && ['roll', 'choose', 'redirect'].includes(s.phase);
        case 'reroll': return s.phase === 'choose' && !!s.dice && !s.rerolls;
        // Only where it helps: a dark floor, and stronger than any orb already cast.
        case 'orb': return !!L.dark && ['roll', 'choose', 'redirect'].includes(s.phase) && this.castLevel(name) > (L.orbLevel || 0);
      }
      return false;
    }

    cast(name) {
      if (!this.canCast(name)) return false;
      const s = this.s, p = s.player, L = s.level, lv = this.castLevel(name);
      if (p.cls === 'wizard') p.casts--; else p.spells[name] -= R.CHARGES_PER_CAST;
      const tag = `${SPELLS[name].name}${p.cls === 'wizard' ? ` (level ${lv})` : ''}`;
      if (name === 'invis') {
        s.invis = { turns: lv >= R.SPELL_MAX ? 5 : lv, level: lv, wall: false };
        this.log(`${tag}: you fade from sight for ${s.invis.turns} turn${s.invis.turns > 1 ? 's' : ''}${lv >= R.SPELL_MAX ? ", and walls can't hold you" : ''}.`, 'spell');
      } else if (name === 'reroll') {
        s.rerolls = { left: lv >= R.SPELL_MAX ? 1 : lv, choose: lv >= R.SPELL_MAX };
        this.log(`${tag}: ${s.rerolls.choose ? "choose a die's value" : `${s.rerolls.left} re-roll${s.rerolls.left > 1 ? 's' : ''}`}.`, 'spell');
      } else if (name === 'orb') {
        L.orbLevel = lv;
        L.orbRadius = R.orbRadius(lv);
        if (lv >= R.SPELL_MAX) { L.floodTurns = R.ORB_FLOOD_TURNS; L.enemyMemory = true; }
        this.emit('orb');
        this.log(`${tag}: ${lv >= R.SPELL_MAX ? 'light floods the whole floor!' : `light reaches ${L.orbRadius} squares.`}`, 'spell');
        this.updateVision();
      }
      this.emit('spell');
      return true;
    }

    // Re-roll attempts (after casting Re-roll).
    rerollDie(i) {
      const s = this.s, r = s.rerolls;
      if (s.phase !== 'choose' || !r || r.choose || r.left < 1 || (i !== 0 && i !== 1)) return false;
      const old = s.dice[i];
      s.dice[i] = this.d(6);
      r.left--;
      this.computeSteps();
      this.emit('roll');
      this.log(`Re-roll: die ${i + 1} ${old} → ${s.dice[i]}.${this.dieSummary()}`, 'spell');
      return true;
    }
    // Level 5 Re-roll: choose a die's value.
    setDie(i, v) {
      const s = this.s, r = s.rerolls;
      if (s.phase !== 'choose' || !r || !r.choose || r.left < 1 || (i !== 0 && i !== 1) || !(Number.isInteger(v) && v >= 1 && v <= 6)) return false;
      s.dice[i] = v;
      r.left--;
      this.computeSteps();
      this.emit('spell');
      this.log(`Re-roll: you set die ${i + 1} to ${v}.${this.dieSummary()}`, 'spell');
      return true;
    }

    dieSummary() {
      const s = this.s;
      return s.die === null ? ' Pick a die.' : ` Using ${s.dice[s.die]}: move ${s.steps}, ${s.parity === 'ortho' ? 'orthogonal' : 'diagonal'}.`;
    }

    // A Wizard spends 5n charges of a known spell to raise it to level n.
    upgradeCost(name) {
      return R.upgradeCost(this.s.player.known[name] + 1);
    }
    canUpgrade(name) {
      const s = this.s, p = s.player;
      return !!(p.cls === 'wizard' && SPELLS[name] && p.known[name] > 0 && p.known[name] < R.SPELL_MAX &&
        p.spells[name] >= this.upgradeCost(name) && ['roll', 'levelDone', 'shop'].includes(s.phase));
    }
    upgradeSpell(name) {
      if (!this.canUpgrade(name)) return false;
      const p = this.s.player, cost = this.upgradeCost(name);
      p.spells[name] -= cost;
      p.known[name]++;
      this.emit('spellUp');
      this.log(`You study ${cost} ${SPELLS[name].name} charges: ${SPELLS[name].name} is now level ${p.known[name]}.`, 'spell');
      return true;
    }

    // ------------------------------------------------------------------- shop
    makeShop(f) {
      const rng = new RNG(seedFor(this.s.seed, 'shop', f));
      // Only offers the current class can use (no spells unless Wizard, no
      // stones unless Rogue).
      const cls = this.s.player.cls;
      const pool = SHOP_POOL.filter((id) => id !== 'ammo' || cls === 'rogue');
      const random = rng.shuffle(pool).slice(0, 4);
      return { floor: f, items: [...SHOP_FIXED, ...random].map((id) => ({ id, sold: false })), lastGamble: null };
    }

    price(id) {
      const s = this.s, p = s.player, t = Math.floor(s.floor / 10);
      switch (id) {
        case 'heal': return p.hp >= p.maxHp ? 0 : 2 + Math.ceil((p.maxHp - p.hp) / 2) + t;
        case 'str': return 8 + 4 * (p.str - R.START_STR) + 2 * t;
        case 'maxhp': return 6 + 2 * t;
        case 'torch': return 4 + t;
        case 'dex': return 8 + 4 * (p.dex - 1) + 2 * t;
        case 'ammo': return 3 + t;
        case 'lockpick': return 4 + t;
      }
      return 0;
    }

    canBuy(i) {
      const s = this.s;
      if (s.phase !== 'shop') return false;
      const it = s.shop.items[i];
      if (!it || it.sold || it.id === 'gamble') return false;
      if (it.id === 'heal' && s.player.hp >= s.player.maxHp) return false;
      return s.player.coins >= this.price(it.id);
    }

    buy(i) {
      if (!this.canBuy(i)) return false;
      const s = this.s, p = s.player, it = s.shop.items[i];
      const cost = this.price(it.id);
      p.coins -= cost;
      this.emit('buy');
      switch (it.id) {
        case 'heal': p.hp = p.maxHp; this.log(`Healed to full for ${cost} coins.`, 'shop'); break;
        case 'str': p.str++; this.log(`Strength increased to ${p.str}.`, 'shop'); break;
        case 'maxhp': p.maxHp += 2; p.hp += 2; it.sold = true; this.log('Max health +2.', 'shop'); break;
        case 'torch': p.torches++; it.sold = true; this.log('Bought a torch. Light it on a dark floor.', 'shop'); break;
        case 'dex': p.dex++; this.log(`Dexterity increased to ${p.dex}.`, 'shop'); break;
        case 'ammo': p.ammo += 3; it.sold = true; this.log('Bought 3 sling stones.', 'shop'); break;
        case 'lockpick': p.lockpicks++; it.sold = true; this.log('Bought a lock pick.', 'shop'); break;
      }
      return true;
    }

    // 1-2 lose the wager, 3-4 money back, 5 money back +2, 6 money back + 2x wager.
    gamble(wager) {
      const s = this.s, p = s.player;
      wager = Math.floor(wager);
      if (s.phase !== 'shop' || !s.shop.items.some((it) => it.id === 'gamble')) return null;
      if (!(wager >= 1 && wager <= p.coins)) return null;
      const roll = this.d(6);
      let delta, text;
      if (roll <= 2) { delta = -wager; text = 'You lose your wager.'; }
      else if (roll <= 4) { delta = 0; text = 'Your money back.'; }
      else if (roll === 5) { delta = 2; text = 'Money back, plus 2!'; }
      else { delta = 2 * wager; text = 'You win double! Money back plus 2× your bet.'; }
      p.coins += delta;
      if (delta > 0) s.stats.coins += delta;
      s.shop.lastGamble = { roll, wager, delta, text };
      this.emit(delta > 0 ? 'gambleWin' : delta < 0 ? 'gambleLose' : 'roll');
      this.log(`Gamble ${wager}: rolled ${roll}. ${text}`, 'shop');
      return s.shop.lastGamble;
    }
  }

  DC.Game = Game;
  DC.DIRS = DIRS;
  DC.OPP = OPP;
  DC.ORTHO = ORTHO;
  DC.DIAG = DIAG;
  DC.SPELLS = SPELLS;
  DC.SPELL_IDS = SPELL_IDS;
  DC.BOONS = BOONS;
  DC.CLASS_IDS = CLASS_IDS;
})(typeof window !== 'undefined' ? window : globalThis);
