'use strict';

/* ── Constants ──────────────────────────────────────────── */
const CW        = 960;
const CH        = 560;
const GROUND_PX = 60;
const SKY_PX    = CH - GROUND_PX;   // 500 — fixed sky height in px
const G         = 9.8;
const LAUNCH_CX = 70;
const PAD_RIGHT = 50;
const PAD_TOP_M = 3;    // extra metres headroom above trajectory peak

const NODRAG_COL = '#1d4ed8';   // dark blue
const DRAG_COL   = '#e11d48';   // crimson

const PRESETS = {
  shotput:  { beta: 0.002, speed: 15, angle: 40 },
  cricket:  { beta: 0.007, speed: 25, angle: 35 },
  afl:      { beta: 0.015, speed: 22, angle: 40 },
  tennis:   { beta: 0.030, speed: 20, angle: 45 },
  shuttle:  { beta: 0.120, speed:  8, angle: 50 },
};

/* ── Config ─────────────────────────────────────────────── */
const cfg = {
  mode:      'unilevel',   // 'unilevel' | 'raised'
  display:   'both',       // 'nodrag' | 'drag' | 'both'
  angle:     45,
  speed:     20,
  height:    20,
  beta:      0.030,
  showStats: true,
  preset:    'tennis',     // key into PRESETS, or '' for custom
};

/* ── State ──────────────────────────────────────────────── */
let launched   = false;
let animId     = null;
let tStart     = null;
let tNow       = 0;
let scale      = 1;
let nodragPath = [];   // [{x, y, vx, vy, t}, …]
let dragPath   = [];

const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');

/* ── Coordinate helpers ─────────────────────────────────── */
// Physics: y = 0 at ground, increasing upward.
// Canvas:  y = SKY_PX at ground, decreasing upward.
function wx(x) { return LAUNCH_CX + x * scale; }
function wy(y) { return SKY_PX    - y * scale; }

/* ── RK4 integrator ─────────────────────────────────────── */
function rk4Step(s, dt) {
  function deriv(q) {
    const drag = cfg.beta * Math.hypot(q.vx, q.vy);
    return { dx: q.vx, dy: q.vy, dvx: -drag * q.vx, dvy: -G - drag * q.vy };
  }
  function advance(q, k, h) {
    return { x: q.x + h*k.dx, y: q.y + h*k.dy, vx: q.vx + h*k.dvx, vy: q.vy + h*k.dvy };
  }
  const k1 = deriv(s);
  const k2 = deriv(advance(s, k1, 0.5*dt));
  const k3 = deriv(advance(s, k2, 0.5*dt));
  const k4 = deriv(advance(s, k3, dt));
  return {
    x:  s.x  + dt/6 * (k1.dx  + 2*k2.dx  + 2*k3.dx  + k4.dx),
    y:  s.y  + dt/6 * (k1.dy  + 2*k2.dy  + 2*k3.dy  + k4.dy),
    vx: s.vx + dt/6 * (k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx),
    vy: s.vy + dt/6 * (k1.dvy + 2*k2.dvy + 2*k3.dvy + k4.dvy),
  };
}

/* ── Initial conditions ─────────────────────────────────── */
function makeIC() {
  const a  = cfg.mode === 'raised' ? 0 : cfg.angle * Math.PI / 180;
  const y0 = cfg.mode === 'raised' ? cfg.height : 0;
  return { x: 0, y: y0, vx: cfg.speed * Math.cos(a), vy: cfg.speed * Math.sin(a) };
}

/* ── Pre-compute trajectories ───────────────────────────── */
function computeNodragPath() {
  const { vx, vy, y: y0 } = makeIC();
  const path = [];
  const DT   = 0.01;
  let t = 0;
  while (true) {
    const y  = y0 + vy*t - 0.5*G*t*t;
    path.push({ x: vx*t, y: Math.max(y, 0), vx, vy: vy - G*t, t });
    if (y <= 0 && t > 0) break;
    t += DT;
  }
  return path;
}

