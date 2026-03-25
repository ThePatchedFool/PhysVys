'use strict';

/* ── Constants ──────────────────────────────────────────── */
const CW = 960, CH = 560;
const OBJ_CX = 350, OBJ_CY = 290;   // sprite centre on canvas

/* ── Preset / environment / gravity data ─────────────────── */
const PRESETS = {
  spread:    { m: 80,     cd: 1.00, a: 0.70,    group: 'skydiver' },
  headdown:  { m: 80,     cd: 0.70, a: 0.18,    group: 'skydiver' },
  wingsuit:  { m: 80,     cd: 0.35, a: 1.50,    group: 'skydiver' },
  parachute: { m: 80,     cd: 1.50, a: 44.0,    group: 'skydiver' },
  feather:   { m: 0.003,  cd: 1.00, a: 0.002,   group: 'other'    },
  raindrop:  { m: 1e-4,   cd: 0.47, a: 7.85e-5, group: 'other'    },
  tennis:    { m: 0.058,  cd: 0.47, a: 0.0034,  group: 'other'    },
  bowling:   { m: 6.0,    cd: 0.47, a: 0.0573,  group: 'other'    },
};

const ENVS = {
  sealevel: { rho: 1.225,  sky: ['#6ab4e8', '#c4e4ff'], streakCol: 'rgba(255,255,255,0.55)' },
  highalt:  { rho: 0.526,  sky: ['#1a3560', '#2e5fa3'], streakCol: 'rgba(180,210,255,0.45)' },
  strato:   { rho: 0.0889, sky: ['#04070f', '#0d1b3e'], streakCol: 'rgba(140,170,255,0.30)' },
  mars:     { rho: 0.020,  sky: ['#6b2808', '#c2581e'], streakCol: 'rgba(240,190,120,0.45)' },
};

const GRAVITIES = {
  earth: { g: 9.80 },
  moon:  { g: 1.62 },
  mars:  { g: 3.72 },
};

/* ── Config ─────────────────────────────────────────────── */
const cfg = {
  group:        'skydiver',
  preset:       'spread',
  env:          'sealevel',
  gravity:      'earth',
  params:       'preset',
  cd:           1.00,
  area:         0.70,
  mass:         80,
  chuteDeployed: false,
};

/* ── State ──────────────────────────────────────────────── */
let dropped            = false;
let animId             = null;
let v                  = 0;
let elapsed            = 0;
let lastTs             = null;
let vtHistory          = [];
let graphXMax          = 10;
let terminalReachedAt  = null;   // elapsed time when v first hit 99 % of v_T

const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');

/* ── Physics ─────────────────────────────────────────────── */
function getRho()     { return ENVS[cfg.env].rho; }
function getG()       { return GRAVITIES[cfg.gravity].g; }
function getK()       { return 0.5 * getRho() * cfg.cd * cfg.area; }
function terminalV()  { const k = getK(); return k > 0 ? Math.sqrt(cfg.mass * getG() / k) : Infinity; }

function rk4Step(vNow, dt) {
  const f = u => getG() - (getK() / cfg.mass) * u * u;
  const k1 = f(vNow);
  const k2 = f(vNow + 0.5*dt*k1);
  const k3 = f(vNow + 0.5*dt*k2);
  const k4 = f(vNow + dt*k3);
  return Math.max(0, vNow + dt/6 * (k1 + 2*k2 + 2*k3 + k4));
}

function computeGraphXMax() {
  const vT = terminalV();
  if (!isFinite(vT)) return 30;
  return Math.max(10, (vT / getG()) * 6);   // ~6 time-constants ≈ 99.75% of v_T
}

/* ── Wind streaks ────────────────────────────────────────── */
const STREAK_N = 50;
const streaks  = [];

function initStreaks() {
  streaks.length = 0;
  for (let i = 0; i < STREAK_N; i++) {
    streaks.push({
      x: Math.random() * CW,
      y: Math.random() * CH,
      len:   14 + Math.random() * 30,
      spd:   0.7 + Math.random() * 0.6,
      alpha: 0.15 + Math.random() * 0.35,
    });
  }
}

