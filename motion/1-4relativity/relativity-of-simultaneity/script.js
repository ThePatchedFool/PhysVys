'use strict';

/* ── Canvas setup ────────────────────────────────────────── */
const canvas = document.getElementById('simulation-canvas');
const ctx    = canvas.getContext('2d');
const CW = canvas.width;   // 960
const CH = canvas.height;  // 560

/* ── Geometry ────────────────────────────────────────────── */
const BOX_W    = 300;
const BOX_H    = 110;
const BOX_WALL = 6;
const WHEEL_R  = 18;
const GROUND_Y = 490;
const BOX_BOTTOM_Y = GROUND_Y - WHEEL_R * 2;          // 454
const BOX_TOP_Y    = BOX_BOTTOM_Y - BOX_H;            // 344
const INT_H        = BOX_H - BOX_WALL * 2;            // 98
const INT_HALF     = (BOX_W - BOX_WALL * 2) / 2;      // 144
const EXP_Y        = BOX_TOP_Y + BOX_WALL + INT_H / 2; // 399

// In ground frame, always fire from this x so the action fits on canvas
// at all beta values (verified: fire_x + INT_HALF/(1-beta) <= 940 for beta<=0.8)
const GROUND_FIRE_X  = 200;
const GROUND_START_X = -(BOX_W / 2);  // train enters from left edge

/* ── Physics ─────────────────────────────────────────────── */
const C_VIS       = 125;   // visual speed of light (px/s)
const COMPLETE_DUR = 4.5;  // seconds before auto-reset

/* ── State ───────────────────────────────────────────────── */
const state = {
  frame:     'train',
  beta:      0.6,
  isPlaying: true,
};

// trainX: centre of train on canvas.
// Ground frame → moves right; Train frame → fixed at CW/2.
let trainX      = CW / 2;
let fireOriginX = CW / 2;  // train centre at the moment Fire! was pressed
let bgOff       = 0;       // background scroll offset (train frame only)

let phase     = 'ready';
let fireT     = 0;
let leftHitT  = null;
let rightHitT = null;
let completeT = 0;
let lastTs    = null;

/* ── Position helpers (work for both frames) ─────────────── */
// Beams travel at C_VIS in absolute canvas coords from the explosion origin.
function leftBeamPos()  { return fireOriginX - C_VIS * fireT; }
function rightBeamPos() { return fireOriginX + C_VIS * fireT; }
// Walls move with the train (ground frame: trainX changes; train frame: fixed).
function leftWallPos()  { return trainX - INT_HALF; }
function rightWallPos() { return trainX + INT_HALF; }

/* ── Reset ────────────────────────────────────────────────── */
function resetSim() {
  phase     = 'ready';
  fireT     = 0;
  leftHitT  = null;
  rightHitT = null;
  completeT = 0;
  bgOff     = 0;
  trainX    = state.frame === 'ground' ? GROUND_START_X : CW / 2;
  clearReadouts();
  const btnFire = document.getElementById('btn-fire');
  btnFire.disabled = false;
  btnFire.style.display = state.frame === 'ground' ? 'none' : '';
}

/* ── Readout helpers ─────────────────────────────────────── */
function clearReadouts() {
  setReadout('readout-left',    '—', 'muted');
  setReadout('readout-right',   '—', 'muted');
  setReadout('readout-verdict', '—', 'muted');
}

function setReadout(id, text, cls) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'readout-value ' + (cls || 'muted');
}

function updateReadouts() {
  document.getElementById('readout-beta').textContent = 'v = ' + state.beta.toFixed(2) + 'c';
  if (leftHitT !== null)
    setReadout('readout-left',  't = ' + leftHitT.toFixed(2)  + ' s', 'highlight-green');
  if (rightHitT !== null)
    setReadout('readout-right', 't = ' + rightHitT.toFixed(2) + ' s', 'highlight-green');
  if (leftHitT !== null && rightHitT !== null) {
    const diff = Math.abs(leftHitT - rightHitT);
    if (diff < 0.05) {
      setReadout('readout-verdict', 'Simultaneous', 'highlight-green');
    } else {
      setReadout('readout-verdict',
        'Not simultaneous (Δt = ' + diff.toFixed(2) + ' s)', 'highlight-red');
    }
  }
}

