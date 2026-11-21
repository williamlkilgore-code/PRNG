/* The dungeon map: a <canvas> drawn from game.s every animation frame.
 * Tiles are 16x16 sprites drawn at PX screen pixels per sprite pixel; CSS
 * scales the canvas to fit with crisp (pixelated) edges. */
import { useEffect, useRef } from 'react';
import { DIRS } from '../engine/game.js';
import { rules as R } from '../engine/rules.js';
import { drawSprite, objectSprite, heroSprite, TINTS } from './sprites.js';

const PX = 3;            // screen pixels per sprite pixel (in canvas space)
const T = 16 * PX;       // one tile in canvas pixels

const POP_COLORS = { hurt: '#ff6a5c', hit: '#ffe08a', heal: '#7cf08a', coin: '#ffd24a', spell: '#c9a0ff', xp: '#8ad8ff', gear: '#ffffff' };
const ANGLE = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };

// Which legal direction a point (in tile units, relative to the player) points at.
export function dirToward(dx, dy, legal) {
  if (!legal.length || Math.hypot(dx, dy) < 0.45) return null;
  const ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  let best = null, bestDiff = 999;
  for (const d of legal) {
    const diff = Math.abs((((ang - ANGLE[d]) % 360) + 540) % 360 - 180);
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  return bestDiff <= 45 ? best : null;
}

const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

export default function DungeonCanvas({ game, version, popups, preview, shotCells, dirs, onPick, onHover, reduced }) {
  const ref = useRef(null);
  const anim = useRef({ px: null, py: null, pops: [], lastPopSeq: 0 });
  const props = useRef({});
  props.current = { game, preview, shotCells, dirs };

  // New floating numbers.
  useEffect(() => {
    if (!popups || !popups.length) return;
    const now = performance.now();
    const counts = {};
    for (const p of popups) {
      const k = p.x + ',' + p.y;
      counts[k] = (counts[k] || 0) + 1;
      anim.current.pops.push(Object.assign({ t0: now + (counts[k] - 1) * 220 }, p));
    }
  }, [popups]);

  // The draw loop.
  useEffect(() => {
    let raf = 0;
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const { game: g, preview: pv, shotCells: shots, dirs: ds } = props.current;
      const L = g && g.s.level;
      if (!L) return;
      if (cv.width !== L.w * T || cv.height !== L.h * T) { cv.width = L.w * T; cv.height = L.h * T; }
      ctx.imageSmoothingEnabled = false;
      draw(ctx, g, now, anim.current, pv, shots, ds, reduced);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Snap the pawn when the floor changes.
  useEffect(() => {
    if (!game || !game.s.level) return;
    const a = anim.current, p = game.s.player;
    const jump = a.px === null || Math.abs(a.px - p.x) + Math.abs(a.py - p.y) > 2.5;
    if (jump) { a.px = p.x; a.py = p.y; }
  }, [game, version]);

  const toTile = (e) => {
    const cv = ref.current, r = cv.getBoundingClientRect();
    const L = game.s.level;
    return [((e.clientX - r.left) / r.width) * L.w, ((e.clientY - r.top) / r.height) * L.h];
  };
  const dirAt = (e) => {
    if (!game || !game.s.level) return null;
    const [tx, ty] = toTile(e), p = game.s.player;
    return dirToward(tx - (p.x + 0.5), ty - (p.y + 0.5), dirs || []);
  };
  const enemyAt = (e) => {
    if (!game || !game.s.level) return -1;
    const [tx, ty] = toTile(e);
    const o = game.obj(Math.floor(tx), Math.floor(ty));
    return o && o.type === 'enemy' ? game.objIndex(o) : -1;
  };

  return (
    <canvas
      ref={ref}
      className="dungeon"
      onClick={(e) => onPick && onPick(dirAt(e), enemyAt(e))}
      onMouseMove={(e) => onHover && onHover(dirAt(e))}
      onMouseLeave={() => onHover && onHover(null)}
      aria-label="Dungeon map. Click in a direction to move."
    />
  );
}

function draw(ctx, g, now, a, preview, shotCells, dirs, reduced) {
  const s = g.s, L = s.level, p = s.player;
  const vis = (x, y) => g.isVisible(x, y);
  const seen = (x, y) => !L.dark || (L.seen && L.seen[y * L.w + x]);
  const memory = L.dark ? R.darkMemory(s.floor) : 'full';
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < L.w && y < L.h && L.tiles[y * L.w + x] !== 0;

  ctx.fillStyle = '#120e16';
  ctx.fillRect(0, 0, L.w * T, L.h * T);

  // Tiles.
  for (let y = 0; y < L.h; y++) {
    for (let x = 0; x < L.w; x++) {
      if (L.dark && !seen(x, y)) continue;
      if (L.dark && !vis(x, y) && memory === 'none') continue;
      const t = L.tiles[y * L.w + x];
      if (t === 0) {
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloor(x + dx, y + dy)) { near = true; break; }
        drawSprite(ctx, near ? 'wall' : 'void', x * T, y * T, T);
      } else {
        drawSprite(ctx, hash(x, y) % 5 === 0 ? 'floor2' : 'floor', x * T, y * T, T);
      }
    }
  }

  // The path walked on this floor (roll-and-write pencil line).
  ctx.strokeStyle = 'rgba(246, 200, 64, 0.35)';
  ctx.lineWidth = PX * 1.5;
  ctx.setLineDash([PX * 2, PX * 2]);
  for (const seg of L.trail || []) {
    if (seg.length < 2) continue;
    ctx.beginPath();
    seg.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (x + 0.5) * T, (y + 0.5) * T));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Start and stairs.
  if (L.start && seen(L.start.x, L.start.y)) drawSprite(ctx, 'start', L.start.x * T, L.start.y * T, T);
  if (L.stairs && (!L.dark || L.seenStairs || vis(L.stairs.x, L.stairs.y))) drawSprite(ctx, 'stairs', L.stairs.x * T, L.stairs.y * T, T);

  // Objects.
  const bob = reduced ? 0 : Math.round(Math.sin(now / 260) * 1) * PX;
  for (const o of L.objects) {
    if (o.done) continue;
    const here = vis(o.x, o.y);
    let ox = o.x, oy = o.y, faded = false;
    if (L.dark && !here) {
      if (o.type === 'enemy') {
        if (!L.enemyMemory || !o.lastSeen) continue;
        [ox, oy] = o.lastSeen; faded = true;
      } else if (memory !== 'full' || !o.seen) continue;
      else faded = true;
    }
    const id = objectSprite(o);
    if (!id) continue;
    ctx.globalAlpha = faded ? 0.45 : 1;
    const dy = o.type === 'enemy' ? bob * ((o.x + o.y) % 2 ? 1 : -1) : 0;
    if (o.type === 'enemy') shadow(ctx, ox, oy);
    drawSprite(ctx, id, ox * T, oy * T + dy, T, o.color);
    if (o.type === 'enemy' && o.hp < o.maxHp) hpBar(ctx, ox, oy, o.hp / o.maxHp);
    if (o.stalker && !faded) {
      ctx.fillStyle = '#ff4a3c';
      ctx.fillRect(ox * T + T - 4 * PX, oy * T + PX, 2 * PX, 5 * PX);
      ctx.fillRect(ox * T + T - 4 * PX, oy * T + 7 * PX, 2 * PX, 2 * PX);
    }
    ctx.globalAlpha = 1;
  }

  // Direction hints and the hovered path.
  if (dirs && dirs.length && !preview) {
    ctx.fillStyle = 'rgba(255, 236, 170, 0.22)';
    for (const d of dirs) {
      const [dx, dy] = DIRS[d];
      ctx.fillRect((p.x + dx) * T + 4 * PX, (p.y + dy) * T + 4 * PX, 8 * PX, 8 * PX);
    }
  }
  if (preview && preview.length) {
    ctx.fillStyle = 'rgba(255, 236, 170, 0.28)';
    ctx.strokeStyle = 'rgba(255, 236, 170, 0.8)';
    ctx.lineWidth = PX;
    preview.forEach(([x, y], i) => {
      ctx.fillRect(x * T + PX, y * T + PX, T - 2 * PX, T - 2 * PX);
      if (i === preview.length - 1) ctx.strokeRect(x * T + PX, y * T + PX, T - 2 * PX, T - 2 * PX);
    });
  }
  if (shotCells) {
    ctx.fillStyle = 'rgba(140, 220, 255, 0.55)';
    for (const [x, y] of shotCells) ctx.fillRect(x * T + 6 * PX, y * T + 6 * PX, 4 * PX, 4 * PX);
  }

  // The hero slides between squares.
  if (a.px === null) { a.px = p.x; a.py = p.y; }
  const k = reduced ? 1 : 0.35;
  a.px += (p.x - a.px) * k; a.py += (p.y - a.py) * k;
  if (Math.abs(a.px - p.x) < 0.01) a.px = p.x;
  if (Math.abs(a.py - p.y) < 0.01) a.py = p.y;
  shadow(ctx, a.px, a.py);
  ctx.globalAlpha = s.invis ? 0.45 : 1;
  const hop = (a.px !== p.x || a.py !== p.y) && !reduced ? -2 * PX : bob;
  drawSprite(ctx, heroSprite(p.cls), a.px * T, a.py * T + hop, T);
  ctx.globalAlpha = 1;

  // Darkness: unseen squares are black, remembered ones dim; torchlight flickers.
  if (L.dark) {
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        if (vis(x, y)) continue;
        ctx.fillStyle = seen(x, y) ? 'rgba(10, 6, 14, 0.62)' : '#0a060e';
        ctx.fillRect(x * T, y * T, T, T);
      }
    }
    const lit = L.torchLit || L.orbRadius;
    if (lit) {
      const r = Math.max(L.torchLit ? R.TORCH_RADIUS : 0, L.orbRadius || 0) + 0.5;
      const flick = reduced ? 0 : Math.sin(now / 90) * 0.04 + Math.sin(now / 37) * 0.02;
      const grd = ctx.createRadialGradient((a.px + 0.5) * T, (a.py + 0.5) * T, T * 0.5, (a.px + 0.5) * T, (a.py + 0.5) * T, r * T);
      grd.addColorStop(0, `rgba(255, 170, 60, ${0.16 + flick})`);
      grd.addColorStop(1, 'rgba(255, 140, 40, 0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, L.w * T, L.h * T);
    }
  }

  // Floating numbers.
  ctx.textAlign = 'center';
  ctx.font = `bold ${7 * PX}px "Press Start 2P", ui-monospace, monospace`;
  a.pops = a.pops.filter((q) => now - q.t0 < 1100);
  for (const q of a.pops) {
    const t = (now - q.t0) / 1100;
    if (t < 0) continue;
    const x = (q.x + 0.5) * T, y = (q.y + 0.2) * T - t * T * 0.9;
    ctx.globalAlpha = 1 - t * t;
    ctx.fillStyle = '#000';
    ctx.fillText(q.text, x + PX, y + PX);
    ctx.fillStyle = POP_COLORS[q.kind] || '#fff';
    ctx.fillText(q.text, x, y);
  }
  ctx.globalAlpha = 1;
}

function shadow(ctx, x, y) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse((x + 0.5) * T, (y + 0.94) * T, 5 * PX, 1.5 * PX, 0, 0, Math.PI * 2);
  ctx.fill();
}

function hpBar(ctx, x, y, f) {
  ctx.fillStyle = '#1a1420';
  ctx.fillRect(x * T + 2 * PX, y * T - PX, 12 * PX, 2 * PX);
  ctx.fillStyle = f > 0.5 ? '#62c04e' : f > 0.25 ? '#f6c840' : '#e0484c';
  ctx.fillRect(x * T + 2 * PX, y * T - PX, Math.max(1, Math.round(12 * f)) * PX, 2 * PX);
}

export { TINTS };
