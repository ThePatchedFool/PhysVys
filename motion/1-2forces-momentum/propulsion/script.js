'use strict';

const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');
const CW = 960, CH = 560;

/* ── Visual constants ────────────────────────────────────── */
const ROCKET_CX  = 460;      // fixed screen x of spacecraft centre (both modes)
const ROCKET_CY  = CH / 2;   // fixed screen y
const STAR_COUNT = 72;
const STAR_DRIFT = -28;       // px/s leftward (constant after first firing)

/* ── Config ──────────────────────────────────────────────── */
const cfg = { showVectors: false, mode: 'rocket', ion: 'xe', sail: 'absorb' };

/* ── Ion species ─────────────────────────────────────────── */
// Same accelerating voltage V → KE = qV = ½mv²
// For singly-charged ions: p ∝ √m,  v ∝ 1/√m
// Normalised so Xe = reference (heaviest → most p per particle, slowest)
const ION_TYPES = {
  xe: {
    r: 129, g: 140, b: 248,                              // #818cf8  blue-violet
    pUnit:       4.0,
    speed:      -200,
    streakLen:   18,
  },
  kr: {
    r: 56, g: 189, b: 248,                               // #38bdf8  sky-blue
    pUnit:       4.0 * Math.sqrt(83.80  / 131.29),       // ≈ 3.20
    speed:      -200 * Math.sqrt(131.29 / 83.80),        // ≈ −250
    streakLen:   23,
  },
  ar: {
    r: 192, g: 132, b: 252,                              // #c084fc  lavender
    pUnit:       4.0 * Math.sqrt(39.95  / 131.29),       // ≈ 2.21
    speed:      -200 * Math.sqrt(131.29 / 39.95),        // ≈ −363
    streakLen:   32,
  },
};
const ION_INTERVAL = 0.12;   // seconds between particles while held

/* ── Rocket physics / timing constants ───────────────────── */
const BLOB_SPEED    = -320;
const COOLDOWN      = 3.0;
const MOMENTUM_UNIT = 60;    // px per rocket firing

/* ── Solar sail physics / timing constants ───────────────── */
const PHOTON_SPEED    =  500;   // px/s rightward
const SOLAR_COOLDOWN  =  2.0;   // s — time for photon to complete full reflect journey
const SOLAR_P_UNIT    =  30;    // px per photon (absorb); reflect gives 2×

/* ── Vector colours ──────────────────────────────────────── */
const COL_ROCKET  = '#60a5fa';
const COL_EXHAUST = '#f87171';

/* ── Shared state ────────────────────────────────────────── */
let stars    = [];
let drifting = false;
let lastTs   = null;
let simTime  = 0;    // seconds elapsed — drives photon wave animation

/* ── Rocket-mode state ───────────────────────────────────── */
let blobs             = [];
let fireCount         = 0;
let cooldownRemaining = 0;

/* ── Ion-mode state ──────────────────────────────────────── */
let ions         = [];
let ionFiring    = false;
let ionAccum     = 0;
let ionTotalP    = 0;

/* ── Solar-sail state ────────────────────────────────────── */
let solarPhoton    = null;   // single in-flight photon object, or null
let solarCooldown  = 0;
let solarTotalP    = 0;
let solarPhotonRef = false;  // true once first photon has fired (shows |p_γ| arrow)

/* ── DOM refs ────────────────────────────────────────────── */
const fireBtn     = document.getElementById('btn-fire');
const cooldownLbl = document.getElementById('cooldown-label');

/* ── UI helpers ──────────────────────────────────────────── */
function updateFireBtn() {
  if (cfg.mode === 'rocket') {
    if (cooldownRemaining > 0) {
      fireBtn.disabled        = true;
      cooldownLbl.textContent = `Ready in ${Math.ceil(cooldownRemaining)}s`;
    } else {
      fireBtn.disabled        = false;
      cooldownLbl.textContent = '';
    }
  } else if (cfg.mode === 'solar') {
    if (solarCooldown > 0) {
      fireBtn.disabled        = true;
      cooldownLbl.textContent = `Ready in ${Math.ceil(solarCooldown)}s`;
    } else {
      fireBtn.disabled        = false;
      cooldownLbl.textContent = '';
    }
  } else {
    fireBtn.disabled        = false;
    cooldownLbl.textContent = '';
  }
}

