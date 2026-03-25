'use strict';

/* ─────────────────────────────────────────────────────────────
   Canvas & constants
───────────────────────────────────────────────────────────── */
const canvas = document.getElementById('simulation-canvas');
const ctx    = canvas.getContext('2d');
const CW = canvas.width;   // 960
const CH = canvas.height;  // 560

const BETA  = 0.6;
const GAMMA = 1.25;           // 1 / sqrt(1 - 0.36)
const LC    = 1 / GAMMA;      // 0.8  length contraction factor

// Visual speeds (px/s)
const TRAIN_SPEED  = 80;      // train moves at this rate
const PHOTON_SPEED = TRAIN_SPEED / BETA;  // ≈ 133 px/s  (c = v/β)

// Track geometry
const TRACK_Y      = 370;     // y of the rail
const GROUND_Y     = 390;
const STATION_Y    = TRACK_Y; // station clocks sit on the track line

// Train geometry (uncontracted)
const TRAIN_H      = 80;
const CAR_W        = 120;     // one car width (uncontracted)
const NUM_CARS     = 3;
const TRAIN_W_FULL = CAR_W * NUM_CARS;   // 360 px uncontracted
const TRAIN_TOP    = TRACK_Y - TRAIN_H;

// Metre stick geometry
const STICK_Y      = TRACK_Y + 22;       // drawn just below track
const STICK_H      = 10;
const METRE_FULL   = 180;                // full station metre stick width (px)
const METRE_CONTR  = METRE_FULL * LC;    // 144 px  (train's contracted stick)

// Station clock positions (fixed)
const STATION_CLK  = [200, 680];         // x positions of the two station clocks
const CLK_R        = 22;                 // clock face radius

/* ─────────────────────────────────────────────────────────────
   State
───────────────────────────────────────────────────────────── */
const state = {
  step:        1,       // 1–5
  isPlaying:   true,
  time:        0,       // accumulated simulation time (s)
  trainX:      -400,    // x of left edge of train
  // photon state
  photons: null,        // { originX, leftX, rightX, active }
  // clock state — each has { phase, offset }
  stationClocks: [{ t: 0 }, { t: 0 }],   // station clocks
  trainClocks:   [{ t: 0 }, { t: 0 }, { t: 0 }],  // front, mid, rear
  // sync flash
  syncFlash: null,      // { x, age, target: 'station'|'train' }
  // measurement markers
  markers: [],          // [{x, color, label}]
  // step-specific flags
  contractionApplied: false,
  dilationApplied:    false,
  // measurement result overlay
  measureResult: null,  // { text, color, age }
  // per-clock manual offsets (teacher-controlled, set by clicking)
  stationOffsets: [0, -2.5],   // station clocks start out of sync
  trainOffsets:   [1.8, -0.6, 0.9],  // train clocks start out of sync
};

let lastTs = null;

/* ─────────────────────────────────────────────────────────────
   Derived geometry helpers
───────────────────────────────────────────────────────────── */
function trainW() {
  return state.contractionApplied ? TRAIN_W_FULL * LC : TRAIN_W_FULL;
}
function carW() {
  return trainW() / NUM_CARS;
}
function trainRight() { return state.trainX + trainW(); }
function trainMidX()  { return state.trainX + trainW() / 2; }

// x positions of the three train clock faces (on top of each car)
function trainClockX(i) {
  return state.trainX + carW() * i + carW() / 2;
}

// train metre stick: sits below train, length depends on step
function trainStickW() {
  return state.contractionApplied ? METRE_CONTR : METRE_FULL;
}

/* ─────────────────────────────────────────────────────────────
   Clock helpers
───────────────────────────────────────────────────────────── */
function stationClockTime(i) {
  return state.time + state.stationOffsets[i];
}

function trainClockTime(i) {
  const rate = state.dilationApplied ? LC : 1.0;
  // Leading clock runs behind by β·x/c (relativity of simultaneity, visual approximation)
  const xFrac      = (trainClockX(i) - trainMidX()) / (trainW() / 2);
  const syncOffset = -BETA * xFrac * 0.6;
  return state.time * rate + syncOffset + state.trainOffsets[i];
}

