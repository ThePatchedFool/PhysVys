'use strict';

// ─────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────
const CW   = 960;
const CH   = 560;
const FONT = '"Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';

const GROUND_Y   = 500;          // y of ground surface
const GROUND_H   = CH - GROUND_Y;
const MARKER_GAP = 100;          // px between ground sleeper marks

// Box on wheels
const BOX_W      = 600;
const BOX_H      = 220;
const BOX_WALL   = 7;            // wall thickness
const WHEEL_R    = 24;

// Derived box geometry (all in canvas coords, y increases downward)
const BOX_BOTTOM_Y  = GROUND_Y - WHEEL_R * 2;       // underside of box = top of wheels
const BOX_TOP_Y     = BOX_BOTTOM_Y - BOX_H;
const INT_BOTTOM_Y  = BOX_BOTTOM_Y - BOX_WALL;      // interior floor
const INT_TOP_Y     = BOX_TOP_Y    + BOX_WALL;      // interior ceiling
const INT_W         = BOX_W - BOX_WALL * 2;
const INT_H         = INT_BOTTOM_Y - INT_TOP_Y;

// Ball
const BALL_R         = 11;
const BALL_LAUNCH_Y  = INT_BOTTOM_Y - BALL_R - 2;   // ball centre at launch

// Physics
const PPM        = 5;    // pixels per metre
const G          = 10;   // m/s² (simplified)
const INIT_BOX_CX = CW / 2;  // box centre-x on first load / full reset

// Arrow display
const ARROW_SCALE = 4;   // px per m/s

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
const state = {
  frame:     'ground',  // 'ground' | 'train'
  u:         10,        // train velocity [0, 15] m/s
  vy0:       15,        // vertical launch speed [5, 22] m/s
  isPlaying: true,
};

// boxX accumulates forever (train never stops); ballT resets each launch
let boxX   = INIT_BOX_CX;  // box centre-x, continuous — wraps for display
let ballT  = 0;             // time since last ball launch
let trail  = [];            // [{x, y}] canvas positions for current arc
let bgOff  = 0;             // ground marker scroll offset for train frame

let lastTs = null;

// ─────────────────────────────────────────────────────────────
// DOM
// ─────────────────────────────────────────────────────────────
const canvas      = document.getElementById('simulation-canvas');
const ctx         = canvas.getContext('2d');
const uSlider     = document.getElementById('u-slider');
const uNumber     = document.getElementById('u-number');
const vySlider    = document.getElementById('vy-slider');
const vyNumber    = document.getElementById('vy-number');
const btnPlay     = document.getElementById('btn-play');
const btnRelaunch = document.getElementById('btn-relaunch');
const frameBtns   = document.querySelectorAll('.seg-btn');
const rdTraj      = document.getElementById('readout-trajectory');
const rdVx        = document.getElementById('readout-vx');
const rdVy        = document.getElementById('readout-vy');

// ─────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function setU(raw) {
  state.u = clamp(Math.round(+raw), 0, 15);
  uSlider.value = state.u;
  uNumber.value = state.u;
  relaunch();
}

function setVy(raw) {
  state.vy0 = clamp(Math.round(+raw), 5, 22);
  vySlider.value = state.vy0;
  vyNumber.value = state.vy0;
  relaunch();
}

function setFrame(f) {
  state.frame = f;
  frameBtns.forEach(b => b.classList.toggle('active', b.dataset.frame === f));
  resetView();
}

// Soft relaunch — ball restarts but train keeps moving
function relaunch() {
  ballT = 0;
  trail = [];
  refreshReadout(0);
}

// Full reset — box and background return to starting position
function resetView() {
  ballT = 0;
  trail = [];
  boxX  = INIT_BOX_CX;
  bgOff = 0;
  refreshReadout(0);
}

uSlider.addEventListener('input',  () => setU(uSlider.value));
uNumber.addEventListener('change', () => setU(uNumber.value));
vySlider.addEventListener('input',  () => setVy(vySlider.value));
vyNumber.addEventListener('change', () => setVy(vyNumber.value));
frameBtns.forEach(b => b.addEventListener('click', () => setFrame(b.dataset.frame)));

btnPlay.addEventListener('click', () => {
  state.isPlaying = !state.isPlaying;
  btnPlay.textContent = state.isPlaying ? 'Pause' : 'Play';
});
btnRelaunch.addEventListener('click', resetView);

// ─────────────────────────────────────────────────────────────
// Readout
// ─────────────────────────────────────────────────────────────
function refreshReadout(t) {
  const vy  = state.vy0 - G * t;
  const vx  = state.frame === 'ground' ? state.u : 0;
  rdTraj.textContent = state.frame === 'ground' ? 'Parabola (curved arc)' : 'Straight vertical';
  rdVx.textContent   = `v\u2093 = ${vx.toFixed(1)} m s\u207b\u00b9`;
  rdVy.textContent   = `v\u1d67 = ${vy.toFixed(1)} m s\u207b\u00b9`;
}
refreshReadout(0);

