'use strict';

/* ═══════════════════════════════════════════════════════════
   CANVAS
   ═══════════════════════════════════════════════════════════ */

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
const CW = 800, CH = 800;
canvas.width  = CW;
canvas.height = CH;

/* ═══════════════════════════════════════════════════════════
   PHYSICS CONSTANTS

   All units pixel-based. GM tuned so orbital periods feel
   playable at our visual scale.
     v = √(GM/r),  T = 2π r^(3/2) / √GM
   ═══════════════════════════════════════════════════════════ */

const EARTH_R       = 22;      // draw radius (= 1 "Earth radius")
const MOON_R        = 7;
const R_MOON_ORBIT  = 350;     // Moon's orbit around Earth (moon mode)

// GEO is at 6.62 Earth radii (real ratio) → 146 px
// LEO starting orbit visually raised to 40 px (would be ~24 for true LEO,
// but 40 is clearer to fly in).
const R_LEO  = 40;
const R_GEO  = 146;

const GM_EARTH = 13566;
const GM_MOON  = GM_EARTH / 8;   // boosted from real 81:1 for game-scale

// Moon orbital period
const T_MOON = 2 * Math.PI * Math.pow(R_MOON_ORBIT, 1.5) / Math.sqrt(GM_EARTH);
// Geostationary period (= Earth rotation period — by definition)
const T_GEO  = 2 * Math.PI * Math.pow(R_GEO, 1.5) / Math.sqrt(GM_EARTH);
const OMEGA_EARTH = 2 * Math.PI / T_GEO;

// Rocket
const THRUST_ACC   = 30;
const ROTATE_SPEED = 3.0;
const TRAIL_MAX    = 600;

/* ═══════════════════════════════════════════════════════════
   MODES
   ═══════════════════════════════════════════════════════════ */

const MODES = {
  geo: {
    hasMoon:    false,
    startR:     R_LEO,
    title:      'Geostationary Transfer',
    intro:      'You\u2019re in a low equatorial orbit. Transfer to geostationary altitude ' +
                'using as little \u0394v as possible. WASD to fly.',
    startMsg:   'Press W to thrust prograde. Raise your orbit to the white GEO ring.',
    readoutLabels: ['Eccentricity', 'Semi-major axis'],
  },
  moon: {
    hasMoon:    true,
    startR:     70,   // slightly higher LEO for moon mode
    title:      'Moon Shot',
    intro:      'You\u2019re in low Earth orbit. Transfer to the Moon and attempt a capture ' +
                'orbit. Both Earth and Moon gravity act on you.',
    startMsg:   'Press W to thrust prograde and raise your orbit toward the Moon.',
    readoutLabels: ['Nearest body', 'Dist to Moon'],
  },
};

let currentMode = 'geo';
const mode = () => MODES[currentMode];

/* ═══════════════════════════════════════════════════════════
   STARS
   ═══════════════════════════════════════════════════════════ */

const STARS = Array.from({length: 200}, () => ({
  x: Math.random() * CW,
  y: Math.random() * CH,
  r: Math.random() * 1.2 + 0.3,
  a: Math.random() * 0.5 + 0.3,
}));

/* ═══════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════ */

const earth  = { x: CW / 2, y: CH / 2, angle: 0 };
const moon   = { x: 0, y: 0, angle: 0 };
const rocket = { x: 0, y: 0, vx: 0, vy: 0, heading: 0, trail: [] };

let totalDv = 0;
let simTime = 0;

const keys = {};
const medals = { bronze: false, silver: false, gold: false };

// Shared tracking
const winTrack = {
  // Moon mode
  moonOrbitAngle: 0,
  lastMoonAngle:  null,
  moonOrbitRmin:  Infinity,
  moonOrbitRmax:  0,
  // GEO mode
  maxR:           0,
};

/* ═══════════════════════════════════════════════════════════
   INIT / RESET
   ═══════════════════════════════════════════════════════════ */