// Snap a clock's offset so its hand jumps to the nearest of 12, 3, 6, or 9
function snapClockToQuarter(offsets, i, autoBase) {
  const current = ((autoBase + offsets[i]) % 12 + 12) % 12;
  const nearest = [0, 3, 6, 9].reduce((best, t) => {
    const d    = Math.min(Math.abs(t - current), 12 - Math.abs(t - current));
    const dBest = Math.min(Math.abs(best - current), 12 - Math.abs(best - current));
    return d < dBest ? t : best;
  });
  let delta = nearest - current;
  if (delta >  6) delta -= 12;
  if (delta < -6) delta += 12;
  offsets[i] += delta;
}

/* ─────────────────────────────────────────────────────────────
   Step notes
───────────────────────────────────────────────────────────── */
const STEP_NOTES = [
  'Watch the photon flash synchronise first the station clocks, then the train clocks.',
  'Arrow markers drop simultaneously (in each frame) to measure metre sticks.',
  'Compare the two measurements — they are asymmetric, violating the postulates.',
  'The train\'s metre stick contracts to 4/5 of the station metre.',
  'Both frames now measure the other\'s stick as 4/5 their own. Symmetry restored.',
];

/* ─────────────────────────────────────────────────────────────
   Step setup — what to show and animate for each step
───────────────────────────────────────────────────────────── */
function setupStep(s) {
  state.step = s;
  state.photons = null;
  state.syncFlash = null;
  state.markers = [];
  state.measureResult = null;
  state.pendingMarkers = null;

  if (s <= 3) {
    state.contractionApplied = false;
    state.dilationApplied    = false;
  }
  if (s === 4) {
    state.contractionApplied = true;
    state.dilationApplied    = false;
  }
  if (s === 5) {
    state.contractionApplied = true;
    state.dilationApplied    = true;
  }

  // Kick off step-specific initial action
  if (s === 1) triggerSyncFlash('station');

  updateSidebar();
}

function triggerSyncFlash(target) {
  const midX = target === 'station'
    ? (STATION_CLK[0] + STATION_CLK[1]) / 2
    : trainMidX();
  state.syncFlash = { x: midX, age: 0, target, leftX: midX, rightX: midX };
}

const STATION_STICK_LEFT = STATION_CLK[0] + 40;

// Place (or replace) a single named marker at position x
function placeMarker(id, x, color, label) {
  state.markers = state.markers.filter(m => m.id !== id);
  state.markers.push({ id, x, color, label });
}

function clearMarkers() {
  state.markers = [];
  state.measureResult = null;
}

/* ─────────────────────────────────────────────────────────────
   Update
───────────────────────────────────────────────────────────── */
const TRAIN_LOOP_START = -TRAIN_W_FULL - 50;
const TRAIN_LOOP_END   = CW + 50;

function update(dt) {
  if (!state.isPlaying) return;

  state.time   += dt;
  state.trainX += TRAIN_SPEED * dt;
  if (state.trainX > TRAIN_LOOP_END) state.trainX = TRAIN_LOOP_START;

  // ── Sync flash ──
  if (state.syncFlash) {
    const sf = state.syncFlash;
    sf.age    += dt;
    sf.leftX  -= PHOTON_SPEED * dt;
    sf.rightX += PHOTON_SPEED * dt;

    // For station sync: check if photons reach the station clocks
    if (sf.target === 'station') {
      if (sf.rightX >= STATION_CLK[1] && !sf.done) {
        sf.done = true;
        // After a beat, trigger train sync
        setTimeout(() => {
          if (state.step === 1) triggerSyncFlash('train');
        }, 1400);
      }
    }
    // Fade out after done
    if (sf.age > 4) state.syncFlash = null;
  }

  // ── Photons (step 2+ speed-of-light measurement) ──
  if (state.photons && state.photons.active) {
    const p = state.photons;
    p.leftX  -= PHOTON_SPEED * dt;
    p.rightX += PHOTON_SPEED * dt;
    p.age    += dt;
    if (p.age > 5) state.photons = null;
  }

  // ── Measurement result fade ──
  if (state.measureResult) {
    state.measureResult.age += dt;
  }
}


/* ─────────────────────────────────────────────────────────────
   Drawing
───────────────────────────────────────────────────────────── */

