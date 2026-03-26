'use strict';

/* ─────────────────────────────── Constants ─────────────────────────── */
const PPM        = 2000;        // canvas pixels per physical metre
const E_CHARGE   = 1.6e-19;    // C
const M_ELECTRON = 9.109e-31;  // kg
const M_PROTON   = 1.673e-27;  // kg
const PLATE_T    = 12;         // plate visual thickness, px

/* ─────────────────────────────── Formatting ────────────────────────── */
const SUPER = {'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
function sup(n) { return String(n).split('').map(c => SUPER[c] ?? c).join(''); }

function fmtSci(val, unit, dp = 2) {
  if (!Number.isFinite(val) || val === 0) return `0 ${unit}`;
  const neg = val < 0;
  const abs = Math.abs(val);
  let exp = Math.floor(Math.log10(abs));
  let man = abs / Math.pow(10, exp);
  if (man >= 9.995) { man = 1; exp += 1; }
  return `${neg ? '−' : ''}${man.toFixed(dp)} × 10${sup(exp)} ${unit}`;
}

function fmtEV(joules) {
  const ev = joules / E_CHARGE;
  if (ev < 1e3) return `${ev.toFixed(1)} eV`;
  if (ev < 1e6) return `${(ev / 1e3).toFixed(2)} keV`;
  return `${(ev / 1e6).toFixed(3)} MeV`;
}

function fmtDist(metres) {
  if (metres < 0.001) return `${(metres * 1000).toFixed(2)} mm`;
  if (metres < 0.10)  return `${(metres * 100).toFixed(2)} cm`;
  return `${metres.toFixed(3)} m`;
}

/* ─────────────────────────────── Canvas ────────────────────────────── */
const canvas = document.getElementById('simulation-canvas');
const ctx    = canvas.getContext('2d');

function W() { return canvas.width  / (window.devicePixelRatio || 1); }
function H() { return canvas.height / (window.devicePixelRatio || 1); }

// Layout fractions
const PLATE_L = 0.17;
const PLATE_R = 0.83;

function plLeft()    { return W() * PLATE_L; }
function plRight()   { return W() * PLATE_R; }
function midY()      { return H() / 2; }
function halfGapPx() { return (state.d * PPM) / 2; }
function topPlY()    { return midY() - halfGapPx(); }
function botPlY()    { return midY() + halfGapPx(); }
function plateLenM() { return (plRight() - plLeft()) / PPM; }

function resizeCanvas() {
  const wrap = canvas.parentElement;
  const dpr  = window.devicePixelRatio || 1;
  const cw   = wrap.clientWidth - 2 * 13;
  const ch   = Math.round(cw * 7 / 12);
  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width  = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

/* ─────────────────────────────── State ─────────────────────────────── */
const state = {
  mode:            'deflection',
  particle:        'electron',
  customSign:      +1,
  V:               0,      // Volts
  d:               0.10,   // metres
  v0f:             5,      // × 10⁷ m/s
  showField:       false,
  showForce:       false,
  showUndeflected: false,
};

function v0() { return state.v0f * 1e7; }

function getParticle() {
  switch (state.particle) {
    case 'electron': return { q: -E_CHARGE, m: M_ELECTRON };
    case 'proton':   return { q: +E_CHARGE, m: M_PROTON };
    default:         return { q: state.customSign * E_CHARGE, m: M_ELECTRON };
  }
}

/* ─────────────────────────────── Physics ───────────────────────────── */
function calcPhysics() {
  const { V, d } = state;
  const { q, m } = getParticle();
  const V0 = v0();

  const Efield  = V / d;                // V m⁻¹
  const F       = Math.abs(q) * Efield; // N
  const a       = F / m;               // m s⁻²
  const L       = plateLenM();         // m (plate length)
  const tCross  = L / V0;              // s (time to traverse plates)
  const yCross  = 0.5 * a * tCross * tCross; // m (deflection if no collision)

  // Field points top → bottom (+y canvas direction).
  // Negative charge deflects upward (−y); positive charge deflects downward (+y).
  const qDir = q < 0 ? -1 : +1;

  const halfD     = d / 2;
  const hitsPlate = yCross >= halfD;
  const tHit      = hitsPlate ? Math.sqrt(2 * halfD / a) : tCross;
  const yExit     = hitsPlate ? halfD : yCross; // m from centre at exit/impact

  // Energy: work done by field = force × displacement in field direction
  const KE_entry = 0.5 * m * V0 * V0;
  const W        = F * yExit;           // always positive (field accelerates particle)
  const KE_exit  = KE_entry + W;

  return { Efield, F, a, L, tCross, yCross, qDir, hitsPlate, tHit, yExit, q, KE_entry, KE_exit };
}

/* ───────────────────────── Acceleration physics ────────────────────── */

// In acceleration mode the plates are vertical (left / right).
// The gap between them equals state.d — the same slider as deflection.
// The particle enters from the left, parallel to the field, and
// is always arranged to accelerate rightward regardless of charge sign.
function accelLeftX()  { return W() / 2 - halfGapPx(); }
function accelRightX() { return W() / 2 + halfGapPx(); }

function calcAccelPhysics() {
  const { V, d } = state;
  const { q, m } = getParticle();
  const V0 = v0();

  const Efield = V / d;
  const F      = Math.abs(q) * Efield;
  const a      = F / m;

  // Particle traverses full gap d → v² = v₀² + 2ad
  const v_exit = Math.sqrt(V0 * V0 + 2 * a * d);
  // Time to cross: v = v₀ + at  →  t = (v_exit − v₀) / a  (guard a = 0)
  const tCross = a > 0 ? (v_exit - V0) / a : d / V0;

  // KE gained = |q|V  (particle traverses the full potential difference)
  const KE_entry = 0.5 * m * V0 * V0;
  const KE_exit  = 0.5 * m * v_exit * v_exit;

  return { Efield, F, a, d, V0, v_exit, tCross, KE_entry, KE_exit, q };
}

/* ─────────────────────────────── Drawing ───────────────────────────── */

function drawGrid() {
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.06)';
  ctx.lineWidth = 1;
  const w = W(), h = H();
  for (let x = 0; x <= w; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y <= h; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function drawPlates() {
  const x1 = plLeft(), x2 = plRight();
  const ty  = topPlY(), by = botPlY();
  const PT  = PLATE_T;

  // Subtle field region fill
  ctx.fillStyle = 'rgba(220, 235, 255, 0.32)';
  ctx.fillRect(x1, ty, x2 - x1, by - ty);

  // Top plate — positive (red)
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(x1 - 4, ty - PT, x2 - x1 + 8, PT);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x1 - 4, ty - PT, x2 - x1 + 8, PT * 0.35); // highlight

  // Bottom plate — negative (blue)
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(x1 - 4, by, x2 - x1 + 8, PT);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x1 - 4, by, x2 - x1 + 8, PT * 0.35); // highlight

  // ± labels on left
  ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#b91c1c';
  ctx.fillText('+', x1 - 10, ty - PT / 2);
  ctx.fillStyle = '#1d4ed8';
  ctx.fillText('−', x1 - 10, by + PT / 2);

  // Voltage labels on right
  ctx.font = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#b91c1c';
  ctx.fillText(state.V > 0 ? `+${state.V} V` : '0 V', x2 + 10, ty - PT / 2);
  ctx.fillStyle = '#1d4ed8';
  ctx.fillText('0 V', x2 + 10, by + PT / 2);
}

function drawTrajectory() {
  const ph = calcPhysics();
  const { a, qDir, hitsPlate, tHit, yExit } = ph;
  const V0 = v0();
  const L  = plateLenM();
  const pl = plLeft(), pr = plRight();
  const my = midY();

  const tEnd   = hitsPlate ? tHit : L / V0;
  const exitXpx = pl + V0 * tEnd * PPM;
  const exitYpx = my + qDir * yExit * PPM;

  ctx.setLineDash([]);

  // ── 1. Entry path ──
  ctx.beginPath();
  ctx.moveTo(0, my);
  ctx.lineTo(pl, my);
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // ── 2. Parabolic path inside plates ──
  const STEPS = 300;
  ctx.beginPath();
  ctx.moveTo(pl, my);
  for (let i = 1; i <= STEPS; i++) {
    const t   = (i / STEPS) * tEnd;
    const xPx = pl + V0 * t * PPM;
    const yPx = my + qDir * 0.5 * a * t * t * PPM;
    ctx.lineTo(xPx, yPx);
  }
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // ── 3. Exit path — straight line (only if particle cleared the plates) ──
  if (!hitsPlate) {
    const vy    = a * (L / V0);           // vertical speed at exit, m/s
    const slope = qDir * vy / V0;         // dy/dx (dimensionless)
    ctx.beginPath();
    ctx.moveTo(pr, exitYpx);
    ctx.lineTo(W(), exitYpx + slope * (W() - pr));
    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // ── 4. Particle marker at entry (left edge of plates) ──
  const { q } = getParticle();
  const pCol  = q < 0 ? '#2563eb' : '#dc2626';
  const pDark = q < 0 ? '#1d4ed8' : '#b91c1c';
  const pSign = q < 0 ? '−' : '+';

  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.20)';
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetY = 3;
  const grd = ctx.createRadialGradient(pl - 3, my - 3, 1, pl, my, 10);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, pCol);
  grd.addColorStop(1, pDark);
  ctx.beginPath();
  ctx.arc(pl, my, 10, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle    = 'white';
  ctx.font         = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pSign, pl, my + 1);

  // ── 5. Impact marker if particle hits a plate ──
  if (hitsPlate) {
    ctx.beginPath();
    ctx.arc(exitXpx, exitYpx, 5, 0, Math.PI * 2);
    ctx.fillStyle   = '#dc2626';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    ctx.fillStyle    = '#dc2626';
    ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = qDir > 0 ? 'top' : 'bottom';
    ctx.fillText('hits plate', exitXpx, exitYpx + qDir * 10);
  }
}

