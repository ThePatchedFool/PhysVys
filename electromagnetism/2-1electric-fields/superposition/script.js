'use strict';

/* ── Constants ── */
const K = 8.99e9;
const CANVAS_W = 960;
const CANVAS_H = 560;
const CHARGE_RADIUS = 26;
const PIXELS_PER_METRE = 200; // 1 px = 5 mm

/* ── State ── */
const state = {
  mode: 'explore',   // 'explore' | 'custom'
  preset: 'right-angle',
  testId: 2,         // index of the test charge (0=q1, 1=q2, 2=q3)
  showForces: false,

  charges: [
    { id: 0, sign: +1, magnitude: 1e-6, x: 0, y: 0 },
    { id: 1, sign: -1, magnitude: 1e-6, x: 0, y: 0 },
    { id: 2, sign: +1, magnitude: 1e-6, x: 0, y: 0 },
  ],

  drag: null,   // { id, offX, offY }
};

/* ── Canvas setup ── */
const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const dpr = window.devicePixelRatio || 1;
  const cssW = wrap.clientWidth - 2 * 13; // visual-panel padding
  const cssH = Math.round(cssW * (7 / 12));
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function cssWidth()  { return canvas.width  / (window.devicePixelRatio || 1); }
function cssHeight() { return canvas.height / (window.devicePixelRatio || 1); }

/* ── Preset positions ── */
function applyPreset(name) {
  const cx = cssWidth()  / 2;
  const cy = cssHeight() / 2;
  const d  = 140;

  if (name === 'right-angle') {
    state.charges[0].x = cx - d;     state.charges[0].y = cy + d * 0.6;
    state.charges[1].x = cx + d;     state.charges[1].y = cy + d * 0.6;
    state.charges[2].x = cx;         state.charges[2].y = cy - d * 0.6;
  } else if (name === 'equilateral') {
    const h = d * Math.sqrt(3) / 2;
    state.charges[0].x = cx - d;     state.charges[0].y = cy + h * 0.5;
    state.charges[1].x = cx + d;     state.charges[1].y = cy + h * 0.5;
    state.charges[2].x = cx;         state.charges[2].y = cy - h * 0.5;
  } else if (name === 'collinear') {
    state.charges[0].x = cx - d * 1.4; state.charges[0].y = cy;
    state.charges[1].x = cx + d * 1.4; state.charges[1].y = cy;
    state.charges[2].x = cx;           state.charges[2].y = cy;
  }
  draw();
}

/* ── Coulomb physics ── */
function coulombVector(source, test) {
  const dx = test.x - source.x;
  const dy = test.y - source.y;
  const rPx = Math.sqrt(dx * dx + dy * dy);
  if (rPx < 1) return { fx: 0, fy: 0, r: 0 };
  const rM = rPx / PIXELS_PER_METRE;
  const mag = K * Math.abs(source.sign * source.magnitude) * Math.abs(test.sign * test.magnitude) / (rM * rM);
  // sign: like charges repel (+dx/r means force on test is away from source if same sign)
  const sign = source.sign * test.sign > 0 ? 1 : -1; // +1 repulsive, -1 attractive
  return {
    fx: sign * mag * (dx / rPx),
    fy: sign * mag * (dy / rPx),
    r: rM,
  };
}

/* ── Format helpers ── */
function formatSci(val) {
  if (val === 0) return '0 C';
  const exp = Math.floor(Math.log10(Math.abs(val)));
  const man = val / Math.pow(10, exp);
  return `${man.toFixed(2)} × 10^${exp} C`;
}

function formatSciN(val, unit) {
  if (!Number.isFinite(val) || val === 0) return '0 ' + unit;
  const exp = Math.floor(Math.log10(Math.abs(val)));
  const man = val / Math.pow(10, exp);
  return `${man.toFixed(2)} × 10^${exp} ${unit}`;
}

function formatAngle(rad) {
  let deg = ((rad * 180 / Math.PI) % 360 + 360) % 360;
  return deg.toFixed(1) + '°';
}

/* ── Drawing ── */
const COLORS = {
  q: ['#2563eb', '#d97706', '#0f766e'],  // blue, amber, teal
  qDark: ['#1d4ed8', '#b45309', '#0d6b63'],
  force0: '#2563eb',
  force1: '#d97706',
  fnet:   '#0f766e',
};

