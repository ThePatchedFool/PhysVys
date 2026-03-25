/* ── Constants ─────────────────────────────────────────────── */

const CW = 960, CH = 560;
const BANK_DEG  = 25;
const BANK_RAD  = BANK_DEG * Math.PI / 180;

// Force vector colours
const COL_WEIGHT   = '#dc2626';
const COL_NORMAL   = '#2563eb';
const COL_FRICTION = '#d97706';
const COL_NET      = '#0d9488';
const COL_COMP     = 'rgba(37,99,235,0.35)'; // N component dashes

/* ── State ─────────────────────────────────────────────────── */

const state = {
  surface: 'flat',    // 'flat' | 'banked'
  speed:   'ideal',   // 'slow' | 'ideal' | 'fast'
  view:    'cross',   // 'cross' | 'overhead' | 'persp'
  animT:   0,
  running: true
};

/* ── DOM ───────────────────────────────────────────────────── */

const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');

/* ── Shared helpers ────────────────────────────────────────── */

function lbl(text, x, y, opts = {}) {
  ctx.save();
  ctx.font         = opts.font  || '700 13px "Trebuchet MS", sans-serif';
  ctx.fillStyle    = opts.color || '#15304d';
  ctx.textAlign    = opts.align || 'center';
  ctx.textBaseline = opts.base  || 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function arrow(x1, y1, x2, y2, col, width = 3) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len, uy = dy / len;
  const hs = Math.min(14, len * 0.4);

  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle   = col;
  ctx.lineWidth   = width;
  ctx.lineCap     = 'round';

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hs * (ux - 0.4 * uy), y2 - hs * (uy + 0.4 * ux));
  ctx.lineTo(x2 - hs * (ux + 0.4 * uy), y2 - hs * (uy - 0.4 * ux));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function dashedArrow(x1, y1, x2, y2, col, dash = [8, 5]) {
  ctx.save();
  ctx.setLineDash(dash);
  arrow(x1, y1, x2, y2, col, 2.5);
  ctx.restore();
}

function panel(x, y, w, h, fill = 'rgba(255,255,255,0.88)', stroke = 'rgba(21,48,77,0.12)') {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════
   CAR DRAWINGS
════════════════════════════════════════════════════════════ */

// Front-facing car (cross-section view).
// Call with ctx already translated so that y=0 is the road surface under the car.
function drawCarFront() {
  const W  = 84;    // total width
  const TR = 12;    // tyre radius
  const BH = 24;    // lower-body height above tyre centre
  const CH = 22;    // cabin height above body shoulder

  const shoulderY = -(TR + BH);   // top of lower body
  const cabinTopY = shoulderY - CH;
  const bodyBotY  = -TR * 0.6;    // bottom of body (slightly above road)

  // ── Tyres ─────────────────────────────────────────────────
  [W * -0.36, W * 0.36].forEach(tx => {
    // Tyre
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(tx, -TR, TR, 0, 2 * Math.PI); ctx.fill();
    // Tread ring
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, -TR, TR - 2.5, 0, 2 * Math.PI); ctx.stroke();
    // Alloy rim
    ctx.fillStyle = '#d0d8e0';
    ctx.beginPath(); ctx.arc(tx, -TR, TR * 0.52, 0, 2 * Math.PI); ctx.fill();
    // Rim spokes
    ctx.strokeStyle = '#a0aab4'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(tx + Math.cos(a) * TR * 0.18, -TR + Math.sin(a) * TR * 0.18);
      ctx.lineTo(tx + Math.cos(a) * TR * 0.48, -TR + Math.sin(a) * TR * 0.48);
      ctx.stroke();
    }
    // Centre hub
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.arc(tx, -TR, TR * 0.14, 0, 2 * Math.PI); ctx.fill();
  });

  // ── Lower body (trapezoidal sill) ─────────────────────────
  ctx.fillStyle = '#2970b8';
  ctx.strokeStyle = '#1a5090';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-W * 0.48, bodyBotY);
  ctx.lineTo( W * 0.48, bodyBotY);
  ctx.lineTo( W * 0.40, shoulderY);
  ctx.lineTo(-W * 0.40, shoulderY);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // ── Cabin / greenhouse ────────────────────────────────────
  const cabW = W * 0.62;
  ctx.fillStyle = '#3a82ca';
  ctx.strokeStyle = '#1a5090';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-cabW / 2,      shoulderY);
  ctx.bezierCurveTo(-cabW / 2, cabinTopY + 4, -cabW * 0.3, cabinTopY, 0, cabinTopY);
  ctx.bezierCurveTo( cabW * 0.3, cabinTopY,    cabW / 2,   cabinTopY + 4, cabW / 2, shoulderY);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // ── Windscreen ────────────────────────────────────────────
  ctx.fillStyle = 'rgba(160,215,255,0.68)';
  ctx.strokeStyle = 'rgba(80,140,200,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-cabW / 2 + 7, shoulderY - 1);
  ctx.bezierCurveTo(-cabW / 2 + 7, cabinTopY + 8, -cabW * 0.28, cabinTopY + 5, 0, cabinTopY + 5);
  ctx.bezierCurveTo( cabW * 0.28,  cabinTopY + 5,  cabW / 2 - 7, cabinTopY + 8, cabW / 2 - 7, shoulderY - 1);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // ── Headlights ────────────────────────────────────────────
  [[-W * 0.37, shoulderY + 7], [W * 0.37, shoulderY + 7]].forEach(([hx, hy]) => {
    ctx.fillStyle = '#ffffc0';
    ctx.strokeStyle = '#c8a020'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(hx, hy, 10, 6, 0, 0, 2 * Math.PI);
    ctx.fill(); ctx.stroke();
    // Inner lens
    ctx.fillStyle = '#ffff80';
    ctx.beginPath(); ctx.ellipse(hx, hy, 5.5, 3.5, 0, 0, 2 * Math.PI); ctx.fill();
  });

  // ── Grille ────────────────────────────────────────────────
  ctx.fillStyle = '#0e3a6a';
  ctx.beginPath();
  ctx.roundRect(-W * 0.19, shoulderY + 2, W * 0.38, 9, 3);
  ctx.fill();

  // ── Bumper ────────────────────────────────────────────────
  ctx.fillStyle = '#1a5090';
  ctx.beginPath();
  ctx.roundRect(-W * 0.43, bodyBotY - 1, W * 0.86, 6, 3);
  ctx.fill();
}