function drawAccelPlates() {
  const lx = accelLeftX(), rx = accelRightX();
  const PT = PLATE_T;
  const my = midY(), h = H();

  // Polarity is set so the particle always accelerates rightward:
  //   q > 0  →  left plate is +  (E rightward, force rightward)
  //   q < 0  →  right plate is + (E leftward, force rightward since F = qE with q < 0)
  const { q } = getParticle();
  const leftPos  = q > 0;
  const leftCol  = leftPos ? '#dc2626' : '#2563eb';
  const rightCol = leftPos ? '#2563eb' : '#dc2626';

  // Field region fill
  ctx.fillStyle = 'rgba(220, 235, 255, 0.32)';
  ctx.fillRect(lx, 0, rx - lx, h);

  // Left plate
  ctx.fillStyle = leftCol;
  ctx.fillRect(lx - PT, 0, PT, h);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(lx - PT, 0, PT / 3, h);

  // Right plate
  ctx.fillStyle = rightCol;
  ctx.fillRect(rx, 0, PT, h);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(rx, 0, PT / 3, h);

  // Polarity labels
  ctx.font         = 'bold 15px "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'right';
  ctx.fillStyle    = leftPos ? '#b91c1c' : '#1d4ed8';
  ctx.fillText(leftPos ? '+' : '−', lx - PT - 10, my);
  ctx.textAlign = 'left';
  ctx.fillStyle = leftPos ? '#1d4ed8' : '#b91c1c';
  ctx.fillText(leftPos ? '−' : '+', rx + PT + 10, my);

  // Voltage labels at top of each plate
  const vLabel = state.V > 0 ? `+${state.V} V` : '0 V';
  ctx.font         = '12px "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign    = 'center';
  ctx.fillStyle    = leftPos ? '#b91c1c' : '#1d4ed8';
  ctx.fillText(leftPos ? vLabel : '0 V', lx - PT / 2, 20);
  ctx.fillStyle    = leftPos ? '#1d4ed8' : '#b91c1c';
  ctx.fillText(leftPos ? '0 V' : vLabel, rx + PT / 2, 20);
}

