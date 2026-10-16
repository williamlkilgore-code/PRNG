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
  const SHOP_POOL = ['maxhp', 'gamble', 'noclip', 'fireball', 'luck', 'reroll', 'invis'];
  const SHOP_IDS = ['heal', 'str', ...SHOP_POOL];
  const PHASES = ['roll', 'choose', 'moving', 'redirect', 'levelDone', 'shop', 'dead'];
  const OBJ_TYPES = ['coin', 'chest', 'heart', 'medpack', 'key', 'lock', 'web', 'enemy', 'portal'];
  const OBJ_COLORS = ['gold', 'crimson', 'azure', 'emerald', 'violet', 'teal'];

  function randomSeedText() {
    const words = ['moss', 'grim', 'ember', 'vault', 'crypt', 'rune', 'bone', 'gloom', 'ash', 'iron', 'wyrm', 'hex'];
    const pick = () => words[Math.floor(Math.random() * words.length)];
    return `${pick()}-${pick()}-${Math.floor(Math.random() * 1000)}`;
  }

  class Game {
    constructor(state) {
      this.s = state;
      this.rebuildIndex();
    }

    static create(seedText) {
      seedText = String(seedText || '').trim() || randomSeedText();
      const s = {
        version: 1,
        seedText,
        seed: hashStr(seedText),
        floor: 0,
        turn: 0,
        phase: 'roll',
        player: {
          x: 0, y: 0, hp: R.START_HP, maxHp: R.START_HP, str: R.START_STR, coins: 0,
          keys: [], webbed: false,
          spells: { noclip: 0, fireball: 0, luck: 0, reroll: 0, invis: 0 },
        },
        diceState: seedFor(seedText, 'dice'),
        dice: null, steps: 0, parity: null, halved: false,
        usedDirs: [], turnPath: [], move: null,
        armed: { noclip: false, invis: false }, invisUsed: false,
        level: null, shop: null,
        log: [],
        stats: { kills: 0, coins: 0, floorsCleared: 0 },
        floorStartTurn: 0,
      };
      const g = new Game(s);
      g.log(`A new descent begins. Seed "${seedText}".`);
      g.enterFloor(1);
      return g;
    }

    // Returns a game, or null if `state` isn't a valid save.
    static load(state) {
      if (Game.validate(state)) return null;
      if (!Array.isArray(state.turnPath)) state.turnPath = [];
      return new Game(state);
    }

    /* Checks a save's shape and value types. Saves can come from files the
     * player imports, so every value that reaches the page is checked here.
     * Returns null when valid, otherwise a short reason. */
    static validate(st) {
      const int = (v, lo, hi) => Number.isInteger(v) && v >= (lo ?? -Infinity) && v <= (hi ?? Infinity);
      const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
      const fail = (why) => why;
      if (!obj(st)) return fail('not a save file');
      if (st.version !== 1) return fail('unsupported save version');
      if (typeof st.seedText !== 'string' || st.seedText.length > 100) return fail('bad seed');
      if (!int(st.seed, 0, 0xffffffff) || !int(st.diceState, 0, 0xffffffff)) return fail('bad seed');
      if (!int(st.floor, 1, 100000) || !int(st.turn, 0) || !int(st.floorStartTurn ?? 0, 0)) return fail('bad floor or turn');
      if (!PHASES.includes(st.phase)) return fail('bad phase');

      const p = st.player;
      if (!obj(p)) return fail('missing player');
      if (!int(p.hp, 0) || !int(p.maxHp, 1) || p.hp > p.maxHp || !int(p.str, 0) || !int(p.coins, 0)) return fail('bad player stats');
      if (!Array.isArray(p.keys) || !p.keys.every((k) => DC.KEY_COLORS.includes(k))) return fail('bad keys');
      if (!obj(p.spells) || !Object.keys(SPELLS).every((k) => int(p.spells[k], 0))) return fail('bad spells');

      if (st.dice !== null && !(Array.isArray(st.dice) && st.dice.length === 2 && st.dice.every((d) => int(d, 1, 6)))) return fail('bad dice');
      if (!int(st.steps, 0, 12) || ![null, 'ortho', 'diag'].includes(st.parity ?? null)) return fail('bad roll');
      if (!Array.isArray(st.usedDirs) || !st.usedDirs.every((d) => d in DIRS)) return fail('bad directions');
      if (st.move !== null && !(obj(st.move) && st.move.dir in DIRS && int(st.move.stepsLeft, 0, 12))) return fail('bad move');
      if ((st.phase === 'moving' || st.phase === 'redirect') && !st.move) return fail('bad move');
      if (!obj(st.armed) || typeof st.armed.noclip !== 'boolean' || typeof st.armed.invis !== 'boolean') return fail('bad spells');
      if (!Array.isArray(st.log) || !st.log.every((l) => obj(l) && typeof l.text === 'string' && /^[a-z]{1,12}$/.test(l.kind))) return fail('bad journal');
      if (!obj(st.stats) || !['kills', 'coins', 'floorsCleared'].every((k) => int(st.stats[k], 0))) return fail('bad stats');

      if (st.phase === 'levelDone') {
        const sm = st.summary;
        if (!obj(sm) || !int(sm.floor, 1) || !int(sm.turns, 0) || !int(sm.next, 1) || typeof sm.nextIsShop !== 'boolean') return fail('bad summary');
      }
      if (st.phase === 'shop') {
        const sh = st.shop;
        if (!obj(sh) || !Array.isArray(sh.items) || !sh.items.every((it) => obj(it) && SHOP_IDS.includes(it.id) && typeof it.sold === 'boolean')) return fail('bad shop');
        const g = sh.lastGamble;
        if (g != null && !(obj(g) && int(g.roll, 1, 6) && int(g.wager, 1) && int(g.delta) && typeof g.text === 'string')) return fail('bad shop');
      } else if (st.phase !== 'dead' || st.level) {
        const L = st.level;
        if (!obj(L) || !int(L.w, 5, 200) || !int(L.h, 5, 200)) return fail('bad map');
        const inB = (c) => Array.isArray(c) && c.length === 2 && int(c[0], 0, L.w - 1) && int(c[1], 0, L.h - 1);
        const at = (o) => obj(o) && int(o.x, 0, L.w - 1) && int(o.y, 0, L.h - 1);
        if (!Array.isArray(L.tiles) || L.tiles.length !== L.w * L.h || !L.tiles.every((t) => int(t, 0, 2))) return fail('bad map');
        if (!at(L.start) || !at(L.stairs) || !int(p.x, 0, L.w - 1) || !int(p.y, 0, L.h - 1)) return fail('bad map');
        if (!Array.isArray(L.objects)) return fail('bad map');
        const ok = L.objects.every((o) => at(o) && OBJ_TYPES.includes(o.type) &&
          (o.color === undefined || OBJ_COLORS.includes(o.color)) &&
          (o.type !== 'enemy' || (int(o.hp) && int(o.maxHp, 1))) &&
          (o.type !== 'portal' || (int(o.pair, 0, L.objects.length - 1) && L.objects[o.pair].type === 'portal')));
        if (!ok) return fail('bad map objects');
        if (!Array.isArray(L.trail) || !L.trail.length || !L.trail.every((seg) => Array.isArray(seg) && seg.length && seg.every(inB))) return fail('bad trail');
        if (st.turnPath !== undefined && !(Array.isArray(st.turnPath) && st.turnPath.every((i) => int(i, 0, L.w * L.h - 1)))) return fail('bad trail');
      }
      return null;
    }

    // ---------------------------------------------------------------- helpers
    log(text, kind) {
      this.s.log.push({ text, kind: kind || 'info', turn: this.s.turn });
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
      // No doubling back. First choice: never reverse a direction used this
      // turn. If that leaves nothing, allow only moves onto squares not yet
      // walked this turn. Retracing is allowed only when it is the only move.
      const back = new Set(s.usedDirs.map((d) => OPP[d]));
      const fwd = legal.filter((d) => !back.has(d));
      if (fwd.length) return fwd;
      const walked = new Set(s.turnPath || []);
      const fresh = legal.filter((d) => {
        const m = this.legalMove(d, steps);
        return !walked.has(m.y * s.level.w + m.x);
      });
      return fresh.length ? fresh : legal;
    }

    // Straight-line preview of where a direction leads (stops at the first event).
    previewPath(dir) {
      const out = [];
      let steps = this.stepsLeft();
      let { x, y } = this.s.player;
      while (steps > 0) {
        const m = this.legalMove(dir, steps, x, y);
        if (!m) break;
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
      s.dice = null; s.move = null; s.usedDirs = []; s.turnPath = []; s.halved = false;
      s.armed = { noclip: false, invis: false }; s.invisUsed = false;
      p.keys = []; p.webbed = false;
      s.floorStartTurn = s.turn;
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
      }
      this.rebuildIndex();
    }

    completeFloor() {
      const s = this.s;
      this.finishTurnFlags();
      s.stats.floorsCleared++;
      s.phase = 'levelDone';
      s.summary = { floor: s.floor, turns: s.turn - s.floorStartTurn, next: s.floor + 1, nextIsShop: R.isShopFloor(s.seed, s.floor + 1) };
      this.log(`You descend the stairs of floor ${s.floor}!`, 'good');
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
      if (s.phase === 'choose') {
        s.move = { stepsLeft: s.steps, dir };
        s.turnPath = [s.player.y * s.level.w + s.player.x];
      }
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
      s.turnPath = [];
      s.turn++;
    }

    endTurn(msg, kind) {
      if (msg) this.log(msg, kind);
      this.finishTurnFlags();
      if (this.s.phase !== 'dead') this.s.phase = 'roll';
    }

    die() {
      this.s.phase = 'dead';
      this.s.move = null;
      this.log('You have fallen in the dungeon.', 'bad');
    }

    moveTo(x, y, jump) {
      const p = this.s.player, L = this.s.level;
      p.x = x; p.y = y;
      if (this.s.turnPath) this.s.turnPath.push(y * L.w + x);
      if (jump) L.trail.push([[x, y]]);
      else L.trail[L.trail.length - 1].push([x, y]);
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
        this.log(`Blocked! ${m.stepsLeft} move${m.stepsLeft > 1 ? 's' : ''} left: pick a new direction.`, 'warn');
        return { type: 'redirect' };
      }

      if (lm.kind === 'noclip') {
        const [dx, dy] = DIRS[m.dir];
        for (let k = 1; k <= lm.walls; k++) this.moveTo(p.x + dx, p.y + dy);
        m.stepsLeft -= lm.walls;
        s.armed.noclip = false;
        p.spells.noclip--;
        this.log('You phase straight through the wall!', 'spell');
      }

      m.stepsLeft -= 1;
      const o = this.obj(lm.x, lm.y);
      if (o && o.type === 'enemy') {
        if (s.armed.invis) {
          s.invisUsed = true;
          this.log('You slip past an enemy unseen.', 'spell');
        } else {
          const dmg = R.enemyDamage(s.floor);
          p.hp = Math.max(0, p.hp - dmg);
          o.hp -= p.str;
          if (o.hp <= 0) {
            this.clearObj(o);
            s.stats.kills++;
            this.log(`You take ${dmg} damage and slay the enemy!`, 'fight');
            if (p.hp <= 0) { this.die(); return { type: 'dead' }; }
          } else {
            this.log(`You take ${dmg} damage and wound the enemy (${o.hp}/${o.maxHp} left). It blocks your path.`, 'fight');
            if (p.hp <= 0) { this.die(); return { type: 'dead' }; }
            this.endTurn();
            return { type: 'fight' };
          }
        }
      } else if (o && o.type === 'lock') {
        this.clearObj(o);
        p.keys.splice(p.keys.indexOf(o.color), 1);
        this.log(`Your ${o.color} key opens the door.`, 'good');
      }

      this.moveTo(lm.x, lm.y);
      return this.onEnter(lm.x, lm.y);
    }

    onEnter(x, y) {
      const s = this.s, p = s.player, L = s.level, f = s.floor;
      if (x === L.stairs.x && y === L.stairs.y) { this.completeFloor(); return { type: 'stairs' }; }
      const o = this.obj(x, y);
      let ev = { type: 'step' };
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
            this.endTurn('Caught in a spider web! Movement stops, and your next move is halved.', 'warn');
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
      this.log(`${SPELLS[name].name} is ready for this turn.`, 'spell');
      return true;
    }

    fireballTargets() {
      const L = this.s.level;
      if (!L) return [];
      return L.objects.map((o, i) => i).filter((i) => {
        const o = L.objects[i];
        return !o.done && (o.type === 'web' || o.type === 'enemy' || o.type === 'lock');
      });
    }

    fireball(index) {
      const s = this.s;
      if (!this.canCast('fireball') || !this.fireballTargets().includes(index)) return false;
      const o = s.level.objects[index];
      this.clearObj(o);
      o.burned = true;
      s.player.spells.fireball--;
      if (o.type === 'enemy') s.stats.kills++;
      const what = o.type === 'lock' ? `the ${o.color} door` : o.type === 'web' ? 'a web' : 'an enemy';
      this.log(`Fireball! You incinerate ${what}.`, 'spell');
      return true;
    }

    // ------------------------------------------------------------------- shop
    makeShop(f) {
      const rng = new RNG(seedFor(this.s.seed, 'shop', f));
      const random = rng.shuffle(SHOP_POOL.slice()).slice(0, 4);
      return { floor: f, items: ['heal', 'str', ...random].map((id) => ({ id, sold: false })), lastGamble: null };
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
      switch (it.id) {
        case 'heal': p.hp = p.maxHp; this.log(`Healed to full for ${cost} coins.`, 'shop'); break;
        case 'str': p.str++; this.log(`Strength increased to ${p.str}.`, 'shop'); break;
        case 'maxhp': p.maxHp += 2; p.hp += 2; it.sold = true; this.log('Max health +2.', 'shop'); break;
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
