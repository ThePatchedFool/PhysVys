'use strict';

/* ═══════════════════════════════════════════════════════════
   WORLD & CANVAS SETUP
   World coordinates: x right, y up, origin = bottom-left.
   Canvas coordinates: x right, y down.
   wx(x), wy(y) convert world metres → canvas pixels.
   ═══════════════════════════════════════════════════════════ */

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
const CW     = 960;
const CH     = 480;
const offCanvas = Object.assign(document.createElement('canvas'), { width: CW, height: CH });
const octx      = offCanvas.getContext('2d');

const GROUND_PX = CH - 30;   // canvas y of the ground line (30px ground strip)
const SCALE     = 2;          // canvas pixels per metre
const G         = 9.8;        // m/s²
const WORLD_W   = CW / SCALE; // 480 m

function wx(x) { return x * SCALE; }
function wy(y) { return GROUND_PX - y * SCALE; }   // flip y axis

/* ═══════════════════════════════════════════════════════════
   BUILDINGS
   8 buildings, 36 m wide, 18 m gaps (step = 54 m).
   Left margin = (480 − 8×36 − 7×18) / 2 = 33 m.
   ═══════════════════════════════════════════════════════════ */

const NUM_BLDG   = 8;
const BLDG_W     = 36;   // metres
const BLDG_GAP   = 18;
const BLDG_STEP  = BLDG_W + BLDG_GAP;                             // 54 m
const BLDG_LEFT  = (WORLD_W - NUM_BLDG * BLDG_W - (NUM_BLDG - 1) * BLDG_GAP) / 2; // 33 m

const PLAYER_BLDG = 1;   // gorilla positions (building index, 0-based)
const AI_BLDG     = 6;

// Building gorilla-center x positions (metres):
//   player: 33 + 1×54 + 18 = 105 m
//   AI:     33 + 6×54 + 18 = 375 m
//   horizontal gap ≈ 270 m  → range formula at v=52, θ=45°: R=276 m (slight overshoot)

let buildings = [];  // [{x, width, height, windows:[boolean[]]}]
let wind      = 0;   // m/s² horizontal acceleration (positive = rightward)

function generateBuildings() {
  buildings = [];
  for (let i = 0; i < NUM_BLDG; i++) {
    const x = BLDG_LEFT + i * BLDG_STEP;
    const h = 22 + Math.random() * 70;    // 22–92 m
    const numRows = Math.floor((h * SCALE - 14) / 15);
    const windows = [];
    for (let r = 0; r < numRows; r++) {
      windows.push([Math.random() < 0.6, Math.random() < 0.6, Math.random() < 0.6]);
    }
    buildings.push({ x, width: BLDG_W, height: h, windows, craters: [] });
  }
  wind = (Math.random() * 6 - 3);   // −3 to +3 m/s²
  updateWindDisplay();
}

function bldgCenter(i) {
  return buildings[i].x + buildings[i].width / 2;
}

/* ═══════════════════════════════════════════════════════════
   STARS  (generated once, stable across rounds)
   ═══════════════════════════════════════════════════════════ */

const STARS = Array.from({ length: 90 }, () => ({
  x: Math.random() * CW,
  y: Math.random() * (GROUND_PX - 150),
  r: Math.random() * 1.2 + 0.3,
  a: Math.random() * 0.5 + 0.4,
}));

/* ═══════════════════════════════════════════════════════════
   GAME STATE
   ═══════════════════════════════════════════════════════════ */

const MAX_ROUNDS = 5;

let phase    = 'aim';    // 'aim' | 'flying' | 'exploding' | 'gameover'
let turn     = 0;        // 0 = player, 1 = AI
let scores   = [0, 0];
let round    = 1;
let banana   = null;
let explosion = null;

/* ═══════════════════════════════════════════════════════════
   TRAJECTORY PREVIEW
   Recomputed whenever controls change; drawn as a dashed arc.
   ═══════════════════════════════════════════════════════════ */

let previewPts = [];   // [{x,y}] in world metres