function drawAccelTrajectory() {
  const ph = calcAccelPhysics();
  const { a, V0, v_exit, tCross, q } = ph;
  const lx = accelLeftX(), rx = accelRightX();
  const my = midY();

  ctx.setLineDash([]);

  // ── 1. Full path line ──
  ctx.beginPath();
  ctx.moveTo(0, my);
  ctx.lineTo(W(), my);
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth   = 2.5;
  ctx.stroke();

  // ── 2. Time-spaced dots (closer = slower, farther = faster) ──
  const d_entry  = lx / PPM;
  const d_exit   = (W() - rx) / PPM;
  const t_entry  = d_entry / V0;
  const t_exitReg = v_exit > 0 ? d_exit / v_exit : 0;
  const T_total  = t_entry + tCross + t_exitReg;

  const N = 28;
  ctx.fillStyle = 'rgba(15, 118, 110, 0.6)';
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * T_total;
    let xPx;
    if (t <= t_entry) {
      xPx = t * V0 * PPM;
    } else if (t <= t_entry + tCross) {
      const tp = t - t_entry;
      xPx = lx + (V0 * tp + 0.5 * a * tp * tp) * PPM;
    } else {
      const tp = t - t_entry - tCross;
      xPx = rx + tp * v_exit * PPM;
    }
    ctx.beginPath();
    ctx.arc(Math.min(xPx, W() - 2), my, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── 3. Particle marker at field entry ──
  const pCol  = q < 0 ? '#2563eb' : '#dc2626';
  const pDark = q < 0 ? '#1d4ed8' : '#b91c1c';
  const pSign = q < 0 ? '−' : '+';

  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.20)';
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetY = 3;
  const grd = ctx.createRadialGradient(lx - 3, my - 3, 1, lx, my, 10);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, pCol);
  grd.addColorStop(1, pDark);
  ctx.beginPath();
  ctx.arc(lx, my, 10, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle    = 'white';
  ctx.font         = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pSign, lx, my + 1);

  // ── 4. Speed annotations above the path ──
  function fmtSpeed(v) {
    const f = v / 1e7;
    return `${f.toFixed(1)} × 10${sup(7)} m s⁻¹`;
  }

  ctx.font         = '12px "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign    = 'center';
  ctx.fillStyle    = 'rgba(21,48,77,0.55)';
  ctx.fillText(`v₀ = ${fmtSpeed(V0)}`, lx, my - 18);
  ctx.fillStyle    = '#0f766e';
  ctx.fillText(`v = ${fmtSpeed(v_exit)}`, rx, my - 18);
}

