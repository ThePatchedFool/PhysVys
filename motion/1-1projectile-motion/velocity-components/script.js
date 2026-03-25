'use strict';

/* ── Canvas setup ────────────────────────────────────────── */
const canvas  = document.getElementById('sim-canvas');
const ctx     = canvas.getContext('2d');
const CW      = 960;
const BASE_CH = 560;
let   CH      = BASE_CH;

/* ── Physics constants ───────────────────────────────────── */
const G = 9.8;

/* ── Layout constants ────────────────────────────────────── */
const GROUND_PX  = 60;
const SKY_PX     = BASE_CH - GROUND_PX;   // 500 — fixed regardless of CH
const BALL_R     = 9;
const DROP_COL   = '#3b82f6';    // blue  — dropped ball
const PROJ_COL   = '#f97316';    // orange — launched ball
const COMP_SCALE = 5;            // canvas px per m/s for velocity arrows
const VEC_SCALE  = 4;            // canvas px per m/s for pre-fire preview arrow
const LAUNCH_CX  = CW * 0.12;   // fixed canvas x of the shared launch/drop point (~115 px)
const PAD_TOP    = 28;           // min canvas px above launch point
const PAD_RIGHT  = 28;           // min canvas px right of projectile landing
const TRACE_STEPS = 300;

/* ── Config ──────────────────────────────────────────────── */
const cfg = {
  mode:      'animation',
  height:    20,    // m  — launch height above ground
  speed:     15,    // m/s — horizontal launch speed
  showLines: false,
  showVecs:  false,
  showTimes: false,
};

/* ── Dynamic scale ───────────────────────────────────────── */
let scale    = 1;
let launchCY = 0;   // canvas y of the shared launch point; recomputed by computeScale()

function computeScale() {
  const T     = Math.sqrt(2 * cfg.height / G);
  const range = cfg.speed * T;
  const sy    = (SKY_PX - PAD_TOP)               / cfg.height;
  const sx    = (CW - LAUNCH_CX - PAD_RIGHT)      / Math.max(range, 1);
  scale    = Math.min(sx, sy);
  launchCY = SKY_PX - cfg.height * scale;   // ground line (SKY_PX) minus height in px
}

/* ── World → canvas ──────────────────────────────────────── */
// World origin = launch/drop point.  Positive y = up.
function wx(worldX) { return LAUNCH_CX + worldX * scale; }
function wy(worldY) { return launchCY  - worldY * scale; }

/* ── Physics helpers ─────────────────────────────────────── */
function dropPos(t)   { return { x: 0,             y: -0.5 * G * t * t }; }
function projPos(t)   { return { x: cfg.speed * t,  y: -0.5 * G * t * t }; }
function dropVel(t)   { return { vx: 0,             vy: -(G * t) }; }
function projVel(t)   { return { vx: cfg.speed,     vy: -(G * t) }; }

/* ── Simulation state ────────────────────────────────────── */
let animId         = null;
let launched       = false;
let flightT        = 0;
let flightDone     = false;
let fullTrace      = [];   // canvas pts along the projectile parabola
let strobePositions = [];  // [{drop:{cx,cy,vx,vy}, proj:{cx,cy,vx,vy}}]

function inFlight() { return launched && !flightDone; }

function buildFullTrace() {
  const T = Math.sqrt(2 * cfg.height / G);
  fullTrace = [];
  for (let i = 0; i <= TRACE_STEPS; i++) {
    const t = (i / TRACE_STEPS) * T;
    const p = projPos(t);
    fullTrace.push({ cx: wx(p.x), cy: wy(p.y) });
  }
}

/* ── DOM refs ────────────────────────────────────────────── */
const fireBtn      = document.getElementById('btn-fire');
const sliderHeight = document.getElementById('slider-height');
const sliderSpeed  = document.getElementById('slider-speed');
const numHeight    = document.getElementById('num-height');
const numSpeed     = document.getElementById('num-speed');
const scrubberEl   = document.getElementById('scrubber');
const scrubberTime = document.getElementById('scrubber-time');

/* ── Control sync ────────────────────────────────────────── */
function syncHeight(v) {
  cfg.height = Math.max(5, Math.min(50, +v));
  sliderHeight.value = cfg.height;
  numHeight.value    = cfg.height;
  if (inFlight()) return;
  computeScale();
  onParamsChanged();
}

function syncSpeed(v) {
  cfg.speed = Math.max(5, Math.min(30, +v));
  sliderSpeed.value = cfg.speed;
  numSpeed.value    = cfg.speed;
  if (inFlight()) return;
  computeScale();
  onParamsChanged();
}

sliderHeight.addEventListener('input',  () => syncHeight(sliderHeight.value));
numHeight.addEventListener('change',    () => syncHeight(numHeight.value));
sliderSpeed.addEventListener('input',   () => syncSpeed(sliderSpeed.value));
numSpeed.addEventListener('change',     () => syncSpeed(numSpeed.value));