function drawBackground() {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#daeeff');
  sky.addColorStop(1, '#eef6ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, GROUND_Y);

  // Ground
  ctx.fillStyle = '#b0ca80';
  ctx.fillRect(0, GROUND_Y, CW, CH - GROUND_Y);
  ctx.fillStyle = '#94b060';
  ctx.fillRect(0, GROUND_Y, CW, 5);

  // Ballast
  ctx.fillStyle = '#b8a898';
  ctx.fillRect(0, TRACK_Y - 4, CW, 16);

  // Rails
  ctx.fillStyle = '#888';
  ctx.fillRect(0, TRACK_Y - 5, CW, 4);
  ctx.fillRect(0, TRACK_Y + 1, CW, 4);

  // Sleepers
  ctx.fillStyle = '#7a6245';
  for (let x = 0; x < CW; x += 44) {
    ctx.fillRect(x, TRACK_Y - 8, 28, 18);
  }

  // Platform
  ctx.fillStyle = '#c8d8e8';
  ctx.fillRect(0, TRACK_Y - 40, CW, 36);
  ctx.fillStyle = '#a8bece';
  ctx.fillRect(0, TRACK_Y - 42, CW, 3);
}

function drawClockFace(x, y, r, time, label, color, dilated) {
  ctx.save();

  // Face
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Quarter-position dots at 12, 3, 6, 9 — show the snap targets
  [0, 3, 6, 9].forEach(h => {
    const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * (r - 5), y + Math.sin(a) * (r - 5), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(21,48,77,0.35)';
    ctx.fill();
  });

  // Single hand (hour-hand speed: one revolution per 12 time units)
  const angle = (time / 12) * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * r * 0.7, y + Math.sin(angle) * r * 0.7);
  ctx.stroke();

  // Centre pip
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Label
  ctx.fillStyle    = color;
  ctx.font         = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, x, y + r + 4);

  // "click to set" hint text
  ctx.fillStyle = 'rgba(21,48,77,0.3)';
  ctx.font      = '9px "Trebuchet MS", sans-serif';
  ctx.fillText('click', x, y + r + 15);

  // Dilation badge
  if (dilated) {
    ctx.fillStyle = '#ea580c';
    ctx.font      = 'bold 9px sans-serif';
    ctx.fillText('×0.8', x, y + r + 24);
  }

  ctx.restore();
}

function drawStationClocks() {
  STATION_CLK.forEach((x, i) => {
    const y = TRACK_Y - 56;
    drawClockFace(x, y, CLK_R, stationClockTime(i), `S${i + 1}`, '#2563eb', false);
    // Stand
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + CLK_R);
    ctx.lineTo(x, TRACK_Y - 42);
    ctx.stroke();
  });
}