/* ─────────────────────────────── Overlay helpers ───────────────────── */

// Generic arrow from (x1,y1) to (x2,y2). Caller sets strokeStyle/fillStyle/lineWidth.
function drawArrow(x1, y1, x2, y2, headLen = 8, headWidth = 4) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * ux + headWidth * uy, y2 - headLen * uy - headWidth * ux);
  ctx.lineTo(x2 - headLen * ux - headWidth * uy, y2 - headLen * uy + headWidth * ux);
  ctx.closePath();
  ctx.fill();
}

/* ─────────────────────── Overlay: E field arrows ───────────────────── */

function drawFieldArrows() {
  const ARROW = 20;
  ctx.strokeStyle = 'rgba(37,99,235,0.50)';
  ctx.fillStyle   = 'rgba(37,99,235,0.50)';
  ctx.lineWidth   = 1.5;

  if (state.mode === 'deflection') {
    const x1 = plLeft(), x2 = plRight();
    const ty = topPlY(), by = botPlY();
    const gapPx = by - ty;
    if (gapPx < 30) return;

    const COLS = 7, ROWS = 4;
    for (let c = 0; c < COLS; c++) {
      const x = x1 + (x2 - x1) * (c + 0.5) / COLS;
      for (let r = 0; r < ROWS; r++) {
        const y = ty + gapPx * (r + 0.5) / ROWS;
        // E always points downward: + plate (top) → − plate (bottom)
        drawArrow(x, y - ARROW / 2, x, y + ARROW / 2);
      }
    }
    // "E" legend inside field region
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = 'rgba(37,99,235,0.70)';
    ctx.fillText('E', x2 - 6, ty + 5);

  } else {
    // Acceleration mode — field direction depends on charge sign
    const lx = accelLeftX(), rx = accelRightX();
    const { q } = getParticle();
    const rightward = q > 0; // proton: + plate on left  → E rightward
    const COLS = 5, ROWS = 4;

    for (let c = 0; c < COLS; c++) {
      const x = lx + (rx - lx) * (c + 0.5) / COLS;
      for (let r = 0; r < ROWS; r++) {
        const y = H() * (r + 1) / (ROWS + 1);
        if (rightward) {
          drawArrow(x - ARROW / 2, y, x + ARROW / 2, y);
        } else {
          drawArrow(x + ARROW / 2, y, x - ARROW / 2, y);
        }
      }
    }
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign    = rightward ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = 'rgba(37,99,235,0.70)';
    ctx.fillText('E', rightward ? rx - 6 : lx + 6, 24);
  }
}