function computeDragPath() {
  let s    = makeIC();
  const path = [];
  const DT   = 0.005;
  const MAX_T = 120;
  let t = 0;
  while (t < MAX_T) {
    path.push({ ...s, t });
    if (s.y <= 0 && t > 0) break;
    const next = rk4Step(s, DT);
    if (s.y > 0 && next.y <= 0) {
      // Linear interpolation to exact landing moment
      const frac = s.y / (s.y - next.y);
      t += frac * DT;
      path.push({
        x:  s.x  + frac*(next.x  - s.x),
        y:  0,
        vx: s.vx + frac*(next.vx - s.vx),
        vy: s.vy + frac*(next.vy - s.vy),
        t,
      });
      break;
    }
    s = next;
    t += DT;
  }
  return path;
}

/* ── Scale ──────────────────────────────────────────────── */
function computeScale() {
  // Scale from no-drag path (always has larger range and height than drag path)
  const nd   = computeNodragPath();
  const maxX = Math.max(...nd.map(p => p.x));
  const maxY = Math.max(...nd.map(p => p.y));
  const scX  = (CW - LAUNCH_CX - PAD_RIGHT) / Math.max(maxX, 0.1);
  const scY  = SKY_PX / (maxY + PAD_TOP_M);
  scale = Math.min(scX, scY);
}

/* ── Path interpolation ─────────────────────────────────── */
function interpPath(path, t) {
  if (!path.length) return null;
  const last = path[path.length - 1];
  if (t >= last.t) return { ...last };
  for (let i = 1; i < path.length; i++) {
    if (path[i].t >= t) {
      const a = path[i-1], b = path[i];
      const f = (t - a.t) / (b.t - a.t);
      return {
        x:  a.x  + f*(b.x  - a.x),
        y:  a.y  + f*(b.y  - a.y),
        vx: a.vx + f*(b.vx - a.vx),
        vy: a.vy + f*(b.vy - a.vy),
        t,
      };
    }
  }
  return { ...last };
}

function pathMaxY(path, upToT) {
  let max = 0;
  for (const p of path) {
    if (p.t > upToT) break;
    if (p.y > max) max = p.y;
  }
  return max;
}

/* ── Drawing helpers ─────────────────────────────────────── */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y,   x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h,   x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y,     x+r, y);
  ctx.closePath();
}

