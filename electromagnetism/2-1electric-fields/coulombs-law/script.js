// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_FONT = '"Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
const CHARGE_RADIUS = 26;
const POSITIVE_COLOR = '#dc2626';
const NEGATIVE_COLOR = '#2563eb';

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

function draw() {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  drawGrid();

  // Field visualisation and force arrows will be added in later chunks.

  drawCharge(state.q1, 'q₁');
  drawCharge(state.q2, 'q₂');
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