function computePreview() {
  if (phase !== 'aim' || turn !== 0) { previewPts = []; return; }

  const angleDeg = parseFloat(elAngle.value);
  const speed    = parseFloat(elSpeed.value);
  const rad = angleDeg * Math.PI / 180;
  const bldg = buildings[PLAYER_BLDG];
  let x  = bldg.x + bldg.width / 2;
  let y  = bldg.height + 3;   // launch from gorilla's hand
  let vx = speed * Math.cos(rad);
  let vy = speed * Math.sin(rad);
  const dt = 0.05;

  previewPts = [{ x, y }];
  for (let step = 0; step < 1200; step++) {
    vx += wind * dt;
    vy -= G * dt;
    x  += vx * dt;
    y  += vy * dt;

    if (x < -10 || x > WORLD_W + 10 || y < -5) break;
    let blocked = false;
    for (const b of buildings) {
      if (x >= b.x && x <= b.x + b.width && y <= b.height) { blocked = true; break; }
    }
    if (blocked) break;
    previewPts.push({ x, y });
  }
}

/* ═══════════════════════════════════════════════════════════
   BANANA  (projectile)
   ═══════════════════════════════════════════════════════════ */

const TRAIL_LEN  = 30;
const HIT_RADIUS = 6;   // metres — collision radius for gorilla hit

function launchBanana(fromBldg, angleDeg, speed) {
  const bldg = buildings[fromBldg];
  const dir  = fromBldg === PLAYER_BLDG ? 1 : -1;
  const rad  = angleDeg * Math.PI / 180;
  banana = {
    x: bldg.x + bldg.width / 2,
    y: bldg.height + 3,          // launch from gorilla hand height
    vx: dir * speed * Math.cos(rad),
    vy: speed * Math.sin(rad),
    rot: 0,
    trail: [],
    thrower: fromBldg,
    hitBldgIdx: -1,  // which building it hit (-1 = didn't hit a building)
  };
}

const DT = 1 / 60;

function stepBanana() {
  if (!banana) return;

  // Record trail
  banana.trail.push({ x: banana.x, y: banana.y });
  if (banana.trail.length > TRAIL_LEN) banana.trail.shift();

  // Integrate
  banana.vx  += wind * DT;
  banana.vy  -= G    * DT;
  banana.x   += banana.vx * DT;
  banana.y   += banana.vy * DT;
  banana.rot += 5 * DT;   // spin ~5 rad/s

  // ── Collision: opponent gorilla? ──────────────────────────
  const oppIdx = banana.thrower === PLAYER_BLDG ? AI_BLDG : PLAYER_BLDG;
  const ob     = buildings[oppIdx];
  const gcx    = ob.x + ob.width / 2;
  const gcy    = ob.height + 3;
  const dx = banana.x - gcx, dy = banana.y - gcy;
  if (Math.hypot(dx, dy) < HIT_RADIUS) {
    triggerExplosion(banana.x, banana.y, 'gorilla', oppIdx);
    return;
  }

  // ── Collision: any building? ──────────────────────────────
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (banana.x >= b.x      && banana.x <= b.x + b.width &&
        banana.y <= b.height  && banana.y >= -5) {
      // Skip if the banana is passing through a crater
      if (b.craters.some(c => Math.hypot(banana.x - c.x, banana.y - c.y) < c.r)) continue;
      banana.hitBldgIdx = i;
      triggerExplosion(banana.x, banana.y, 'building', null);
      return;
    }
  }

  // ── Ground collision ──────────────────────────────────────
  if (banana.y <= 0 && banana.x >= 0 && banana.x <= WORLD_W) {
    triggerExplosion(banana.x, 0, 'ground', null);
    return;
  }

  // ── Out of bounds ─────────────────────────────────────────
  if (banana.x < -40 || banana.x > WORLD_W + 40 || banana.y < -30) {
    endMiss();
  }
}

/* ═══════════════════════════════════════════════════════════
   EXPLOSION
   ═══════════════════════════════════════════════════════════ */

const EXP_FRAMES    = 55;
const CRATER_RADIUS = 10;   // metres (~20 px at SCALE=2)