/* ── Background ──────────────────────────────────────────── */
function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, SKY_PX);
  sky.addColorStop(0, '#4aa8e0');
  sky.addColorStop(1, '#a8d8f0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, SKY_PX);
}

function drawGround() {
  const gnd = ctx.createLinearGradient(0, SKY_PX, 0, CH);
  gnd.addColorStop(0,   '#5a9e3a');
  gnd.addColorStop(0.3, '#4a8a2e');
  gnd.addColorStop(1,   '#3a6e22');
  ctx.fillStyle = gnd;
  ctx.fillRect(0, SKY_PX, CW, CH - SKY_PX);
  ctx.strokeStyle = '#6abb44';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(0, SKY_PX);
  ctx.lineTo(CW, SKY_PX);
  ctx.stroke();
}

/* ── Arrow + label helpers ───────────────────────────────── */
function arrow(x1, y1, x2, y2, col, lw = 2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len, uy = dy / len;
  const headLen = Math.min(10, len * 0.4);
  ctx.save();
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - ux * headLen * 0.7, y2 - uy * headLen * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * headLen - uy * headLen * 0.4, y2 - uy * headLen + ux * headLen * 0.4);
  ctx.lineTo(x2 - ux * headLen + uy * headLen * 0.4, y2 - uy * headLen - ux * headLen * 0.4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function canvasLabel(x, y, text, col, align = 'left', baseline = 'middle', sz = 13) {
  ctx.save();
  ctx.fillStyle    = col;
  ctx.font         = `bold ${sz}px "Trebuchet MS", sans-serif`;
  ctx.textAlign    = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* ── Ball drawing ────────────────────────────────────────── */
function drawBall(cx, cy, col) {
  ctx.save();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(cx, cy, BALL_R, 0, 2 * Math.PI);
  ctx.fill();
  // Highlight spot
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.beginPath();
  ctx.arc(cx - BALL_R * 0.3, cy - BALL_R * 0.32, BALL_R * 0.38, 0, 2 * Math.PI);
  ctx.fill();
  // Border
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth   = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, BALL_R, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

/* ── Velocity component vectors ──────────────────────────── */
// vx, vy are in world units (m/s).  vy is negative when falling.
function drawVectors(cx, cy, vx, vy) {
  // Horizontal (dark blue) — only if non-zero
  if (Math.abs(vx) > 0.5) {
    const hLen = vx * COMP_SCALE;
    arrow(cx, cy, cx + hLen, cy, '#1d4ed8', 2);
    canvasLabel(cx + hLen + 5, cy, 'vₕ', '#1d4ed8', 'left', 'middle', 11);
  }
  // Vertical (pink) — vy < 0 means downward, so canvas arrow goes downward (+y)
  const vLen = -vy * COMP_SCALE;
  if (vLen > 2) {
    arrow(cx, cy, cx, cy + vLen, '#f472b6', 2);
    canvasLabel(cx + 5, cy + vLen + 10, 'vᵥ', '#f472b6', 'left', 'middle', 11);
  }
}

/* ── Guiding line ────────────────────────────────────────── */
// Draws a horizontal dashed line at canvas-y `cy` from dropCX to projCX.
// In animation mode pass showLabel=true; in strobe mode pass false.
function drawGuidingLine(dropCX, cy, projCX, showLabel) {
  if (projCX <= dropCX + 2) return;   // nothing to draw at t = 0
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(dropCX, cy);
  ctx.lineTo(projCX, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  if (showLabel) {
    // Height above ground (world y) = worldY + cfg.height
    const worldY   = (launchCY - cy) / scale;
    const hAbove   = worldY + cfg.height;
    if (hAbove > 0.1) {
      const mid = (dropCX + projCX) / 2;
      canvasLabel(mid, cy - 6, `${hAbove.toFixed(1)} m`, 'rgba(255,255,255,0.88)',
                  'center', 'bottom', 10);
    }
  }
  ctx.restore();
}

/* ── Faint path overlays ─────────────────────────────────── */
// Vertical dashed line — drop ball path
function drawDropPath() {
  ctx.save();
  ctx.strokeStyle = 'rgba(59,130,246,0.3)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(LAUNCH_CX, launchCY);
  ctx.lineTo(LAUNCH_CX, SKY_PX);
  ctx.stroke();
  ctx.restore();
}

// Faint dashed parabola — projectile path
function drawFullTraceFaint() {
  if (fullTrace.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(249,115,22,0.28)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(fullTrace[0].cx, fullTrace[0].cy);
  for (let i = 1; i < fullTrace.length; i++) ctx.lineTo(fullTrace[i].cx, fullTrace[i].cy);
  ctx.stroke();
  ctx.restore();
}

// Progressive solid trace for the projectile (animation mode)
function drawProjTraceTo(stepIndex) {
  if (fullTrace.length < 2 || stepIndex < 1) return;
  const end = Math.min(stepIndex, fullTrace.length - 1);
  ctx.save();
  ctx.strokeStyle = 'rgba(249,115,22,0.85)';
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(fullTrace[0].cx, fullTrace[0].cy);
  for (let i = 1; i <= end; i++) ctx.lineTo(fullTrace[i].cx, fullTrace[i].cy);
  ctx.stroke();
  ctx.restore();
}

// Progressive vertical trail for the drop ball (animation mode)
function drawDropTrailTo(t) {
  if (t <= 0) return;
  const dp = dropPos(t);
  ctx.save();
  ctx.strokeStyle = 'rgba(59,130,246,0.85)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(LAUNCH_CX, launchCY);
  ctx.lineTo(LAUNCH_CX, wy(dp.y));
  ctx.stroke();
  ctx.restore();
}

/* ── Times box ───────────────────────────────────────────── */
function drawTimesBox(T) {
  const lines = [
    `Dropped:   t = ${T.toFixed(2)} s`,
    `Launched:  t = ${T.toFixed(2)} s`,
  ];
  const PX = 14, PY = 14, LH = 20, PAD = 10;
  const W = 215, HB = lines.length * LH + PAD * 2;
  const bx = CW - W - PX, by = PY;
  ctx.save();
  ctx.fillStyle   = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = 'rgba(21,48,77,0.18)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, W, HB, 10);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle    = '#15304d';
  ctx.font         = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + PAD, by + PAD + i * LH));
  ctx.restore();
}

/* ── Static preview (pre-fire) ───────────────────────────── */
function drawStatic() {
  drawSky();
  drawGround();
  drawDropPath();
  drawFullTraceFaint();

  // Both balls start at the same point — draw drop (blue) behind, proj (orange) in front
  drawBall(LAUNCH_CX, launchCY, DROP_COL);
  canvasLabel(LAUNCH_CX - BALL_R - 6, launchCY - BALL_R - 2, 'Drop',
              DROP_COL, 'right', 'bottom', 11);

  drawBall(LAUNCH_CX, launchCY, PROJ_COL);
  canvasLabel(LAUNCH_CX + BALL_R + 6, launchCY - BALL_R - 2, 'Launch',
              PROJ_COL, 'left', 'bottom', 11);

  // Horizontal velocity arrow for launched ball
  const arrowLen = cfg.speed * VEC_SCALE;
  arrow(LAUNCH_CX, launchCY, LAUNCH_CX + arrowLen, launchCY, PROJ_COL, 2.5);
  canvasLabel(LAUNCH_CX + arrowLen + 6, launchCY,
              `${cfg.speed} m/s`, 'rgba(249,115,22,0.95)', 'left', 'middle', 12);
}

/* ── Animation frame draw ────────────────────────────────── */
function drawAnimationAt(t) {
  const T      = Math.sqrt(2 * cfg.height / G);
  const dp     = dropPos(t);
  const pp     = projPos(t);
  const dv     = dropVel(t);
  const pv     = projVel(t);
  const dCX    = wx(dp.x);
  const dCY    = wy(dp.y);
  const pCX    = wx(pp.x);
  const pCY    = wy(pp.y);
  const tIdx   = Math.round((t / T) * TRACE_STEPS);

  drawSky();
  drawGround();
  drawDropPath();
  drawFullTraceFaint();
  drawDropTrailTo(t);
  drawProjTraceTo(tIdx);

  if (cfg.showLines) drawGuidingLine(dCX, dCY, pCX, true);

  if (cfg.showVecs) {
    drawVectors(dCX, dCY, dv.vx, dv.vy);
    drawVectors(pCX, pCY, pv.vx, pv.vy);
  }

  drawBall(dCX, dCY, DROP_COL);
  drawBall(pCX, pCY, PROJ_COL);

  if (flightDone && cfg.showTimes) drawTimesBox(T);
}

/* ── Strobe draw ─────────────────────────────────────────── */
function drawStrobe() {
  drawSky();
  drawGround();
  drawDropPath();
  drawFullTraceFaint();

  // Guiding lines underneath everything
  if (cfg.showLines) {
    strobePositions.forEach(s => drawGuidingLine(s.drop.cx, s.drop.cy, s.proj.cx, false));
  }

  // Vectors under balls
  if (cfg.showVecs) {
    strobePositions.forEach(s => {
      drawVectors(s.drop.cx, s.drop.cy, s.drop.vx, s.drop.vy);
      drawVectors(s.proj.cx, s.proj.cy, s.proj.vx, s.proj.vy);
    });
  }

  // Balls on top
  strobePositions.forEach(s => {
    drawBall(s.drop.cx, s.drop.cy, DROP_COL);
    drawBall(s.proj.cx, s.proj.cy, PROJ_COL);
  });

  if (cfg.showTimes) {
    const T = Math.sqrt(2 * cfg.height / G);
    drawTimesBox(T);
  }
}

/* ── Fire: animation ─────────────────────────────────────── */
function fireAnimation() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  launched   = true;
  flightDone = false;
  flightT    = 0;
  scrubberEl.disabled = true;
  scrubberEl.value    = 0;

  computeScale();
  buildFullTrace();
  const T = Math.sqrt(2 * cfg.height / G);

  let lastTs = null;
  function step(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    flightT += dt;
    if (flightT >= T) { flightT = T; flightDone = true; }

    scrubberEl.value         = Math.round((flightT / T) * 1000);
    scrubberTime.textContent = flightT.toFixed(2);

    drawAnimationAt(flightT);

    if (!flightDone) {
      animId = requestAnimationFrame(step);
    } else {
      animId = null;
      scrubberEl.disabled = false;
    }
  }
  animId = requestAnimationFrame(step);
}

/* ── Fire: strobe ────────────────────────────────────────── */
function fireStrobe() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  computeScale();
  buildFullTrace();

  // Extend canvas below ground to fit the downward vᵥ arrow on the bottom dots
  const T           = Math.sqrt(2 * cfg.height / G);
  const vyLanding   = G * T;
  const extraBottom = Math.ceil(vyLanding * COMP_SCALE) + 20;
  CH = BASE_CH + extraBottom;
  canvas.height = CH;

  const DT = T / 10;
  strobePositions = [];
  for (let i = 0; i <= 10; i++) {
    const t  = i * DT;
    const dp = dropPos(t);
    const pp = projPos(t);
    const dv = dropVel(t);
    const pv = projVel(t);
    strobePositions.push({
      drop: { cx: wx(dp.x), cy: wy(dp.y), vx: dv.vx, vy: dv.vy },
      proj: { cx: wx(pp.x), cy: wy(pp.y), vx: pv.vx, vy: pv.vy },
    });
  }

  launched   = true;
  flightDone = true;
  drawStrobe();
}

/* ── Reset ───────────────────────────────────────────────── */
function resetSim() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  if (CH !== BASE_CH) { CH = BASE_CH; canvas.height = CH; }
  launched        = false;
  flightT         = 0;
  flightDone      = false;
  fullTrace       = [];
  strobePositions = [];
  scrubberEl.value         = 0;
  scrubberEl.disabled      = true;
  scrubberTime.textContent = '0.00';
  computeScale();
  buildFullTrace();
  drawStatic();
}