function drawBg() {
  const grad = ctx.createLinearGradient(0, 0, 0, SKY_PX);
  grad.addColorStop(0, '#dbeafe');
  grad.addColorStop(1, '#eff6ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CW, SKY_PX);
  ctx.fillStyle = '#86efac';
  ctx.fillRect(0, SKY_PX, CW, CH - SKY_PX);
  ctx.fillStyle = '#4ade80';
  ctx.fillRect(0, SKY_PX, CW, 4);
}

function drawHeightBar() {
  if (cfg.mode !== 'raised') return;
  const gx = wx(0);
  const groundY  = wy(0);
  const launchY  = wy(cfg.height);

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(21,48,77,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.moveTo(gx, groundY);
  ctx.lineTo(gx, launchY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '11px "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#55708d';
  ctx.textAlign = 'right';
  ctx.fillText(`h = ${cfg.height} m`, gx - 6, (groundY + launchY) / 2 + 4);
  ctx.textAlign = 'left';
}

function drawTrail(path, upToT, col) {
  if (path.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  let started = false;
  for (const p of path) {
    if (p.t > upToT + 1e-9) break;
    const cx = wx(p.x), cy = wy(p.y);
    if (!started) { ctx.moveTo(cx, cy); started = true; }
    else          ctx.lineTo(cx, cy);
  }
  ctx.stroke();
}

/* ── Ball sprites ────────────────────────────────────────── */

function drawShotPut(cx, cy) {
  const r = 9;
  const grad = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, r);
  grad.addColorStop(0,    '#f1f5f9');
  grad.addColorStop(0.35, '#94a3b8');
  grad.addColorStop(1,    '#1e293b');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();
}

function drawCricketBall(cx, cy) {
  const r = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#991b1b';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.5;
  // Seam 1: arcs from top-left to bottom-right
  ctx.beginPath();
  ctx.moveTo(cx - r + 1, cy - 2);
  ctx.bezierCurveTo(cx - 3, cy - r + 2,  cx + 3, cy + r - 2,  cx + r - 1, cy + 2);
  ctx.stroke();
  // Seam 2: perpendicular
  ctx.beginPath();
  ctx.moveTo(cx - 2, cy - r + 1);
  ctx.bezierCurveTo(cx - r + 2, cy - 3,  cx + r - 2, cy + 3,  cx + 2, cy + r - 1);
  ctx.stroke();
}

function drawAFLFootball(cx, cy, vx, vy) {
  const angle = Math.atan2(-vy, vx);   // canvas y is flipped
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // Soft shadow
  ctx.beginPath();
  ctx.ellipse(1, 1, 12, 6, 0, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  // Leather body
  ctx.beginPath();
  ctx.ellipse(0, 0, 12, 6, 0, 0, 2 * Math.PI);
  ctx.fillStyle = '#92400e';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();
  // Vertical lacing bars
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 3, -3);
    ctx.lineTo(i * 3,  3);
    ctx.stroke();
  }
  // Horizontal lace thread
  ctx.beginPath();
  ctx.setLineDash([1.5, 1.5]);
  ctx.moveTo(-5, 0);
  ctx.lineTo( 5, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawTennisBall(cx, cy) {
  const r = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#a3e635';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1.5;
  // Seam top arc
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.bezierCurveTo(cx - r*0.4, cy - r*0.7,  cx + r*0.4, cy + r*0.7,  cx + r, cy);
  ctx.stroke();
  // Seam bottom arc (mirrors it)
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.bezierCurveTo(cx - r*0.4, cy + r*0.7,  cx + r*0.4, cy - r*0.7,  cx + r, cy);
  ctx.stroke();
}

function drawShuttlecock(cx, cy, vx, vy) {
  const angle = Math.atan2(-vy, vx);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // Feather skirt
  ctx.beginPath();
  ctx.moveTo(2, -7);
  ctx.lineTo(-14, -9);
  ctx.lineTo(-14,  9);
  ctx.lineTo(2,  7);
  ctx.closePath();
  ctx.fillStyle = 'rgba(241,245,249,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.6)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([]);
  ctx.stroke();
  // Feather spine lines
  ctx.strokeStyle = 'rgba(203,213,225,0.8)';
  ctx.lineWidth = 0.7;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(2,   i * 3.2);
    ctx.lineTo(-13, i * 4.5);
    ctx.stroke();
  }
  // Cork hemisphere (front)
  ctx.beginPath();
  ctx.arc(3, 0, 6, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(2, 0);
  ctx.closePath();
  ctx.fillStyle = '#d4a574';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}

function drawDefaultBall(cx, cy, col) {
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.stroke();
}

function drawBall(p, col, useSprite = true) {
  const cx = wx(p.x), cy = wy(p.y);
  ctx.setLineDash([]);
  if (!useSprite) { drawDefaultBall(cx, cy, col); return; }
  switch (cfg.preset) {
    case 'shotput':  drawShotPut(cx, cy); break;
    case 'cricket':  drawCricketBall(cx, cy); break;
    case 'afl':      drawAFLFootball(cx, cy, p.vx, p.vy); break;
    case 'tennis':   drawTennisBall(cx, cy); break;
    case 'shuttle':  drawShuttlecock(cx, cy, p.vx, p.vy); break;
    default:         drawDefaultBall(cx, cy, col); break;
  }
}

function drawLandingDot(landingPoint, col, useSprite = true) {
  ctx.globalAlpha = 0.55;
  drawBall(landingPoint, col, useSprite);
  ctx.globalAlpha = 1;
}

/* ── Stats overlay ──────────────────────────────────────── */
function drawStats(t) {
  if (!cfg.showStats || !launched) return;

  const showND = cfg.display !== 'drag';
  const showDR = cfg.display !== 'nodrag';

  const ndLast = nodragPath.length ? nodragPath[nodragPath.length-1] : null;
  const drLast = dragPath.length   ? dragPath[dragPath.length-1]     : null;

  const ndP    = showND && ndLast ? interpPath(nodragPath, t) : null;
  const drP    = showDR && drLast ? interpPath(dragPath,   t) : null;

  const ndMaxH = ndP ? pathMaxY(nodragPath, t) : 0;
  const drMaxH = drP ? pathMaxY(dragPath,   t) : 0;

  const ndDone = showND && ndLast && t >= ndLast.t;
  const drDone = showDR && drLast && t >= drLast.t;
  const showComp = cfg.display === 'both' && ndDone && drDone;

  // Compute box height from content
  const PAD = 12, LH = 21;
  let lineCount = 0;
  if (ndP) lineCount += 4;                    // header + time + range + H max
  if (drP) lineCount += (ndP ? 1 : 0) + 4;   // gap + header + 3 rows
  if (showComp) lineCount += 2 + 4;           // gap + divider + header + 3 rows

  const W = 220, H = lineCount * LH + PAD * 2;
  const BX = CW - W - 10, BY = 10;

  roundRect(BX, BY, W, H, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(21,48,77,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();

  let ty = BY + PAD + 14;

  const dataRow = (label, val) => {
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(label, BX + PAD, ty);
    ctx.textAlign = 'right';
    ctx.fillText(val, BX + W - PAD, ty);
    ctx.textAlign = 'left';
    ty += LH;
  };

  if (ndP) {
    ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
    ctx.fillStyle = NODRAG_COL;
    ctx.fillText('No drag', BX + PAD, ty); ty += LH;
    dataRow('Time',    `${Math.min(t, ndLast.t).toFixed(2)} s`);
    dataRow('Range',   `${ndP.x.toFixed(1)} m`);
    dataRow('H max',   `${ndMaxH.toFixed(1)} m`);
  }

  if (drP) {
    if (ndP) ty += LH;
    ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
    ctx.fillStyle = DRAG_COL;
    ctx.fillText('With drag', BX + PAD, ty); ty += LH;
    dataRow('Time',    `${Math.min(t, drLast.t).toFixed(2)} s`);
    dataRow('Range',   `${drP.x.toFixed(1)} m`);
    dataRow('H max',   `${drMaxH.toFixed(1)} m`);
  }

  if (showComp) {
    ty += LH;
    ctx.fillStyle = 'rgba(21,48,77,0.18)';
    ctx.fillRect(BX + PAD, ty - LH/2, W - PAD*2, 1);

    const ndFinalMaxH = pathMaxY(nodragPath, ndLast.t);
    const drFinalMaxH = pathMaxY(dragPath,   drLast.t);
    const pRange = ((drLast.x    - ndLast.x)     / ndLast.x    * 100).toFixed(0);
    const pH     = ((drFinalMaxH - ndFinalMaxH)   / ndFinalMaxH * 100).toFixed(0);
    const pTof   = ((drLast.t    - ndLast.t)      / ndLast.t    * 100).toFixed(0);

    const signed = n => (n > 0 ? '+' : '') + n + '%';

    ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('Drag effect', BX + PAD, ty); ty += LH;
    dataRow('Δ Range', signed(pRange));
    dataRow('Δ H max', signed(pH));
    dataRow('Δ Time',  signed(pTof));
  }
}

/* ── Full render frame ───────────────────────────────────── */
function draw(t) {
  ctx.clearRect(0, 0, CW, CH);
  drawBg();
  drawHeightBar();

  if (!launched) {
    // Show launch point
    const y0 = cfg.mode === 'raised' ? cfg.height : 0;
    ctx.beginPath();
    ctx.arc(wx(0), wy(y0), 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#94a3b8';
    ctx.fill();
    return;
  }

  const showND = cfg.display !== 'drag';
  const showDR = cfg.display !== 'nodrag';

  const ndLast = nodragPath.length ? nodragPath[nodragPath.length-1] : null;
  const drLast = dragPath.length   ? dragPath[dragPath.length-1]     : null;

  if (showND && ndLast) {
    drawTrail(nodragPath, t, NODRAG_COL);
    const p = interpPath(nodragPath, t);
    if (p) {
      if (t < ndLast.t) drawBall(p, NODRAG_COL, false);
      else               drawLandingDot(ndLast, NODRAG_COL, false);
    }
  }

  if (showDR && drLast) {
    drawTrail(dragPath, t, DRAG_COL);
    const p = interpPath(dragPath, t);
    if (p) {
      if (t < drLast.t) drawBall(p, DRAG_COL);
      else               drawLandingDot(drLast, DRAG_COL, true);
    }
  }

  drawStats(t);
}

/* ── Animation loop ─────────────────────────────────────── */
function animate(ts) {
  if (!tStart) tStart = ts;
  tNow = (ts - tStart) / 1000;

  const showND = cfg.display !== 'drag';
  const showDR = cfg.display !== 'nodrag';
  const ndEnd  = (showND && nodragPath.length) ? nodragPath[nodragPath.length-1].t : 0;
  const drEnd  = (showDR && dragPath.length)   ? dragPath[dragPath.length-1].t     : 0;
  const maxEnd = Math.max(ndEnd, drEnd);

  draw(tNow);

  if (tNow < maxEnd) {
    animId = requestAnimationFrame(animate);
  } else {
    draw(maxEnd);
    animId = null;
  }
}

/* ── Fire / Reset ────────────────────────────────────────── */
function fire() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  computeScale();
  nodragPath = computeNodragPath();
  dragPath   = computeDragPath();
  launched   = true;
  tStart     = null;
  tNow       = 0;
  animId     = requestAnimationFrame(animate);
}

function reset() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  launched   = false;
  tNow       = 0;
  tStart     = null;
  nodragPath = [];
  dragPath   = [];
  draw(0);
}

/* ── Control wiring ─────────────────────────────────────── */
function syncSliderNum(sliderId, numId, cfgKey) {
  const slider = document.getElementById(sliderId);
  const num    = document.getElementById(numId);
  function update(raw) {
    const val = +raw;
    cfg[cfgKey]  = val;
    slider.value = val;
    num.value    = val;
  }
  slider.addEventListener('input',  () => update(slider.value));
  num.addEventListener('change', () =>
    update(Math.max(+num.min, Math.min(+num.max, +num.value)))
  );
}

function wireSegControl(segId, cfgKey, onChange) {
  document.getElementById(segId).addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll(`#${segId} .seg-btn`)
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (cfgKey) cfg[cfgKey] = btn.dataset.val;
    if (onChange) onChange(btn.dataset.val);
  });
}

function setMode(mode) {
  cfg.mode = mode;
  document.getElementById('grp-angle') .classList.toggle('hidden', mode === 'raised');
  document.getElementById('grp-height').classList.toggle('hidden', mode === 'unilevel');
  if (launched) reset();
}

function applyPreset(key) {
  cfg.preset = key;
  if (!key || !PRESETS[key]) return;
  const p = PRESETS[key];
  cfg.beta  = p.beta;
  cfg.speed = p.speed;
  document.getElementById('slider-beta').value  = p.beta;
  document.getElementById('num-beta').value     = p.beta;
  document.getElementById('slider-speed').value = p.speed;
  document.getElementById('num-speed').value    = p.speed;
  if (cfg.mode === 'unilevel') {
    cfg.angle = p.angle;
    document.getElementById('slider-angle').value = p.angle;
    document.getElementById('num-angle').value    = p.angle;
  }
}

/* ── Boot ────────────────────────────────────────────────── */
syncSliderNum('slider-angle',  'num-angle',  'angle');
syncSliderNum('slider-height', 'num-height', 'height');
syncSliderNum('slider-speed',  'num-speed',  'speed');
syncSliderNum('slider-beta',   'num-beta',   'beta');

wireSegControl('seg-mode',    'mode',    val => setMode(val));
wireSegControl('seg-display', 'display', null);
wireSegControl('seg-stats',   null,      val => { cfg.showStats = val === 'show'; });

document.getElementById('sel-preset').addEventListener('change', e => {
  applyPreset(e.target.value);   // also sets cfg.preset inside applyPreset
});

document.getElementById('btn-fire').addEventListener('click',  fire);
document.getElementById('btn-reset').addEventListener('click', reset);

draw(0);
