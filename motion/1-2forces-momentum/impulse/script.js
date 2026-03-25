'use strict';

const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');
const CW = 960, CH = 560;

/* ── Config ───────────────────────────────────────────────── */
const cfg = {
  triangle:       'equilateral',
  customAngle:    30,
  massMantissa:   1,
  massExp:        0,
  speedMantissa:  1,
  speedExp:       0,
  showAngles:     false,
  showImpulse:    false,
  showMagnitudes: false,
};

/* ── Visual constants ─────────────────────────────────────── */
const WALL_X   = 840;
const WALL_W   = 24;
const BALL_R   = 18;
const PATH_LEN = 280;
const COL_IN   = '#2563eb';   // blue  — incoming / p_i
const COL_OUT  = '#dc2626';   // red   — outgoing / p_f
const COL_DP   = '#0d9488';   // teal  — Δp
const PHASE_DUR = 1.3;

/* ── Geometry ─────────────────────────────────────────────── */
function geometry() {
  const deg = cfg.triangle === 'equilateral' ? 60
            : cfg.triangle === 'right-angle'  ? 45
            : cfg.customAngle;
  const rad = deg * Math.PI / 180;
  const bx = WALL_X - BALL_R;
  const by = CH / 2;
  const startX = bx - PATH_LEN * Math.cos(rad);
  const startY = by - PATH_LEN * Math.sin(rad);
  const endX   = bx - PATH_LEN * Math.cos(rad);
  const endY   = by + PATH_LEN * Math.sin(rad);
  return { deg, rad, bx, by, startX, startY, endX, endY };
}

/* ── Animation state ──────────────────────────────────────── */
let phase  = 'incoming';
let phaseT = 0;
let lastTs = null;

function reset() {
  phase  = 'incoming';
  phaseT = 0;
  lastTs = null;
}

/* ── Drawing helpers ──────────────────────────────────────── */
function arrowHead(x2, y2, ux, uy, hs) {
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hs * (ux - 0.38 * uy), y2 - hs * (uy + 0.38 * ux));
  ctx.lineTo(x2 - hs * (ux + 0.38 * uy), y2 - hs * (uy - 0.38 * ux));
  ctx.closePath();
  ctx.fill();
}

function arrow(x1, y1, x2, y2, col, width) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 6) return;
  const ux = dx / len, uy = dy / len;
  const hs = Math.min(14, len * 0.22);
  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle   = col;
  ctx.lineWidth   = width ?? 2.5;
  ctx.lineCap     = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  arrowHead(x2, y2, ux, uy, hs);
  ctx.restore();
}