function triggerExplosion(x, y, type, hitIdx) {
  explosion = { x, y, frame: 0, type, hitIdx };
  phase = 'exploding';
  // Carve a crater into any nearby building (not for ground hits)
  if (type !== 'ground') {
    for (const b of buildings) {
      if (x >= b.x - CRATER_RADIUS && x <= b.x + b.width + CRATER_RADIUS &&
          y <= b.height + CRATER_RADIUS && y >= -CRATER_RADIUS) {
        b.craters.push({ x, y, r: CRATER_RADIUS });
        break;
      }
    }
  }
}

function stepExplosion() {
  if (!explosion) return;
  explosion.frame++;
  if (explosion.frame >= EXP_FRAMES) {
    const wasHit = explosion.type === 'gorilla';
    const idx    = explosion.hitIdx;
    explosion = null;
    if (wasHit) endHit(idx);
    else        endMiss();
  }
}

/* ═══════════════════════════════════════════════════════════
   TURN MANAGEMENT
   ═══════════════════════════════════════════════════════════ */

function endHit(hitIdx) {
  const playerScored = hitIdx === AI_BLDG;
  if (playerScored) {
    scores[0]++;
    setMessage('Direct hit! You scored!');
  } else {
    scores[1]++;
    setMessage('The AI got you that round.');
  }
  updateScoreDisplay();

  if (round >= MAX_ROUNDS) {
    setTimeout(finishGame, 1800);
  } else {
    round++;
    updateRoundLabel();
    setTimeout(() => {
      generateBuildings();
    
      banana = null;
      turn = 0;
      phase = 'aim';
      elFire.disabled = false;
      updateTurnIndicator();
      setMessage('New round! Your throw — adjust for the new building heights.');
    }, 2200);
  }
}

function endMiss() {
  // Feedback message for the player's throw
  if (turn === 0 && banana) {
    const targetX = bldgCenter(AI_BLDG);
    const landX   = banana.x;
    const diff    = landX - targetX;  // + = over, − = short

    if (banana.hitBldgIdx >= 0 && banana.hitBldgIdx < AI_BLDG) {
      setMessage('Blocked by a building — try a higher arc or more speed.');
    } else if (Math.abs(diff) <= 8) {
      setMessage('Very close! Fine-tune slightly.');
    } else if (diff > 0) {
      setMessage(`Over by ${Math.abs(diff).toFixed(0)} m — reduce speed or angle.`);
    } else {
      setMessage(`Short by ${Math.abs(diff).toFixed(0)} m — increase speed or angle.`);
    }
  }

  banana = null;
  turn = 1 - turn;
  updateTurnIndicator();

  if (turn === 1) {
    // AI's turn
    elFire.disabled = true;
    phase = 'aim';
    setTimeout(doAIThrow, 1200);
  } else {
    phase = 'aim';
    elFire.disabled = false;
  
  }
}

function finishGame() {
  phase = 'gameover';
  elFire.disabled = true;
  elNewGame.classList.remove('hidden');
  if (scores[0] > scores[1]) {
    setMessage('You win the match! Great physics work.');
  } else if (scores[1] > scores[0]) {
    setMessage('AI wins the match. Better luck next time!');
  } else {
    setMessage("It's a draw — well played by both sides.");
  }
}

/* ═══════════════════════════════════════════════════════════
   AI THROW
   Solves the quadratic for the launch angle needed to reach
   the player gorilla, then adds realistic noise.
   ═══════════════════════════════════════════════════════════ */

function doAIThrow() {
  const from  = buildings[AI_BLDG];
  const to    = buildings[PLAYER_BLDG];
  const fx    = from.x + from.width / 2,  fy = from.height + 3;
  const tx    = to.x   + to.width   / 2,  ty = to.height   + 3;
  const d     = Math.abs(tx - fx);          // horizontal distance (always positive)
  const dy    = ty - fy;                    // vertical offset to target

  // Solve: k·u² − d·u + (k + dy) = 0   where u = tan(θ), k = g·d²/(2v²)
  let bestAngle = 45, bestSpeed = 50;
  for (const v of [35, 42, 48, 55, 62]) {
    const k    = G * d * d / (2 * v * v);
    const disc = d * d - 4 * k * (k + dy);
    if (disc < 0) continue;
    const sqrtD = Math.sqrt(disc);
    for (const sign of [-1, 1]) {
      const u     = (d + sign * sqrtD) / (2 * k);
      const angle = Math.atan(u) * 180 / Math.PI;
      if (angle > 8 && angle < 82) {
        bestAngle = angle;
        bestSpeed = v;
        break;
      }
    }
    if (bestAngle !== 45) break;
  }

  // Add noise — roughly ±8° and ±8% speed
  const nAngle = Math.max(5, Math.min(85, bestAngle + (Math.random() * 16 - 8)));
  const nSpeed = bestSpeed * (1 + (Math.random() * 0.16 - 0.08));

  setTimeout(() => {
    setMessage(`AI fires at ${nAngle.toFixed(0)}° · ${nSpeed.toFixed(0)} m/s`);
    launchBanana(AI_BLDG, nAngle, nSpeed);
    phase = 'flying';
  }, 700);
}