function initState() {
  // Moon (only relevant in moon mode)
  moon.angle = 0;
  moon.x     = earth.x + R_MOON_ORBIT;
  moon.y     = earth.y;

  earth.angle = 0;

  // Rocket in circular starting orbit
  const r0 = mode().startR;
  const v0 = Math.sqrt(GM_EARTH / r0);
  rocket.x       = earth.x;
  rocket.y       = earth.y - r0;
  rocket.vx      = v0;   // moving right = prograde (matches Earth rotation: counterclockwise in canvas)
  rocket.vy      = 0;
  rocket.heading = 0;
  rocket.trail   = [];

  totalDv = 0;
  simTime = 0;

  Object.assign(winTrack, {
    moonOrbitAngle: 0, lastMoonAngle: null,
    moonOrbitRmin: Infinity, moonOrbitRmax: 0,
    maxR: 0,
  });

  medals.bronze = false;
  medals.silver = false;
  medals.gold   = false;

  setMsg(mode().startMsg);
  updateUI();
}

/* ═══════════════════════════════════════════════════════════
   PHYSICS
   ═══════════════════════════════════════════════════════════ */

function stepPhysics(dt) {
  // Earth rotation (for visual ground marker)
  earth.angle += OMEGA_EARTH * dt;

  // Moon (moon mode only)
  if (mode().hasMoon) {
    moon.angle += (2 * Math.PI / T_MOON) * dt;
    moon.x = earth.x + Math.cos(moon.angle) * R_MOON_ORBIT;
    moon.y = earth.y + Math.sin(moon.angle) * R_MOON_ORBIT;
  }

  // Earth gravity
  let dx = earth.x - rocket.x, dy = earth.y - rocket.y;
  let r2 = dx * dx + dy * dy;
  let r  = Math.sqrt(r2);
  let a  = GM_EARTH / r2;
  rocket.vx += (dx / r) * a * dt;
  rocket.vy += (dy / r) * a * dt;

  // Moon gravity
  if (mode().hasMoon) {
    dx = moon.x - rocket.x; dy = moon.y - rocket.y;
    r2 = dx * dx + dy * dy;
    r  = Math.sqrt(r2);
    a  = GM_MOON / r2;
    rocket.vx += (dx / r) * a * dt;
    rocket.vy += (dy / r) * a * dt;
  }

  // Thrust
  let thrusting = false;
  if (keys['KeyA'] || keys['ArrowLeft'])  rocket.heading -= ROTATE_SPEED * dt;
  if (keys['KeyD'] || keys['ArrowRight']) rocket.heading += ROTATE_SPEED * dt;

  if (keys['KeyW'] || keys['ArrowUp']) {
    rocket.vx += Math.cos(rocket.heading) * THRUST_ACC * dt;
    rocket.vy += Math.sin(rocket.heading) * THRUST_ACC * dt;
    totalDv   += THRUST_ACC * dt;
    thrusting  = true;
  }
  if (keys['KeyS'] || keys['ArrowDown']) {
    rocket.vx -= Math.cos(rocket.heading) * THRUST_ACC * dt;
    rocket.vy -= Math.sin(rocket.heading) * THRUST_ACC * dt;
    totalDv   += THRUST_ACC * dt;
    thrusting  = true;
  }
  rocket._thrusting = thrusting;

  // Integrate
  rocket.x += rocket.vx * dt;
  rocket.y += rocket.vy * dt;

  // Trail
  rocket.trail.push({x: rocket.x, y: rocket.y, thrust: thrusting});
  if (rocket.trail.length > TRAIL_MAX) rocket.trail.shift();

  // Collisions
  const rEarth = Math.hypot(rocket.x - earth.x, rocket.y - earth.y);
  if (rEarth < EARTH_R) {
    setMsg('Crashed into Earth! Press R to reset.');
    initState();
    return;
  }
  if (mode().hasMoon) {
    const rMoon = Math.hypot(rocket.x - moon.x, rocket.y - moon.y);
    if (rMoon < MOON_R) {
      setMsg('Crashed into the Moon! Press R to reset.');
      initState();
      return;
    }
  }

  simTime += dt;
}

/* ═══════════════════════════════════════════════════════════
   ORBITAL ELEMENTS (for GEO mode)

   Given position r and velocity v relative to Earth:
     ε = v²/2 − GM/r        (specific orbital energy)
     a = −GM/(2ε)           (semi-major axis; only valid for bound orbits)
     h = r × v              (specific angular momentum, 2D scalar)
     e = √(1 + 2εh²/GM²)    (eccentricity)
   h positive → counterclockwise (prograde here).
   ═══════════════════════════════════════════════════════════ */