function drawTrain() {
  const tx  = state.trainX;
  const tw  = trainW();
  const cw  = carW();
  const top = TRAIN_TOP;
  const bot = TRACK_Y;
  const h   = bot - top;

  // Shadow
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.ellipse(tx + tw / 2, bot + 6, tw / 2, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Cars
  for (let i = 0; i < NUM_CARS; i++) {
    const cx = tx + i * cw;
    const grad = ctx.createLinearGradient(cx, top, cx, bot);
    grad.addColorStop(0, '#4a7fc1');
    grad.addColorStop(0.5, '#3b6eb5');
    grad.addColorStop(1, '#2c5a9e');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(cx + 1, top, cw - 2, h, i === 0 ? [6, 0, 0, 6] : i === NUM_CARS - 1 ? [0, 6, 6, 0] : 0);
    ctx.fill();

    // Windows
    const winY = top + 12;
    const winH = h * 0.38;
    const winW = cw * 0.35;
    [cx + cw * 0.12, cx + cw * 0.56].forEach(wx => {
      ctx.fillStyle = 'rgba(180,218,255,0.55)';
      ctx.fillRect(wx, winY, winW, winH);
      ctx.strokeStyle = '#1e3a6e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(wx, winY, winW, winH);
    });

    // Dividing line between cars
    if (i < NUM_CARS - 1) {
      ctx.strokeStyle = '#1e3a6e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + cw, top);
      ctx.lineTo(cx + cw, bot);
      ctx.stroke();
    }

    // Wheels
    [cx + cw * 0.22, cx + cw * 0.75].forEach(wx => {
      ctx.beginPath();
      ctx.arc(wx, bot + 8, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#333';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(wx, bot + 8, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#aaa';
      ctx.fill();
    });
  }

  // Outline
  ctx.strokeStyle = '#1e3a6e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(tx + 1, top, tw - 2, h, 6);
  ctx.stroke();

  // Train clocks (on roof)
  for (let i = 0; i < NUM_CARS; i++) {
    const cx = trainClockX(i);
    const cy = top - CLK_R - 6;
    drawClockFace(cx, cy, CLK_R, trainClockTime(i),
      `T${i + 1}`, '#ea580c', state.dilationApplied);
    // Stand
    ctx.strokeStyle = '#ea580c';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + CLK_R);
    ctx.lineTo(cx, top);
    ctx.stroke();
  }
}

function drawMetreSticks() {
  const stickLeft = STATION_CLK[0] + 40;

  // Station metre stick (fixed)
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(stickLeft, STICK_Y, METRE_FULL, STICK_H);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Station metre', stickLeft + METRE_FULL / 2, STICK_Y + STICK_H / 2);

  // Tick marks every 20%
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  for (let t = 1; t < 5; t++) {
    const x = stickLeft + METRE_FULL * t / 5;
    ctx.beginPath();
    ctx.moveTo(x, STICK_Y);
    ctx.lineTo(x, STICK_Y + STICK_H);
    ctx.stroke();
  }

  // Train metre stick (moves with train, contracts in step 4+)
  const tsw = trainStickW();
  const tstickLeft = state.trainX + (trainW() - tsw) / 2;
  const trainStickColor = state.contractionApplied ? '#ea580c' : '#c2410c';
  ctx.fillStyle = trainStickColor;
  ctx.fillRect(tstickLeft, STICK_Y + 18, tsw, STICK_H);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const stickLabel = state.contractionApplied ? 'Train metre (×0.8)' : 'Train metre';
  ctx.fillText(stickLabel, tstickLeft + tsw / 2, STICK_Y + 18 + STICK_H / 2);
  for (let t = 1; t < 5; t++) {
    const x = tstickLeft + tsw * t / 5;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, STICK_Y + 18);
    ctx.lineTo(x, STICK_Y + 18 + STICK_H);
    ctx.stroke();
  }
}

