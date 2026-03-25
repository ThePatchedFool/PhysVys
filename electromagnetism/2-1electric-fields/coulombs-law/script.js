// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_FONT = '"Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
const CHARGE_RADIUS = 26;
const POSITIVE_COLOR = '#dc2626';
const NEGATIVE_COLOR = '#2563eb';
const K = 8.99e9;          // Coulomb's constant, N m² C⁻²
const PIXELS_PER_METRE = 500; // 1 m = 500 px  →  canvas ≈ 1.92 m × 1.12 m
const SCALE_BAR_PX = 100;  // 100 px = 0.2 m = 20 cm

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  q1: { x: 300, y: 280, sign: '+', magnitude: 1 },
  q2: { x: 660, y: 280, sign: '-', magnitude: 1 },
  showForces: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');
const btnShowForces = document.getElementById('btn-show-forces');
const q1Display = document.getElementById('q1-display');
const q2Display = document.getElementById('q2-display');
const readoutR = document.getElementById('readout-r');
const readoutF = document.getElementById('readout-f');

// ─── Utilities ────────────────────────────────────────────────────────────────

function updateMath() {
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise();
  }
}

function screenToCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  };
}

function chargeColor(sign) {
  return sign === '+' ? POSITIVE_COLOR : NEGATIVE_COLOR;
}

function separation() {
  const dx = state.q2.x - state.q1.x;
  const dy = state.q2.y - state.q1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Physics ──────────────────────────────────────────────────────────────────

function separationMetres() {
  return separation() / PIXELS_PER_METRE;
}

function coulombForce() {
  const r = separationMetres();
  if (r < 0.01) return Infinity; // charges nearly overlapping
  const q1 = state.q1.magnitude * 1e-6;
  const q2 = state.q2.magnitude * 1e-6;
  return K * q1 * q2 / (r * r);
}

// Format a value in scientific notation, e.g. 1.23 × 10⁴ N
const SUPERSCRIPT = { '-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
function toSup(n) {
  return String(n).split('').map((c) => SUPERSCRIPT[c] ?? c).join('');
}

function formatSci(value, unit = '') {
  if (!Number.isFinite(value)) return `∞${unit ? ' ' + unit : ''}`;
  if (value === 0) return `0${unit ? ' ' + unit : ''}`;
  const exp = Math.floor(Math.log10(value));
  const man = value / 10 ** exp;
  const rounded = man >= 9.995 ? 10 : man;
  const finalExp = rounded === 10 ? exp + 1 : exp;
  const finalMan = rounded === 10 ? 1 : rounded;
  return `${finalMan.toFixed(2)} × 10${toSup(finalExp)}${unit ? ' ' + unit : ''}`;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function drawGrid() {
  const { width, height } = canvas;
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y <= height; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.restore();
}

function drawDistanceLine() {
  const { q1, q2 } = state;
  const dx = q2.x - q1.x;
  const dy = q2.y - q1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;

  const ux = dx / dist;
  const uy = dy / dist;

  // Start and end at the edge of each charge circle
  const x1 = q1.x + ux * CHARGE_RADIUS;
  const y1 = q1.y + uy * CHARGE_RADIUS;
  const x2 = q2.x - ux * CHARGE_RADIUS;
  const y2 = q2.y - uy * CHARGE_RADIUS;

  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  // r label at midpoint, offset perpendicular to the line
  const mx = (q1.x + q2.x) / 2;
  const my = (q1.y + q2.y) / 2;
  const perpX = -uy;
  const perpY = ux;
  const labelX = mx + perpX * 22;
  const labelY = my + perpY * 22;

  ctx.fillStyle = 'rgba(21, 48, 77, 0.7)';
  ctx.font = `700 14px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`r = ${separationMetres().toFixed(2)} m`, labelX, labelY);
  ctx.restore();
}

function drawScaleBar() {
  const { width, height } = canvas;
  const x = width - 30 - SCALE_BAR_PX;
  const y = height - 28;

  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.45)';
  ctx.lineWidth = 2;

  // Horizontal bar with end ticks
  ctx.beginPath();
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
  ctx.moveTo(x, y); ctx.lineTo(x + SCALE_BAR_PX, y);
  ctx.moveTo(x + SCALE_BAR_PX, y - 5); ctx.lineTo(x + SCALE_BAR_PX, y + 5);
  ctx.stroke();

  ctx.fillStyle = 'rgba(21, 48, 77, 0.6)';
  ctx.font = `500 13px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('20 cm', x + SCALE_BAR_PX / 2, y - 6);
  ctx.restore();
}

function drawCharge(charge, label) {
  const { x, y, sign } = charge;
  const color = chargeColor(sign);
  const r = CHARGE_RADIUS;

  const gradient = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.15, x, y, r);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.25, color);
  gradient.addColorStop(1, 'rgba(16, 24, 40, 0.85)');

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Symbol
  ctx.fillStyle = 'white';
  ctx.font = `900 ${r}px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sign === '+' ? '+' : '−', x, y + 1);

  // Label below
  ctx.fillStyle = chargeColor(sign);
  ctx.font = `700 15px ${CANVAS_FONT}`;
  ctx.fillText(label, x, y + r + 18);
  ctx.restore();
}

function updateReadouts() {
  const r = separationMetres();
  const f = coulombForce();
  readoutR.textContent = `${r.toFixed(2)} m`;
  readoutF.textContent = formatSci(f, 'N');
}

function draw() {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  drawGrid();
  drawDistanceLine();
  drawScaleBar();

  // Force arrows will be added in Chunk 4.

  drawCharge(state.q1, 'q₁');
  drawCharge(state.q2, 'q₂');
  updateReadouts();
}

// ─── Dragging ─────────────────────────────────────────────────────────────────

const drag = {
  active: false,
  target: null,   // 'q1' | 'q2'
  offsetX: 0,
  offsetY: 0,
  moved: false,
};

function hitTest(x, y) {
  for (const key of ['q1', 'q2']) {
    const c = state[key];
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy <= CHARGE_RADIUS * CHARGE_RADIUS) return key;
  }
  return null;
}

canvas.addEventListener('mousedown', (e) => {
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  const hit = hitTest(x, y);
  if (!hit) return;
  drag.active = true;
  drag.target = hit;
  drag.offsetX = x - state[hit].x;
  drag.offsetY = y - state[hit].y;
  drag.moved = false;
  canvas.classList.add('dragging');
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!drag.active) {
    // Hover cursor
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    canvas.style.cursor = hitTest(x, y) ? 'grab' : 'default';
    return;
  }
  drag.moved = true;
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  state[drag.target].x = x - drag.offsetX;
  state[drag.target].y = y - drag.offsetY;
  draw();
});

window.addEventListener('mouseup', () => {
  if (!drag.active) return;
  drag.active = false;
  drag.target = null;
  canvas.classList.remove('dragging');
});

canvas.addEventListener('mouseleave', () => {
  if (!drag.active) canvas.style.cursor = 'default';
});

// ─── Panel displays ───────────────────────────────────────────────────────────

function formatCharge(key) {
  const c = state[key];
  const sign = c.sign === '+' ? '+' : '−';
  const sub = key === 'q1' ? '₁' : '₂';
  return `q${sub} = ${sign}${c.magnitude} μC`;
}

function updateDisplays() {
  q1Display.textContent = formatCharge('q1');
  q2Display.textContent = formatCharge('q2');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

updateDisplays();
draw();
updateMath();