function computeOrbitalElements() {
  const rx = rocket.x - earth.x, ry = rocket.y - earth.y;
  const r  = Math.hypot(rx, ry);
  const v2 = rocket.vx * rocket.vx + rocket.vy * rocket.vy;
  const eps = v2 / 2 - GM_EARTH / r;

  const h = rx * rocket.vy - ry * rocket.vx;  // z-component of r × v

  if (eps >= 0) {
    return { bound: false, r, h };  // hyperbolic/parabolic escape
  }

  const a = -GM_EARTH / (2 * eps);
  const eSq = 1 + (2 * eps * h * h) / (GM_EARTH * GM_EARTH);
  const e = Math.sqrt(Math.max(0, eSq));
  return { bound: true, a, e, h, r };
}

/* ═══════════════════════════════════════════════════════════
   WIN DETECTION
   ═══════════════════════════════════════════════════════════ */

function checkWinConditions() {
  if (currentMode === 'geo') checkGeoWins();
  else                       checkMoonWins();
}

function checkGeoWins() {
  const rEarth = Math.hypot(rocket.x - earth.x, rocket.y - earth.y);
  if (rEarth > winTrack.maxR) winTrack.maxR = rEarth;

  // Bronze: reach GEO altitude (within 10%)
  if (!medals.bronze && winTrack.maxR >= R_GEO * 0.9) {
    medals.bronze = true;
    setMsg('Bronze! Reached GEO altitude. Now circularize for Silver.');
    updateUI();
  }

  // Silver / Gold — only evaluate when coasting (no thrust)
  if (rocket._thrusting) return;

  const el = computeOrbitalElements();
  if (!el.bound) return;

  const aErr = Math.abs(el.a - R_GEO) / R_GEO;

  // Silver: circular near GEO (within 15% of a, e < 0.2)
  if (!medals.silver && aErr < 0.15 && el.e < 0.2) {
    medals.silver = true;
    medals.bronze = true;   // award bronze implicitly
    setMsg('Silver! Near-GEO circular orbit. \u0394v: ' + Math.round(totalDv) +
           '. For Gold: tighten to a true geostationary orbit.');
    updateUI();
  }

  // Gold: true geostationary — prograde (h > 0), e < 0.05, a within 5% of GEO
  if (medals.silver && !medals.gold && el.h > 0 && aErr < 0.05 && el.e < 0.05) {
    medals.gold = true;
    setMsg('GOLD! Geostationary orbit locked. Total \u0394v: ' +
           Math.round(totalDv) + ' m/s. Perfect Hohmann \u2248 8.');
    updateUI();
  }
}