function drawBall(x, y, col, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha ?? 1;
  ctx.fillStyle   = col;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth   = 2.5;
  ctx.beginPath(); ctx.arc(x, y, BALL_R, 0, 2 * Math.PI);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/* ── Scientific notation string ───────────────────────────── */
function sciStr(mantissa, exp) {
  if (exp === 0) return String(mantissa);
  const m = mantissa === 1 ? '' : `${mantissa} \u00d7 `;  // ×
  return `${m}10^${exp}`;
}

/* ── Given-values readout (always visible) ─────────────────── */
function drawValues() {
  const VX = 14, VY = 207, VW = 230, VH = 60;
  ctx.save();
  ctx.fillStyle   = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = 'rgba(21,48,77,0.10)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath(); ctx.roundRect(VX, VY, VW, VH, 12);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle    = '#15304d';
  ctx.font         = '700 13px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`m = ${sciStr(cfg.massMantissa, cfg.massExp)} kg`,       VX + 14, VY + 10);
  ctx.fillText(`v = ${sciStr(cfg.speedMantissa, cfg.speedExp)} m s\u207b\u00b9`, VX + 14, VY + 32);
  ctx.restore();
}

/* ── Subscript label helper ────────────────────────────────── */
// Draws `base` at `sz` then `sub` at 70% size, shifted down.
// align: 'left' | 'center' | 'right' relative to (x, y).
function subLabel(x, y, base, sub, col, align, sz) {
  sz = sz ?? 14;
  ctx.save();
  ctx.fillStyle    = col;
  ctx.textBaseline = 'middle';
  ctx.font = `italic 700 ${sz}px "Trebuchet MS", sans-serif`;
  const bw = ctx.measureText(base).width;
  const subSz = Math.round(sz * 0.70);
  ctx.font = `italic 700 ${subSz}px "Trebuchet MS", sans-serif`;
  const sw = ctx.measureText(sub).width;
  const total = bw + sw;
  let ox = x;
  if      (align === 'center') ox = x - total / 2;
  else if (align === 'right')  ox = x - total;
  ctx.font = `italic 700 ${sz}px "Trebuchet MS", sans-serif`;
  ctx.fillText(base, ox, y);
  ctx.font = `italic 700 ${subSz}px "Trebuchet MS", sans-serif`;
  ctx.fillText(sub, ox + bw, y + sz * 0.28);
  ctx.restore();
}

/* ── Angle labels on main canvas ──────────────────────────── */
function drawAnglesOverlay(g) {
  if (g.deg === 0) return;  // head-on: no meaningful angle to annotate
  // At height H above/below bounce, find the x-coord of the path,
  // then place the label at the horizontal midpoint between path and wall.
  // If the gap is too narrow to fit the label, draw it right of the wall
  // with a small leader arrow.
  const H       = 70;   // px above/below bounce for sampling
  const MIN_GAP = 34;   // minimum horizontal gap needed (px)
  const FBX     = WALL_X + WALL_W + 22;  // fallback x (right of wall)

  // Incoming path at y = by − H
  const tIn  = Math.max(0, Math.min(1, (g.by - H - g.startY) / (g.by - g.startY)));
  const pxIn = g.startX + (g.bx - g.startX) * tIn;
  const lyIn = g.by - H;
  const fitsIn = (g.bx - pxIn) >= MIN_GAP;
  const lxIn   = fitsIn ? (pxIn + g.bx) / 2 : FBX;

  // Outgoing path at y = by + H
  const tRef  = Math.min(1, H / (g.endY - g.by));
  const pxRef = g.bx + (g.endX - g.bx) * tRef;
  const lyRef = g.by + H;
  const fitsRef = (g.bx - pxRef) >= MIN_GAP;
  const lxRef   = fitsRef ? (pxRef + g.bx) / 2 : FBX;

  // Fallback leader arrows
  if (!fitsIn)  arrow(FBX - 12, lyIn,  (pxIn  + g.bx) / 2 + 6, lyIn,  '#94a3b8', 1);
  if (!fitsRef) arrow(FBX - 12, lyRef, (pxRef + g.bx) / 2 + 6, lyRef, '#94a3b8', 1);

  ctx.save();
  ctx.fillStyle    = '#334155';
  ctx.font         = '700 12px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${g.deg}°`, lxIn,  lyIn);
  ctx.fillText(`${g.deg}°`, lxRef, lyRef);
  ctx.restore();
}

/* ── Path label (pᵢ / p_f on the main canvas) ─────────────── */
function drawPathLabel(base, sub, x, y, col) {
  subLabel(x, y, base, sub, col, 'center', 14);
}

/* ── Scientific notation formatter for computed values ────── */
function toSciStr(val) {
  if (val === 0) return '0';
  let exp  = Math.floor(Math.log10(Math.abs(val)));
  let mant = parseFloat((val / Math.pow(10, exp)).toFixed(2));
  if (mant >= 10) { mant /= 10; exp++; }
  if (exp === 0) return String(mant);
  return mant === 1 ? `10^${exp}` : `${mant} × 10^${exp}`;
}

/* ── On-canvas impulse overlay ────────────────────────────── */
function drawImpulseOverlay(g) {
  if (phase === 'incoming') return;

  // -p_i placed at the head of p_f (endX, endY), pointing opposite to p_i.
  // p_i direction: (cos rad, sin rad).  -p_i direction: (-cos rad, -sin rad).
  // Head of -p_i = (endX − PATH_LEN·cos rad, endY − PATH_LEN·sin rad) = (bx − 2L·cos rad, by).
  const negX2 = g.endX - PATH_LEN * Math.cos(g.rad);  // = g.bx − 2L·cos rad
  const negY2 = g.endY - PATH_LEN * Math.sin(g.rad);  // = g.by  (horizontal)

  // ── Altitude from B to Δp base (custom angles only — equilateral and
  //    right-angle triangles are already "special" so no line needed)
  if (cfg.triangle === 'custom' && g.deg > 0) {
    // Foot D = (endX, by) — B drops vertically onto the horizontal Δp line.
    // D always lies between A and C (triangle is isoceles, D is the midpoint).
    const dX = g.endX, dY = g.by;
    const sq = 7;
    ctx.save();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth   = 1.5;
    // Altitude line
    ctx.beginPath();
    ctx.moveTo(dX, dY);
    ctx.lineTo(dX, g.endY);
    ctx.stroke();
    // Right-angle marker at D (small square toward triangle interior)
    ctx.beginPath();
    ctx.moveTo(dX + sq, dY);
    ctx.lineTo(dX + sq, dY + sq);
    ctx.lineTo(dX,      dY + sq);
    ctx.stroke();
    ctx.restore();
  }

  // ── -p_i arrow (blue)
  arrow(g.endX, g.endY, negX2, negY2, COL_IN, 2);

  // ── Δp arrow: tail of p_f → head of -p_i (teal, horizontal)
  arrow(g.bx, g.by, negX2, negY2, COL_DP, 2.5);

  // ── Labels
  // -p_i: perpendicular offset to the right of the arrow direction
  const negMidX = (g.endX + negX2) / 2;
  const negMidY = (g.endY + negY2) / 2;
  const perpX   =  Math.sin(g.rad);   // CCW 90° of (-cos, -sin)
  const perpY   = -Math.cos(g.rad);
  const LOFF    = 20;
  subLabel(negMidX + perpX * LOFF, negMidY + perpY * LOFF, '-p', 'i', COL_IN, 'center', 13);

  // Δp: above the horizontal arrow
  ctx.save();
  ctx.fillStyle    = COL_DP;
  ctx.font         = 'italic 700 13px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Δp', (g.bx + negX2) / 2, g.by - 8);
  ctx.restore();

  // ── Angles inside the triangle (skip degenerate 0° case)
  if (cfg.showAngles && g.deg > 0) {
    // Bisector directions derived from normalize(u1 + u2) at each vertex:
    //   A (bx,by):        bisector = (−cos(rad/2),  sin(rad/2)), angle = deg
    //   B (endX,endY):    bisector = (0, −1),                   angle = 180−2·deg
    //   C (negX2,by):     bisector = ( cos(rad/2),  sin(rad/2)), angle = deg
    const hr = g.rad / 2;
    const TRIC_R = 24;
    const verts = [
      { x: g.bx,   y: g.by,   bx: -Math.cos(hr), by: Math.sin(hr),  ang: g.deg           },
      { x: g.endX, y: g.endY, bx: 0,              by: -1,            ang: 180 - 2 * g.deg },
      { x: negX2,  y: negY2,  bx:  Math.cos(hr),  by: Math.sin(hr),  ang: g.deg           },
    ];
    ctx.save();
    ctx.fillStyle    = '#334155';
    ctx.font         = '700 11px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    verts.forEach(v => ctx.fillText(`${v.ang}°`, v.x + v.bx * TRIC_R, v.y + v.by * TRIC_R));
    ctx.restore();
  }

  // ── Magnitudes
  if (cfg.showMagnitudes) {
    const p     = cfg.massMantissa * Math.pow(10, cfg.massExp) *
                  cfg.speedMantissa * Math.pow(10, cfg.speedExp);
    const dpMag = 2 * p * Math.cos(g.rad);
    const units = 'kg m s\u207b\u00b9';  // kg m s⁻¹

    ctx.save();
    ctx.font         = '11px "Trebuchet MS", sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'center';

    // -p_i magnitude (below the label)
    ctx.fillStyle = COL_IN;
    ctx.fillText(`${toSciStr(p)} ${units}`,
      negMidX + perpX * LOFF, negMidY + perpY * LOFF + 14);

    // Δp magnitude (below the arrow)
    ctx.fillStyle = COL_DP;
    ctx.fillText(`${toSciStr(dpMag)} ${units}`,
      (g.bx + negX2) / 2, g.by + 6);

    // p_i and p_f magnitudes (only in frozen phase when labels are shown)
    if (phase === 'frozen') {
      ctx.fillStyle = COL_IN;
      ctx.fillText(`${toSciStr(p)} ${units}`,
        (g.startX + g.bx) / 2 + 18 * Math.sin(g.rad) + 2,
        (g.startY + g.by) / 2 - 18 * Math.cos(g.rad) + 10);
      ctx.fillStyle = COL_OUT;
      ctx.fillText(`${toSciStr(p)} ${units}`,
        (g.bx + g.endX) / 2 - 18 * Math.sin(g.rad) - 2,
        (g.by + g.endY) / 2 - 18 * Math.cos(g.rad) + 10);
    }
    ctx.restore();
  }
}