const MODE_TEXT = {
  rocket: {
    intro:    'In deep space there is nothing to push against. The only way to change momentum is to throw mass the other way — and that is exactly what a rocket does. Total momentum of the system stays zero.',
    explain:  'Before firing, the rocket is at rest — total momentum is zero. After ejecting exhaust gas backward, the exhaust carries momentum in one direction, so the rocket must carry equal momentum in the opposite direction. <strong>p</strong><sub>rocket</sub> + <strong>p</strong><sub>exhaust</sub> = 0, always.',
    btnLabel: 'Fire Rocket',
  },
  ion: {
    intro:    'Ion thrusters accelerate charged particles to extremely high speed using an electric field. Each particle carries tiny momentum — but fire continuously long enough and the craft builds real speed. Same law, very different character.',
    explain:  'Each ion is accelerated through the same electric field: KE\u202f=\u202fqV\u202f=\u202f½mv². Heavier ions (Xe) gain more momentum per particle — p\u202f=\u202f√(2mqV) — but travel more slowly than lighter ones (Ar). The same conservation law applies: <strong>p</strong><sub>craft</sub> + <strong>Σp</strong><sub>ions</sub> = 0, always.',
    btnLabel: 'Hold to Fire',
  },
  solar: {
    intro:    'A solar sail needs no propellant — sunlight itself provides the push. Photons carry momentum (p\u202f=\u202fE/c), and when they strike a sail that momentum is transferred to the craft. A reflective sail doubles the impulse by bouncing the photon back.',
    explain:  'Absorbing sail: the photon vanishes and all its momentum goes to the craft — <strong>Δp</strong><sub>sail</sub>\u202f=\u202f<strong>p</strong><sub>γ</sub>. Reflecting sail: the photon reverses direction, so by conservation of momentum the craft gains twice as much — <strong>Δp</strong><sub>sail</sub>\u202f=\u202f2<strong>p</strong><sub>γ</sub>. No propellant, no exhaust — just light.',
    btnLabel: 'Photon',
  },
};

function setMode(mode) {
  cfg.mode = mode;

  // Reset all simulation state
  drifting = false;  lastTs = null;
  blobs = [];  fireCount = 0;  cooldownRemaining = 0;
  ions  = [];  ionFiring = false;  ionAccum = 0;  ionTotalP = 0;
  solarPhoton = null;  solarCooldown = 0;  solarTotalP = 0;  solarPhotonRef = false;
  initStars();

  // Update mode selector active state
  document.querySelectorAll('#seg-mode .seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.val === mode));

  // Show/hide mode-specific controls
  document.getElementById('ion-controls').style.display  = mode === 'ion'   ? '' : 'none';
  document.getElementById('sail-controls').style.display = mode === 'solar' ? '' : 'none';

  // Update text content
  const t = MODE_TEXT[mode];
  fireBtn.textContent = t.btnLabel;
  document.getElementById('hero-intro').textContent = t.intro;
  document.getElementById('explain-body').innerHTML  = t.explain;

  updateFireBtn();
}

/* ── Stars ───────────────────────────────────────────────── */
function initStars() {
  stars = Array.from({ length: STAR_COUNT }, () => ({
    x:     Math.random() * CW,
    y:     Math.random() * CH,
    r:     Math.random() * 1.3 + 0.3,
    alpha: Math.random() * 0.55 + 0.45,
  }));
}

/* ── Background ──────────────────────────────────────────── */
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, '#07081a');
  g.addColorStop(1, '#0c1124');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CW, CH);
}

function drawStars() {
  stars.forEach(s => {
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  });
}

/* ── Saturn V silhouette ─────────────────────────────────── */
// All coordinates relative to rocket centre (cx, cy).
// Engine end (left) at roughly x = −143.
// Nose/LES tip (right) at roughly x = +140.
//
// Stage layout (left → right):
//   Engine bells:        −143 … −126
//   S-IC (first stage):  −126 … −32   hh = 22
//   S-II (2nd stage):     −32 … +18   hh = 20  (interstage ring at −32)
//   S-IVB (3rd stage):    +18 … +52   hh = 14  (interstage ring at +18)
//   Instrument unit:      +52 … +59   hh = 14  (dark)
//   SLA adapter (taper):  +59 … +75   14→10
//   Service Module:       +75 … +96   hh = 10
//   Command Module:       +96 … +111  10→6 (taper)
//   LES tower:           +111 … +140  hh = 3