// Top-down car (overhead view).
// Call with ctx already translated to car centre and rotated so +y = forward.
function drawCarTop() {
  const W = 26;   // car width
  const L = 50;   // car length

  // ── Body outline ──────────────────────────────────────────
  ctx.fillStyle = '#2970b8';
  ctx.strokeStyle = '#1a5090'; ctx.lineWidth = 2;
  ctx.beginPath();
  // Slightly pointed front (–y), rounded rear (+y)
  ctx.moveTo(0, -L / 2);
  ctx.bezierCurveTo( W / 2, -L / 2 + 6,  W / 2, -L / 2 + 10,  W / 2,  -L / 2 + 14);
  ctx.lineTo( W / 2,  L / 2 - 10);
  ctx.bezierCurveTo( W / 2, L / 2,  -W / 2, L / 2,  -W / 2, L / 2 - 10);
  ctx.lineTo(-W / 2, -L / 2 + 14);
  ctx.bezierCurveTo(-W / 2, -L / 2 + 10, -W / 2, -L / 2 + 6, 0, -L / 2);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // ── Roof panel ────────────────────────────────────────────
  ctx.fillStyle = '#3a82ca';
  ctx.beginPath();
  ctx.roundRect(-W / 2 + 5, -L / 2 + 14, W - 10, L - 30, 4);
  ctx.fill();

  // ── Front windscreen ──────────────────────────────────────
  ctx.fillStyle = 'rgba(160,215,255,0.72)';
  ctx.strokeStyle = 'rgba(80,140,200,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-W / 2 + 5, -L / 2 + 14);
  ctx.lineTo( W / 2 - 5, -L / 2 + 14);
  ctx.lineTo( W / 2 - 7, -L / 2 + 6);
  ctx.bezierCurveTo(W / 2 - 7, -L / 2 + 2, -W / 2 + 7, -L / 2 + 2, -W / 2 + 7, -L / 2 + 6);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // ── Rear windscreen ───────────────────────────────────────
  ctx.fillStyle = 'rgba(160,215,255,0.45)';
  ctx.beginPath();
  ctx.roundRect(-W / 2 + 6, L / 2 - 18, W - 12, 10, 2);
  ctx.fill();

  // ── Wheels (four corners) ─────────────────────────────────
  const wheelPositions = [
    [-W / 2 - 2, -L / 2 + 11],
    [ W / 2 + 2, -L / 2 + 11],
    [-W / 2 - 2,  L / 2 - 11],
    [ W / 2 + 2,  L / 2 - 11],
  ];
  wheelPositions.forEach(([wx, wy]) => {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.roundRect(wx - 4, wy - 7, 8, 14, 2); ctx.fill();
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.ellipse(wx, wy, 2.5, 5, 0, 0, 2 * Math.PI); ctx.fill();
  });
}

