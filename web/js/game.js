/* Game state and rules engine. Pure logic, no DOM: the UI drives it and
 * renders `game.s`, which is plain JSON so it can be saved and restored.
 *
 * Phases: roll -> choose -> moving <-> redirect -> roll ...
 *         plus levelDone, shop and dead.
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

  const SPELLS = {
    noclip: { name: 'No Clipping', desc: 'Arm before or during a move: walk straight through a wall if this move carries you all the way through it.' },
    fireball: { name: 'Fireball', desc: 'Destroy one obstacle on the floor: a web, an enemy or a locked door.' },
    luck: { name: "Dark One's Luck", desc: 'After rolling, set both dice to any values you like.' },
    reroll: { name: 'Re-roll', desc: 'After rolling, re-roll one of the two dice.' },
    invis: { name: 'Invisibility', desc: 'Arm for one turn: pass through enemies without encountering them.' },
  };
  const SHOP_POOL = ['maxhp', 'gamble', 'noclip', 'fireball', 'luck', 'reroll', 'invis', 'torch', 'ammo', 'lockpick'];
  const SHOP_FIXED = ['heal', 'str', 'dex'];
  const CHECKPOINT_VERSION = 2;

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
        turn: 0,
        phase: 'roll',
        player: {
          x: 0, y: 0, hp: R.START_HP, maxHp: R.START_HP, str: R.START_STR, coins: 0,
          keys: [], webbed: false, torches: 0,
          ammo: R.START_AMMO, dex: 1, lockpicks: 0,
          spells: { noclip: 0, fireball: 0, luck: 0, reroll: 0, invis: 0 },
        },
        diceState: 0,
        dice: null, steps: 0, parity: null, halved: false,
        usedDirs: [], move: null,
        armed: { noclip: false, invis: false }, invisUsed: false,
        declinedPicks: [], pickTarget: -1,
        level: null, shop: null,
        log: [], logSeq: 0,
        stats: { kills: 0, coins: 0, floorsCleared: 0 },
        floorStartTurn: 0,
        checkpoint: null,
      };
    }

    // opts.startFloor (e.g. 4) skips the tutorial floors.
    static create(seedText, opts) {
      seedText = String(seedText || '').trim() || randomSeedText();
      const g = new Game(Game.newState(seedText));
      g.log(`A new descent begins. Seed "${seedText}".`);
      const start = opts && Number.isInteger(opts.startFloor) && opts.startFloor > 1 ? opts.startFloor : 1;
      if (start > 1) g.log('Skipped the tutorial.');
      g.enterFloor(start);
      return g;
    }

    /* ---- Saves ----
     * A save is a checkpoint: the seed, the floor to start, and what carries
     * between floors. The floor itself (map, items, dice) is rebuilt from the
     * seed, so loading always starts a floor fresh. */
    checkpointFor(floor) {
      const s = this.s, p = s.player;
      return {
        v: CHECKPOINT_VERSION,
        seedText: s.seedText,
        floor,
        player: {
          hp: p.hp, maxHp: p.maxHp, str: p.str, coins: p.coins, torches: p.torches,
          ammo: p.ammo, dex: p.dex, lockpicks: p.lockpicks, spells: Object.assign({}, p.spells),
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
      if (cp.v !== CHECKPOINT_VERSION) return 'unsupported save version';
      if (typeof cp.seedText !== 'string' || !cp.seedText.trim() || cp.seedText.length > 100) return 'bad seed';
      if (!int(cp.floor, 1, 100000)) return 'bad floor';
      const p = cp.player;
      if (!obj(p) || !int(p.maxHp, 1, 100000) || !int(p.hp, 1, p.maxHp) || !int(p.str, 0, 100000) || !int(p.coins, 0, 1e9)) return 'bad player stats';
      if (!obj(p.spells) || !Object.keys(SPELLS).every((k) => int(p.spells[k], 0, 10000))) return 'bad spells';
      // Optional fields: older saves don't have them and get defaults.
      if (p.torches !== undefined && !int(p.torches, 0, 10000)) return 'bad torches';
      if (p.ammo !== undefined && !int(p.ammo, 0, 10000)) return 'bad ammo';
      if (p.dex !== undefined && !int(p.dex, 0, 1000)) return 'bad dexterity';
      if (p.lockpicks !== undefined && !int(p.lockpicks, 0, 10000)) return 'bad lock picks';
      if (cp.stats !== undefined && !(obj(cp.stats) && ['kills', 'coins', 'floorsCleared'].every((k) => int(cp.stats[k], 0, 1e9)))) return 'bad stats';
      if (cp.turn !== undefined && !int(cp.turn, 0, 1e9)) return 'bad turn';
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
          v: CHECKPOINT_VERSION, seedText: data.seedText,
          floor: data.phase === 'levelDone' ? data.floor + 1 : data.floor,
          player: { hp: p.hp, maxHp: p.maxHp, str: p.str, coins: p.coins, spells: p.spells },
          stats: data.stats, turn: data.turn,
        };
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
      });
      for (const k of Object.keys(SPELLS)) p.spells[k] = cp.player.spells[k];
      if (cp.stats) Object.assign(s.stats, { kills: cp.stats.kills, coins: cp.stats.coins, floorsCleared: cp.stats.floorsCleared });
      s.turn = cp.turn || 0;
      g.log(`Resumed seed "${s.seedText}" at floor ${cp.floor}.`);
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

      if (this.s.armed.noclip) {
        let k = 0, cx = nx, cy = ny;
        while (this.inB(cx, cy) && this.isSolid(cx, cy)) { k++; cx += dx; cy += dy; }
        if (k >= 1 && this.inB(cx, cy) && stepsLeft >= k + 1) {
          const o = this.obj(cx, cy);
          if (!(o && o.type === 'enemy' && !this.s.armed.invis)) return { kind: 'noclip', x: cx, y: cy, walls: k };
        }
      }
      return null;
    }

    stepsLeft() {
      return this.s.phase === 'redirect' || this.s.phase === 'moving' ? this.s.move.stepsLeft : this.s.steps;
    }

    // Directions the player may pick right now.
    availableDirs() {
      const s = this.s;
      if (s.phase !== 'choose' && s.phase !== 'redirect') return [];
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
      s.dice = null; s.move = null; s.usedDirs = []; s.halved = false;
      s.armed = { noclip: false, invis: false }; s.invisUsed = false;
      s.declinedPicks = []; s.pickTarget = -1;
      p.keys = []; p.webbed = false;
      s.floorStartTurn = s.turn;
      // Dice restart per floor, so a floor replays identically from its checkpoint.
      s.diceState = seedFor(s.seedText, 'dice', f);
      s.checkpoint = this.checkpointFor(f);
      if (R.isShopFloor(s.seed, f)) {
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
     * TORCH_RADIUS (Chebyshev) with a clear line of sight once a torch is lit.
     * Seen squares are remembered in level.seen; how much of that memory is
     * drawn depends on rules.darkMemory(floor). */
    updateVision() {
      const L = this.s.level;
      this.vis = null;
      if (!L || !L.dark) return;
      if (!Array.isArray(L.seen) || L.seen.length !== L.w * L.h) L.seen = new Array(L.w * L.h).fill(0);
      const p = this.s.player;
      const r = L.torchLit ? R.TORCH_RADIUS : 1;
      const vis = new Set();
      for (let y = Math.max(0, p.y - r); y <= Math.min(L.h - 1, p.y + r); y++) {
        for (let x = Math.max(0, p.x - r); x <= Math.min(L.w - 1, p.x + r); x++) {
          if (r === 1 || this.lineOfSight(p.x, p.y, x, y)) vis.add(y * L.w + x);
        }
      }
      for (const i of vis) L.seen[i] = 1;
      if (vis.has(L.stairs.y * L.w + L.stairs.x)) L.seenStairs = true;
      for (const o of L.objects) if (vis.has(o.y * L.w + o.x)) o.seen = true;
      this.vis = vis;
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
      s.summary = { floor: s.floor, turns: s.turn - s.floorStartTurn, next: s.floor + 1, nextIsShop: R.isShopFloor(s.seed, s.floor + 1) };
      s.checkpoint = this.checkpointFor(s.floor + 1);
      this.log(`You descend the stairs of floor ${s.floor}!`, 'floor');
    }

    nextFloor() {
      if (this.s.phase !== 'levelDone' && this.s.phase !== 'shop') return false;
      this.enterFloor(this.s.floor + 1);
      return true;
    }

    // ------------------------------------------------------------------ turns
    computeSteps() {
      const s = this.s;
      const total = s.dice[0] + s.dice[1];
      s.parity = total % 2 === 0 ? 'ortho' : 'diag';
      s.steps = s.halved ? Math.max(1, Math.floor(total / 2)) : total;
    }

    roll() {
      const s = this.s, p = s.player;
      if (s.phase !== 'roll') return false;
      s.dice = [this.d(6), this.d(6)];
      this.emit('roll');
      s.halved = p.webbed;
      p.webbed = false;
      s.usedDirs = [];
      this.computeSteps();
      s.phase = 'choose';
      const t = s.dice[0] + s.dice[1];
      this.log(`Rolled ${s.dice[0]} + ${s.dice[1]} = ${t} (${s.parity === 'ortho' ? 'orthogonal' : 'diagonal'})` +
        (s.halved ? `, halved by the web to ${s.steps}` : '') + '.', 'roll');
      return true;
    }

    choose(dir) {
      const s = this.s;
      if (!this.availableDirs().includes(dir)) return false;
      if (s.phase === 'choose') s.move = { stepsLeft: s.steps, dir };
      else s.move.dir = dir;
      s.usedDirs.push(dir);
      s.phase = 'moving';
      return true;
    }

    passTurn() {
      if (this.s.phase !== 'choose' || this.availableDirs().length) return false;
      this.endTurn('No legal move. The turn passes.');
      return true;
    }

    finishTurnFlags() {
      const s = this.s;
      if (s.invisUsed) { s.player.spells.invis--; this.log('Your invisibility fades.', 'spell'); }
      s.armed = { noclip: false, invis: false };
      s.invisUsed = false;
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
     * step | teleport | redirect | fight | web | stairs | end | dead | idle */
    step() {
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
        s.armed.noclip = false;
        p.spells.noclip--;
        this.emit('spell');
        this.log('You phase straight through the wall!', 'spell');
      }

      m.stepsLeft -= 1;
      const o = this.obj(lm.x, lm.y);
      if (o && o.type === 'enemy') {
        if (s.armed.invis) {
          s.invisUsed = true;
          this.emit('spell');
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
            const kinds = Object.keys(SPELLS);
            const spell = kinds[this.d(kinds.length) - 1];
            this.gainCoins(v);
            p.spells[spell]++;
            this.clearObj(o);
            this.log(`Dark chest! ${v} coins and a ${SPELLS[spell].name} spell.`, 'good');
            break;
          }
          case 'body':
            p.ammo += o.ammo;
            this.clearObj(o);
            this.log(`You gather ${o.ammo} sling stone${o.ammo > 1 ? 's' : ''} from the body.`, 'good');
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
      this.s.stats.kills++;
      if (!dropBody) return;
      const body = { type: 'body', x: o.x, y: o.y, ammo: this.d(2) };
      L.objects.push(body);
      this.objAt[o.y * L.w + o.x] = L.objects.length - 1;
    }

    // ------------------------------------------------------------------ sling
    canShoot() {
      const s = this.s;
      return !!(s.level && s.phase === 'choose' && s.player.ammo > 0);
    }

    // Directions of the roll's type with at least one open square to fly through.
    shotDirs() {
      if (!this.canShoot()) return [];
      return (this.s.parity === 'ortho' ? ORTHO : DIAG).filter((d) => this.shotPath(d).cells.length > 0);
    }

    /* Squares a shot crosses: up to the move total, stopping before walls and
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
      const s = this.s, p = s.player;
      if (!this.shotDirs().includes(dir)) return null;
      const { cells, target } = this.shotPath(dir);
      p.ammo--;
      this.emit('shoot');
      this.emit(!target ? 'miss' : target.hp <= 1 ? 'kill' : 'hit');
      if (target) {
        target.hp -= 1;
        const name = target.stalker ? 'stalker' : 'enemy';
        if (target.hp <= 0) { this.killEnemy(target, true); this.log(`Your sling stone fells the ${name}!`, 'fight'); }
        else this.log(`Your sling stone hits the ${name} (${target.hp}/${target.maxHp} left).`, 'fight');
      } else {
        this.log('Your sling stone clatters off the wall.', 'info');
      }
      this.endTurn();
      return { cells, hit: !!target };
    }

    // --------------------------------------------------------------- stalkers
    // A stalker notices you by line of sight; on dark floors only within 2
    // squares, unless your torch is lit (then from any distance).
    stalkerSees(o) {
      const s = this.s, L = s.level, p = s.player;
      const dist = Math.max(Math.abs(o.x - p.x), Math.abs(o.y - p.y));
      if (L.dark && !L.torchLit && dist > 2) return false;
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
    canCast(name) {
      const s = this.s;
      if (!s.level || !(s.player.spells[name] > 0)) return false;
      switch (name) {
        case 'reroll': case 'luck': return s.phase === 'choose';
        case 'noclip': case 'invis': return s.phase === 'choose' || s.phase === 'redirect' || s.phase === 'roll';
        case 'fireball': return ['roll', 'choose', 'redirect'].includes(s.phase) && this.fireballTargets().length > 0;
      }
      return false;
    }

    reroll(i) {
      const s = this.s;
      if (!this.canCast('reroll') || (i !== 0 && i !== 1)) return false;
      const old = s.dice[i];
      s.dice[i] = this.d(6);
      s.player.spells.reroll--;
      this.computeSteps();
      this.emit('roll');
      this.log(`Re-roll: die ${i + 1} ${old} → ${s.dice[i]}. Move ${s.steps}, ${s.parity === 'ortho' ? 'orthogonal' : 'diagonal'}.`, 'spell');
      return true;
    }

    darkLuck(a, b) {
      const s = this.s;
      const ok = (v) => Number.isInteger(v) && v >= 1 && v <= 6;
      if (!this.canCast('luck') || !ok(a) || !ok(b)) return false;
      s.dice = [a, b];
      s.player.spells.luck--;
      this.computeSteps();
      this.emit('spell');
      this.log(`Dark One's Luck bends fate: ${a} + ${b}. Move ${s.steps}, ${s.parity === 'ortho' ? 'orthogonal' : 'diagonal'}.`, 'spell');
      return true;
    }

    // Arm/disarm No Clipping or Invisibility. Charges are spent only when used.
    toggleArm(name) {
      const s = this.s;
      if (name !== 'noclip' && name !== 'invis') return false;
      if (s.armed[name]) {
        if (name === 'invis' && s.invisUsed) return false;
        s.armed[name] = false;
        return true;
      }
      if (!this.canCast(name)) return false;
      s.armed[name] = true;
      this.emit('spell');
      this.log(`${SPELLS[name].name} is ready for this turn.`, 'spell');
      return true;
    }

    fireballTargets() {
      const L = this.s.level;
      if (!L) return [];
      return L.objects.map((o, i) => i).filter((i) => {
        const o = L.objects[i];
        return !o.done && (o.type === 'web' || o.type === 'enemy' || o.type === 'lock') && this.isVisible(o.x, o.y);
      });
    }

    fireball(index) {
      const s = this.s;
      if (!this.canCast('fireball') || !this.fireballTargets().includes(index)) return false;
      const o = s.level.objects[index];
      this.clearObj(o);
      o.burned = true;
      s.player.spells.fireball--;
      if (o.type === 'enemy') s.stats.kills++; // no body: nothing left to loot
      this.updateVision(); // a burned door can open a line of sight
      const what = o.type === 'lock' ? `the ${o.color} door` : o.type === 'web' ? 'a web' : 'an enemy';
      this.emit('fireball');
      this.log(`Fireball! You incinerate ${what}.`, 'spell');
      return true;
    }

    // ------------------------------------------------------------------- shop
    makeShop(f) {
      const rng = new RNG(seedFor(this.s.seed, 'shop', f));
      const random = rng.shuffle(SHOP_POOL.slice()).slice(0, 4);
      return { floor: f, items: [...SHOP_FIXED, ...random].map((id) => ({ id, sold: false })), lastGamble: null };
    }

    price(id) {
      const s = this.s, p = s.player, t = Math.floor(s.floor / 10);
      switch (id) {
        case 'heal': return p.hp >= p.maxHp ? 0 : 2 + Math.ceil((p.maxHp - p.hp) / 2) + t;
        case 'str': return 8 + 4 * (p.str - R.START_STR) + 2 * t;
        case 'maxhp': return 6 + 2 * t;
        case 'noclip': return 7 + t;
        case 'fireball': return 5 + t;
        case 'luck': return 9 + t;
        case 'reroll': return 3 + t;
        case 'invis': return 6 + t;
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
        default:
          p.spells[it.id]++;
          it.sold = true;
          this.log(`Bought ${SPELLS[it.id].name}.`, 'shop');
      }
      return true;
    }

    // 1-2 lose the wager, 3-4 money back, 5 money back +2, 6 win double.
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
      else { delta = wager; text = 'You win double!'; }
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
})(typeof window !== 'undefined' ? window : globalThis);
