'use strict';

/* ── Constants ── */
const K = 8.99e9;
const PIXELS_PER_METRE = 100;   // 1 px = 1 cm
const SOURCE_RADIUS = 26;
const TEST_RADIUS   = 10;
const FIELD_SPLIT   = 0.58;     // fraction of canvas width used for field area
const TEST_CHARGE   = 1e-6;     // fixed +1 µC probe for force readout

const SUPERSCRIPT = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function toSuperscript(n) { return String(n).split('').map(c => SUPERSCRIPT[c] ?? c).join(''); }

function formatSciN(val, unit) {
  if (!Number.isFinite(val) || val === 0) return `0 ${unit}`;
  const exp = Math.floor(Math.log10(Math.abs(val)));
  const man = val / Math.pow(10, exp);
  const rounded = Math.abs(man) >= 9.995 ? (val > 0 ? 1 : -1) : man;
  const finalExp = Math.abs(man) >= 9.995 ? exp + 1 : exp;
  return `${rounded.toFixed(2)} × 10${toSuperscript(finalExp)} ${unit}`;
}

/* ── State ── */
const state = {
  mode: 'explore',
  sign: +1,
  magnitude: 1e-6,

  // test point position in CSS pixels (set in init)
  testX: 0,
  testY: 0,

  drag: false,
};

/* ── Canvas setup ── */
const canvas = document.getElementById('simulation-canvas');
const ctx    = canvas.getContext('2d');

function cssWidth()  { return canvas.width  / (window.devicePixelRatio || 1); }
function cssHeight() { return canvas.height / (window.devicePixelRatio || 1); }
function fieldWidth() { return cssWidth() * FIELD_SPLIT; }
function sourceX()    { return fieldWidth() * 0.32; }
function sourceY()    { return cssHeight() / 2; }

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const dpr  = window.devicePixelRatio || 1;
  const cssW = wrap.clientWidth - 2 * 13;
  const cssH = Math.round(cssW * (7 / 12));
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Keep test point in valid field area after resize
  state.testX = Math.min(state.testX || fieldWidth() * 0.72, fieldWidth() - TEST_RADIUS - 4);
  state.testY = state.testY || cssHeight() / 2;
  draw();
}