/* ── Update ───────────────────────────────────────────────── */
function update(dt) {
  if (!state.isPlaying) return;

  if (state.frame === 'ground') {
    // Train moves right continuously; background is fixed.
    trainX += state.beta * C_VIS * dt;
    if (phase === 'ready') {
      // Auto-fire when the train reaches the designated position.
      if (trainX >= GROUND_FIRE_X) {
        trainX      = GROUND_FIRE_X;
        fireOriginX = GROUND_FIRE_X;
        phase       = 'firing';
        fireT       = 0;
        leftHitT    = null;
        rightHitT   = null;
      } else if (trainX - BOX_W / 2 > CW) {
        // Loop back from right edge.
        trainX = GROUND_START_X;
      }
    }
  } else {
    // Train frame: background scrolls left to show motion.
    bgOff -= state.beta * C_VIS * dt;
  }

  if (phase === 'firing') {
    const prevFireT = fireT;
    fireT += dt;

    // ── Left beam vs left wall ──
    if (leftHitT === null) {
      const lbCurr = leftBeamPos();
      const lwCurr = leftWallPos();
      if (lbCurr <= lwCurr) {
        // Interpolate exact crossing time.
        const lbPrev = fireOriginX - C_VIS * prevFireT;
        const lwPrev = (state.frame === 'ground')
          ? (fireOriginX + state.beta * C_VIS * prevFireT) - INT_HALF
          : CW / 2 - INT_HALF;
        const gapPrev =  lbPrev - lwPrev;  // > 0 before hit
        const gapCurr =  lbCurr - lwCurr;  // < 0 after hit
        leftHitT = prevFireT + dt * gapPrev / (gapPrev - gapCurr);
      }
    }

    // ── Right beam vs right wall ──
    if (rightHitT === null) {
      const rbCurr = rightBeamPos();
      const rwCurr = rightWallPos();
      if (rbCurr >= rwCurr) {
        const rbPrev = fireOriginX + C_VIS * prevFireT;
        const rwPrev = (state.frame === 'ground')
          ? (fireOriginX + state.beta * C_VIS * prevFireT) + INT_HALF
          : CW / 2 + INT_HALF;
        const gapPrev = rwPrev - rbPrev;
        const gapCurr = rwCurr - rbCurr;
        rightHitT = prevFireT + dt * gapPrev / (gapPrev - gapCurr);
      }
    }

    updateReadouts();

    if (leftHitT !== null && rightHitT !== null) {
      phase     = 'complete';
      completeT = 0;
    }
  } else if (phase === 'complete') {
    completeT += dt;
    if (completeT >= COMPLETE_DUR) resetSim();
  }
}

/* ── Drawing ─────────────────────────────────────────────── */