function chargeColor(idx) { return COLORS.q[idx]; }
function chargeDark(idx)  { return COLORS.qDark[idx]; }

function drawCharge(ch, idx, isTest) {
  const { x, y, sign } = ch;
  const r = CHARGE_RADIUS;
  const col  = chargeColor(idx);
  const dark = chargeDark(idx);

  // Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur  = 12;
  ctx.shadowOffsetY = 4;

  // Body gradient
  const grd = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, col);
  grd.addColorStop(1, dark);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.restore();

  // Test charge ring
  if (isTest) {
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Sign label
  ctx.fillStyle = 'white';
  ctx.font = `bold ${r * 0.85}px "Trebuchet MS", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sign > 0 ? '+' : '−', x, y + 1);

  // Charge label below
  ctx.fillStyle = dark;
  ctx.font = `bold 13px "Trebuchet MS", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const SUB = ['₁', '₂', '₃'];
  ctx.fillText(`q${SUB[idx] ?? idx + 1}`, x, y + r + 5);
}

function arrowHead(x, y, angle, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.5);
  ctx.lineTo(-size, size * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawForceArrow(fromX, fromY, fx, fy, color, label) {
  const len = Math.sqrt(fx * fx + fy * fy);
  if (len < 0.5) return;
  const ux = fx / len;
  const uy = fy / len;
  const tipX = fromX + fx;
  const tipY = fromY + fy;

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  arrowHead(tipX, tipY, Math.atan2(uy, ux), 10, color);

  if (label) {
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lx = fromX + fx * 0.5 - uy * 14;
    const ly = fromY + fy * 0.5 + ux * 14;
    ctx.fillText(label, lx, ly);
  }
}

function draw() {
  const W = cssWidth();
  const H = cssHeight();
  ctx.clearRect(0, 0, W, H);

  const testIdx  = state.testId;
  const test     = state.charges[testIdx];
  const sources  = state.charges.filter((_, i) => i !== testIdx);

  // ── Force arrows ──
  if (state.showForces) {
    let netFx = 0, netFy = 0;

    const forceVecs = sources.map((src) => {
      const { fx, fy } = coulombVector(src, test);
      netFx += fx;
      netFy += fy;
      return { fx, fy, srcIdx: src.id };
    });

    // Proportional scale: largest force maps to TARGET_PX so tip-to-tail is geometrically correct
    const TARGET_PX = 130;
    const maxF = Math.max(...forceVecs.map(({ fx, fy }) => Math.sqrt(fx * fx + fy * fy)), 1e-30);
    const scale = TARGET_PX / maxF;

    // Individual force arrows
    forceVecs.forEach(({ fx, fy, srcIdx }, si) => {
      const col = si === 0 ? COLORS.force0 : COLORS.force1;
      const SUB = ['₁', '₂', '₃'];
      const lbl = `F${SUB[srcIdx] ?? srcIdx + 1}${SUB[testIdx] ?? testIdx + 1}`;
      drawForceArrow(test.x, test.y, fx * scale, fy * scale, col, lbl);
    });

    // Tip-to-tail construction (dashed ghost arrows offset from origin)
    let tailX = test.x, tailY = test.y;
    ctx.save();
    ctx.setLineDash([6, 4]);
    forceVecs.forEach(({ fx, fy }, si) => {
      const col = si === 0 ? COLORS.force0 : COLORS.force1;
      const nextX = tailX + fx * scale;
      const nextY = tailY + fy * scale;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(nextX, nextY);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // small arrowhead on ghost
      arrowHead(nextX, nextY, Math.atan2(fy, fx), 8, col);
      tailX = nextX;
      tailY = nextY;
    });
    ctx.restore();

    // Resultant
    drawForceArrow(test.x, test.y, netFx * scale, netFy * scale, COLORS.fnet, 'F\u2099\u2091\u209c');

    // Readouts
    updateReadouts(forceVecs, netFx, netFy);
  } else {
    clearReadouts();
  }

  // ── Charges ──
  state.charges.forEach((ch, i) => drawCharge(ch, i, i === testIdx));
}

/* ── Readout updates ── */
function updateReadouts(forceVecs, netFx, netFy) {
  const testIdx = state.testId;

  // forceVecs is always length 2; slot 0 → readout-f1, slot 1 → readout-f2
  forceVecs.forEach(({ fx, fy, srcIdx }, si) => {
    const mag    = Math.sqrt(fx * fx + fy * fy);
    const slot   = si + 1;
    const labelEl = document.getElementById(`readout-f${slot}-label`);
    const valEl   = document.getElementById(`readout-f${slot}`);
    if (labelEl) labelEl.textContent = `Force from q${srcIdx + 1} on q${testIdx + 1}`;
    if (valEl)   valEl.textContent   = formatSciN(mag, 'N');
  });

  const netMag = Math.sqrt(netFx * netFx + netFy * netFy);
  const angle  = Math.atan2(-netFy, netFx); // canvas y is inverted
  const fnetEl = document.getElementById('readout-fnet');
  if (fnetEl) fnetEl.textContent = `${formatSciN(netMag, 'N')}  at ${formatAngle(angle)}`;
}

function clearReadouts() {
  ['readout-f1', 'readout-f2', 'readout-fnet'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
}

/* ── Charge magnitude helpers ── */
const NICE_MANTISSAS = [1, 1.5, 2, 3, 5, 7];

function logSliderToMagnitude(v) {
  // v is a float in [-19, 0]; we snap to nearest nice value
  const exp   = Math.floor(v);
  const frac  = v - exp;
  // find nearest nice mantissa index
  const breakpoints = [0, Math.log10(1.5), Math.log10(2), Math.log10(3), Math.log10(5), Math.log10(7), 1];
  let best = 0;
  for (let i = 1; i < breakpoints.length - 1; i++) {
    if (frac >= (breakpoints[i - 1] + breakpoints[i]) / 2) best = i;
  }
  return NICE_MANTISSAS[best] * Math.pow(10, exp);
}

function magnitudeToLogSlider(mag) {
  if (mag <= 0) return -19;
  return Math.log10(mag);
}

function updateChargeDisplay(idx) {
  const ch  = state.charges[idx];
  const val = ch.sign * ch.magnitude;
  const el  = document.getElementById(`q${idx + 1}-display`);
  if (el) {
    const exp = Math.floor(Math.log10(Math.abs(val)));
    const man = val / Math.pow(10, exp);
    el.textContent = `${man.toFixed(2)} × 10^${exp} C`;
  }
}

/* ── Controls wiring ── */

// Mode toggle
document.getElementById('btn-mode-explore').addEventListener('click', () => {
  state.mode = 'explore';
  document.getElementById('btn-mode-explore').classList.add('active');
  document.getElementById('btn-mode-custom').classList.remove('active');
  [0, 1, 2].forEach(i => {
    document.getElementById(`q${i + 1}-explore`).classList.remove('is-hidden');
    document.getElementById(`q${i + 1}-custom`).classList.add('is-hidden');
  });
});

document.getElementById('btn-mode-custom').addEventListener('click', () => {
  state.mode = 'custom';
  document.getElementById('btn-mode-custom').classList.add('active');
  document.getElementById('btn-mode-explore').classList.remove('active');
  [0, 1, 2].forEach(i => {
    document.getElementById(`q${i + 1}-explore`).classList.add('is-hidden');
    document.getElementById(`q${i + 1}-custom`).classList.remove('is-hidden');
  });
});

// Preset
document.getElementById('preset-select').addEventListener('change', e => {
  state.preset = e.target.value;
  applyPreset(state.preset);
});

// Show Forces
const btnForces = document.getElementById('btn-show-forces');
btnForces.addEventListener('click', () => {
  state.showForces = !state.showForces;
  btnForces.classList.toggle('active', state.showForces);
  btnForces.setAttribute('aria-pressed', String(state.showForces));
  btnForces.textContent = state.showForces ? 'Hide Forces' : 'Show Forces';
  draw();
});

// Per-charge controls
[0, 1, 2].forEach(idx => {
  const n = idx + 1;

  // Sign buttons
  document.getElementById(`q${n}-sign-pos`).addEventListener('click', () => {
    state.charges[idx].sign = +1;
    document.getElementById(`q${n}-sign-pos`).classList.add('active');
    document.getElementById(`q${n}-sign-neg`).classList.remove('active');
    updateChargeDisplay(idx);
    draw();
  });
  document.getElementById(`q${n}-sign-neg`).addEventListener('click', () => {
    state.charges[idx].sign = -1;
    document.getElementById(`q${n}-sign-neg`).classList.add('active');
    document.getElementById(`q${n}-sign-pos`).classList.remove('active');
    updateChargeDisplay(idx);
    draw();
  });

  // Explore log-slider
  const logSlider = document.getElementById(`q${n}-log-slider`);
  logSlider.addEventListener('input', () => {
    state.charges[idx].magnitude = logSliderToMagnitude(parseFloat(logSlider.value));
    // Sync custom inputs
    const mag = state.charges[idx].magnitude;
    const exp = Math.floor(Math.log10(mag));
    const man = mag / Math.pow(10, exp);
    document.getElementById(`q${n}-mantissa-slider`).value = man.toFixed(2);
    document.getElementById(`q${n}-mantissa-input`).value  = man.toFixed(2);
    document.getElementById(`q${n}-exponent-input`).value  = exp;
    updateChargeDisplay(idx);
    draw();
  });

  // Custom mantissa slider
  const manSlider = document.getElementById(`q${n}-mantissa-slider`);
  manSlider.addEventListener('input', () => {
    const man = parseFloat(manSlider.value);
    const exp = parseInt(document.getElementById(`q${n}-exponent-input`).value, 10);
    document.getElementById(`q${n}-mantissa-input`).value = man.toFixed(2);
    state.charges[idx].magnitude = man * Math.pow(10, exp);
    updateChargeDisplay(idx);
    draw();
  });

  // Custom mantissa number input
  const manInput = document.getElementById(`q${n}-mantissa-input`);
  manInput.addEventListener('change', () => {
    let man = parseFloat(manInput.value);
    man = Math.max(1, Math.min(9.99, man));
    manInput.value = man.toFixed(2);
    document.getElementById(`q${n}-mantissa-slider`).value = man.toFixed(2);
    const exp = parseInt(document.getElementById(`q${n}-exponent-input`).value, 10);
    state.charges[idx].magnitude = man * Math.pow(10, exp);
    updateChargeDisplay(idx);
    draw();
  });

  // Exponent input
  const expInput = document.getElementById(`q${n}-exponent-input`);
  expInput.addEventListener('change', () => {
    const man = parseFloat(document.getElementById(`q${n}-mantissa-input`).value);
    const exp = parseInt(expInput.value, 10);
    state.charges[idx].magnitude = man * Math.pow(10, exp);
    updateChargeDisplay(idx);
    draw();
  });
});

/* ── Drag interaction ── */
function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = cssWidth()  / rect.width;
  const scaleY = cssHeight() / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY,
  };
}