/* ── Main draw ────────────────────────────────────────────── */
function draw() {
  const g = geometry();
  ctx.clearRect(0, 0, CW, CH);

  // Background
  ctx.fillStyle = 'rgba(240,246,255,0.55)';
  ctx.fillRect(0, 0, CW, CH);

  // ── Wall
  ctx.save();
  ctx.fillStyle   = '#64748b';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth   = 1.5;
  ctx.beginPath(); ctx.roundRect(WALL_X, 0, WALL_W, CH, 0);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle    = 'rgba(255,255,255,0.45)';
  ctx.font         = '700 12px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(WALL_X + WALL_W / 2, CH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('W A L L', 0, 0);
  ctx.restore();

  const t = Math.min(phaseT / PHASE_DUR, 1);

  if (phase === 'incoming') {
    const cx = g.startX + (g.bx - g.startX) * t;
    const cy = g.startY + (g.by - g.startY) * t;
    drawBall(cx, cy, COL_IN);
    arrow(g.startX, g.startY, cx, cy, COL_IN);

  } else if (phase === 'outgoing') {
    // Ghost ball at start
    drawBall(g.startX, g.startY, COL_IN, 0.35);
    // Full incoming trail + label
    arrow(g.startX, g.startY, g.bx, g.by, COL_IN);
    drawPathLabel('p', 'i',
      (g.startX + g.bx) / 2 + 18 * Math.sin(g.rad),
      (g.startY + g.by) / 2 - 18 * Math.cos(g.rad),
      COL_IN);
    // Partial outgoing trail — ball first, arrow on top
    const cx = g.bx + (g.endX - g.bx) * t;
    const cy = g.by + (g.endY - g.by) * t;
    drawBall(cx, cy, COL_OUT);
    arrow(g.bx, g.by, cx, cy, COL_OUT);
    if (cfg.showImpulse) drawImpulseOverlay(g);

  } else {
    // Frozen — balls first (semi-transparent), arrows on top
    drawBall(g.startX, g.startY, COL_IN, 0.35);
    drawBall(g.endX, g.endY, COL_OUT, 0.35);
    arrow(g.startX, g.startY, g.bx, g.by, COL_IN);
    arrow(g.bx, g.by, g.endX, g.endY, COL_OUT);

    // Path labels
    drawPathLabel('p', 'i',
      (g.startX + g.bx) / 2 + 18 * Math.sin(g.rad),
      (g.startY + g.by) / 2 - 18 * Math.cos(g.rad),
      COL_IN);
    drawPathLabel('p', 'f',
      (g.bx + g.endX) / 2 - 18 * Math.sin(g.rad),
      (g.by + g.endY) / 2 - 18 * Math.cos(g.rad),
      COL_OUT);

    if (cfg.showImpulse) drawImpulseOverlay(g);

    // Reset hint
    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,0.88)';
    ctx.strokeStyle  = 'rgba(21,48,77,0.10)';
    ctx.lineWidth    = 1;
    ctx.beginPath(); ctx.roundRect(14, CH - 42, 152, 28, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle    = '#55708d';
    ctx.font         = '700 12px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Press Reset to replay', 14 + 76, CH - 42 + 14);
    ctx.restore();
  }

  if (cfg.showAngles) drawAnglesOverlay(g);
}