function checkMoonWins() {
  const rMoon  = Math.hypot(rocket.x - moon.x, rocket.y - moon.y);
  const rEarth = Math.hypot(rocket.x - earth.x, rocket.y - earth.y);

  if (!medals.silver) {
    // Track sweep angle around Moon when close to it
    if (rMoon < 120) {
      const angle = Math.atan2(rocket.y - moon.y, rocket.x - moon.x);
      if (winTrack.lastMoonAngle !== null) {
        let da = angle - winTrack.lastMoonAngle;
        while (da >  Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        winTrack.moonOrbitAngle += da;
        if (rMoon < winTrack.moonOrbitRmin) winTrack.moonOrbitRmin = rMoon;
        if (rMoon > winTrack.moonOrbitRmax) winTrack.moonOrbitRmax = rMoon;
      }
      winTrack.lastMoonAngle = angle;

      if (Math.abs(winTrack.moonOrbitAngle) >= 2 * Math.PI) {
        if (!medals.bronze) {
          medals.bronze = true;
          setMsg('Bronze! You completed a lunar orbit. Circularize for Silver.');
          updateUI();
        }
        const ecc = (winTrack.moonOrbitRmax - winTrack.moonOrbitRmin) /
                    (winTrack.moonOrbitRmax + winTrack.moonOrbitRmin);
        if (ecc < 0.3) {
          medals.silver = true;
          setMsg('Silver! Circular lunar orbit achieved! For Gold: escape and return to Earth orbit.');
          updateUI();
        }
        winTrack.moonOrbitAngle = 0;
        winTrack.moonOrbitRmin  = Infinity;
        winTrack.moonOrbitRmax  = 0;
      }
    } else {
      winTrack.lastMoonAngle  = null;
      winTrack.moonOrbitAngle = 0;
      winTrack.moonOrbitRmin  = Infinity;
      winTrack.moonOrbitRmax  = 0;
    }
  }

  // Gold: return to near Earth orbit (bound) after Silver
  if (medals.silver && !medals.gold) {
    if (rEarth < 100 && rEarth > EARTH_R + 5) {
      const speed = Math.hypot(rocket.vx, rocket.vy);
      const vEsc  = Math.sqrt(2 * GM_EARTH / rEarth);
      if (speed < vEsc * 0.95) {
        medals.gold = true;
        setMsg('GOLD! Free-return trajectory complete! Total \u0394v: ' +
               Math.round(totalDv) + ' m/s');
        updateUI();
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   DRAWING
   ═══════════════════════════════════════════════════════════ */

function drawStars() {
  STARS.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.fill();
  });
}

function drawEarth() {
  const {x, y} = earth;

  // Glow
  const glow = ctx.createRadialGradient(x, y, EARTH_R * 0.8, x, y, EARTH_R * 3);
  glow.addColorStop(0, 'rgba(59,130,246,0.15)');
  glow.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, EARTH_R * 3, 0, Math.PI * 2);
  ctx.fill();

  // Body
  const grad = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, EARTH_R);
  grad.addColorStop(0, '#5b9bff');
  grad.addColorStop(0.6, '#2563eb');
  grad.addColorStop(1, '#1e3a8a');
  ctx.beginPath();
  ctx.arc(x, y, EARTH_R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Rotating landmass blobs (visible rotation cue)
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(earth.angle);
  ctx.fillStyle = 'rgba(34,197,94,0.55)';
  // Three landmass blobs at fixed angular positions
  drawBlob( 12,  -4,  7);
  drawBlob( -6,  10,  6);
  drawBlob(-14,  -6,  5);
  ctx.restore();

  // Ground reference marker (GEO mode only)
  if (currentMode === 'geo') {
    const gx = x + Math.cos(earth.angle - Math.PI / 2) * EARTH_R;
    const gy = y + Math.sin(earth.angle - Math.PI / 2) * EARTH_R;

    // Radial line out to beyond GEO ring
    const fx = x + Math.cos(earth.angle - Math.PI / 2) * (R_GEO + 25);
    const fy = y + Math.sin(earth.angle - Math.PI / 2) * (R_GEO + 25);
    ctx.save();
    ctx.strokeStyle = 'rgba(239,68,68,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Red dot marker
    ctx.beginPath();
    ctx.arc(gx, gy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
  }

  // Label
  ctx.font         = 'bold 9px "Trebuchet MS",sans-serif';
  ctx.fillStyle    = 'rgba(255,255,255,0.5)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Earth', x, y + EARTH_R + 5);
}

// Helper — draws a soft blob at (cx,cy) (relative to current transform)
function drawBlob(cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawMoon() {
  const {x, y} = moon;

  const glow = ctx.createRadialGradient(x, y, MOON_R * 0.6, x, y, MOON_R * 2.5);
  glow.addColorStop(0, 'rgba(209,213,219,0.12)');
  glow.addColorStop(1, 'rgba(209,213,219,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, MOON_R * 2.5, 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, MOON_R);
  grad.addColorStop(0, '#e5e7eb');
  grad.addColorStop(0.7, '#9ca3af');
  grad.addColorStop(1, '#6b7280');
  ctx.beginPath();
  ctx.arc(x, y, MOON_R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.font         = 'bold 9px "Trebuchet MS",sans-serif';
  ctx.fillStyle    = 'rgba(255,255,255,0.4)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Moon', x, y + MOON_R + 4);
}

function drawRing(r, color, dash = [3, 5], width = 1) {
  ctx.beginPath();
  ctx.arc(earth.x, earth.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth   = width;
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTrail() {
  if (rocket.trail.length < 2) return;
  for (let i = 1; i < rocket.trail.length; i++) {
    const a = rocket.trail[i - 1], b = rocket.trail[i];
    const alpha = (i / rocket.trail.length) * 0.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = b.thrust
      ? `rgba(251,191,36,${alpha})`
      : `rgba(56,189,248,${alpha * 0.5})`;
    ctx.lineWidth = b.thrust ? 2 : 1;
    ctx.stroke();
  }
}

function drawRocket() {
  const {x, y, heading} = rocket;
  const thrusting = keys['KeyW'] || keys['ArrowUp'];
  const braking   = keys['KeyS'] || keys['ArrowDown'];

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);

  if (thrusting) {
    ctx.beginPath();
    ctx.moveTo(-8, -3);
    ctx.lineTo(-14 - Math.random() * 6, 0);
    ctx.lineTo(-8, 3);
    ctx.closePath();
    ctx.fillStyle = `rgba(251,191,36,${0.6 + Math.random() * 0.4})`;
    ctx.fill();
  }
  if (braking) {
    ctx.beginPath();
    ctx.moveTo(8, -2);
    ctx.lineTo(12 + Math.random() * 4, 0);
    ctx.lineTo(8, 2);
    ctx.closePath();
    ctx.fillStyle = `rgba(248,113,113,${0.5 + Math.random() * 0.3})`;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-6, -5);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.strokeStyle = '#0ea5e9';
  ctx.lineWidth   = 1;
  ctx.stroke();

  ctx.restore();
}

/* ═══════════════════════════════════════════════════════════
   ORBIT PREDICTOR
   ═══════════════════════════════════════════════════════════ */

const PRED_STEPS = 2400;
const PRED_DT    = 0.04;

function computePrediction() {
  let px = rocket.x,  py = rocket.y;
  let pvx = rocket.vx, pvy = rocket.vy;
  let mAngle = moon.angle;

  const pts = [];
  const hasMoon = mode().hasMoon;
  for (let i = 0; i < PRED_STEPS; i++) {
    let dx, dy, r2, r, a;

    if (hasMoon) {
      mAngle += (2 * Math.PI / T_MOON) * PRED_DT;
      const mx = earth.x + Math.cos(mAngle) * R_MOON_ORBIT;
      const my = earth.y + Math.sin(mAngle) * R_MOON_ORBIT;

      dx = mx - px; dy = my - py;
      r2 = dx * dx + dy * dy;
      r  = Math.sqrt(r2);
      if (r < MOON_R) break;
      a  = GM_MOON / r2;
      pvx += (dx / r) * a * PRED_DT;
      pvy += (dy / r) * a * PRED_DT;
    }

    dx = earth.x - px; dy = earth.y - py;
    r2 = dx * dx + dy * dy;
    r  = Math.sqrt(r2);
    if (r < EARTH_R) break;
    a  = GM_EARTH / r2;
    pvx += (dx / r) * a * PRED_DT;
    pvy += (dy / r) * a * PRED_DT;

    px += pvx * PRED_DT;
    py += pvy * PRED_DT;

    if (i % 3 === 0) pts.push({x: px, y: py});
  }
  return pts;
}

function drawPrediction(pts) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1;
  for (let i = 1; i < pts.length; i++) {
    const alpha = 0.35 * (1 - i / pts.length);
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/* ═══════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════ */

function render() {
  ctx.fillStyle = '#080c14';
  ctx.fillRect(0, 0, CW, CH);

  drawStars();

  // Starting-orbit ring
  drawRing(mode().startR, 'rgba(56,189,248,0.15)', [3, 5], 1);

  if (currentMode === 'geo') {
    // GEO target ring — highlight
    drawRing(R_GEO, 'rgba(255,255,255,0.35)', [6, 4], 1.5);
  } else {
    // Moon's orbit
    drawRing(R_MOON_ORBIT, 'rgba(255,255,255,0.06)', [4, 6], 1);
  }

  const predPts = computePrediction();
  drawPrediction(predPts);

  drawEarth();
  if (mode().hasMoon) drawMoon();
  drawTrail();
  drawRocket();
}

/* ═══════════════════════════════════════════════════════════
   HUD
   ═══════════════════════════════════════════════════════════ */

function updateUI() {
  document.getElementById('dv-value').textContent = Math.round(totalDv);

  const rE  = Math.hypot(rocket.x - earth.x, rocket.y - earth.y);
  const spd = Math.hypot(rocket.vx, rocket.vy);

  document.getElementById('r-alt').textContent   = Math.round(rE - EARTH_R) + ' km';
  document.getElementById('r-speed').textContent = Math.round(spd) + ' m/s';

  const [lbl3, lbl4] = mode().readoutLabels;
  document.getElementById('r-label-3').textContent = lbl3;
  document.getElementById('r-label-4').textContent = lbl4;

  if (currentMode === 'geo') {
    const el = computeOrbitalElements();
    if (el.bound) {
      document.getElementById('r-val-3').textContent = el.e.toFixed(3);
      document.getElementById('r-val-4').textContent = Math.round(el.a) + ' km';
    } else {
      document.getElementById('r-val-3').textContent = 'escaping';
      document.getElementById('r-val-4').textContent = '—';
    }
  } else {
    const rM = Math.hypot(rocket.x - moon.x, rocket.y - moon.y);
    document.getElementById('r-val-3').textContent = rM < rE ? 'Moon' : 'Earth';
    document.getElementById('r-val-4').textContent = Math.round(rM) + ' km';
  }

  // Status
  const st = document.getElementById('status-text');
  if (currentMode === 'geo') {
    if      (rE < R_LEO * 1.4) st.textContent = 'In low Earth orbit';
    else if (Math.abs(rE - R_GEO) < 20) st.textContent = 'At GEO altitude';
    else if (rE < R_GEO)       st.textContent = 'Transfer in progress';
    else                        st.textContent = 'Above GEO';
  } else {
    const rM = Math.hypot(rocket.x - moon.x, rocket.y - moon.y);
    if      (rM < 80)  st.textContent = 'Near the Moon';
    else if (rE < 120) st.textContent = 'Near Earth';
    else                st.textContent = 'In transit';
  }

  // Medals
  const ma = document.getElementById('medal-area');
  ma.innerHTML =
    `<div class="medal medal-bronze ${medals.bronze ? 'earned' : ''}">B</div>` +
    `<div class="medal medal-silver ${medals.silver ? 'earned' : ''}">S</div>` +
    `<div class="medal medal-gold   ${medals.gold   ? 'earned' : ''}">G</div>`;
}

/* ═══════════════════════════════════════════════════════════
   MODE SWITCH
   ═══════════════════════════════════════════════════════════ */

function setMode(name) {
  if (!MODES[name] || name === currentMode) return;
  currentMode = name;

  // Button styling
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === name);
  });

  // Title + intro
  document.getElementById('mode-title').textContent = mode().title;
  document.getElementById('mode-intro').textContent = mode().intro;

  initState();
}

/* ═══════════════════════════════════════════════════════════
   GAME LOOP
   ═══════════════════════════════════════════════════════════ */

const PHYSICS_DT  = 1 / 240;
let accumulator   = 0;
let lastTimestamp = 0;
let hudTimer      = 0;

function gameLoop(ts) {
  const frameDt = Math.min((ts - lastTimestamp) / 1000, 0.1);
  lastTimestamp = ts;
  accumulator  += frameDt;
  hudTimer     += frameDt;

  while (accumulator >= PHYSICS_DT) {
    stepPhysics(PHYSICS_DT);
    accumulator -= PHYSICS_DT;
  }

  checkWinConditions();
  render();

  if (hudTimer > 0.15) {
    updateUI();
    hudTimer = 0;
  }

  requestAnimationFrame(gameLoop);
}

/* ═══════════════════════════════════════════════════════════
   INPUT
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR') initState();
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
});

document.addEventListener('keyup', e => {
  keys[e.code] = false;
});

/* ═══════════════════════════════════════════════════════════
   UI HOOKS
   ═══════════════════════════════════════════════════════════ */

function setMsg(txt) {
  document.getElementById('message-bar').textContent = txt || '\u00a0';
}

document.getElementById('btn-reset').addEventListener('click', initState);

document.getElementById('btn-rules').addEventListener('click', () => {
  document.getElementById('rules-modal').classList.remove('hidden');
});

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('rules-modal').classList.add('hidden');
});

document.getElementById('rules-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('rules-modal')) {
    document.getElementById('rules-modal').classList.add('hidden');
  }
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */

initState();
requestAnimationFrame(gameLoop);