/* ═══════════════════════════════════════════════════════════
   DRAWING
   ═══════════════════════════════════════════════════════════ */

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_PX);
  g.addColorStop(0,   '#4aa8e0');
  g.addColorStop(1,   '#a8d8f0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CW, GROUND_PX);
}

function drawGround() {
  const g = ctx.createLinearGradient(0, GROUND_PX, 0, CH);
  g.addColorStop(0,   '#5a9e3a');
  g.addColorStop(0.3, '#4a8a2e');
  g.addColorStop(1,   '#3a6e22');
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND_PX, CW, CH - GROUND_PX);
  ctx.strokeStyle = '#6abb44';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_PX); ctx.lineTo(CW, GROUND_PX);
  ctx.stroke();
}

function drawBuilding(b, idx) {
  const bx = wx(b.x);
  const by = wy(b.height);
  const bw = b.width * SCALE;
  const bh = b.height * SCALE;

  // Draw to offscreen canvas so we can use destination-out to punch craters.
  // destination-out correctly unions overlapping holes (unlike even-odd clipping,
  // which re-fills areas inside two craters).
  const margin = CRATER_RADIUS * SCALE + 2;
  const rx = bx - margin, ry = by - margin;
  const rw = bw + margin * 2, rh = bh + margin * 2;
  octx.clearRect(rx, ry, rw, rh);

  const baseCol =
    idx === PLAYER_BLDG ? '#4a6fa5' :
    idx === AI_BLDG     ? '#a54a6f' :
                          '#5a6e82';
  octx.fillStyle = baseCol;
  octx.fillRect(bx, by, bw, bh);

  // Left-edge highlight (sunlit side)
  octx.fillStyle = 'rgba(255,255,255,0.12)';
  octx.fillRect(bx, by, 3, bh);

  // Windows: 3 columns, pre-generated lit/dark state
  const wW = 5, wH = 7, wCols = 3;
  const xGap = (bw - wCols * wW) / (wCols + 1);
  for (let r = 0; r < b.windows.length; r++) {
    const wy_ = by + 10 + r * 15;
    if (wy_ + wH > by + bh - 6) break;
    for (let c = 0; c < wCols; c++) {
      const wx_ = bx + xGap + c * (wW + xGap);
      octx.fillStyle = b.windows[r][c]
        ? 'rgba(200, 230, 255, 0.85)'
        : 'rgba(30, 50, 80, 0.5)';
      octx.fillRect(wx_, wy_, wW, wH);
    }
  }

  // Punch craters: destination-out erases pixels.
  // fillStyle must be fully opaque — a semi-transparent fill would only
  // partially erase (destination-out scales by source alpha).
  if (b.craters.length > 0) {
    octx.globalCompositeOperation = 'destination-out';
    octx.fillStyle = '#000';
    for (const c of b.craters) {
      octx.beginPath();
      octx.arc(wx(c.x), wy(c.y), c.r * SCALE, 0, Math.PI * 2);
      octx.fill();
    }
    octx.globalCompositeOperation = 'source-over';
  }

  ctx.drawImage(offCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
}

function drawGorilla(bldgIdx) {
  const b   = buildings[bldgIdx];
  const cx  = wx(b.x + b.width / 2);
  const cy  = wy(b.height);          // canvas y of building top (= gorilla feet)
  const throwing = phase === 'flying' && banana && banana.thrower === bldgIdx;
  const facingR  = bldgIdx === PLAYER_BLDG;  // player faces right, AI faces left

  // ── Body ──────────────────────────────────────────────────
  ctx.fillStyle = '#3d2b1f';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 16, 13, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Head ──────────────────────────────────────────────────
  ctx.fillStyle = '#4e3828';
  ctx.beginPath();
  ctx.arc(cx, cy - 33, 11, 0, Math.PI * 2);
  ctx.fill();

  // Muzzle bump
  ctx.fillStyle = '#6a4a34';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 29, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Eyes ──────────────────────────────────────────────────
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(cx - 4, cy - 36, 2.8, 0, Math.PI * 2);
  ctx.arc(cx + 4, cy - 36, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(cx - 4, cy - 36, 1.4, 0, Math.PI * 2);
  ctx.arc(cx + 4, cy - 36, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // ── Nostrils ──────────────────────────────────────────────
  ctx.fillStyle = '#2a1a10';
  ctx.beginPath();
  ctx.arc(cx - 2, cy - 28, 1.1, 0, Math.PI * 2);
  ctx.arc(cx + 2, cy - 28, 1.1, 0, Math.PI * 2);
  ctx.fill();

  // ── Arms ──────────────────────────────────────────────────
  ctx.strokeStyle = '#3d2b1f';
  ctx.lineWidth   = 9;
  ctx.lineCap     = 'round';

  if (throwing) {
    // Throwing arm extended, other arm down
    const td = facingR ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(cx + td * 12, cy - 18);
    ctx.lineTo(cx + td * 28, cy - 34);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - td * 12, cy - 18);
    ctx.lineTo(cx - td * 18, cy - 8);
    ctx.stroke();
  } else {
    // Both arms raised — classic Gorillas pose
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy - 18);
    ctx.lineTo(cx + 26, cy - 35);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy - 18);
    ctx.lineTo(cx - 26, cy - 35);
    ctx.stroke();
  }
}