function drawRocket(cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);

  const CREAM  = '#f0ede0';
  const CREAM2 = '#e8e5d4';   // Service Module — slightly different white
  const BAND   = '#0f0e1e';   // interstage / instrument unit
  const TRIM   = '#c8c4b0';   // outline/stroke for body sections
  const LES_C  = '#1e1e30';

  // ── Helper: stroked filled rect ─────────────────────────
  function br(xl, hh, w, fill, lw = 0.8, stroke = TRIM) {
    ctx.fillStyle   = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth   = lw;
    ctx.beginPath();
    ctx.rect(xl, -hh, w, hh * 2);
    ctx.fill();
    ctx.stroke();
  }

  // ── Fins (drawn before body so body overlaps fin root) ──
  const finPts = [
    // bottom fin
    [ [-126, 22], [-95, 22], [-99, 52], [-130, 52] ],
    // top fin (y-mirrored)
    [ [-126,-22], [-95,-22], [-99,-52], [-130,-52] ],
  ];
  finPts.forEach(pts => {
    ctx.fillStyle   = CREAM2;
    ctx.strokeStyle = TRIM;
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    pts.slice(1).forEach(p => ctx.lineTo(...p));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  // ── Engine fairing / skirt ──────────────────────────────
  br(-143, 23, 17, BAND, 0.8, '#22223a');

  // F-1 engine bells — 5 in a quincunx, visible from behind
  [[-136,-12], [-136,12], [-136,0], [-140,-20], [-140,20]].forEach(([bx, by]) => {
    ctx.fillStyle   = '#100e20';
    ctx.strokeStyle = '#3a3555';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(bx, by, 5.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    // Subtle hot-spot glow in centre of each bell
    ctx.fillStyle = 'rgba(80,60,40,0.4)';
    ctx.beginPath();
    ctx.arc(bx, by, 2.5, 0, 2 * Math.PI);
    ctx.fill();
  });

  // ── Main body sections ──────────────────────────────────
  br(-126, 22, 94, CREAM);    // S-IC
  // Dark interstage ring S-IC/S-II
  br( -32, 20,  5, BAND, 0.8, '#22223a');
  br( -27, 20, 45, CREAM);    // S-II
  // Dark interstage ring S-II/S-IVB
  br(  18, 20,  4, BAND, 0.8, '#22223a');
  br(  22, 14, 30, CREAM);    // S-IVB
  // Instrument unit (dark band)
  br(  52, 14,  7, BAND, 0.8, '#22223a');

  // SLA adapter — trapezoid taper 14→10
  ctx.fillStyle   = CREAM;
  ctx.strokeStyle = TRIM;
  ctx.lineWidth   = 0.8;
  ctx.beginPath();
  ctx.moveTo( 59, -14);
  ctx.lineTo( 75, -10);
  ctx.lineTo( 75,  10);
  ctx.lineTo( 59,  14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  br(  75, 10, 21, CREAM2);   // Service Module

  // Command Module — trapezoid taper 10→6
  ctx.fillStyle   = '#ddd9c6';
  ctx.strokeStyle = TRIM;
  ctx.lineWidth   = 0.8;
  ctx.beginPath();
  ctx.moveTo( 96, -10);
  ctx.lineTo(111,  -6);
  ctx.lineTo(111,   6);
  ctx.lineTo( 96,  10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // LES tower
  br( 111, 3, 29, LES_C, 0.8, '#2a2a3e');
  // LES motor cap
  ctx.fillStyle   = '#0a0a18';
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth   = 0.8;
  ctx.beginPath();
  ctx.rect(137, -4.5, 5, 9);
  ctx.fill();
  ctx.stroke();

  // ── Subtle USA text band on S-IC (decorative stripe) ───
  ctx.save();
  ctx.strokeStyle = 'rgba(180,170,150,0.18)';
  ctx.lineWidth   = 1;
  [-8, 8].forEach(dy => {
    ctx.beginPath();
    ctx.moveTo(-126, dy);
    ctx.lineTo( -32, dy);
    ctx.stroke();
  });
  ctx.restore();

  ctx.restore();
}

/* ── Storlunk satellite silhouette ───────────────────────── */
// Body centre at (cx, cy). Thruster at left (x ≈ −73), comms at right (x ≈ +78).
// Two symmetric solar arrays above and below the body.

function drawStorlunk(cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);

  const BODY      = '#1e2d42';
  const BODY_HI   = '#243650';
  const BODY_TRIM = '#6aaccc';   // bright enough to read against the starfield
  const PANEL_BG  = '#02080f';
  const PANEL_LN  = '#0c2440';
  const COMMS     = '#1c2e42';

  // ── Solar arrays (top and bottom, drawn behind body) ─────
  for (const sy of [-58, 10]) {
    const ph = 48;
    ctx.fillStyle   = PANEL_BG;
    ctx.strokeStyle = PANEL_LN;
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.rect(-42, sy, 84, ph);
    ctx.fill();
    ctx.stroke();
    // Cell grid — 5 vertical + 3 horizontal dividers
    ctx.strokeStyle = PANEL_LN;
    ctx.lineWidth   = 0.5;
    for (let c = 1; c <= 5; c++) {
      const lx = -42 + c * 14;
      ctx.beginPath(); ctx.moveTo(lx, sy); ctx.lineTo(lx, sy + ph); ctx.stroke();
    }
    for (let r = 1; r <= 3; r++) {
      const ly = sy + r * 12;
      ctx.beginPath(); ctx.moveTo(-42, ly); ctx.lineTo(42, ly); ctx.stroke();
    }
    // Outer border — visible against starfield
    ctx.strokeStyle = BODY_TRIM;
    ctx.lineWidth   = 1.2;
    ctx.strokeRect(-42, sy, 84, ph);
  }

  // ── Ion thruster nozzle (protrudes left of body) ──────────
  ctx.fillStyle   = '#060d18';
  ctx.strokeStyle = BODY_TRIM;
  ctx.lineWidth   = 0.8;
  ctx.beginPath();
  ctx.rect(-73, -6, 8, 12);
  ctx.fill();
  ctx.stroke();
  // Aperture glow — brightens and changes colour when firing
  const ion  = ION_TYPES[cfg.ion];
  const glow = ctx.createRadialGradient(-73, 0, 0, -73, 0, 6);
  if (ionFiring) {
    glow.addColorStop(0,   `rgba(${ion.r},${ion.g},${ion.b},0.95)`);
    glow.addColorStop(0.4, `rgba(${ion.r},${ion.g},${ion.b},0.45)`);
    glow.addColorStop(1,   `rgba(${ion.r},${ion.g},${ion.b},0)`);
  } else {
    glow.addColorStop(0,   'rgba(40,70,140,0.65)');
    glow.addColorStop(1,   'rgba(10,20,60,0)');
  }
  ctx.beginPath();
  ctx.arc(-73, 0, 5, 0, 2 * Math.PI);
  ctx.fillStyle = glow;
  ctx.fill();

  // ── Main body ─────────────────────────────────────────────
  // Outer glow pass — slightly expanded rect for a lit-edge effect
  ctx.save();
  ctx.strokeStyle = 'rgba(106,172,204,0.35)';
  ctx.lineWidth   = 4;
  ctx.strokeRect(-66, -11, 132, 22);
  ctx.restore();

  ctx.fillStyle   = BODY;
  ctx.strokeStyle = BODY_TRIM;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.rect(-65, -10, 130, 20);
  ctx.fill();
  ctx.stroke();
  // Highlight strip along top edge
  ctx.fillStyle = BODY_HI;
  ctx.beginPath();
  ctx.rect(-65, -10, 130, 4);
  ctx.fill();

  // STORLUNK stencil
  ctx.save();
  ctx.fillStyle    = 'rgba(155,185,215,0.38)';
  ctx.font         = 'bold 7px "Trebuchet MS", monospace';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STORLUNK', 0, 0);
  ctx.restore();

  // ── Comms phased array (protrudes right of body) ──────────
  ctx.fillStyle   = COMMS;
  ctx.strokeStyle = BODY_TRIM;
  ctx.lineWidth   = 1.2;
  ctx.beginPath();
  ctx.rect(65, -5, 13, 10);
  ctx.fill();
  ctx.stroke();
  // Detail lines
  ctx.strokeStyle = BODY_HI;
  ctx.lineWidth   = 0.5;
  for (let i = 1; i <= 3; i++) {
    const ly = -5 + i * 2.5;
    ctx.beginPath(); ctx.moveTo(66, ly); ctx.lineTo(77, ly); ctx.stroke();
  }

  ctx.restore();
}

/* ── Arrow + label helpers ───────────────────────────────── */
function arrow(x1, y1, x2, y2, col, lw = 1.5) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 4) return;
  const ux = dx / len, uy = dy / len;
  const hw = 6, hl = 12;
  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle   = col;
  ctx.lineWidth   = lw;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - ux * hl, y2 - uy * hl);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * hl - uy * hw, y2 - uy * hl + ux * hw);
  ctx.lineTo(x2 - ux * hl + uy * hw, y2 - uy * hl - ux * hw);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Two-pass subscript: base text at sz, subscript at 70% sz shifted down