function hitCharge(x, y) {
  for (let i = state.charges.length - 1; i >= 0; i--) {
    const ch = state.charges[i];
    const dx = x - ch.x;
    const dy = y - ch.y;
    if (dx * dx + dy * dy <= (CHARGE_RADIUS + 4) ** 2) return i;
  }
  return -1;
}

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const { x, y } = canvasPoint(e);
  const hit = hitCharge(x, y);
  if (hit === -1) return;

  // Click to set test charge — distinguish from drag in mouseup
  state.drag = { id: hit, offX: x - state.charges[hit].x, offY: y - state.charges[hit].y, moved: false };
  canvas.classList.add('dragging');
});

canvas.addEventListener('mousemove', e => {
  if (!state.drag) return;
  const { x, y } = canvasPoint(e);
  const ch = state.charges[state.drag.id];
  const nx = Math.max(CHARGE_RADIUS, Math.min(cssWidth()  - CHARGE_RADIUS, x - state.drag.offX));
  const ny = Math.max(CHARGE_RADIUS, Math.min(cssHeight() - CHARGE_RADIUS, y - state.drag.offY));
  if (Math.abs(nx - ch.x) > 3 || Math.abs(ny - ch.y) > 3) state.drag.moved = true;
  ch.x = nx;
  ch.y = ny;
  draw();
});

canvas.addEventListener('mouseup', e => {
  if (!state.drag) return;
  if (!state.drag.moved) {
    // Treat as click → set as test charge
    state.testId = state.drag.id;
  }
  state.drag = null;
  canvas.classList.remove('dragging');
  draw();
});

canvas.addEventListener('mouseleave', () => {
  if (state.drag) {
    state.drag = null;
    canvas.classList.remove('dragging');
  }
});

/* ── Init ── */
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
  resizeCanvas();
  applyPreset(state.preset);
  [0, 1, 2].forEach(i => updateChargeDisplay(i));
});