/* ════════════════════════════════════════════════════════════
   VIEW 1: CROSS-SECTION
════════════════════════════════════════════════════════════ */

function drawCrossSection() {
  // Background
  ctx.fillStyle = '#f0f4ff';
  ctx.fillRect(0, 0, CW, CH);

  const cx = CW / 2;       // horizontal centre of road
  const ry = 380;           // y of road centre (for flat)
  const ROAD_HALF = 160;    // half-width of the road strip (in cross-section)
  const roadThick = 18;
  const isFlat   = state.surface === 'flat';
  const speed    = state.speed;

  // ── Road surface ──────────────────────────────────────────
  ctx.save();
  ctx.translate(cx, ry);
  if (!isFlat) ctx.rotate(+BANK_RAD);  // clockwise: right side down, centre to the right

  // Ground fill beneath road
  ctx.fillStyle = '#c8d8a0';
  ctx.fillRect(-ROAD_HALF - 60, 0, (ROAD_HALF + 60) * 2, 160);

  // Road surface
  const roadGrad = ctx.createLinearGradient(-ROAD_HALF, -roadThick, ROAD_HALF, 0);
  roadGrad.addColorStop(0,   '#708090');
  roadGrad.addColorStop(0.5, '#8a9aaa');
  roadGrad.addColorStop(1,   '#607080');
  ctx.fillStyle = roadGrad;
  ctx.fillRect(-ROAD_HALF, -roadThick, ROAD_HALF * 2, roadThick);

  // Centre dashed line
  ctx.strokeStyle = '#ffec80';
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 14]);
  ctx.beginPath();
  ctx.moveTo(0, -roadThick + 2);
  ctx.lineTo(0, -roadThick + roadThick - 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Kerb lines
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  [-ROAD_HALF, ROAD_HALF].forEach(ex => {
    ctx.beginPath();
    ctx.moveTo(ex, -roadThick);
    ctx.lineTo(ex, 0);
    ctx.stroke();
  });

  ctx.restore();

  // ── Car (front-facing) ────────────────────────────────────
  ctx.save();
  ctx.translate(cx, ry - roadThick);   // base of car = top of road surface
  if (!isFlat) ctx.rotate(+BANK_RAD);
  drawCarFront();
  ctx.restore();

  // ── Force vectors ─────────────────────────────────────────
  // Force origin: visual centre of the car (~30px above road surface top).
  // With ctx.rotate(+BANK_RAD), local point (0, dy) → screen: x = cx - dy·sin(θ), y ≈ ry + dy·cos(θ)
  const localCarY = -(roadThick + 30);
  const fcx = isFlat ? cx : cx - localCarY * Math.sin(BANK_RAD);
  const fcy = isFlat ? ry + localCarY : ry + localCarY * Math.cos(BANK_RAD);

  const W_MAG  = 95;   // visual magnitude of weight vector (px)
  const N_MAG  = isFlat ? W_MAG : W_MAG / Math.cos(BANK_RAD);
  const FF_MAG = 60;   // visual friction magnitude

  // Weight
  if (show.weight) {
    arrow(fcx, fcy, fcx, fcy + W_MAG, COL_WEIGHT);
    lbl('W', fcx + 14, fcy + W_MAG * 0.55, { color: COL_WEIGHT, font: '700 14px "Trebuchet MS",sans-serif' });
  }

  if (isFlat) {
    if (show.normal) {
      arrow(fcx, fcy, fcx, fcy - N_MAG, COL_NORMAL);
      lbl('N', fcx + 14, fcy - N_MAG * 0.6, { color: COL_NORMAL, font: '700 14px "Trebuchet MS",sans-serif' });
    }
    if (show.friction) {
      arrow(fcx, fcy, fcx + FF_MAG, fcy, COL_FRICTION);
      lbl('Ff', fcx + FF_MAG + 16, fcy, { color: COL_FRICTION, font: '700 14px "Trebuchet MS",sans-serif' });
    }
    if (show.netForce) {
      dashedArrow(fcx, fcy - 22, fcx + FF_MAG, fcy - 22, COL_NET);
      lbl('Fc = Ff', fcx + FF_MAG / 2, fcy - 36, { color: COL_NET, font: '700 12px "Trebuchet MS",sans-serif' });
    }
    lbl('centre of curve →', CW - 16, fcy + 22, { color: '#55708d', font: '13px "Trebuchet MS",sans-serif', align: 'right' });

  } else {
    // Banked — N direction: right side lower, normal tilts right (toward centre)
    const nDx =  Math.sin(BANK_RAD);
    const nDy = -Math.cos(BANK_RAD);
    const nEx = fcx + N_MAG * nDx;
    const nEy = fcy + N_MAG * nDy;

    if (show.normal) {
      arrow(fcx, fcy, nEx, nEy, COL_NORMAL);
      lbl('N', nEx + 16, nEy, { color: COL_NORMAL, font: '700 14px "Trebuchet MS",sans-serif' });
      // N components — form a right-angle triangle with the corner at (fcx, nEy)
      // Vertical leg (upward): origin → top-left corner
      dashedArrow(fcx, fcy, fcx, nEy, COL_COMP, [6, 4]);
      lbl('N cos θ = W', fcx - 12, (fcy + nEy) / 2,
          { color: '#2563eb', font: '12px "Trebuchet MS",sans-serif', align: 'right' });
      // Horizontal leg (rightward, at top): top-left corner → N tip
      dashedArrow(fcx, nEy, nEx, nEy, COL_COMP, [6, 4]);
      lbl('N sin θ  →  Fc', (fcx + nEx) / 2, nEy - 14,
          { color: '#2563eb', font: '12px "Trebuchet MS",sans-serif', align: 'center' });
      // Right-angle marker at the corner
      const rg = 7;
      ctx.save();
      ctx.strokeStyle = COL_COMP; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fcx, nEy + rg);
      ctx.lineTo(fcx + rg, nEy + rg);
      ctx.lineTo(fcx + rg, nEy);
      ctx.stroke();
      ctx.restore();
    }

    if (show.friction) {
      if (speed === 'slow') {
        const fDx = -Math.cos(BANK_RAD), fDy = -Math.sin(BANK_RAD);
        arrow(fcx, fcy, fcx + FF_MAG * fDx, fcy + FF_MAG * fDy, COL_FRICTION);
        lbl('Ff', fcx + FF_MAG * fDx - 18, fcy + FF_MAG * fDy,
            { color: COL_FRICTION, font: '700 14px "Trebuchet MS",sans-serif' });
        lbl('(up slope — reduces centripetal)', fcx - 20, fcy - N_MAG * 0.2,
            { color: COL_FRICTION, font: '12px "Trebuchet MS",sans-serif', align: 'right' });
      } else if (speed === 'fast') {
        const fDx = Math.cos(BANK_RAD), fDy = Math.sin(BANK_RAD);
        arrow(fcx, fcy, fcx + FF_MAG * fDx, fcy + FF_MAG * fDy, COL_FRICTION);
        lbl('Ff', fcx + FF_MAG * fDx + 16, fcy + FF_MAG * fDy,
            { color: COL_FRICTION, font: '700 14px "Trebuchet MS",sans-serif' });
        lbl('(down slope — adds to centripetal)', fcx + 20, fcy + W_MAG * 0.55,
            { color: COL_FRICTION, font: '12px "Trebuchet MS",sans-serif', align: 'left' });
      }
    }

    if (show.netForce) {
      // Fixed visual magnitudes — always positive (toward centre = rightward).
      // ideal: matches N sin θ horizontal component exactly.
      // slow: smaller (reduced centripetal needed; friction partially opposes N's horizontal push).
      // fast: larger (friction adds to N's horizontal push).
      const fcNet = speed === 'slow'  ? 25
                  : speed === 'ideal' ? N_MAG * Math.sin(BANK_RAD)
                  :                     N_MAG * Math.sin(BANK_RAD) + FF_MAG * Math.cos(BANK_RAD);
      const netY = fcy - 28;
      dashedArrow(fcx, netY, fcx + fcNet, netY, COL_NET);
      const fcLabel = speed === 'ideal' ? 'Fc = N sin θ' : speed === 'slow' ? 'Fc (reduced)' : 'Fc (increased)';
      lbl(fcLabel, fcx + fcNet / 2, netY - 14, { color: COL_NET, font: '700 12px "Trebuchet MS",sans-serif' });
    }

    // Bank angle indicator — placed at the inner (right/lower) road edge
    ctx.save();
    ctx.translate(cx + ROAD_HALF * Math.cos(BANK_RAD), ry + ROAD_HALF * Math.sin(BANK_RAD));
    // Horizontal dashed reference line (going leftward)
    ctx.strokeStyle = '#55708d';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-40, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arc from road-surface direction (upper-left = π − θ) to horizontal-left (π)
    ctx.beginPath();
    ctx.arc(0, 0, 24, Math.PI - BANK_RAD, Math.PI);
    ctx.strokeStyle = '#55708d';
    ctx.lineWidth = 2;
    ctx.stroke();
    lbl(`θ = ${BANK_DEG}°`, -30, -16, { color: '#55708d', font: '12px "Trebuchet MS",sans-serif', align: 'right' });
    ctx.restore();

    // Centre label (far right, unambiguously away from all vectors)
    lbl('centre of curve →', CW - 16, fcy,
        { color: '#55708d', font: '13px "Trebuchet MS",sans-serif', align: 'right' });
  }

  // ── Frame label ────────────────────────────────────────────
  panel(16, 16, 240, 44, 'rgba(255,255,255,0.9)');
  lbl('Cross-section view  (front-on)', 124, 38,
      { color: '#15304d', font: '700 13px "Trebuchet MS",sans-serif' });
}