function subLabel(x, y, base, sub, col, align = 'left', sz = 14) {
  ctx.save();
  ctx.fillStyle    = col;
  ctx.textBaseline = 'middle';
  ctx.font = `italic 700 ${sz}px "Trebuchet MS", sans-serif`;
  const bw    = ctx.measureText(base).width;
  const subSz = Math.round(sz * 0.70);
  ctx.font = `italic 700 ${subSz}px "Trebuchet MS", sans-serif`;
  const sw    = ctx.measureText(sub).width;
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

/* ── Momentum vector overlay ─────────────────────────────── */
// Both summary arrows start from ROCKET_CX — equal-and-opposite is obvious.
// They share MAX_VEC so they are always exactly the same length.
const MAX_VEC = Math.min(CW - ROCKET_CX - 36, ROCKET_CX - 40);  // ≈ 420 px

function drawVectors() {
  if (!cfg.showVectors) return;
  const LW = 2.2;

  if (cfg.mode === 'solar') {
    // p_sail — above craft, pointing right, grows with each photon
    if (solarTotalP >= 1) {
      const sailLen = Math.min(solarTotalP, MAX_VEC);
      const ry = ROCKET_CY - 68;
      arrow(ROCKET_CX, ry, ROCKET_CX + sailLen, ry, COL_ROCKET, LW);
      subLabel(ROCKET_CX + sailLen + 7, ry, 'p', 'sail', COL_ROCKET, 'left', 13);
    }

    // |p_γ| — static reference arrow, shown permanently after first photon
    // Drawn below craft pointing right; fixed size = SOLAR_P_UNIT
    if (solarPhotonRef) {
      const ey  = ROCKET_CY + 68;
      const ref = SOLAR_P_UNIT;
      arrow(ROCKET_CX, ey, ROCKET_CX + ref, ey, COL_EXHAUST, LW);
      // Render |p_γ| with correct baseline alignment
      ctx.save();
      ctx.fillStyle    = COL_EXHAUST;
      ctx.textBaseline = 'middle';
      const SZ = 13, SUBSZ = Math.round(SZ * 0.70);
      ctx.font = `italic 700 ${SZ}px "Trebuchet MS", sans-serif`;
      const bw = ctx.measureText('|p').width;
      ctx.font = `italic 700 ${SUBSZ}px "Trebuchet MS", sans-serif`;
      const gw = ctx.measureText('γ').width;
      ctx.font = `italic 700 ${SZ}px "Trebuchet MS", sans-serif`;
      const cw = ctx.measureText('|').width;
      const lx = ROCKET_CX + ref + 7;
      ctx.fillText('|p', lx, ey);
      ctx.font = `italic 700 ${SUBSZ}px "Trebuchet MS", sans-serif`;
      ctx.fillText('γ', lx + bw, ey + SZ * 0.28);
      ctx.font = `italic 700 ${SZ}px "Trebuchet MS", sans-serif`;
      ctx.fillText('|', lx + bw + gw, ey);
      ctx.restore();
    }
    return;
  }

  const pVal = cfg.mode === 'rocket' ? fireCount * MOMENTUM_UNIT : ionTotalP;
  const len  = Math.min(pVal, MAX_VEC);
  if (len < 1) return;

  // p_craft — above spacecraft, pointing right
  const ry = ROCKET_CY - 68;
  arrow(ROCKET_CX, ry, ROCKET_CX + len, ry, COL_ROCKET, LW);
  subLabel(ROCKET_CX + len + 7, ry, 'p', 'r', COL_ROCKET, 'left', 13);

  // Σp_exhaust — below spacecraft, pointing left (equal and opposite)
  const ey = ROCKET_CY + 68;
  arrow(ROCKET_CX, ey, ROCKET_CX - len, ey, COL_EXHAUST, LW);
  subLabel(ROCKET_CX - len - 7, ey, 'Σp', 'ex', COL_EXHAUST, 'right', 13);

  // Individual p_ex arrows on each blob (rocket mode only — too many in ion mode)
  if (cfg.mode === 'rocket') {
    blobs.forEach(b => {
      const half = MOMENTUM_UNIT / 2;
      const ay   = b.y - 42;
      arrow(b.x + half, ay, b.x - half, ay, COL_EXHAUST, LW);
      subLabel(b.x - half - 7, ay, 'p', 'ex', COL_EXHAUST, 'right', 13);
    });
  }
}


/* ── Daedalus solar sail ─────────────────────────────────── */
function drawDaedalus(cx, cy) {
  const reflect = cfg.sail === 'reflect';

  ctx.save();
  ctx.translate(cx, cy);

  // ── Sail ─────────────────────────────────────────────────
  // Full-canvas-height thin vertical panel, centred on cy.
  // The sail extends from just above the top to just below the bottom of the canvas.
  const sailHalfH = CH / 2 - 4;   // 276px each side → 552px total
  const sailX     = 0;             // sail is at the craft centre

  if (reflect) {
    // Silver reflective sail — bright gradient with specular sheen
    const sg = ctx.createLinearGradient(-8, 0, 8, 0);
    sg.addColorStop(0,   'rgba(120,160,180,0.6)');
    sg.addColorStop(0.3, 'rgba(220,235,245,0.95)');
    sg.addColorStop(0.5, 'rgba(255,255,255,1)');
    sg.addColorStop(0.7, 'rgba(200,220,235,0.95)');
    sg.addColorStop(1,   'rgba(100,140,165,0.6)');
    ctx.fillStyle = sg;
    ctx.fillRect(sailX - 5, -sailHalfH, 10, sailHalfH * 2);
    // Bright edge highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(sailX - 5, -sailHalfH, 10, sailHalfH * 2);
  } else {
    // Matte black absorbing sail
    ctx.fillStyle   = '#0e1118';
    ctx.strokeStyle = 'rgba(80,100,120,0.7)';
    ctx.lineWidth   = 1.5;
    ctx.fillRect(sailX - 5, -sailHalfH, 10, sailHalfH * 2);
    ctx.strokeRect(sailX - 5, -sailHalfH, 10, sailHalfH * 2);
  }

  // ── Payload box ──────────────────────────────────────────
  const PW = 34, PH = 20;
  ctx.fillStyle   = '#1e2d42';
  ctx.strokeStyle = '#4a7fa0';
  ctx.lineWidth   = 1.5;
  ctx.fillRect(-PW / 2, -PH / 2, PW, PH);
  ctx.strokeRect(-PW / 2, -PH / 2, PW, PH);

  // Small solar panel stubs (visual detail)
  ctx.fillStyle   = '#1a3a5c';
  ctx.strokeStyle = '#3a6080';
  ctx.lineWidth   = 1;
  [[-PW / 2 - 10, -4, 10, 8], [PW / 2, -4, 10, 8]].forEach(([x, y, w, h]) => {
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  });

  // "Daedalus" label
  ctx.fillStyle    = '#7ab8d4';
  ctx.font         = 'bold 8px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Daedalus', 0, 0);

  ctx.restore();
}