/* ── Animation loop ───────────────────────────────────────── */
function loop(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (phase !== 'frozen') {
    phaseT += dt;
    if (phaseT >= PHASE_DUR) {
      phaseT = PHASE_DUR;
      if      (phase === 'incoming') { phase = 'outgoing'; phaseT = 0; }
      else if (phase === 'outgoing') { phase = 'frozen'; }
    }
  }

  draw();
  drawValues();
  requestAnimationFrame(loop);
}

/* ── Wire up controls ─────────────────────────────────────── */
document.querySelectorAll('#seg-triangle .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.triangle = btn.dataset.val;
    document.querySelectorAll('#seg-triangle .seg-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('custom-angle-row').style.display =
      cfg.triangle === 'custom' ? '' : 'none';
    reset();
  });
});

document.getElementById('custom-angle').addEventListener('input', e => {
  cfg.customAngle = Math.max(0, Math.min(89, parseInt(e.target.value) || 0));
  if (cfg.triangle === 'custom') reset();
});
document.getElementById('custom-angle').addEventListener('change', e => {
  cfg.customAngle = Math.max(0, Math.min(89, parseInt(e.target.value) || 0));
  e.target.value = cfg.customAngle;
  if (cfg.triangle === 'custom') reset();
});

function clampMantissa(v) { return Math.max(1, Math.min(9.99, parseFloat(v) || 1)); }
function clampExp(v, lo, hi) { return Math.max(lo, Math.min(hi, parseInt(v) || 0)); }