function stepStreaks(dt, vNow) {
  const vT      = terminalV();
  const ref     = isFinite(vT) ? Math.max(vT, 1) : Math.max(v, 1);
  const pxPerSec = dropped
    ? (vNow / ref) * 400
    : 35;   // gentle idle breeze
  for (const s of streaks) {
    s.y -= s.spd * pxPerSec * dt;
    if (s.y + s.len < 0) {
      s.y   = CH + s.len;
      s.x   = Math.random() * CW;
      s.len = 14 + Math.random() * 30;
      s.alpha = 0.15 + Math.random() * 0.35;
    }
  }
}

function drawStreaks() {
  const col = ENVS[cfg.env].streakCol;
  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth   = 1.2;
  ctx.setLineDash([]);
  for (const s of streaks) {
    ctx.globalAlpha = s.alpha;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x, s.y + s.len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ── Sky background ──────────────────────────────────────── */
function drawSky() {
  const [c1, c2] = ENVS[cfg.env].sky;
  const grad = ctx.createLinearGradient(0, 0, 0, CH);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CW, CH);
}

/* ── Rich-text helper (supports subscripts) ─────────────── */
// parts: [{text: '...', sub: '...' (optional)}]
function richText(parts, x, y, sizePx, bold, color) {
  ctx.textAlign = 'left';
  const pf = bold ? 'bold ' : '';
  ctx.fillStyle = color;
  let cx = x;
  for (const p of parts) {
    ctx.font = `${pf}${sizePx}px "Trebuchet MS", sans-serif`;
    ctx.fillText(p.text, cx, y);
    cx += ctx.measureText(p.text).width;
    if (p.sub) {
      ctx.font = `${pf}${Math.round(sizePx * 0.70)}px "Trebuchet MS", sans-serif`;
      ctx.fillText(p.sub, cx, y + sizePx * 0.30);
      cx += ctx.measureText(p.sub).width;
    }
  }
  return cx - x;   // total width drawn
}

function measureRich(parts, sizePx, bold) {
  const pf = bold ? 'bold ' : '';
  let w = 0;
  for (const p of parts) {
    ctx.font = `${pf}${sizePx}px "Trebuchet MS", sans-serif`;
    w += ctx.measureText(p.text).width;
    if (p.sub) {
      ctx.font = `${pf}${Math.round(sizePx * 0.70)}px "Trebuchet MS", sans-serif`;
      w += ctx.measureText(p.sub).width;
    }
  }
  return w;
}

/* ── Canvas rounded-rect helper ─────────────────────────── */
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

/* ── v-t graph overlay ───────────────────────────────────── */
const GX = 568, GY = 18, GW = 378, GH = 202;
const GPL = 48, GPR = 14, GPT = 24, GPB = 52;
const GIX = GX + GPL, GIY = GY + GPT;
const GIW = GW - GPL - GPR, GIH = GH - GPT - GPB;

function drawGraph() {
  const vT   = terminalV();
  const vMax = Math.max(
    isFinite(vT) ? vT * 1.18 : 0,
    vtHistory.length ? Math.max(...vtHistory.map(p => p.v)) * 1.1 : 0,
    v * 1.1,
    1
  );
  const tMax = Math.max(graphXMax, elapsed * 1.08, 5);

  // Panel
  roundRect(GX, GY, GW, GH, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.90)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(21,48,77,0.14)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();

  // Clip inner area
  ctx.save();
  ctx.beginPath();
  ctx.rect(GIX, GIY, GIW, GIH);
  ctx.clip();

  // vT dashed line — only once terminal velocity has been reached
  if (terminalReachedAt !== null && isFinite(vT) && vT < vMax) {
    const py = GIY + GIH * (1 - vT / vMax);
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(21,48,77,0.28)';
    ctx.lineWidth = 1;
    ctx.moveTo(GIX, py);
    ctx.lineTo(GIX + GIW, py);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // v-t curve
  if (vtHistory.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    let first = true;
    for (const pt of vtHistory) {
      const px = GIX + (pt.t / tMax) * GIW;
      const py = GIY + GIH * (1 - pt.v / vMax);
      if (first) { ctx.moveTo(px, py); first = false; }
      else        ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Live dot
    const last = vtHistory[vtHistory.length - 1];
    const dx = GIX + (last.t / tMax) * GIW;
    const dy = GIY + GIH * (1 - last.v / vMax);
    ctx.beginPath();
    ctx.arc(dx, dy, 4.5, 0, 2*Math.PI);
    ctx.fillStyle = '#1d4ed8';
    ctx.fill();
  }

  ctx.restore();   // end clip

  // Axes
  ctx.strokeStyle = 'rgba(21,48,77,0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(GIX, GIY); ctx.lineTo(GIX, GIY + GIH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(GIX, GIY + GIH); ctx.lineTo(GIX + GIW, GIY + GIH); ctx.stroke();

  // Axis labels
  ctx.font = '11px "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#475569';
  // t axis — small label at right end of axis, below it
  ctx.textAlign = 'right';
  ctx.fillText('t (s)', GIX + GIW, GIY + GIH + 13);
  // v axis — rotated label
  ctx.save();
  ctx.translate(GX + 10, GIY + GIH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('v (m/s)', 0, 0);
  ctx.restore();

  // vT label to left of dashed line — only when reached
  if (terminalReachedAt !== null && isFinite(vT) && vT < vMax) {
    const py = GIY + GIH * (1 - vT / vMax);
    ctx.fillStyle = 'rgba(21,48,77,0.55)';
    const w = measureRich([{text:'v', sub:'T'}], 11, false);
    richText([{text:'v', sub:'T'}], GIX - 4 - w, py + 4, 11, false, 'rgba(21,48,77,0.55)');
  }

  // ── Readout strip ────────────────────────────────────────
  const RS = 12;   // font size for readout
  const ry1 = GY + GH - 28;   // first readout line
  const ry2 = GY + GH - 11;   // second readout line

  // Left: current v
  richText([{text:`v = ${v.toFixed(1)} m/s`}], GIX, ry1, RS, true, '#1d4ed8');

  // Centre: vT value (only when reached, else show nothing or approaching label)
  if (terminalReachedAt !== null && isFinite(vT)) {
    const parts = [{text:'v', sub:'T'}, {text:` = ${vT.toFixed(1)} m/s`}];
    const w = measureRich(parts, RS, true);
    richText(parts, GIX + GIW/2 - w/2, ry1, RS, true, '#334155');
  }

  // Right: percentage of vT
  if (isFinite(vT) && vT > 0) {
    const pct = Math.min(100, v / vT * 100);
    const parts = [{text:`${pct.toFixed(0)}% of v`, sub:'T'}];
    const w = measureRich(parts, RS, true);
    richText(parts, GIX + GIW - w, ry1, RS, true, '#475569');
  }

  // Second line: "Reached vT in X.X s" when terminal velocity is reached
  if (terminalReachedAt !== null) {
    const parts = [
      {text:'Reached v', sub:'T'},
      {text:` in ${terminalReachedAt.toFixed(1)} s`},
    ];
    const w = measureRich(parts, RS, false);
    richText(parts, GIX + GIW/2 - w/2, ry2, RS, false, '#059669');
  }

  ctx.textAlign = 'left';
}

/* ── Object sprites ──────────────────────────────────────── */
// Each function draws centred at (0,0); caller translates to (OBJ_CX, OBJ_CY).

function spriteSpread() {
  const SUIT = '#1e3a5f', SKIN = '#f5c5a0', BOOT = '#111';
  // Left arm slab
  ctx.beginPath();
  ctx.moveTo(-12, -18); ctx.lineTo(-46, -4); ctx.lineTo(-44, 10); ctx.lineTo(-10, -4);
  ctx.fillStyle = SUIT; ctx.fill();
  // Right arm slab
  ctx.beginPath();
  ctx.moveTo(12, -18); ctx.lineTo(46, -4); ctx.lineTo(44, 10); ctx.lineTo(10, -4);
  ctx.fillStyle = SUIT; ctx.fill();
  // Body
  ctx.fillStyle = SUIT;
  ctx.fillRect(-12, -27, 24, 36);
  // Left leg
  ctx.beginPath();
  ctx.moveTo(-8, 9); ctx.lineTo(-28, 42); ctx.lineTo(-18, 44); ctx.lineTo(-2, 13);
  ctx.fillStyle = SUIT; ctx.fill();
  // Right leg
  ctx.beginPath();
  ctx.moveTo(8, 9); ctx.lineTo(28, 42); ctx.lineTo(18, 44); ctx.lineTo(2, 13);
  ctx.fillStyle = SUIT; ctx.fill();
  // Boots
  ctx.fillStyle = BOOT;
  for (const bx of [-24, 22]) { ctx.beginPath(); ctx.ellipse(bx, 43, 9, 5, 0, 0, 2*Math.PI); ctx.fill(); }
  // Head
  ctx.beginPath(); ctx.arc(0, -37, 11, 0, 2*Math.PI); ctx.fillStyle = SKIN; ctx.fill();
  // Helmet
  ctx.beginPath(); ctx.arc(0, -39, 12, Math.PI, 2*Math.PI);
  ctx.fillStyle = '#c41a1a'; ctx.fill();
}

function spriteHeadDown() {
  const SUIT = '#1e3a5f', SKIN = '#f5c5a0';
  // Boots (top — feet first)
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.ellipse(0, -46, 11, 6, 0, 0, 2*Math.PI); ctx.fill();
  // Legs together
  ctx.fillStyle = SUIT; ctx.fillRect(-10, -40, 20, 34);
  // Body
  ctx.fillStyle = SUIT; ctx.fillRect(-12, -6, 24, 32);
  // Arms tight
  ctx.fillStyle = SUIT; ctx.fillRect(-18, -5, 8, 28);
  ctx.fillRect(10, -5, 8, 28);
  // Head (bottom)
  ctx.beginPath(); ctx.arc(0, 38, 11, 0, 2*Math.PI); ctx.fillStyle = SKIN; ctx.fill();
  // Helmet
  ctx.beginPath(); ctx.arc(0, 35, 13, Math.PI, 2*Math.PI); ctx.fillStyle = '#c41a1a'; ctx.fill();
}

function spriteWingsuit() {
  const SUIT = '#1a2a40', WING = '#1a4080', SKIN = '#f5c5a0';
  // Left wing
  ctx.beginPath();
  ctx.moveTo(-11, -22); ctx.lineTo(-65, 8); ctx.lineTo(-60, 20); ctx.lineTo(-11, 2);
  ctx.fillStyle = WING; ctx.fill();
  ctx.strokeStyle = '#2060c0'; ctx.lineWidth = 0.8; ctx.stroke();
  // Right wing
  ctx.beginPath();
  ctx.moveTo(11, -22); ctx.lineTo(65, 8); ctx.lineTo(60, 20); ctx.lineTo(11, 2);
  ctx.fillStyle = WING; ctx.fill();
  ctx.strokeStyle = '#2060c0'; ctx.lineWidth = 0.8; ctx.stroke();
  // Leg wing
  ctx.beginPath();
  ctx.moveTo(-11, 8); ctx.lineTo(-34, 44); ctx.lineTo(34, 44); ctx.lineTo(11, 8);
  ctx.fillStyle = WING; ctx.fill();
  ctx.strokeStyle = '#2060c0'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.setLineDash([]);
  // Body
  ctx.fillStyle = SUIT; ctx.fillRect(-11, -32, 22, 56);
  // Head
  ctx.beginPath(); ctx.arc(0, -42, 10, 0, 2*Math.PI); ctx.fillStyle = SKIN; ctx.fill();
  // Helmet
  ctx.beginPath(); ctx.arc(0, -44, 11, Math.PI, 2*Math.PI); ctx.fillStyle = '#111'; ctx.fill();
}

function spriteParachute() {
  ctx.setLineDash([]);
  // Canopy
  const R = 72;
  ctx.beginPath();
  ctx.arc(0, -75, R, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.strokeStyle = '#7f1d1d'; ctx.lineWidth = 1; ctx.stroke();
  // Panel dividers (radial lines)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
  for (let i = 1; i <= 7; i++) {
    const a = Math.PI + i * Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(0, -75);
    ctx.lineTo(R * Math.cos(a), -75 + R * Math.sin(a));
    ctx.stroke();
  }
  // Alternating panel colour
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 4; i++) {
    const a1 = Math.PI + i * 2 * Math.PI / 8;
    const a2 = a1 + Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(0, -75);
    ctx.arc(0, -75, R, a1, a2);
    ctx.closePath();
    ctx.fill();
  }
  // Risers
  ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 0.9;
  for (const lx of [-52, -26, 0, 26, 52]) {
    const ly = -75 + Math.sqrt(Math.max(0, R*R - lx*lx));
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx * 0.25, 12); ctx.stroke();
  }
  // Person
  const SUIT = '#1e3a5f', SKIN = '#f5c5a0';
  ctx.beginPath(); ctx.arc(0, 2, 9, 0, 2*Math.PI); ctx.fillStyle = SKIN; ctx.fill();
  ctx.fillStyle = SUIT; ctx.fillRect(-9, 11, 18, 28);
  ctx.strokeStyle = SUIT; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-9, 17); ctx.lineTo(-22, 32); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9, 17);  ctx.lineTo(22, 32);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5, 39); ctx.lineTo(-9, 55);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(5, 39);  ctx.lineTo(9, 55);   ctx.stroke();
  ctx.lineWidth = 1;
}