/* ── onParamsChanged ─────────────────────────────────────── */
function onParamsChanged() {
  if (!launched || flightDone) resetSim();
}

/* ── setMode ─────────────────────────────────────────────── */
function setMode(mode) {
  cfg.mode = mode;
  document.querySelectorAll('#seg-mode .seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.val === mode));
  document.getElementById('scrubber-row').classList.toggle('hidden', mode !== 'animation');
  resetSim();
}

/* ── Toggle helper ───────────────────────────────────────── */
function redrawCurrent() {
  if (cfg.mode === 'strobe' && launched) {
    drawStrobe();
  } else if (flightDone && cfg.mode === 'animation') {
    drawAnimationAt(flightT);
  } else if (!launched) {
    drawStatic();
  }
}

function wireToggle(segId, key) {
  document.querySelectorAll(`#${segId} .seg-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      cfg[key] = btn.dataset.val === 'show';
      document.querySelectorAll(`#${segId} .seg-btn`)
        .forEach(b => b.classList.toggle('active', b === btn));
      redrawCurrent();
    });
  });
}

/* ── Event listeners ─────────────────────────────────────── */
document.querySelectorAll('#seg-mode .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.val !== cfg.mode) setMode(btn.dataset.val);
  });
});

fireBtn.addEventListener('click', () => {
  if (cfg.mode === 'animation') fireAnimation();
  else                          fireStrobe();
});

document.getElementById('btn-reset').addEventListener('click', () => resetSim());

scrubberEl.addEventListener('input', () => {
  if (!flightDone || fullTrace.length === 0) return;
  const T = Math.sqrt(2 * cfg.height / G);
  flightT = (scrubberEl.value / 1000) * T;
  scrubberTime.textContent = flightT.toFixed(2);
  drawAnimationAt(flightT);
});

wireToggle('seg-lines',   'showLines');
wireToggle('seg-vectors', 'showVecs');
wireToggle('seg-times',   'showTimes');

/* ── Boot ────────────────────────────────────────────────── */
setMode('animation');