function drawBanana(b) {
  ctx.save();
  ctx.translate(wx(b.x), wy(b.y));
  ctx.rotate(b.rot);

  // ── Banana body ───────────────────────────────────────────
  // Two cubic bezier curves: convex outer edge arcing upward,
  // concave inner edge hugging shallower — classic crescent shape.
  ctx.beginPath();
  ctx.moveTo(-13, 2);
  ctx.bezierCurveTo(-11, -10, 11, -10, 13, 2);   // outer (top) curve
  ctx.bezierCurveTo( 10,   6, -10,   6, -13, 2);  // inner (bottom) curve
  ctx.closePath();

  ctx.fillStyle = '#FFE135';
  ctx.fill();

  // Outline — slightly darker gold for definition
  ctx.strokeStyle = '#C8900A';
  ctx.lineWidth   = 1.3;
  ctx.stroke();

  // ── Highlight ridge along the spine ──────────────────────
  ctx.beginPath();
  ctx.moveTo(-10, -2);
  ctx.bezierCurveTo(-6, -8, 6, -8, 10, -2);
  ctx.strokeStyle = 'rgba(255, 252, 180, 0.75)';
  ctx.lineWidth   = 1.2;
  ctx.stroke();

  // ── Brown nubs at each tip ────────────────────────────────
  ctx.fillStyle = '#6B3A1F';
  ctx.beginPath();
  ctx.ellipse(-13, 2, 3, 2, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse( 13, 2, 3, 2,  0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawTrail(b) {
  for (let i = 0; i < b.trail.length; i++) {
    const t = i / b.trail.length;
    const r = 1.5 + t * 2.5;
    ctx.globalAlpha = t * 0.5;
    ctx.fillStyle   = '#FFD700';
    ctx.beginPath();
    ctx.arc(wx(b.trail[i].x), wy(b.trail[i].y), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawExplosion(e) {
  const t   = e.frame / EXP_FRAMES;
  const ecx = wx(e.x);
  const ecy = wy(e.y);
  const r   = 55 * t;

  // Radial glow
  ctx.globalAlpha = (1 - t) * 0.85;
  const g = ctx.createRadialGradient(ecx, ecy, 0, ecx, ecy, r);
  g.addColorStop(0,    '#fffde0');
  g.addColorStop(0.25, '#ffcc00');
  g.addColorStop(0.55, '#ff6600');
  g.addColorStop(1,    'rgba(200,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ecx, ecy, r, 0, Math.PI * 2);
  ctx.fill();

  // Debris particles
  ctx.globalAlpha = (1 - t) * 0.9;
  for (let i = 0; i < 10; i++) {
    const angle  = (i / 10) * Math.PI * 2;
    const pr     = r * 0.75;
    const px     = ecx + Math.cos(angle) * pr;
    const py_    = ecy + Math.sin(angle) * pr;
    const pSize  = 4 * (1 - t * 0.6);
    ctx.fillStyle = `hsl(${30 + i * 8}, 100%, 60%)`;
    ctx.beginPath();
    ctx.arc(px, py_, pSize, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawTrajectoryPreview() {
  if (previewPts.length < 3) return;
  ctx.setLineDash([4, 9]);
  ctx.strokeStyle = 'rgba(255, 220, 60, 0.3)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(wx(previewPts[0].x), wy(previewPts[0].y));
  for (let i = 1; i < previewPts.length; i++) {
    ctx.lineTo(wx(previewPts[i].x), wy(previewPts[i].y));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Landing marker
  const last = previewPts[previewPts.length - 1];
  ctx.fillStyle   = 'rgba(255, 220, 60, 0.45)';
  ctx.strokeStyle = 'rgba(255, 220, 60, 0.7)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.arc(wx(last.x), wy(last.y), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawWindArrow() {
  if (Math.abs(wind) < 0.2) return;
  const arrowY   = 22;
  const arrowCX  = CW / 2;
  const arrowLen = Math.min(60, Math.abs(wind) * 18);
  const dir      = wind > 0 ? 1 : -1;
  const x1 = arrowCX - dir * arrowLen / 2;
  const x2 = arrowCX + dir * arrowLen / 2;

  ctx.strokeStyle = 'rgba(30, 80, 160, 0.55)';
  ctx.fillStyle   = 'rgba(30, 80, 160, 0.55)';
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, arrowY);
  ctx.lineTo(x2, arrowY);
  ctx.stroke();
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, arrowY);
  ctx.lineTo(x2 - dir * 8, arrowY - 5);
  ctx.lineTo(x2 - dir * 8, arrowY + 5);
  ctx.closePath();
  ctx.fill();

  ctx.font      = 'bold 10px "Trebuchet MS", sans-serif';
  ctx.fillStyle = 'rgba(30, 80, 160, 0.6)';
  ctx.textAlign = 'center';
  ctx.fillText(`wind ${Math.abs(wind).toFixed(1)} m/s²`, arrowCX, arrowY + 14);
  ctx.textAlign = 'left';
}

function drawLabels() {
  ctx.font         = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';

  const pb = buildings[PLAYER_BLDG];
  ctx.fillStyle = '#1d4ed8';
  ctx.fillText('YOU', wx(pb.x + pb.width / 2), wy(pb.height) - 44);

  const ab = buildings[AI_BLDG];
  ctx.fillStyle = '#be185d';
  ctx.fillText('AI', wx(ab.x + ab.width / 2), wy(ab.height) - 44);

  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

/* ═══════════════════════════════════════════════════════════
   MAIN DRAW  (called every frame)
   ═══════════════════════════════════════════════════════════ */

function draw() {
  ctx.clearRect(0, 0, CW, CH);

  drawSky();
  drawGround();
  drawWindArrow();

  for (let i = 0; i < buildings.length; i++) drawBuilding(buildings[i], i);

  drawGorilla(PLAYER_BLDG);
  drawGorilla(AI_BLDG);


  // Banana in flight
  if (banana && phase === 'flying') {
    drawTrail(banana);
    drawBanana(banana);
  }

  if (explosion) drawExplosion(explosion);

  drawLabels();
}

/* ═══════════════════════════════════════════════════════════
   GAME LOOP
   ═══════════════════════════════════════════════════════════ */

function loop() {
  requestAnimationFrame(loop);
  if      (phase === 'flying')   stepBanana();
  else if (phase === 'exploding') stepExplosion();
  draw();
}

/* ═══════════════════════════════════════════════════════════
   DOM REFS & UI HELPERS
   ═══════════════════════════════════════════════════════════ */

const elAngle   = document.getElementById('num-angle');
const elSpeed   = document.getElementById('num-speed');
const slAngle   = document.getElementById('slider-angle');
const slSpeed   = document.getElementById('slider-speed');
const elFire    = document.getElementById('btn-fire');
const elNewGame = document.getElementById('btn-new-game');
const elMsg     = document.getElementById('message-bar');
const elScoreP  = document.getElementById('score-player');
const elScoreAI = document.getElementById('score-ai');
const elRound   = document.getElementById('round-label');
const elWindVal = document.getElementById('wind-val');
const elWindIcon = document.getElementById('wind-icon');
const elTurnTxt  = document.getElementById('turn-text');
const elTurnBox  = document.getElementById('turn-indicator');
const elReadR    = document.getElementById('readout-range');
const elReadH    = document.getElementById('readout-h');
const elReadT    = document.getElementById('readout-t');

function setMessage(msg)     { elMsg.textContent = msg; }
function updateScoreDisplay() { elScoreP.textContent = scores[0]; elScoreAI.textContent = scores[1]; }
function updateRoundLabel()   { elRound.textContent = `Round ${round} of ${MAX_ROUNDS}`; }

function updateWindDisplay() {
  elWindVal.textContent  = Math.abs(wind).toFixed(1);
  const right = wind >= 0;
  elWindIcon.textContent = right ? '→' : '←';
  elWindIcon.style.color = right ? '#7dd3fc' : '#f9a8d4';
}

function updateTurnIndicator() {
  if (turn === 0) {
    elTurnTxt.textContent = 'Your turn';
    elTurnBox.classList.remove('ai-turn');
  } else {
    elTurnTxt.textContent = "AI's turn";
    elTurnBox.classList.add('ai-turn');
  }
}

function updateReadout() {
  const deg  = parseFloat(elAngle.value);
  const v    = parseFloat(elSpeed.value);
  const rad  = deg * Math.PI / 180;
  const vy0  = v * Math.sin(rad);
  const T    = 2 * vy0 / G;
  const R    = v * Math.cos(rad) * T;
  const Hmax = vy0 * vy0 / (2 * G);
  elReadR.textContent = `${R.toFixed(0)} m`;
  elReadH.textContent = `${Hmax.toFixed(0)} m`;
  elReadT.textContent = `${T.toFixed(1)} s`;
}

/* ═══════════════════════════════════════════════════════════
   EVENT HANDLERS
   ═══════════════════════════════════════════════════════════ */

slAngle.addEventListener('input', () => {
  elAngle.value = slAngle.value;
  updateReadout();

});
elAngle.addEventListener('input', () => {
  slAngle.value = elAngle.value;
  updateReadout();

});

slSpeed.addEventListener('input', () => {
  elSpeed.value = slSpeed.value;
  updateReadout();

});
elSpeed.addEventListener('input', () => {
  slSpeed.value = elSpeed.value;
  updateReadout();

});

elFire.addEventListener('click', () => {
  if (phase !== 'aim' || turn !== 0) return;
  const angle = Math.max(1, Math.min(89, parseFloat(elAngle.value)));
  const speed = Math.max(10, Math.min(100, parseFloat(elSpeed.value)));
  previewPts = [];
  launchBanana(PLAYER_BLDG, angle, speed);
  phase = 'flying';
  elFire.disabled = true;
});

elNewGame.addEventListener('click', () => {
  scores  = [0, 0];
  round   = 1;
  turn    = 0;
  phase   = 'aim';
  banana  = null;
  explosion = null;
  elNewGame.classList.add('hidden');
  elFire.disabled = false;
  updateScoreDisplay();
  updateRoundLabel();
  updateTurnIndicator();
  generateBuildings();

  setMessage('New game! Choose angle and speed, then fire.');
});

/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */

generateBuildings();
computePreview();
updateReadout();
updateScoreDisplay();
updateRoundLabel();
updateTurnIndicator();
setMessage('Choose angle and speed — the dashed arc shows your predicted path. Then fire!');

requestAnimationFrame(loop);