function spriteFeather() {
  ctx.strokeStyle = '#8b7355'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(0, 48); ctx.stroke();
  const N = 22;
  for (let i = 0; i < N; i++) {
    const y       = -42 + i * (90 / N);
    const spread  = 22 * Math.sin(Math.PI * i / (N - 1));
    const alpha   = 0.45 + 0.45 * Math.sin(Math.PI * i / (N - 1));
    ctx.strokeStyle = `rgba(175,150,110,${alpha.toFixed(2)})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(-spread*0.4, y+3, -spread, y+7, -spread*1.1, y+9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(spread*0.4, y+3, spread, y+7, spread*1.1, y+9);
    ctx.stroke();
  }
}

function spriteRaindrop() {
  ctx.beginPath();
  ctx.moveTo(0, -42);
  ctx.bezierCurveTo(24, -12, 24, 18, 0, 32);
  ctx.bezierCurveTo(-24, 18, -24, -12, 0, -42);
  ctx.closePath();
  const grad = ctx.createLinearGradient(-16, -42, 16, 32);
  grad.addColorStop(0, 'rgba(160,215,255,0.92)');
  grad.addColorStop(1, 'rgba(30,110,200,0.85)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,80,180,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-6, -18, 4, 9, -0.4, 0, 2*Math.PI);
  ctx.fillStyle = 'rgba(255,255,255,0.40)'; ctx.fill();
}

function spriteTennisBall() {
  const r = 32;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 2*Math.PI);
  ctx.fillStyle = '#a3e635'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2.5; ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(-r, 0); ctx.bezierCurveTo(-r*0.4, -r*0.7,  r*0.4, r*0.7,  r, 0); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r, 0); ctx.bezierCurveTo(-r*0.4,  r*0.7,  r*0.4, -r*0.7, r, 0); ctx.stroke();
}

function spriteBowlingBall() {
  const r = 36;
  const grad = ctx.createRadialGradient(-12, -12, 3, 0, 0, r);
  grad.addColorStop(0, '#6b3a7d'); grad.addColorStop(1, '#180a22');
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 2*Math.PI);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  for (const [hx, hy] of [[-9,-10],[3,-17],[13,-6]]) {
    ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, 2*Math.PI); ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(-13, -15, 6, 11, -0.5, 0, 2*Math.PI);
  ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fill();
}

function drawSprite() {
  ctx.save();
  ctx.translate(OBJ_CX, OBJ_CY);
  ctx.setLineDash([]);
  const p = cfg.preset;
  switch (p) {
    case 'spread':    spriteSpread();    break;
    case 'headdown':  spriteHeadDown();  break;
    case 'wingsuit':  spriteWingsuit();  break;
    case 'parachute': spriteParachute(); break;
    case 'feather':   spriteFeather();   break;
    case 'raindrop':  spriteRaindrop();  break;
    case 'tennis':    spriteTennisBall(); break;
    case 'bowling':   spriteBowlingBall(); break;
  }
  ctx.restore();
}

/* ── Force arrows ────────────────────────────────────────── */
function drawForceArrows() {
  if (!dropped) return;
  const Fg   = cfg.mass * getG();
  const Fd   = getK() * v * v;
  const AX   = OBJ_CX + 105;
  const AY   = OBJ_CY;
  const scale = 80 / Fg;

  function arrow(len, col, mainLetter, sub, valN, down) {
    const sign = down ? 1 : -1;
    const endY = AY + sign * Math.max(len, 8);
    ctx.beginPath(); ctx.moveTo(AX, AY); ctx.lineTo(AX, endY);
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([]); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(AX, endY);
    ctx.lineTo(AX - 6, endY - sign*10);
    ctx.lineTo(AX + 6, endY - sign*10);
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    richText(
      [{text: mainLetter, sub}, {text: ` = ${valN.toFixed(0)} N`}],
      AX + 10, endY + (down ? 5 : -5), 12, true, col
    );
  }

  arrow(Fg * scale, '#e11d48', 'F', 'g', Fg, true);
  if (Fd >= 0.5) {
    arrow(Fd * scale, '#1d4ed8', 'F', 'd', Fd, false);
  }
}

/* ── Full render ─────────────────────────────────────────── */
function draw() {
  ctx.clearRect(0, 0, CW, CH);
  drawSky();
  drawStreaks();
  drawSprite();
  drawForceArrows();
  drawGraph();
}

/* ── Animation loops ─────────────────────────────────────── */
function physicsLoop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  const vT = terminalV();
  v = v < vT * 0.9995 ? rk4Step(v, dt) : vT;
  elapsed += dt;
  vtHistory.push({ t: elapsed, v });
  if (vtHistory.length > 3000) vtHistory.splice(0, vtHistory.length - 3000);
  if (terminalReachedAt === null && isFinite(vT) && v >= vT * 0.99) {
    terminalReachedAt = elapsed;
  }

  stepStreaks(dt, v);
  draw();
  animId = requestAnimationFrame(physicsLoop);
}

function idleLoop(ts) {
  if (dropped) return;
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  stepStreaks(dt, 0);
  draw();
  animId = requestAnimationFrame(idleLoop);
}

/* ── Actions ─────────────────────────────────────────────── */
function startDrop() {
  if (animId) cancelAnimationFrame(animId);
  dropped   = true;
  v         = 0;
  elapsed   = 0;
  lastTs    = null;
  vtHistory = [];
  graphXMax         = computeGraphXMax();
  terminalReachedAt = null;
  cfg.chuteDeployed = false;
  updateDeployBtn();
  initStreaks();
  animId = requestAnimationFrame(physicsLoop);
}

function doReset() {
  if (animId) cancelAnimationFrame(animId);
  dropped   = false;
  v         = 0;
  elapsed   = 0;
  lastTs    = null;
  vtHistory         = [];
  graphXMax         = computeGraphXMax();
  terminalReachedAt = null;
  cfg.chuteDeployed = false;
  updateDeployBtn();
  initStreaks();
  animId = requestAnimationFrame(idleLoop);
}

function deployChute() {
  if (!dropped || cfg.chuteDeployed || cfg.preset === 'parachute') return;
  cfg.chuteDeployed = true;
  cfg.preset = 'parachute';
  const p    = PRESETS.parachute;
  cfg.cd   = p.cd;
  cfg.area = p.a;
  // mass unchanged — it's the same skydiver
  graphXMax = Math.max(graphXMax, elapsed + computeGraphXMax() * 0.6);
  updateDeployBtn();
  if (cfg.params === 'custom') syncCustomToUI();
}

function updateDeployBtn() {
  const btn = document.getElementById('btn-deploy');
  const hide = cfg.group !== 'skydiver';
  document.getElementById('grp-deploy').classList.toggle('hidden', hide);
  btn.disabled = hide || !dropped || cfg.chuteDeployed || cfg.preset === 'parachute';
}

/* ── Preset / param helpers ──────────────────────────────── */
function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  cfg.preset = key;
  cfg.cd     = p.cd;
  cfg.area   = p.a;
  cfg.mass   = p.m;
  cfg.chuteDeployed = false;
  graphXMax  = computeGraphXMax();
  if (cfg.params === 'custom') syncCustomToUI();
  updateDeployBtn();
  doReset();
}

function syncCustomToUI() {
  document.getElementById('slider-cd').value   = cfg.cd;
  document.getElementById('num-cd').value      = cfg.cd;
  document.getElementById('slider-area').value = Math.min(cfg.area, 2.0);
  document.getElementById('num-area').value    = cfg.area;
  document.getElementById('slider-mass').value = Math.min(cfg.mass, 100);
  document.getElementById('num-mass').value    = cfg.mass;
}

/* ── Wiring ──────────────────────────────────────────────── */
function wireSegControl(id, onChange) {
  document.getElementById(id).addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll(`#${id} .seg-btn`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onChange(btn.dataset.val);
  });
}