/* ─────────────────────── Overlay: force arrow ──────────────────────── */

function drawForceArrow() {
  if (state.V === 0) return;
  const PARTICLE_R = 10;
  const MIN_LEN    = 22, MAX_LEN = 70;
  const Efield     = state.V / state.d;
  const maxE       = 5000 / 0.02;          // 250 kV m⁻¹ (slider maximum)
  const arrowLen   = MIN_LEN + Math.min(1, Efield / maxE) * (MAX_LEN - MIN_LEN);

  ctx.strokeStyle = '#d97706';
  ctx.fillStyle   = '#d97706';
  ctx.lineWidth   = 2.5;

  if (state.mode === 'deflection') {
    const ph   = calcPhysics();
    const dir  = ph.qDir;          // −1 = upward on canvas, +1 = downward
    const x    = plLeft();
    const y0   = midY() + dir * PARTICLE_R;
    const y1   = y0 + dir * arrowLen;
    drawArrow(x, y0, x, y1);

    ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = dir > 0 ? 'top' : 'bottom';
    ctx.fillStyle    = '#92400e';
    ctx.fillText('F', x, y1 + dir * 4);

  } else {
    // Acceleration: force always rightward
    const x0 = accelLeftX() + PARTICLE_R;
    const x1 = x0 + arrowLen;
    const y  = midY();
    drawArrow(x0, y, x1, y);

    ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle    = '#92400e';
    ctx.fillText('F', x1 + 4, y - 2);
  }
}

/* ─────────────────────── Overlay: undeflected path ─────────────────── */

function drawUndeflectedPath() {
  // Only shown in Deflection mode — the parabolic vs straight comparison is the point.
  if (state.mode !== 'deflection') return;
  const my = midY();

  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.25)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(0, my);
  ctx.lineTo(W(), my);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font         = '11px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle    = 'rgba(21, 48, 77, 0.38)';
  ctx.fillText('no field', plLeft() - 6, my - 3);
}

/* ─────────────────────────────── Draw ──────────────────────────────── */

function draw() {
  ctx.clearRect(0, 0, W(), H());
  drawGrid();
  if (state.mode === 'deflection') {
    drawPlates();
    if (state.showField)       drawFieldArrows();
    if (state.showUndeflected) drawUndeflectedPath();
    drawTrajectory();
  } else {
    drawAccelPlates();
    if (state.showField) drawFieldArrows();
    drawAccelTrajectory();
  }
  if (state.showForce) drawForceArrow();
  updateReadouts();
}

/* ─────────────────────────────── Readouts ──────────────────────────── */
function updateReadouts() {
  let Efield, F, a, KE_entry, KE_exit;

  if (state.mode === 'deflection') {
    const ph = calcPhysics();
    ({ Efield, F, a, KE_entry, KE_exit } = ph);
    const el = document.getElementById('readout-y');
    if (ph.hitsPlate) {
      el.textContent = 'Hits plate';
      el.style.color = '#dc2626';
    } else {
      el.textContent = fmtDist(ph.yCross);
      el.style.color = '';
    }
  } else {
    const ph = calcAccelPhysics();
    ({ Efield, F, a, KE_entry, KE_exit } = ph);
    document.getElementById('readout-v-exit').textContent = fmtSci(ph.v_exit, 'm s⁻¹');
  }

  document.getElementById('readout-e').textContent = fmtSci(Efield, 'V m⁻¹');
  document.getElementById('readout-f').textContent = fmtSci(F, 'N');
  document.getElementById('readout-a').textContent = fmtSci(a, 'm s⁻²');

  document.getElementById('readout-ke-entry-j').textContent  = fmtSci(KE_entry, 'J');
  document.getElementById('readout-ke-entry-ev').textContent = fmtEV(KE_entry);
  document.getElementById('readout-ke-exit-j').textContent   = fmtSci(KE_exit, 'J');
  document.getElementById('readout-ke-exit-ev').textContent  = fmtEV(KE_exit);
}