function drawSyncFlash() {
  if (!state.syncFlash) return;
  const sf  = state.syncFlash;
  const alpha = Math.max(0, 1 - sf.age / 4);
  const y   = sf.target === 'station' ? TRACK_Y - 56 : TRAIN_TOP - CLK_R - 6;

  // Origin flash
  if (sf.age < 0.5) {
    const r = sf.age * 60;
    const grd = ctx.createRadialGradient(sf.x, y, 0, sf.x, y, r);
    grd.addColorStop(0, `rgba(255,240,100,${alpha})`);
    grd.addColorStop(1, 'rgba(255,200,0,0)');
    ctx.beginPath();
    ctx.arc(sf.x, y, Math.max(1, r), 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
  }

  // Photon dots
  const dotR = 5;
  [sf.leftX, sf.rightX].forEach((px, i) => {
    ctx.beginPath();
    ctx.arc(px, y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,0,${alpha})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, y, dotR - 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,240,100,${alpha})`;
    ctx.fill();
  });

  // Label
  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = '#92400e';
  ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(sf.target === 'station' ? 'Sync flash (station)' : 'Sync flash (train)',
    sf.x, y - CLK_R - 14);
  ctx.restore();
}

function drawPhotons() {
  if (!state.photons || !state.photons.active) return;
  const p = state.photons;
  const alpha = Math.max(0, 1 - p.age / 5);
  const y = TRAIN_TOP - CLK_R - 6;

  [{ x: p.leftX, c: '#fbbf24' }, { x: p.rightX, c: '#38bdf8' }].forEach(({ x, c }) => {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = c.replace(')', `,${alpha})`).replace('rgb', 'rgba');
    ctx.fillStyle = c;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function drawMarkers() {
  state.markers.forEach(m => {
    const y = m.y || STICK_Y;
    ctx.save();
    ctx.strokeStyle = m.color;
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(m.x, TRACK_Y - 10);
    ctx.lineTo(m.x, STICK_Y + 30);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(m.x, TRACK_Y - 10);
    ctx.lineTo(m.x - 5, TRACK_Y - 20);
    ctx.lineTo(m.x + 5, TRACK_Y - 20);
    ctx.closePath();
    ctx.fill();

    // Label badge
    ctx.fillStyle   = m.color;
    ctx.font        = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    ctx.arc(m.x, TRACK_Y - 30, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.fillText(m.label, m.x, TRACK_Y - 30);
    ctx.restore();
  });
}

function drawMeasureResult() {
  if (!state.measureResult) return;
  const mr = state.measureResult;
  const alpha = Math.min(1, mr.age * 3) * Math.max(0, 1 - (mr.age - 5) / 1.5);
  if (alpha <= 0) return;

  const text = mr.text;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font        = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.textAlign   = 'center';
  const tw = ctx.measureText(text).width + 24;
  const bh = 32;
  const bx = CW / 2 - tw / 2;
  const by = TRACK_Y + 55;

  ctx.fillStyle = mr.color === '#16a34a' ? 'rgba(220,252,231,0.96)' : 'rgba(254,226,226,0.96)';
  ctx.beginPath();
  ctx.roundRect(bx, by, tw, bh, 16);
  ctx.fill();
  ctx.strokeStyle = mr.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle    = mr.color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, CW / 2, by + bh / 2);
  ctx.restore();
}

function drawStepLabel() {
  const labels = [
    'Step 1 — Synchronise Clocks',
    'Step 2 — Length Measurements',
    'Step 3 — Violation Found',
    'Step 4 — Length Contraction Applied',
    'Step 5 — Symmetry Restored',
  ];
  ctx.save();
  ctx.fillStyle    = 'rgba(21,48,77,0.55)';
  ctx.font         = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(labels[state.step - 1], CW - 14, 12);
  ctx.restore();
}

function drawContractionBadge() {
  if (!state.contractionApplied && !state.dilationApplied) return;
  const lines = [];
  if (state.contractionApplied) lines.push('Length contraction: train stick × 0.8');
  if (state.dilationApplied)    lines.push('Time dilation: train clocks × 0.8');

  const x = 14, y = 14;
  ctx.save();
  ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
  const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const bw = maxW + 20, bh = lines.length * 20 + 10;

  ctx.fillStyle = 'rgba(254,243,199,0.95)';
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, 10);
  ctx.fill();
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  ctx.fillStyle    = '#92400e';
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';
  lines.forEach((l, i) => ctx.fillText(l, x + 10, y + 15 + i * 20));
  ctx.restore();
}

/* ─────────────────────────────────────────────────────────────
   Main render
───────────────────────────────────────────────────────────── */
function render() {
  ctx.clearRect(0, 0, CW, CH);
  drawBackground();
  drawMetreSticks();
  drawMarkers();
  drawStationClocks();
  drawTrain();
  drawSyncFlash();
  drawPhotons();
  drawMeasureResult();
  drawContractionBadge();
  drawStepLabel();
}

/* ─────────────────────────────────────────────────────────────
   RAF loop
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   Sidebar update
───────────────────────────────────────────────────────────── */
function updateSidebar() {
  // Step buttons
  document.querySelectorAll('.step-btn').forEach(btn => {
    const s = parseInt(btn.dataset.step);
    btn.classList.toggle('active', s === state.step);
    btn.classList.toggle('completed', s < state.step);
  });

  // Prev/Next buttons
  document.getElementById('btn-prev').disabled = state.step <= 1;
  document.getElementById('btn-next').disabled = state.step >= 5;

  // Readout cards
  document.getElementById('readout-contraction').textContent =
    state.contractionApplied ? 'Applied — train stick = 4/5 station metre' : 'not yet applied';
  document.getElementById('readout-contraction').className =
    'readout-value ' + (state.contractionApplied ? 'highlight-green' : 'muted');

  document.getElementById('readout-dilation').textContent =
    state.dilationApplied ? 'Applied — train clocks run at 4/5 rate' : 'not yet applied';
  document.getElementById('readout-dilation').className =
    'readout-value ' + (state.dilationApplied ? 'highlight-green' : 'muted');

  document.getElementById('readout-step-note').textContent = STEP_NOTES[state.step - 1];
}

/* ─────────────────────────────────────────────────────────────
   Controls
───────────────────────────────────────────────────────────── */

// Step buttons in sidebar
document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = parseInt(btn.dataset.step);
    openModal(s);
  });
});

// Prev / Next
document.getElementById('btn-prev').addEventListener('click', () => {
  if (state.step > 1) openModal(state.step - 1);
});
document.getElementById('btn-next').addEventListener('click', () => {
  if (state.step < 5) openModal(state.step + 1);
});

// Play / Pause
document.getElementById('btn-play').addEventListener('click', () => {
  state.isPlaying = !state.isPlaying;
  document.getElementById('btn-play').textContent = state.isPlaying ? 'Pause' : 'Play';
  if (state.isPlaying) lastTs = null;
});

// ── Marker buttons ───────────────────────────────────────────
// A / B  — station frame (blue): mark left / right end of the train's metre stick
document.getElementById('btn-mark-a').addEventListener('click', () => {
  placeMarker('A', state.trainX, '#2563eb', 'A');
});
document.getElementById('btn-mark-b').addEventListener('click', () => {
  placeMarker('B', state.trainX + trainStickW(), '#2563eb', 'B');
});
// C / D  — train frame (orange): mark left / right end of the station's metre stick
document.getElementById('btn-mark-c').addEventListener('click', () => {
  placeMarker('C', STATION_STICK_LEFT, '#ea580c', 'C');
});
document.getElementById('btn-mark-d').addEventListener('click', () => {
  placeMarker('D', STATION_STICK_LEFT + METRE_FULL, '#ea580c', 'D');
});
document.getElementById('btn-clear-markers').addEventListener('click', clearMarkers);

// Reset
document.getElementById('btn-reset').addEventListener('click', () => {
  state.time          = 0;
  state.trainX        = TRAIN_LOOP_START;
  state.stationOffsets = [0, -2.5];
  state.trainOffsets   = [1.8, -0.6, 0.9];
  lastTs = null;
  setupStep(state.step);
});

// ── Clock click: snap hand to nearest of 12, 3, 6, 9 ────────
function clockHitTest(mx, my) {
  // Returns { group: 'station'|'train', index } or null
  for (let i = 0; i < STATION_CLK.length; i++) {
    if (Math.hypot(mx - STATION_CLK[i], my - (TRACK_Y - 56)) <= CLK_R + 8)
      return { group: 'station', index: i };
  }
  for (let i = 0; i < NUM_CARS; i++) {
    if (Math.hypot(mx - trainClockX(i), my - (TRAIN_TOP - CLK_R - 6)) <= CLK_R + 8)
      return { group: 'train', index: i };
  }
  return null;
}

function canvasCoords(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = CW / rect.width;
  const scaleY = CH / rect.height;
  return { mx: (e.clientX - rect.left) * scaleX, my: (e.clientY - rect.top) * scaleY };
}

canvas.addEventListener('click', e => {
  const { mx, my } = canvasCoords(e);
  const hit = clockHitTest(mx, my);
  if (!hit) return;
  if (hit.group === 'station') {
    snapClockToQuarter(state.stationOffsets, hit.index, state.time);
  } else {
    const rate       = state.dilationApplied ? LC : 1.0;
    const xFrac      = (trainClockX(hit.index) - trainMidX()) / (trainW() / 2);
    const syncOffset = -BETA * xFrac * 0.6;
    snapClockToQuarter(state.trainOffsets, hit.index, state.time * rate + syncOffset);
  }
});

canvas.addEventListener('mousemove', e => {
  const { mx, my } = canvasCoords(e);
  canvas.style.cursor = clockHitTest(mx, my) ? 'pointer' : 'default';
});

/* ─────────────────────────────────────────────────────────────
   Modal logic
───────────────────────────────────────────────────────────── */
function openModal(stepNum) {
  // Hide all modals first
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  const modal = document.getElementById(`modal-${stepNum}`);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
  // Extract step number from the modal we just closed and activate that step
  const s = parseInt(modalId.split('-')[1]);
  setupStep(s);
}

// Close buttons inside modals
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    closeModal(btn.dataset.modal);
  });
});

// Click outside modal card to dismiss
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

/* ─────────────────────────────────────────────────────────────
   Init — open Step 1 modal immediately
───────────────────────────────────────────────────────────── */
setupStep(1);
openModal(1);