/* ════════════════════════════════════════════════════════════
   VIEW 2: OVERHEAD
════════════════════════════════════════════════════════════ */

function drawOverhead(t) {
  // Soft sky background
  ctx.fillStyle = '#e8f0f8';
  ctx.fillRect(0, 0, CW, CH);

  // Centre of the circular road (off canvas to the right)
  const RADIUS = 360;   // road radius (px)
  const centX  = CW / 2 + RADIUS;
  const centY  = CH / 2;
  const ROAD_W = 80;    // road width from above

  // Draw road arc (roughly 180° sweep centred on the left side)
  const ARC_START = Math.PI * 0.55;
  const ARC_END   = Math.PI * 1.45;

  // Road fill
  ctx.save();
  ctx.strokeStyle = '#708090';
  ctx.lineWidth   = ROAD_W;
  ctx.lineCap     = 'butt';
  ctx.beginPath();
  ctx.arc(centX, centY, RADIUS, ARC_START, ARC_END);
  ctx.stroke();

  // Road centre line
  ctx.strokeStyle = '#ffec80';
  ctx.lineWidth   = 3;
  ctx.setLineDash([20, 16]);
  ctx.beginPath();
  ctx.arc(centX, centY, RADIUS, ARC_START, ARC_END);
  ctx.stroke();
  ctx.setLineDash([]);

  // Road edges
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 3;
  [RADIUS - ROAD_W / 2, RADIUS + ROAD_W / 2].forEach(r => {
    ctx.beginPath();
    ctx.arc(centX, centY, r, ARC_START, ARC_END);
    ctx.stroke();
  });

  // If banked: hatch pattern suggesting bank slope (angled lines on road surface)
  if (state.surface === 'banked') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    // Sample several positions along the arc
    for (let a = ARC_START; a < ARC_END; a += 0.15) {
      const mx = centX + RADIUS * Math.cos(a);
      const my = centY + RADIUS * Math.sin(a);
      // Radial direction (inward)
      const rx = (centX - mx) / RADIUS;
      const ry = (centY - my) / RADIUS;
      ctx.beginPath();
      ctx.moveTo(mx + rx * (ROAD_W / 2), my + ry * (ROAD_W / 2));
      ctx.lineTo(mx + rx * (-ROAD_W / 3), my + ry * (-ROAD_W / 3));
      ctx.stroke();
    }
    ctx.restore();
    // "banked inward" label
    const midA = (ARC_START + ARC_END) / 2;
    const lx = centX + (RADIUS + ROAD_W * 0.7) * Math.cos(midA);
    const ly = centY + (RADIUS + ROAD_W * 0.7) * Math.sin(midA);
    panel(lx - 58, ly - 14, 116, 28, 'rgba(255,255,255,0.9)');
    lbl('banked inward ↓', lx, ly, { color: '#55708d', font: '700 12px "Trebuchet MS",sans-serif' });
  }

  ctx.restore();

  // ── Car position along arc ─────────────────────────────────
  const carAngle = lerp(ARC_START + 0.12, ARC_END - 0.12, t);
  const carX = centX + RADIUS * Math.cos(carAngle);
  const carY = centY + RADIUS * Math.sin(carAngle);
  // Car orientation: tangent to arc
  // +Math.PI because drawCarTop() has nose at (0,-L/2) and we need nose→forward direction
  const tanAngle = carAngle + Math.PI;

  ctx.save();
  ctx.translate(carX, carY);
  ctx.rotate(tanAngle);
  drawCarTop();
  ctx.restore();

  // ── Velocity vector (tangent to arc) ──────────────────────
  const velLen = 80;
  const tdx = -Math.sin(carAngle);
  const tdy =  Math.cos(carAngle);
  if (show.velocity) {
    arrow(carX, carY, carX + tdx * velLen, carY + tdy * velLen, '#15304d', 2.5);
    lbl('v', carX + tdx * (velLen + 14), carY + tdy * (velLen + 14),
        { color: '#15304d', font: '700 14px "Trebuchet MS",sans-serif' });
  }

  // ── Centripetal force arrow (toward centre) ────────────────
  const cpLen = 70;
  const inDx  = (centX - carX) / RADIUS;
  const inDy  = (centY - carY) / RADIUS;
  const cpLabel = state.surface === 'flat' ? 'Fc = Ff' : (
    state.speed === 'ideal'  ? 'Fc = N sinθ' :
    state.speed === 'slow'   ? 'Fc (reduced)' : 'Fc (increased)');

  if (show.netForce) {
    arrow(carX, carY, carX + inDx * cpLen, carY + inDy * cpLen, COL_NET);
    lbl(cpLabel, carX + inDx * (cpLen + 38), carY + inDy * (cpLen + 38),
        { color: COL_NET, font: '700 12px "Trebuchet MS",sans-serif' });
  }

  // ── Centre marker ──────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = '#55708d';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(carX, carY);
  ctx.lineTo(centX, centY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(centX, centY, 6, 0, 2 * Math.PI);
  ctx.fillStyle = '#55708d';
  ctx.fill();
  ctx.restore();
  lbl('centre', centX + 12, centY - 14, { color: '#55708d', font: '700 12px "Trebuchet MS",sans-serif', align: 'left' });

  // If flat: show friction arrow at car
  if (state.surface === 'flat' && show.friction) {
    const ffLen = 55;
    arrow(carX, carY,
          carX + inDx * ffLen, carY + inDy * ffLen, COL_FRICTION, 2.5);
    lbl('Ff', carX + inDx * (ffLen + 16), carY + inDy * (ffLen + 16),
        { color: COL_FRICTION, font: '700 13px "Trebuchet MS",sans-serif' });
  }

  // ── Frame label ────────────────────────────────────────────
  panel(16, 16, 200, 44, 'rgba(255,255,255,0.9)');
  lbl('Overhead (plan) view', 108, 38,
      { color: '#15304d', font: '700 13px "Trebuchet MS",sans-serif' });
}