function syncSliderNum(sliderId, numId, cfgKey) {
  const slider = document.getElementById(sliderId);
  const num    = document.getElementById(numId);
  function update(raw) {
    cfg[cfgKey] = +raw;
    slider.value = raw;
    num.value    = raw;
    graphXMax = computeGraphXMax();
  }
  slider.addEventListener('input',  () => update(slider.value));
  num.addEventListener('change', () =>
    update(Math.max(+num.min, Math.min(+num.max, +num.value)))
  );
}

wireSegControl('seg-group', val => {
  cfg.group = val;
  const isSky = val === 'skydiver';
  document.getElementById('grp-skydiver').classList.toggle('hidden', !isSky);
  document.getElementById('grp-other').classList.toggle('hidden',     isSky);
  updateDeployBtn();
  const firstKey = isSky ? 'spread' : 'feather';
  applyPreset(firstKey);
  document.querySelectorAll(`#seg-${val} .seg-btn`).forEach((b, i) => b.classList.toggle('active', i === 0));
});

wireSegControl('seg-skydiver', val => applyPreset(val));
wireSegControl('seg-other',    val => applyPreset(val));
wireSegControl('seg-env',      val => { cfg.env = val; graphXMax = computeGraphXMax(); });
wireSegControl('seg-gravity',  val => { cfg.gravity = val; graphXMax = computeGraphXMax(); });

wireSegControl('seg-params', val => {
  cfg.params = val;
  document.getElementById('grp-custom').classList.toggle('hidden', val !== 'custom');
  if (val === 'custom') syncCustomToUI();
});

syncSliderNum('slider-cd',   'num-cd',   'cd');
syncSliderNum('slider-area', 'num-area', 'area');
syncSliderNum('slider-mass', 'num-mass', 'mass');

document.getElementById('btn-drop').addEventListener('click',   startDrop);
document.getElementById('btn-reset').addEventListener('click',  doReset);
document.getElementById('btn-deploy').addEventListener('click', deployChute);

/* ── Boot ────────────────────────────────────────────────── */
applyPreset('spread');
initStreaks();
doReset();