/* ─────────────────────────────── Slider displays ───────────────────── */
function updateVoltageDisplay() {
  const v = state.V;
  document.getElementById('voltage-display').textContent =
    v === 0    ? '0 V (no field)' :
    v >= 1000  ? `${(v / 1000).toFixed(1)} kV` :
                 `${v} V`;
}

function updateSeparationDisplay() {
  document.getElementById('separation-display').textContent =
    `${(state.d * 100).toFixed(0)} cm`;
}

function updateSpeedDisplay() {
  document.getElementById('speed-display').textContent =
    `${state.v0f.toFixed(1)} × 10${sup(7)} m s⁻¹`;
}

/* ─────────────────────────────── Controls wiring ───────────────────── */

document.getElementById('voltage-slider').addEventListener('input', e => {
  state.V = parseInt(e.target.value, 10);
  updateVoltageDisplay();
  draw();
});

document.getElementById('separation-slider').addEventListener('input', e => {
  state.d = parseInt(e.target.value, 10) / 100;
  updateSeparationDisplay();
  draw();
});

document.getElementById('speed-slider').addEventListener('input', e => {
  state.v0f = parseFloat(e.target.value);
  updateSpeedDisplay();
  draw();
});

document.getElementById('particle-select').addEventListener('change', e => {
  state.particle = e.target.value;
  document.getElementById('custom-charge-group')
    .classList.toggle('is-hidden', state.particle !== 'custom');
  draw();
});

document.getElementById('charge-sign-pos').addEventListener('click', () => {
  state.customSign = +1;
  document.getElementById('charge-sign-pos').classList.add('active');
  document.getElementById('charge-sign-neg').classList.remove('active');
  document.getElementById('charge-sign-pos').setAttribute('aria-pressed', 'true');
  document.getElementById('charge-sign-neg').setAttribute('aria-pressed', 'false');
  draw();
});

document.getElementById('charge-sign-neg').addEventListener('click', () => {
  state.customSign = -1;
  document.getElementById('charge-sign-neg').classList.add('active');
  document.getElementById('charge-sign-pos').classList.remove('active');
  document.getElementById('charge-sign-neg').setAttribute('aria-pressed', 'true');
  document.getElementById('charge-sign-pos').setAttribute('aria-pressed', 'false');
  draw();
});

document.getElementById('btn-mode-deflection').addEventListener('click', () => {
  state.mode = 'deflection';
  document.getElementById('btn-mode-deflection').classList.add('active');
  document.getElementById('btn-mode-acceleration').classList.remove('active');
  document.getElementById('btn-mode-deflection').setAttribute('aria-pressed', 'true');
  document.getElementById('btn-mode-acceleration').setAttribute('aria-pressed', 'false');
  document.getElementById('readout-deflection-card').classList.remove('is-hidden');
  document.getElementById('readout-exit-speed-card').classList.add('is-hidden');
  draw();
});

document.getElementById('btn-mode-acceleration').addEventListener('click', () => {
  state.mode = 'acceleration';
  document.getElementById('btn-mode-acceleration').classList.add('active');
  document.getElementById('btn-mode-deflection').classList.remove('active');
  document.getElementById('btn-mode-acceleration').setAttribute('aria-pressed', 'true');
  document.getElementById('btn-mode-deflection').setAttribute('aria-pressed', 'false');
  document.getElementById('readout-exit-speed-card').classList.remove('is-hidden');
  document.getElementById('readout-deflection-card').classList.add('is-hidden');
  draw();
});

/* ─────────────────────────────── Overlay toggles ───────────────────── */

function applyToggle(stateKey, btnId) {
  state[stateKey] = !state[stateKey];
  const btn = document.getElementById(btnId);
  btn.classList.toggle('active', state[stateKey]);
  btn.setAttribute('aria-pressed', String(state[stateKey]));
  draw();
}

document.getElementById('btn-show-field').addEventListener('click',
  () => applyToggle('showField', 'btn-show-field'));
document.getElementById('btn-show-force').addEventListener('click',
  () => applyToggle('showForce', 'btn-show-force'));
document.getElementById('btn-show-undeflected').addEventListener('click',
  () => applyToggle('showUndeflected', 'btn-show-undeflected'));

/* ─────────────────────────────── Init ──────────────────────────────── */
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
  resizeCanvas();
  updateVoltageDisplay();
  updateSeparationDisplay();
  updateSpeedDisplay();
});