/* ════════════════════════════════════════════════════════════
   (perspective view removed)
════════════════════════════════════════════════════════════ */

function drawPerspective(t) { // kept stub so nothing breaks during transition
  const isFlat = state.surface === 'flat';

  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, CH * 0.55);
  sky.addColorStop(0, '#a8c8f0');
  sky.addColorStop(1, '#d8eaff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, CH * 0.55);

  // Ground beyond road
  ctx.fillStyle = '#b8d498';
  ctx.fillRect(0, CH * 0.55, CW, CH * 0.45);

  // Horizon line
  const HY = CH * 0.52;

  // Perspective setup: VP is where road disappears
  // Road curves to the right — VP is slightly right of centre and at horizon
  const VP = { x: CW * 0.62, y: HY };
  const NEAR_Y  = CH - 30;       // bottom of canvas = near road edge y
  const NEAR_HALF = 180;         // half-width of road at near edge
  const FAR_HALF  = 12;          // half-width of road at VP

  // Road bank: at near end, left edge is higher than right edge (by BANK visual pixels)
  // For flat: no height difference
  const BANK_LIFT = isFlat ? 0 : 70;  // px the outer (left) edge is raised at near end

  // Near-edge left/right x positions (road runs from near-left to near-right)
  const nearLeft  = CW / 2 - NEAR_HALF;
  const nearRight = CW / 2 + NEAR_HALF;
  const nearLeftY  = NEAR_Y - BANK_LIFT;   // left (outer) edge lifted for banking
  const nearRightY = NEAR_Y;               // right (inner) edge at ground level

  // Far edge converges to VP
  const farLeft  = VP.x - FAR_HALF;
  const farRight = VP.x + FAR_HALF;
  const farY     = VP.y;

  // Road surface polygon
  ctx.save();
  const roadGrad = ctx.createLinearGradient(nearLeft, NEAR_Y, nearRight, NEAR_Y);
  if (isFlat) {
    roadGrad.addColorStop(0, '#9aabbc');
    roadGrad.addColorStop(0.5, '#b0c0d0');
    roadGrad.addColorStop(1, '#9aabbc');
  } else {
    // Darker on the inner (right, lower) side, lighter on the outer (left, upper) side
    roadGrad.addColorStop(0,   '#c0d0e0');  // outer edge (left, upper) — lighter
    roadGrad.addColorStop(0.5, '#9aabbc');
    roadGrad.addColorStop(1,   '#708090');  // inner edge (right, lower) — darker
  }
  ctx.fillStyle = roadGrad;
  ctx.beginPath();
  ctx.moveTo(nearLeft,  nearLeftY);
  ctx.lineTo(nearRight, nearRightY);
  ctx.lineTo(farRight,  farY);
  ctx.lineTo(farLeft,   farY);
  ctx.closePath();
  ctx.fill();

  // Road edge lines
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(nearLeft, nearLeftY); ctx.lineTo(farLeft, farY);
  ctx.moveTo(nearRight, nearRightY); ctx.lineTo(farRight, farY);
  ctx.stroke();

  // Centre dashes
  const centreNearX = (nearLeft + nearRight) / 2;
  const centreNearY = (nearLeftY + nearRightY) / 2;
  ctx.strokeStyle = '#ffec80';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([22, 18]);
  ctx.beginPath();
  ctx.moveTo(centreNearX, centreNearY);
  ctx.lineTo(VP.x, VP.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Road edge markings (rumble strips suggestion)
  ctx.strokeStyle = '#fff8';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(nearLeft,  nearLeftY);
  ctx.lineTo(farLeft,   farY);
  ctx.stroke();

  ctx.restore();

  // ── Embankment / side slope for banked road ────────────────
  if (!isFlat) {
    // Left (outer) wall — visible since outer edge is raised
    const wallH = BANK_LIFT + 20;
    ctx.save();
    const wallGrad = ctx.createLinearGradient(nearLeft, nearLeftY - wallH, nearLeft, nearLeftY);
    wallGrad.addColorStop(0, '#a8c090');
    wallGrad.addColorStop(1, '#708060');
    ctx.fillStyle = wallGrad;
    ctx.beginPath();
    ctx.moveTo(nearLeft - 8, nearLeftY - wallH);
    ctx.lineTo(nearLeft + 8, nearLeftY);
    ctx.lineTo(farLeft, farY);
    ctx.lineTo(farLeft - 4, farY - 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── Moving car (driving toward viewer) ────────────────────
  // Car appears at perspective-scaled position, animated with t
  // At t=0 car is near VP (far), at t=1 car is near viewer
  const carProgress = (1 - t) * 0.85 + t * 0.12; // 0=near, 1=far
  const carT = carProgress;

  // Interpolate car position along centre of road
  const carX   = lerp(centreNearX, VP.x, carT);
  const carY   = lerp(centreNearY, VP.y + 2, carT);
  const carLeftX  = lerp(nearLeft,  farLeft,  carT);
  const carRightX = lerp(nearRight, farRight, carT);
  const carLeftY  = lerp(nearLeftY, farY, carT);
  const carRightY = lerp(nearRightY, farY, carT);

  const carScale  = lerp(1, 0.08, carT);
  const carWidthPx = (carRightX - carLeftX) * 0.45;
  const carHPx    = carWidthPx * 1.4;

  // Bank offset: at near end, road is tilted so car is also tilted
  const carTilt = isFlat ? 0 : -BANK_RAD * (1 - carT);

  ctx.save();
  ctx.translate(carX, carY - carHPx * 0.5);
  ctx.rotate(carTilt);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(0, carHPx * 0.5, carWidthPx * 0.7, carWidthPx * 0.2, 0, 0, 2 * Math.PI);
  ctx.fill();

  // Body
  const bodyGrad = ctx.createLinearGradient(-carWidthPx, -carHPx, carWidthPx, 0);
  bodyGrad.addColorStop(0, '#e8eef8');
  bodyGrad.addColorStop(0.5, '#ffffff');
  bodyGrad.addColorStop(1, '#c0d0e0');
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#5580aa';
  ctx.lineWidth = Math.max(1, 2 * carScale);
  ctx.beginPath();
  ctx.roundRect(-carWidthPx, -carHPx * 0.9, carWidthPx * 2, carHPx * 0.9, carWidthPx * 0.2);
  ctx.fill();
  ctx.stroke();

  // Windscreen (front = bottom of car from perspective)
  ctx.fillStyle = 'rgba(120,180,255,0.5)';
  ctx.beginPath();
  ctx.roundRect(-carWidthPx * 0.6, -carHPx * 0.45, carWidthPx * 1.2, carHPx * 0.35, carWidthPx * 0.1);
  ctx.fill();

  // Headlights
  ctx.fillStyle = '#ffffa0';
  [[-carWidthPx * 0.65, 0], [carWidthPx * 0.65, 0]].forEach(([hx, hy]) => {
    ctx.beginPath();
    ctx.ellipse(hx, hy, carWidthPx * 0.12, carWidthPx * 0.08, 0, 0, 2 * Math.PI);
    ctx.fill();
  });

  ctx.restore();

  // ── Bank angle indicator (near edge) ──────────────────────
  if (!isFlat) {
    const indX = nearLeft - 50;
    const indY = nearRightY;
    ctx.save();
    // Horizontal reference
    ctx.strokeStyle = '#55708d';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(indX - 20, indY);
    ctx.lineTo(nearRight + 20, indY);
    ctx.stroke();
    ctx.setLineDash([]);
    // Road angle arc
    ctx.beginPath();
    ctx.arc(nearRight, indY, 28, -BANK_RAD - 0.05, 0.05);
    ctx.strokeStyle = '#55708d';
    ctx.lineWidth = 2;
    ctx.stroke();
    lbl(`θ = ${BANK_DEG}°`, nearRight + 34, indY - 14,
        { color: '#55708d', font: '700 12px "Trebuchet MS",sans-serif', align: 'left' });
    ctx.restore();
  }

  // ── Frame label ────────────────────────────────────────────
  panel(16, 16, 220, 44, 'rgba(255,255,255,0.9)');
  lbl('Perspective view  (approaching)', 118, 38,
      { color: '#15304d', font: '700 13px "Trebuchet MS",sans-serif' });
}

/* ── Lerp ───────────────────────────────────────────────────── */
function lerp(a, b, t) { return a + (b - a) * t; }

/* ── Main draw dispatch ─────────────────────────────────────── */

function draw() {
  ctx.clearRect(0, 0, CW, CH);
  const t = state.animT;

  switch (state.view) {
    case 'cross':    drawCrossSection();   break;
    case 'overhead': drawOverhead(t);      break;
  }
}

/* ── Animation loop ─────────────────────────────────────────── */

let lastTs = null;
const ANIM_DUR = 8;  // seconds per loop

function loop(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (state.running) {
    state.animT = (state.animT + dt / ANIM_DUR) % 1;
  }

  draw();
  requestAnimationFrame(loop);
}

/* ── UI helpers ─────────────────────────────────────────────── */

function updateExplainCards() {
  document.querySelectorAll('.explain-card').forEach(el => {
    const surfaceMatch = el.dataset.surface === state.surface;
    const speedMatch   = el.dataset.speed === 'any' || el.dataset.speed === state.speed;
    el.classList.toggle('hidden', !(surfaceMatch && speedMatch));
  });
}


function seg(id, key) {
  document.querySelectorAll(`#${id} .seg-btn`).forEach(b => {
    b.addEventListener('click', () => {
      state[key] = b.dataset.val;
      document.querySelectorAll(`#${id} .seg-btn`).forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.animT = 0;
      updateExplainCards();
      updateVectorUI();
      // Show/hide speed selector
      document.getElementById('group-speed').style.display =
        state.surface === 'banked' ? '' : 'none';
    });
  });
}

/* ── Vector toggle state ────────────────────────────────────── */

const show = { weight: false, normal: false, friction: false, netForce: false, velocity: false };

function updateVectorUI() {
  // Show the right toggle group for the current view
  document.getElementById('toggles-cross').style.display    = state.view === 'cross'    ? '' : 'none';
  document.getElementById('toggles-overhead').style.display = state.view === 'overhead' ? '' : 'none';

  // Disable friction button when it can't appear (banked + ideal)
  const frBtn = document.getElementById('btn-vec-friction');
  const frictionApplies = state.surface === 'flat' || state.speed !== 'ideal';
  frBtn.disabled = !frictionApplies;

  // Sync button active states
  document.querySelectorAll('.vec-btn').forEach(btn => {
    if (!btn.disabled) btn.classList.toggle('active', show[btn.dataset.vec]);
  });
}

document.querySelectorAll('.vec-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const vec = btn.dataset.vec;
    show[vec] = !show[vec];
    // Both cross and overhead share netForce key — update all matching buttons
    document.querySelectorAll(`.vec-btn[data-vec="${vec}"]`).forEach(b => {
      if (!b.disabled) b.classList.toggle('active', show[vec]);
    });
  });
});

seg('seg-view',    'view');
seg('seg-surface', 'surface');
seg('seg-speed',   'speed');

updateExplainCards();
updateVectorUI();
requestAnimationFrame(loop);