// ─────────────────────────────────────────────────────────────
// Physics
// ─────────────────────────────────────────────────────────────
function flightTime() { return (2 * state.vy0) / G; }

// Current wrapped display x for the box centre
function wrappedBoxCX() {
  return state.frame === 'ground'
    ? ((boxX % CW) + CW) % CW
    : CW / 2;
}

// Ball y from vertical kinematics (same in both frames)
function ballY(t) {
  return BALL_LAUNCH_Y - (state.vy0 * t - 0.5 * G * t * t) * PPM;
}

// Ball canvas position — always horizontally centred in the box
// (v_ball_x = u = v_box_x for a vertically thrown ball in S′)
function ballPos() {
  return { x: wrappedBoxCX(), y: ballY(ballT) };
}

// ─────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────
function update(dt) {
  if (!state.isPlaying) return;

  // Train always moves
  boxX  += state.u * PPM * dt;
  bgOff -= state.u * PPM * dt;

  // Ball flight
  ballT += dt;
  trail.push({ x: wrappedBoxCX(), y: ballY(ballT) });

  // Immediate relaunch on landing — no pause
  if (ballT >= flightTime()) relaunch();
}

// ─────────────────────────────────────────────────────────────
// Drawing helpers
// ─────────────────────────────────────────────────────────────
function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h,     x, y + h - r,     r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y,         x + r, y,         r);
  ctx.closePath();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0,    '#7ec8f4');
  g.addColorStop(0.55, '#b6ddf9');
  g.addColorStop(1,    '#daeeff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CW, GROUND_Y);
  const haze = ctx.createLinearGradient(0, GROUND_Y - 30, 0, GROUND_Y);
  haze.addColorStop(0, 'rgba(220,238,255,0)');
  haze.addColorStop(1, 'rgba(220,238,255,0.5)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, GROUND_Y - 30, CW, 30);
}

function drawGround(markerOff) {
  ctx.fillStyle = '#6b5640';
  ctx.fillRect(0, GROUND_Y, CW, GROUND_H);
  ctx.fillStyle = '#8a7055';
  ctx.fillRect(0, GROUND_Y + 2, CW, 10);
  ctx.fillStyle = '#a89070';
  ctx.fillRect(0, GROUND_Y + 4, CW, 4);
  const ofs = ((markerOff % MARKER_GAP) + MARKER_GAP) % MARKER_GAP;
  ctx.fillStyle = '#4e3a26';
  for (let x = ofs - MARKER_GAP; x < CW + MARKER_GAP; x += MARKER_GAP) {
    ctx.fillRect(x - 4, GROUND_Y, 8, 12);
  }
}

// Layer 1 — behind the ball: wheels, box shell, interior fill
function drawBoxBackground(cx) {
  const bLeft = cx - BOX_W / 2;
  const wheelY = GROUND_Y - WHEEL_R;

  // Axle
  ctx.strokeStyle = '#374151'; ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(bLeft + 46, wheelY);
  ctx.lineTo(bLeft + BOX_W - 46, wheelY);
  ctx.stroke();

  // Wheels
  [bLeft + 52, bLeft + BOX_W - 52].forEach(wx => {
    ctx.fillStyle = '#1f2937';
    ctx.beginPath(); ctx.arc(wx, wheelY, WHEEL_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(wx, wheelY, WHEEL_R - 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#9ca3af';
    ctx.beginPath(); ctx.arc(wx, wheelY, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2;
    for (let a = 0; a < Math.PI; a += Math.PI / 3) {
      ctx.beginPath();
      ctx.moveTo(wx + Math.cos(a) * 9, wheelY + Math.sin(a) * 9);
      ctx.lineTo(wx + Math.cos(a + Math.PI) * 9, wheelY + Math.sin(a + Math.PI) * 9);
      ctx.stroke();
    }
  });

  // Box shell
  const shellGrad = ctx.createLinearGradient(bLeft, BOX_TOP_Y, bLeft + BOX_W, BOX_TOP_Y);
  shellGrad.addColorStop(0,   '#1e3a8a');
  shellGrad.addColorStop(0.5, '#2563eb');
  shellGrad.addColorStop(1,   '#1e40af');
  ctx.fillStyle = shellGrad;
  rrect(bLeft, BOX_TOP_Y, BOX_W, BOX_H, 8);
  ctx.fill();

  // Interior fill (light, inside the box)
  ctx.fillStyle = 'rgba(240, 249, 255, 0.96)';
  ctx.fillRect(bLeft + BOX_WALL, INT_TOP_Y, INT_W, INT_H);

  // Subtle interior grid lines to show scale
  ctx.strokeStyle = 'rgba(147, 197, 253, 0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  for (let dy = INT_H / 4; dy < INT_H; dy += INT_H / 4) {
    const lineY = INT_TOP_Y + dy;
    ctx.beginPath();
    ctx.moveTo(bLeft + BOX_WALL, lineY);
    ctx.lineTo(bLeft + BOX_W - BOX_WALL, lineY);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Layer 2 — in front of the ball: wall overlays + border
function drawBoxForeground(cx) {
  const bLeft = cx - BOX_W / 2;

  // Repaint the four walls on top so the ball always looks contained
  const shellGrad = ctx.createLinearGradient(bLeft, BOX_TOP_Y, bLeft + BOX_W, BOX_TOP_Y);
  shellGrad.addColorStop(0,   '#1e3a8a');
  shellGrad.addColorStop(0.5, '#2563eb');
  shellGrad.addColorStop(1,   '#1e40af');
  ctx.fillStyle = shellGrad;

  // Top wall
  ctx.fillRect(bLeft, BOX_TOP_Y, BOX_W, BOX_WALL);
  // Bottom wall
  ctx.fillRect(bLeft, INT_BOTTOM_Y, BOX_W, BOX_WALL);
  // Left wall
  ctx.fillRect(bLeft, BOX_TOP_Y, BOX_WALL, BOX_H);
  // Right wall
  ctx.fillRect(bLeft + BOX_W - BOX_WALL, BOX_TOP_Y, BOX_WALL, BOX_H);

  // Outer border
  ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 2;
  rrect(bLeft, BOX_TOP_Y, BOX_W, BOX_H, 8);
  ctx.stroke();

  // Corner bolts
  ctx.fillStyle = '#93c5fd';
  [
    [bLeft + 16, BOX_TOP_Y + 12],
    [bLeft + BOX_W - 16, BOX_TOP_Y + 12],
    [bLeft + 16, BOX_BOTTOM_Y - 12],
    [bLeft + BOX_W - 16, BOX_BOTTOM_Y - 12],
  ].forEach(([bx, by]) => {
    ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill();
  });
}

function drawBall(cx, cy) {
  const g = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, BALL_R);
  g.addColorStop(0, '#fde68a');
  g.addColorStop(1, '#ea580c');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#9a3412'; ctx.lineWidth = 1.5;
  ctx.stroke();
}

// 2D velocity arrow. vy_phys is positive-upward; canvas y is inverted.
function drawVelArrow(cx, cy, vx, vy_phys) {
  const px  = vx * ARROW_SCALE;
  const py  = -vy_phys * ARROW_SCALE;
  const len = Math.sqrt(px * px + py * py);
  if (len < 3) return;

  const ux = px / len, uy = py / len;
  const hl = 10, hw = 5;
  const endX = cx + px, endY = cy + py;
  const color = vy_phys >= 0 ? '#0d9488' : '#c2410c';

  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(endX - ux * hl, endY - uy * hl);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - ux * hl - uy * hw, endY - uy * hl + ux * hw);
  ctx.lineTo(endX - ux * hl + uy * hw, endY - uy * hl - ux * hw);
  ctx.closePath(); ctx.fill();
}

function drawTrail() {
  if (trail.length < 2) return;
  ctx.save();
  ctx.setLineDash([4, 5]);
  for (let i = 1; i < trail.length; i++) {
    const alpha = (i / trail.length) * 0.8;
    ctx.strokeStyle = `rgba(234, 88, 12, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x,     trail[i].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawFrameLabel() {
  const lbl = state.frame === 'ground' ? 'S — Ground Frame' : 'S\u2032 — Train Frame';
  ctx.font = `bold 14px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(21, 48, 77, 0.5)';
  ctx.fillText(lbl, 14, 26);
}

// ─────────────────────────────────────────────────────────────
// Main draw
// ─────────────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, CW, CH);

  const vy_now = state.vy0 - G * ballT;
  const vx_now = state.frame === 'ground' ? state.u : 0;
  const pos    = ballPos();
  const cx     = wrappedBoxCX();

  drawSky();
  drawGround(state.frame === 'ground' ? 0 : bgOff);

  // Draw box at its wrapped position; also draw a ghost copy if it straddles an edge
  const boxPositions = [cx];
  if (cx + BOX_W / 2 > CW) boxPositions.push(cx - CW);
  if (cx - BOX_W / 2 < 0)  boxPositions.push(cx + CW);

  // Layer 1: box interiors (behind ball and trail)
  boxPositions.forEach(x => drawBoxBackground(x));

  // Trail and ball
  drawTrail();
  drawBall(pos.x, pos.y);

  // Layer 2: box walls over the ball so it looks contained
  boxPositions.forEach(x => drawBoxForeground(x));

  // Velocity arrow on top
  drawVelArrow(pos.x, pos.y, vx_now, vy_now);

  drawFrameLabel();
  refreshReadout(ballT);
}

// ─────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────
function loop(ts) {
  if (lastTs !== null) {
    update(Math.min((ts - lastTs) / 1000, 0.05));
  }
  lastTs = ts;
  draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