function drawBackground() {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#c7dff7');
  sky.addColorStop(1, '#e8f4ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, GROUND_Y);

  // Ground strip
  ctx.fillStyle = '#a8c97a';
  ctx.fillRect(0, GROUND_Y, CW, CH - GROUND_Y);
  ctx.fillStyle = '#8fb55e';
  ctx.fillRect(0, GROUND_Y, CW, 6);

  // Rails (always static visual)
  const RAIL_Y = GROUND_Y + 2;
  ctx.fillStyle = '#888';
  ctx.fillRect(0, RAIL_Y, CW, 4);
  ctx.fillRect(0, RAIL_Y + 16, CW, 4);

  // Ties: static in ground frame (fixed to ground); scroll in train frame.
  drawRailTies(state.frame === 'train' ? bgOff : 0);

  // Ground frame: draw fixed km markers on the ground so the train's motion
  // relative to the ground is visually obvious.
  if (state.frame === 'ground') {
    drawGroundMarkers(0);
  }
}

function drawRailTies(offset) {
  const RAIL_Y    = GROUND_Y + 2;
  const SPACING   = 50;
  const TIE_W     = 34;
  const TIE_H     = 8;
  const start = ((offset % SPACING) + SPACING) % SPACING;
  ctx.fillStyle = '#7a6245';
  for (let x = start - SPACING; x < CW + SPACING; x += SPACING) {
    ctx.fillRect(x - TIE_W / 2, RAIL_Y - 2, TIE_W, TIE_H);
  }
}

// Small tick marks at fixed canvas positions to show ground is stationary.
function drawGroundMarkers(offset) {
  const y = GROUND_Y + 28;
  const SPACING = 80;
  ctx.fillStyle = 'rgba(60,90,50,0.4)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const start = ((offset % SPACING) + SPACING) % SPACING;
  let idx = 0;
  for (let x = start; x < CW; x += SPACING, idx++) {
    ctx.fillRect(x - 1, GROUND_Y + 8, 2, 12);
  }
}

function drawBoxBackground(cx) {
  const left = cx - BOX_W / 2;
  const right = cx + BOX_W / 2;
  const top  = BOX_TOP_Y;
  const bot  = BOX_BOTTOM_Y;

  // Axle
  ctx.strokeStyle = '#555';
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.moveTo(left + 40, bot);
  ctx.lineTo(right - 40, bot);
  ctx.stroke();

  // Wheels
  [left + 55, right - 55].forEach(wx => {
    ctx.beginPath();
    ctx.arc(wx, bot + WHEEL_R, WHEEL_R, 0, Math.PI * 2);
    ctx.fillStyle = '#444';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wx, bot + WHEEL_R, WHEEL_R * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#aaa';
    ctx.fill();
  });

  // Outer shell
  const grad = ctx.createLinearGradient(cx, top, cx, bot);
  grad.addColorStop(0,   '#4a7fc1');
  grad.addColorStop(0.5, '#3b6eb5');
  grad.addColorStop(1,   '#2c5a9e');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(left, top, BOX_W, BOX_H, 5);
  ctx.fill();

  // Interior
  const intL = left + BOX_WALL;
  const intT = top  + BOX_WALL;
  const intW = BOX_W - BOX_WALL * 2;
  const intGrad = ctx.createLinearGradient(cx, intT, cx, intT + INT_H);
  intGrad.addColorStop(0, 'rgba(242,250,255,0.97)');
  intGrad.addColorStop(1, 'rgba(218,236,255,0.95)');
  ctx.fillStyle = intGrad;
  ctx.fillRect(intL, intT, intW, INT_H);
}

function drawBoxForeground(cx) {
  const left  = cx - BOX_W / 2;
  const right = cx + BOX_W / 2;
  const top   = BOX_TOP_Y;
  const bot   = BOX_BOTTOM_Y;

  // Repaint walls over beam content
  ctx.fillStyle = '#3b6eb5';
  ctx.fillRect(left,             top + BOX_WALL, BOX_WALL, INT_H);
  ctx.fillRect(right - BOX_WALL, top + BOX_WALL, BOX_WALL, INT_H);
  ctx.fillRect(left, top,                BOX_W, BOX_WALL);
  ctx.fillRect(left, bot - BOX_WALL,     BOX_W, BOX_WALL);

  // Outline
  ctx.strokeStyle = '#1e3a6e';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(left, top, BOX_W, BOX_H, 5);
  ctx.stroke();

  // Corner bolts
  [[left + 12, top + 12], [right - 12, top + 12],
   [left + 12, bot - 12], [right - 12, bot - 12]].forEach(([bx, by]) => {
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#1e3a6e';
    ctx.fill();
  });

  // One window on each side
  const winY = top + BOX_WALL + 6;
  const winH = INT_H * 0.5;
  const winW = 42;
  [left + 24, right - 24 - winW].forEach(wx => {
    ctx.fillStyle   = 'rgba(180,218,255,0.5)';
    ctx.strokeStyle = '#1e3a6e';
    ctx.lineWidth   = 1.5;
    ctx.fillRect(wx, winY, winW, winH);
    ctx.strokeRect(wx, winY, winW, winH);
  });
}

function drawWallFlash(cx, side, age) {
  const alpha = Math.max(0, 0.8 - age * 0.55);
  if (alpha <= 0) return;
  const intTop = BOX_TOP_Y + BOX_WALL;
  const h      = INT_H;
  const W      = 70;

  if (side === 'left') {
    const x = cx - BOX_W / 2;
    const g = ctx.createLinearGradient(x, 0, x + W, 0);
    g.addColorStop(0, `rgba(251,191,36,${alpha})`);
    g.addColorStop(1, `rgba(251,191,36,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, intTop, W, h);
  } else {
    const x = cx + BOX_W / 2;
    const g = ctx.createLinearGradient(x, 0, x - W, 0);
    g.addColorStop(0, `rgba(56,189,248,${alpha})`);
    g.addColorStop(1, `rgba(56,189,248,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - W, intTop, W, h);
  }
}

function drawBeams() {
  if (phase === 'ready') return;

  const cx     = trainX;
  const intL   = cx - INT_HALF;
  const intR   = cx + INT_HALF;
  const intTop = BOX_TOP_Y + BOX_WALL;
  const intBot = BOX_BOTTOM_Y - BOX_WALL;
  const midY   = intTop + INT_H / 2;

  // Beam positions (absolute canvas coords)
  const lb = leftBeamPos();
  const rb = rightBeamPos();

  // Clamped heads (can't pass through the wall)
  const headL = Math.max(lb, intL);   // left beam head (going left → clamp at left wall)
  const headR = Math.min(rb, intR);   // right beam head (going right → clamp at right wall)

  // Clip all beam drawing to current interior rectangle
  ctx.save();
  ctx.beginPath();
  ctx.rect(intL, intTop, INT_HALF * 2, INT_H);
  ctx.clip();

  // Left beam (amber) — only while still travelling or beam head visible
  if (leftHitT === null || fireT - leftHitT < 0.1) {
    // Short glow trail behind head
    const trailStart = Math.min(headL + 70, fireOriginX);
    if (trailStart > headL) {
      const g = ctx.createLinearGradient(headL, 0, trailStart, 0);
      g.addColorStop(0, 'rgba(251,191,36,0.28)');
      g.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = g;
      ctx.fillRect(headL, intTop, trailStart - headL, INT_H);
    }
    // Beam head dot
    ctx.beginPath();
    ctx.arc(headL, midY, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(253,230,138,0.6)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(headL, midY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
  }

  // Right beam (cyan)
  if (rightHitT === null || fireT - rightHitT < 0.1) {
    const trailEnd = Math.max(headR - 70, fireOriginX);
    if (headR > trailEnd) {
      const g = ctx.createLinearGradient(trailEnd, 0, headR, 0);
      g.addColorStop(0, 'rgba(56,189,248,0)');
      g.addColorStop(1, 'rgba(56,189,248,0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(trailEnd, intTop, headR - trailEnd, INT_H);
    }
    ctx.beginPath();
    ctx.arc(headR, midY, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(186,230,253,0.6)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(headR, midY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
  }

  ctx.restore();

  // Wall flashes (drawn outside clip, over the walls)
  if (leftHitT  !== null) drawWallFlash(cx, 'left',  fireT - leftHitT);
  if (rightHitT !== null) drawWallFlash(cx, 'right', fireT - rightHitT);
}

function drawExplosion() {
  // Pulsing ready marker follows the train
  if (phase === 'ready') {
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
    ctx.beginPath();
    ctx.arc(trainX, EXP_Y, 10 + pulse * 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(251,191,36,${0.22 + pulse * 0.18})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(trainX, EXP_Y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(trainX, EXP_Y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    return;
  }

  // Expanding burst — anchored at fireOriginX (fixed in space after explosion)
  const alpha = Math.max(0, 0.9 - fireT * 2.8);
  if (alpha > 0) {
    const r = Math.min(fireT, 0.3) * 110;
    const grd = ctx.createRadialGradient(fireOriginX, EXP_Y, 0, fireOriginX, EXP_Y, r);
    grd.addColorStop(0,   `rgba(255,255,180,${alpha})`);
    grd.addColorStop(0.4, `rgba(255,170,20,${alpha * 0.6})`);
    grd.addColorStop(1,   'rgba(255,100,10,0)');
    ctx.beginPath();
    ctx.arc(fireOriginX, EXP_Y, Math.max(1, r), 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
    // Sparks
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(fireOriginX + Math.cos(angle) * r * 0.65,
              EXP_Y       + Math.sin(angle) * r * 0.65, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,220,60,${alpha})`;
      ctx.fill();
    }
  }
  // Persistent core dot
  ctx.beginPath();
  ctx.arc(fireOriginX, EXP_Y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fde68a';
  ctx.fill();
}

function drawHitLabels() {
  if (phase !== 'firing' && phase !== 'complete') return;
  const cx     = trainX;
  const intTop = BOX_TOP_Y + BOX_WALL;
  ctx.font      = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';

  if (leftHitT !== null) {
    const lx  = cx - INT_HALF + 46;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText('t = ' + leftHitT.toFixed(2) + ' s', lx, intTop - 7);
    ctx.fillStyle = '#d97706';
    ctx.fillText('t = ' + leftHitT.toFixed(2) + ' s', lx, intTop - 8);
  }
  if (rightHitT !== null) {
    const rx = cx + INT_HALF - 46;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText('t = ' + rightHitT.toFixed(2) + ' s', rx, intTop - 7);
    ctx.fillStyle = '#0284c7';
    ctx.fillText('t = ' + rightHitT.toFixed(2) + ' s', rx, intTop - 8);
  }
}

function drawVerdictOverlay() {
  if (phase !== 'complete') return;

  const fadeIn  = Math.min(completeT / 0.4, 1);
  const fadeOut = completeT > COMPLETE_DUR - 0.6
    ? Math.max(0, (COMPLETE_DUR - completeT) / 0.6) : 1;
  const alpha = fadeIn * fadeOut;
  if (alpha <= 0) return;

  const diff = Math.abs((leftHitT || 0) - (rightHitT || 0));
  const sim  = diff < 0.05;
  const text  = sim ? 'SIMULTANEOUS' : 'NOT SIMULTANEOUS';
  const color = sim ? '#16a34a' : '#dc2626';
  const bgCol = sim ? 'rgba(220,252,231,0.95)' : 'rgba(254,226,226,0.95)';

  // Anchor to centre of canvas regardless of where the train is.
  const bW = 360, bH = 54;
  const bX = CW / 2 - bW / 2;
  const bY = BOX_TOP_Y - 68;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = bgCol;
  ctx.beginPath();
  ctx.roundRect(bX, bY, bW, bH, 27);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2.5;
  ctx.stroke();
  ctx.fillStyle    = color;
  ctx.font         = 'bold 22px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, CW / 2, bY + bH / 2);
  ctx.restore();
}

function drawVelocityArrow() {
  const cx     = trainX;
  const arrowY = BOX_TOP_Y - 20;
  const len    = 50 + state.beta * 90;
  const x0     = cx - len / 2;
  const x1     = cx + len / 2;

  ctx.save();
  ctx.strokeStyle = '#0d9488';
  ctx.fillStyle   = '#0d9488';
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.moveTo(x0, arrowY);
  ctx.lineTo(x1 - 10, arrowY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, arrowY);
  ctx.lineTo(x1 - 10, arrowY - 5);
  ctx.lineTo(x1 - 10, arrowY + 5);
  ctx.closePath();
  ctx.fill();
  ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('v = ' + state.beta.toFixed(2) + 'c', cx, arrowY - 4);
  ctx.restore();
}

function drawFrameLabel() {
  const label = state.frame === 'train'
    ? "Train frame (S′) — train at rest, background moves"
    : "Ground frame (S) — background at rest, train moves →";
  ctx.save();
  ctx.fillStyle    = 'rgba(21,48,77,0.55)';
  ctx.font         = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(label, CW - 14, 12);
  ctx.restore();
}

/* ── Main render ─────────────────────────────────────────── */
function render() {
  ctx.clearRect(0, 0, CW, CH);
  drawBackground();
  drawBoxBackground(trainX);
  drawBeams();
  drawExplosion();
  drawBoxForeground(trainX);
  drawHitLabels();
  drawVerdictOverlay();
  drawVelocityArrow();
  drawFrameLabel();
}

/* ── RAF loop ────────────────────────────────────────────── */
function loop(ts) {
  if (lastTs !== null) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    update(dt);
  }
  lastTs = ts;
  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

/* ── Controls ────────────────────────────────────────────── */

document.getElementById('frame-toggle').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  const f = btn.dataset.frame;
  if (f === state.frame) return;
  state.frame = f;
  document.querySelectorAll('#frame-toggle .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.frame === f);
  });
  resetSim();
});

const betaSlider = document.getElementById('beta-slider');
const betaNumber = document.getElementById('beta-number');

function setBeta(val) {
  state.beta = Math.max(0.1, Math.min(0.8, parseFloat(val) || 0.6));
  betaSlider.value = state.beta;
  betaNumber.value = state.beta.toFixed(2);
  document.getElementById('readout-beta').textContent = 'v = ' + state.beta.toFixed(2) + 'c';
  resetSim();
}

betaSlider.addEventListener('input', () => setBeta(betaSlider.value));
betaNumber.addEventListener('change', () => setBeta(betaNumber.value));

document.getElementById('btn-play').addEventListener('click', () => {
  state.isPlaying = !state.isPlaying;
  document.getElementById('btn-play').textContent = state.isPlaying ? 'Pause' : 'Play';
  if (state.isPlaying) lastTs = null;
});

document.getElementById('btn-fire').addEventListener('click', () => {
  if (phase !== 'ready' || state.frame === 'ground') return;
  fireOriginX = trainX;  // always CW/2 in train frame
  phase     = 'firing';
  fireT     = 0;
  leftHitT  = null;
  rightHitT = null;
  document.getElementById('btn-fire').disabled = true;
  if (!state.isPlaying) {
    state.isPlaying = true;
    document.getElementById('btn-play').textContent = 'Pause';
    lastTs = null;
  }
});

document.getElementById('btn-reset').addEventListener('click', resetSim);

// Initialise
document.getElementById('readout-beta').textContent = 'v = ' + state.beta.toFixed(2) + 'c';
clearReadouts();
resetSim();