document.getElementById('mass-mantissa').addEventListener('input', e => {
  cfg.massMantissa = clampMantissa(e.target.value);
  reset();
});
document.getElementById('mass-mantissa').addEventListener('change', e => {
  cfg.massMantissa = clampMantissa(e.target.value);
  e.target.value = cfg.massMantissa;
});

document.getElementById('mass-exp').addEventListener('input', e => {
  cfg.massExp = clampExp(e.target.value, -31, 31);
  reset();
});
document.getElementById('mass-exp').addEventListener('change', e => {
  cfg.massExp = clampExp(e.target.value, -31, 31);
  e.target.value = cfg.massExp;
});

document.getElementById('speed-mantissa').addEventListener('input', e => {
  cfg.speedMantissa = clampMantissa(e.target.value);
  reset();
});
document.getElementById('speed-mantissa').addEventListener('change', e => {
  cfg.speedMantissa = clampMantissa(e.target.value);
  e.target.value = cfg.speedMantissa;
});

document.getElementById('speed-exp').addEventListener('input', e => {
  cfg.speedExp = clampExp(e.target.value, -8, 8);
  reset();
});
document.getElementById('speed-exp').addEventListener('change', e => {
  cfg.speedExp = clampExp(e.target.value, -8, 8);
  e.target.value = cfg.speedExp;
});

document.querySelectorAll('#seg-angles .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.showAngles = btn.dataset.val === 'show';
    document.querySelectorAll('#seg-angles .seg-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.querySelectorAll('#seg-impulse .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.showImpulse = btn.dataset.val === 'show';
    document.querySelectorAll('#seg-impulse .seg-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.querySelectorAll('#seg-magnitudes .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.showMagnitudes = btn.dataset.val === 'show';
    document.querySelectorAll('#seg-magnitudes .seg-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.getElementById('btn-reset').addEventListener('click', reset);

/* ── Start ────────────────────────────────────────────────── */
requestAnimationFrame(loop);