/* ── Exhaust blobs (rocket mode) ─────────────────────────── */

/* ── ORIGINAL simple ellipse blob — swap back by uncommenting this
       and commenting out the NEW version below ──────────────────
function drawBlob(b) {
  ctx.save();
  const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
  g.addColorStop(0,    `rgba(255,248,200,${b.alpha})`);
  g.addColorStop(0.25, `rgba(255,180, 40,${b.alpha * 0.9})`);
  g.addColorStop(0.6,  `rgba(200, 80,  10,${b.alpha * 0.5})`);
  g.addColorStop(1,    'rgba(80,30,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(b.x, b.y, b.r * 1.8, b.r * 0.9, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}
─────────────────────────────────────────────────────────────── */

// ── NEW: multi-puff gas/flame blob (screen-composite glow) ───
function drawBlob(b) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  b.puffs.forEach(p => {
    const px = b.x + p.dx;
    const py = b.y + p.dy;
    const r  = b.r * p.rs;
    const h  = p.heat;
    // Hotter puffs → white-yellow core; cooler → orange-red
    const c0 = `rgba(255,${Math.round(200 + h * 55)},${Math.round(h * 160)},${(0.45 + h * 0.45) * b.alpha})`;
    const c1 = `rgba(255,${Math.round(70  + h * 80)},0,${(0.25 + h * 0.2) * b.alpha})`;
    const g  = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0,   c0);
    g.addColorStop(0.4, c1);
    g.addColorStop(1,   'rgba(100,15,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, py, r * (1.1 + p.elong), r * 0.75, 0, 0, 2 * Math.PI);
    ctx.fill();
  });
  ctx.restore();
}