/* ── Drawing helpers ── */
function drawSourceCharge() {
  const x = sourceX();
  const y = sourceY();
  const r = SOURCE_RADIUS;
  const col  = state.sign > 0 ? '#dc2626' : '#2563eb';
  const dark = state.sign > 0 ? '#b91c1c' : '#1d4ed8';

  ctx.save();
  ctx.shadowColor  = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur   = 12;
  ctx.shadowOffsetY = 4;

  const grd = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, col);
  grd.addColorStop(1, dark);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'white';
  ctx.font = `bold ${r * 0.85}px "Trebuchet MS", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(state.sign > 0 ? '+' : '−', x, y + 1);

  ctx.fillStyle = dark;
  ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Q', x, y + r + 5);
}

function drawTestPoint() {
  const x = state.testX;
  const y = state.testY;
  const r = TEST_RADIUS;

  ctx.save();
  ctx.shadowColor  = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur   = 8;
  ctx.shadowOffsetY = 2;

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // crosshair
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - r + 3, y); ctx.lineTo(x + r - 3, y);
  ctx.moveTo(x, y - r + 3); ctx.lineTo(x, y + r - 3);
  ctx.stroke();

  ctx.fillStyle = '#0f766e';
  ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('P', x, y + r + 4);
}

function drawRadialLine() {
  const sx = sourceX(), sy = sourceY();
  const tx = state.testX, ty = state.testY;
  const dx = tx - sx, dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;

  const ux = dx / dist, uy = dy / dist;
  const x1 = sx + ux * SOURCE_RADIUS;
  const y1 = sy + uy * SOURCE_RADIUS;
  const x2 = tx - ux * TEST_RADIUS;
  const y2 = ty - uy * TEST_RADIUS;

  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();

  // r label at midpoint, offset perpendicularly
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const rMetres = dist / PIXELS_PER_METRE;
  const rText = rMetres < 1 ? `r = ${(rMetres * 100).toFixed(1)} cm` : `r = ${rMetres.toFixed(2)} m`;

  ctx.fillStyle = 'rgba(21, 48, 77, 0.6)';
  ctx.font = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // perpendicular offset (rotate 90°, above the line)
  ctx.fillText(rText, mx - uy * 14, my + ux * 14);
}

function fieldArrowLength(E) {
  // Log-normalize: map log10(E) from -5 → 12 to arrow length 20 → 150 px
  const norm = (Math.log10(Math.max(E, 1e-10)) - (-5)) / (12 - (-5));
  return 20 + Math.max(0, Math.min(1, norm)) * 130;
}

function drawFieldArrow() {
  const sx = sourceX(), sy = sourceY();
  const tx = state.testX,  ty = state.testY;
  const dx = tx - sx,       dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;

  const rM = dist / PIXELS_PER_METRE;
  const E  = K * state.magnitude / (rM * rM);
  const len = fieldArrowLength(E);

  // Field direction: away from Q if positive, toward Q if negative
  const ux = (dx / dist) * state.sign;
  const uy = (dy / dist) * state.sign;

  const x1 = tx + ux * (TEST_RADIUS + 4);
  const y1 = ty + uy * (TEST_RADIUS + 4);
  const x2 = x1 + ux * len;
  const y2 = y1 + uy * len;

  const col = '#0f766e';

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Arrowhead
  const angle = Math.atan2(uy, ux);
  const headSize = 10;
  ctx.save();
  ctx.translate(x2, y2);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-headSize, -headSize * 0.45);
  ctx.lineTo(-headSize,  headSize * 0.45);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.restore();

  // E label beside arrowhead
  ctx.fillStyle = col;
  ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('E', x2 + ux * 6 - uy * 14, y2 + uy * 6 + ux * 14);
}

/* ── Graph helpers ── */

const GPAD = { left: 58, right: 14, top: 24, bottom: 36 };

function graphArea() {
  const fx = fieldWidth();
  const W  = cssWidth();
  const H  = cssHeight();
  return {
    ox: fx + GPAD.left,
    oy: H  - GPAD.bottom,
    w:  W  - fx - GPAD.left - GPAD.right,
    h:  H  - GPAD.top  - GPAD.bottom,
    fx,
  };
}

function rMaxGraph() {
  // max distance from source to far edge of field area
  return (fieldWidth() - sourceX() - SOURCE_RADIUS - TEST_RADIUS - 4) / PIXELS_PER_METRE;
}

function niceAxisMax(val) {
  if (val <= 0) return 1;
  const exp  = Math.floor(Math.log10(val));
  const frac = val / Math.pow(10, exp);
  let nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

function compactSci(val) {
  if (val === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(val)));
  const man = Math.round((val / Math.pow(10, exp)) * 10) / 10;
  return man === 1 ? `10${toSuperscript(exp)}` : `${man}×10${toSuperscript(exp)}`;
}

function drawGraph() {
  const g   = graphArea();
  const W   = cssWidth();
  const H   = cssHeight();

  // Panel background
  ctx.fillStyle = 'rgba(242, 248, 255, 0.75)';
  ctx.fillRect(g.fx, 0, W - g.fx, H);

  const rxMax = rMaxGraph();
  const rMinM = (SOURCE_RADIUS + TEST_RADIUS + 4) / PIXELS_PER_METRE;
  const eyMax = niceAxisMax(K * state.magnitude / (rMinM * rMinM));

  const toX = r => g.ox + (r          / rxMax) * g.w;
  const toY = E => g.oy - (Math.min(E, eyMax) / eyMax) * g.h;

  // Grid lines
  const N = 5;
  ctx.lineWidth = 1;
  for (let i = 0; i <= N; i++) {
    ctx.strokeStyle = 'rgba(21,48,77,0.07)';
    ctx.beginPath();
    ctx.moveTo(toX(i / N * rxMax), g.oy - g.h);
    ctx.lineTo(toX(i / N * rxMax), g.oy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(g.ox,        toY(i / N * eyMax));
    ctx.lineTo(g.ox + g.w,  toY(i / N * eyMax));
    ctx.stroke();
  }

  // Curve E = k|Q|/r²
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= 300; i++) {
    const r = rMinM + (i / 300) * (rxMax - rMinM);
    const E = K * state.magnitude / (r * r);
    const x = toX(r);
    const y = toY(E);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else           ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Current position tracking dot
  const dx = state.testX - sourceX();
  const dy = state.testY - sourceY();
  const rCur = Math.sqrt(dx * dx + dy * dy) / PIXELS_PER_METRE;
  const eCur = K * state.magnitude / (rCur * rCur);
  const dotX = toX(rCur);
  const dotY = toY(eCur);

  // Dashed crosshairs to axes
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(15,118,110,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(dotX, g.oy); ctx.lineTo(dotX, Math.max(dotY, g.oy - g.h));
  ctx.moveTo(g.ox, Math.max(dotY, g.oy - g.h)); ctx.lineTo(dotX, Math.max(dotY, g.oy - g.h));
  ctx.stroke();
  ctx.restore();

  // Dot
  ctx.beginPath();
  ctx.arc(dotX, Math.max(dotY, g.oy - g.h), 5, 0, Math.PI * 2);
  ctx.fillStyle   = '#0f766e';
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Axes
  ctx.strokeStyle = 'rgba(21,48,77,0.45)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(g.ox, g.oy - g.h);
  ctx.lineTo(g.ox, g.oy);
  ctx.lineTo(g.ox + g.w, g.oy);
  ctx.stroke();

  // Tick labels — r axis
  ctx.fillStyle    = 'rgba(21,48,77,0.6)';
  ctx.font         = '11px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i <= N; i++) {
    const r = (i / N) * rxMax;
    ctx.fillText(r.toFixed(1), toX(r), g.oy + 5);
  }

  // Tick labels — E axis
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= N; i++) {
    const E = (i / N) * eyMax;
    ctx.fillText(i === 0 ? '0' : compactSci(E), g.ox - 5, toY(E));
  }

  // Axis labels
  ctx.fillStyle    = 'rgba(21,48,77,0.75)';
  ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('r (m)', g.ox + g.w / 2, g.oy + 20);

  ctx.save();
  ctx.translate(g.fx + 12, g.oy - g.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('E (N C⁻¹)', 0, 0);
  ctx.restore();
}

function drawFieldArea() {
  // nothing needed — graph panel provides the visual separation
}

function draw() {
  const W = cssWidth();
  const H = cssHeight();
  ctx.clearRect(0, 0, W, H);
  drawFieldArea();
  drawGraph();
  drawRadialLine();
  drawFieldArrow();
  drawSourceCharge();
  drawTestPoint();
  updateReadouts();
}

/* ── Readouts ── */
function updateReadouts() {
  const dx = state.testX - sourceX();
  const dy = state.testY - sourceY();
  const rPx = Math.sqrt(dx * dx + dy * dy);
  const rM  = rPx / PIXELS_PER_METRE;
  const Q   = state.sign * state.magnitude;
  const E   = rM > 0 ? K * Math.abs(Q) / (rM * rM) : Infinity;
  const F   = E * TEST_CHARGE;

  const rMetres = rM < 1 ? `${(rM * 100).toFixed(1)} cm` : `${rM.toFixed(3)} m`;
  document.getElementById('readout-r').textContent = rMetres;
  document.getElementById('readout-e').textContent = Number.isFinite(E) ? formatSciN(E, 'N C⁻¹') : '∞';
  document.getElementById('readout-f').textContent = Number.isFinite(F) ? formatSciN(F, 'N') : '∞';
}

/* ── Magnitude helpers ── */
const NICE_MANTISSAS = [1, 1.5, 2, 3, 5, 7];

function logSliderToMagnitude(v) {
  const exp  = Math.floor(v);
  const frac = v - exp;
  const breaks = [0, Math.log10(1.5), Math.log10(2), Math.log10(3), Math.log10(5), Math.log10(7), 1];
  let best = 0;
  for (let i = 1; i < breaks.length - 1; i++) {
    if (frac >= (breaks[i - 1] + breaks[i]) / 2) best = i;
  }
  return NICE_MANTISSAS[best] * Math.pow(10, exp);
}

function updateQDisplay() {
  const el  = document.getElementById('q-display');
  const mag = state.magnitude;
  const exp = Math.floor(Math.log10(mag));
  const man = mag / Math.pow(10, exp);
  el.textContent = `${man.toFixed(2)} × 10${toSuperscript(exp)} C`;
}

/* ── Controls wiring ── */

// Mode toggle
document.getElementById('btn-mode-explore').addEventListener('click', () => {
  state.mode = 'explore';
  document.getElementById('btn-mode-explore').classList.add('active');
  document.getElementById('btn-mode-custom').classList.remove('active');
  document.getElementById('q-explore').classList.remove('is-hidden');
  document.getElementById('q-custom').classList.add('is-hidden');
});

document.getElementById('btn-mode-custom').addEventListener('click', () => {
  state.mode = 'custom';
  document.getElementById('btn-mode-custom').classList.add('active');
  document.getElementById('btn-mode-explore').classList.remove('active');
  document.getElementById('q-explore').classList.add('is-hidden');
  document.getElementById('q-custom').classList.remove('is-hidden');
});

// Sign
document.getElementById('q-sign-pos').addEventListener('click', () => {
  state.sign = +1;
  document.getElementById('q-sign-pos').classList.add('active');
  document.getElementById('q-sign-neg').classList.remove('active');
  draw();
});
document.getElementById('q-sign-neg').addEventListener('click', () => {
  state.sign = -1;
  document.getElementById('q-sign-neg').classList.add('active');
  document.getElementById('q-sign-pos').classList.remove('active');
  draw();
});

// Explore log-slider
document.getElementById('q-log-slider').addEventListener('input', e => {
  state.magnitude = logSliderToMagnitude(parseFloat(e.target.value));
  const exp = Math.floor(Math.log10(state.magnitude));
  const man = state.magnitude / Math.pow(10, exp);
  document.getElementById('q-mantissa-slider').value = man.toFixed(2);
  document.getElementById('q-mantissa-input').value  = man.toFixed(2);
  document.getElementById('q-exponent-input').value  = exp;
  updateQDisplay();
  draw();
});

// Custom mantissa slider
document.getElementById('q-mantissa-slider').addEventListener('input', e => {
  const man = parseFloat(e.target.value);
  const exp = parseInt(document.getElementById('q-exponent-input').value, 10);
  document.getElementById('q-mantissa-input').value = man.toFixed(2);
  state.magnitude = man * Math.pow(10, exp);
  updateQDisplay();
  draw();
});

// Custom mantissa input
document.getElementById('q-mantissa-input').addEventListener('change', e => {
  let man = Math.max(1, Math.min(9.99, parseFloat(e.target.value)));
  e.target.value = man.toFixed(2);
  document.getElementById('q-mantissa-slider').value = man.toFixed(2);
  const exp = parseInt(document.getElementById('q-exponent-input').value, 10);
  state.magnitude = man * Math.pow(10, exp);
  updateQDisplay();
  draw();
});

// Exponent input
document.getElementById('q-exponent-input').addEventListener('change', e => {
  const man = parseFloat(document.getElementById('q-mantissa-input').value);
  state.magnitude = man * Math.pow(10, parseInt(e.target.value, 10));
  updateQDisplay();
  draw();
});

/* ── Drag interaction ── */
function canvasPoint(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = cssWidth()  / rect.width;
  const scaleY = cssHeight() / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY,
  };
}

function hitTestPoint(x, y) {
  const dx = x - state.testX;
  const dy = y - state.testY;
  return dx * dx + dy * dy <= (TEST_RADIUS + 6) ** 2;
}

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const { x, y } = canvasPoint(e);
  if (hitTestPoint(x, y)) {
    state.drag = true;
    canvas.classList.add('dragging');
  }
});

canvas.addEventListener('mousemove', e => {
  if (!state.drag) return;
  const { x, y } = canvasPoint(e);
  const fw = fieldWidth();
  // keep test point in the field area, clear of source charge
  const dx = x - sourceX(), dy = y - sourceY();
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist >= SOURCE_RADIUS + TEST_RADIUS + 4) {
    state.testX = Math.max(TEST_RADIUS + 2, Math.min(fw - TEST_RADIUS - 4, x));
    state.testY = Math.max(TEST_RADIUS + 2, Math.min(cssHeight() - TEST_RADIUS - 2, y));
  }
  draw();
});

canvas.addEventListener('mouseup',    () => { state.drag = false; canvas.classList.remove('dragging'); });
canvas.addEventListener('mouseleave', () => { state.drag = false; canvas.classList.remove('dragging'); });

/* ── Init ── */
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
  resizeCanvas();
  updateQDisplay();
});