/* ── Ion particles ───────────────────────────────────────── */
function spawnIon() {
  const ion = ION_TYPES[cfg.ion];
  ions.push({
    x:         ROCKET_CX - 73,
    y:         ROCKET_CY + (Math.random() - 0.5) * 8,
    vx:        ion.speed * (0.88 + Math.random() * 0.24),
    r:         ion.r,
    g:         ion.g,
    b:         ion.b,
    streakLen: ion.streakLen * (0.8 + Math.random() * 0.4),
  });
  drifting   = true;
  ionTotalP += ion.pUnit;
}

function drawIon(p) {
  // Particle moves left; streak trails rightward from the head
  const tailX = p.x + p.streakLen;
  ctx.save();

  // Streak — gradient line fading to transparent
  const grad = ctx.createLinearGradient(p.x, p.y, tailX, p.y);
  grad.addColorStop(0, `rgb(${p.r},${p.g},${p.b})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth   = 1.5;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(tailX, p.y);
  ctx.stroke();

  // Particle head
  ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI);
  ctx.fill();

  // Soft glow halo
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 6);
  halo.addColorStop(0, `rgba(${p.r},${p.g},${p.b},0.7)`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/* ── Solar photon ────────────────────────────────────────── */
// Photon travels rightward from off-screen left.
// On reaching the sail it either vanishes (absorb) or reverses (reflect).
// { x, y, vx, sailY, hit: false, done: false }
// sailY is the random impact y; we lock onto it as the photon arrives.
const PHOTON_SPAWN_X = -20;
const PHOTON_EXIT_X  = CW + 20;
const WAVE_LEN       = 22;    // px per full wave cycle
const WAVE_AMP       = 5;     // px amplitude of sine trail

function spawnPhoton() {
  const sailHalfH = CH / 2 - 4;
  const sailY     = ROCKET_CY + (Math.random() * 2 - 1) * sailHalfH * 0.92;
  solarPhoton = {
    x:    PHOTON_SPAWN_X,
    y:    sailY,
    vx:   PHOTON_SPEED,
    sailY,
    hit:  false,   // true once it reaches the sail
    done: false,   // true once it exits canvas (absorb: at sail, reflect: at right edge)
  };
  solarPhotonRef = true;
  solarCooldown  = SOLAR_COOLDOWN;
  drifting = true;
}

function drawPhoton(p) {
  if (!p || p.done) return;
  ctx.save();

  // ── Wave trail (sinusoidal, trailing behind head) ─────────
  // For rightward travel: trail extends leftward from head.
  // For reflected (leftward): trail extends rightward from head.
  const trailDir  = p.vx > 0 ? -1 : 1;   // which side the trail falls on
  const trailLen  = 60;
  const STEPS     = 40;

  const wavePhase = simTime * 10;   // rad/s — controls how fast crests travel
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const t  = i / STEPS;
    const tx = p.x + trailDir * trailLen * t;
    const ty = p.y + Math.sin((t * trailLen / WAVE_LEN) * 2 * Math.PI - wavePhase) * WAVE_AMP;
    if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
  }
  const grad = ctx.createLinearGradient(p.x, p.y,
                                        p.x + trailDir * trailLen, p.y);
  grad.addColorStop(0,   'rgba(255,230,80,0.7)');
  grad.addColorStop(0.5, 'rgba(255,200,30,0.3)');
  grad.addColorStop(1,   'rgba(255,180,0,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth   = 1.8;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // ── Photon head ───────────────────────────────────────────
  ctx.fillStyle = '#ffe040';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
  ctx.fill();

  // Glow halo
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 10);
  halo.addColorStop(0, 'rgba(255,230,80,0.8)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 10, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/* ── Main draw ───────────────────────────────────────────── */
function draw() {
  drawBackground();
  drawStars();
  if (cfg.mode === 'rocket') {
    blobs.forEach(drawBlob);
    drawRocket(ROCKET_CX, ROCKET_CY);
  } else if (cfg.mode === 'ion') {
    ions.forEach(drawIon);
    drawStorlunk(ROCKET_CX, ROCKET_CY);
  } else {
    if (solarPhoton) drawPhoton(solarPhoton);
    drawDaedalus(ROCKET_CX, ROCKET_CY);
  }
  drawVectors();
}

/* ── Animation loop ──────────────────────────────────────── */
function loop(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs   = ts;
  simTime += dt;

  // Star drift — both modes use the same world-drift visual
  if (drifting) {
    stars.forEach(s => {
      s.x += STAR_DRIFT * dt;
      if (s.x <  0)  s.x += CW;
      if (s.x > CW)  s.x -= CW;
    });
  }

  if (cfg.mode === 'rocket') {
    blobs.forEach(b => {
      b.x += b.vx * dt;
      if (drifting) b.x += STAR_DRIFT * dt;
    });
    blobs = blobs.filter(b => b.x > -b.r * 2);

    if (cooldownRemaining > 0) {
      cooldownRemaining = Math.max(0, cooldownRemaining - dt);
      updateFireBtn();
    }
  } else {
    ions.forEach(p => {
      p.x += p.vx * dt;
      if (drifting) p.x += STAR_DRIFT * dt;
    });
    ions = ions.filter(p => p.x > -p.streakLen - 10);

    if (ionFiring) {
      ionAccum += dt;
      while (ionAccum >= ION_INTERVAL) {
        spawnIon();
        ionAccum -= ION_INTERVAL;
      }
    }
  }

  if (cfg.mode === 'solar') {
    // Advance photon
    if (solarPhoton && !solarPhoton.done) {
      solarPhoton.x += solarPhoton.vx * dt;
      if (drifting) solarPhoton.x += STAR_DRIFT * dt;

      if (!solarPhoton.hit && solarPhoton.vx > 0 && solarPhoton.x >= ROCKET_CX) {
        // Reached the sail
        solarPhoton.hit = true;
        if (cfg.sail === 'absorb') {
          solarPhoton  = null;
          solarTotalP += SOLAR_P_UNIT;
        } else {
          solarPhoton.vx = -PHOTON_SPEED;   // reflect leftward; photon keeps animating
          solarTotalP   += SOLAR_P_UNIT * 2;
        }
        updateFireBtn();
      }

      // Cull reflected photon once it exits left edge
      if (solarPhoton && solarPhoton.vx < 0 && solarPhoton.x < PHOTON_SPAWN_X) {
        solarPhoton = null;
      }
    }

    if (solarCooldown > 0) {
      solarCooldown = Math.max(0, solarCooldown - dt);
      updateFireBtn();
    }
  }

  draw();
  requestAnimationFrame(loop);
}

/* ── Controls ────────────────────────────────────────────── */

// Reset — re-runs setMode to wipe everything and re-init
document.getElementById('btn-reset').addEventListener('click', () => {
  setMode(cfg.mode);
});

// Fire — click for rocket and solar, hold for ion
fireBtn.addEventListener('click', () => {
  if (cfg.mode === 'solar') {
    if (solarCooldown > 0 || solarPhoton !== null) return;
    spawnPhoton();
    updateFireBtn();
    return;
  }
  if (cfg.mode !== 'rocket') return;
  if (cooldownRemaining > 0) return;

  const r = 14 + Math.random() * 7;
  blobs.push({
    x:     ROCKET_CX - 143,
    y:     ROCKET_CY + (Math.random() - 0.5) * 10,
    vx:    BLOB_SPEED * (0.88 + Math.random() * 0.24),
    r,
    alpha: 0.88 + Math.random() * 0.12,
    puffs: Array.from({ length: 6 }, () => ({
      dx:    (Math.random() - 0.65) * r * 1.6,
      dy:    (Math.random() - 0.5)  * r * 0.7,
      rs:    0.4  + Math.random() * 0.55,
      heat:  Math.random(),
      elong: 0.3  + Math.random() * 0.7,
    })),
  });
  drifting = true;
  fireCount++;
  cooldownRemaining = COOLDOWN;
  updateFireBtn();
});

fireBtn.addEventListener('mousedown', () => {
  if (cfg.mode !== 'ion') return;
  ionFiring = true;
  ionAccum  = ION_INTERVAL;   // fire on very first frame
});

const stopIon = () => { ionFiring = false; ionAccum = 0; };
fireBtn.addEventListener('mouseup',    stopIon);
fireBtn.addEventListener('mouseleave', stopIon);
fireBtn.addEventListener('touchstart', e => {
  if (cfg.mode !== 'ion') return;
  e.preventDefault();
  ionFiring = true;
  ionAccum  = ION_INTERVAL;
}, { passive: false });
fireBtn.addEventListener('touchend', stopIon);

// Mode selector
document.querySelectorAll('#seg-mode .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled || btn.dataset.val === cfg.mode) return;
    setMode(btn.dataset.val);
  });
});

// Ion species selector — changing species resets the simulation
document.querySelectorAll('#seg-ion .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.val === cfg.ion) return;
    cfg.ion = btn.dataset.val;
    document.querySelectorAll('#seg-ion .seg-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setMode('ion');
  });
});

// Sail type selector — changing type resets the simulation
document.querySelectorAll('#seg-sail .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.val === cfg.sail) return;
    cfg.sail = btn.dataset.val;
    document.querySelectorAll('#seg-sail .seg-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setMode('solar');
  });
});

// Momentum vectors toggle
document.querySelectorAll('#seg-vectors .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.showVectors = btn.dataset.val === 'show';
    document.querySelectorAll('#seg-vectors .seg-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

/* ── Boot ────────────────────────────────────────────────── */
initStars();
requestAnimationFrame(loop);
