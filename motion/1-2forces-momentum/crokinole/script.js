'use strict';

/* ═══════════════════════════════════════════════════════════
   BOARD GEOMETRY
   Canvas is 600×600. Board is centred at (300, 300).
   All radii in canvas pixels.
   ═══════════════════════════════════════════════════════════ */

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
const CW = 600, CH = 600;
canvas.width  = CW;
canvas.height = CH;

const CX = CW / 2;   // 300
const CY = CH / 2;   // 300

const R_OUTER = 285;  // outer edge of ditch
const R_BOARD = 258;  // inner edge of ditch / playing surface edge
const R_5     = 183;  // 5-point ring
const R_10    = 140;  // 10-point ring
const R_15    = 93;   // 15-point ring
const R_PEGS  = 72;   // peg circle (real: 9.2cm from centre; scaled to 258px board radius)
const R_20    = 17;   // centre hole
const DISC_R  = 16;   // disc radius
const PEG_R   = 3.5;  // peg pin radius (real: 0.475cm; scaled)

// 8 pegs equally spaced; first peg at top (−π/2)
const PEGS = Array.from({length: 8}, (_, i) => {
  const a = i * (Math.PI / 4) - Math.PI / 2;
  return {x: CX + Math.cos(a) * R_PEGS, y: CY + Math.sin(a) * R_PEGS};
});

/* ═══════════════════════════════════════════════════════════
   PHYSICS CONSTANTS
   ═══════════════════════════════════════════════════════════ */

const FRICTION   = 220;   // px/s² kinetic friction deceleration
const COR_DISC   = 0.82;  // coefficient of restitution, disc–disc
const COR_PEG    = 0.65;  // coefficient of restitution, disc–peg
const MAX_SPEED  = 900;   // px/s — maximum flick speed
const MAX_DRAG   = 160;   // px of drag → full power
const STOP_V     = 2.5;   // px/s below which a disc is considered stopped
const AI_DELAY   = 1300;  // ms pause before AI shoots

/* ═══════════════════════════════════════════════════════════
   GAME STATE
   ═══════════════════════════════════════════════════════════ */

let nextId = 0;
let discs  = [];                      // all discs on board
let hole20 = {player: 0, ai: 0};     // 20s scored this round (removed from board)

const gs = {
  phase:      'placing',   // placing | aiming | shooting | ai-thinking | round-over | game-over
  turn:       'player',
  playerHand: 12,
  aiHand:     12,
  gameScore:  {player: 0, ai: 0},
  round:      1,

  // Mouse / drag state
  mouse:    null,    // current canvas mouse pos
  dragFrom: null,    // {x,y} — placed disc centre; drag starts here
  dragCur:  null,    // {x,y} — current drag mouse pos

  // Shot tracking (set at flick time, read in afterShot)
  shotCtx:         null,
  removedThisShot: [],
};

/* ═══════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════ */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dfc   = p  => Math.hypot(p.x - CX, p.y - CY);
const dd    = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function ptScore(x, y) {
  const r = Math.hypot(x - CX, y - CY);
  if (r < R_15) return 15;
  if (r < R_10) return 10;
  if (r < R_5)  return 5;
  return 0;
}

// Snap a canvas point to the R_5 baseline circle (bottom half only)
function snapToBaseline(mx, my) {
  const angle = Math.atan2(my - CY, mx - CX);
  return { x: CX + Math.cos(angle) * R_5, y: CY + Math.sin(angle) * R_5 };
}

// True if the mouse is in the clickable bottom-half region
function inBottomHalf(x, y) {
  return y >= CY && Math.hypot(x - CX, y - CY) <= R_BOARD + 20;
}

/* ═══════════════════════════════════════════════════════════
   DRAWING
   ═══════════════════════════════════════════════════════════ */

function drawBoard() {
  // Dark surround
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, CW, CH);

  // Ditch
  ctx.beginPath();
  ctx.arc(CX, CY, R_OUTER, 0, Math.PI * 2);
  ctx.fillStyle = '#3e1e08';
  ctx.fill();

  // Playing surface — outermost colour (5-point zone)
  ctx.beginPath();
  ctx.arc(CX, CY, R_BOARD, 0, Math.PI * 2);
  ctx.fillStyle = '#d4a040';
  ctx.fill();

  // 10-point zone
  ctx.beginPath();
  ctx.arc(CX, CY, R_10, 0, Math.PI * 2);
  ctx.fillStyle = '#be8c28';
  ctx.fill();

  // 15-point zone
  ctx.beginPath();
  ctx.arc(CX, CY, R_15, 0, Math.PI * 2);
  ctx.fillStyle = '#d4a040';
  ctx.fill();

  // Ring lines
  [R_BOARD, R_5, R_10, R_15].forEach(r => {
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(50,25,0,0.55)';
    ctx.lineWidth   = 2;
    ctx.stroke();
  });

  // Quadrant dividers (dashed)
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(CX - R_BOARD, CY); ctx.lineTo(CX + R_BOARD, CY);
  ctx.moveTo(CX, CY - R_BOARD); ctx.lineTo(CX, CY + R_BOARD);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Zone labels (top + bottom)
  ctx.font         = 'bold 12px "Trebuchet MS",sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = 'rgba(0,0,0,0.35)';
  [
    [R_5  - 13, '5'],
    [R_10 - 11, '10'],
    [R_15 - 10, '15'],
  ].forEach(([r, t]) => {
    ctx.fillText(t, CX, CY - r);
    ctx.fillText(t, CX, CY + r);
  });

  // Pegs
  PEGS.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x + 1, p.y + 1.5, PEG_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2a2a';
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.lineWidth   = 1;
    ctx.stroke();
  });

  // Centre hole
  ctx.beginPath();
  ctx.arc(CX, CY, R_20, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0a0a';
  ctx.fill();
  ctx.strokeStyle = '#444';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  ctx.font         = 'bold 10px "Trebuchet MS",sans-serif';
  ctx.fillStyle    = 'rgba(255,255,255,0.38)';
  ctx.textBaseline = 'middle';
  ctx.fillText('20', CX, CY);
}

function drawZoneHighlight() {
  if (gs.phase !== 'placing' || gs.turn !== 'player') return;
  ctx.save();
  // Highlight the baseline: bottom-half arc of the R_5 ring
  ctx.beginPath();
  ctx.arc(CX, CY, R_5, 0, Math.PI);   // 0→π spans right→bottom→left in canvas coords
  ctx.strokeStyle = 'rgba(59,130,246,0.75)';
  ctx.lineWidth   = 3.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawDisc(x, y, owner, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;

  const fill = owner === 'player' ? '#3b82f6' : '#ec4899';
  const rim  = owner === 'player' ? '#1d4ed8' : '#be185d';

  // Drop shadow
  ctx.beginPath();
  ctx.arc(x + 2, y + 3, DISC_R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.arc(x, y, DISC_R, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Inner ring detail
  ctx.beginPath();
  ctx.arc(x, y, DISC_R * 0.55, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Specular highlight
  ctx.beginPath();
  ctx.arc(x - DISC_R * 0.3, y - DISC_R * 0.3, DISC_R * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();

  ctx.restore();
}

function drawAimVector() {
  if (!gs.dragFrom || !gs.dragCur) return;
  const fx = gs.dragFrom.x, fy = gs.dragFrom.y;
  const mx = gs.dragCur.x,  my = gs.dragCur.y;

  // Drag direction is backward; shot direction is opposite
  const dx = fx - mx, dy = fy - my;
  const dragLen = Math.hypot(dx, dy);
  if (dragLen < 4) return;

  const pct  = clamp(dragLen / MAX_DRAG, 0, 1);
  // Tip of arrow is capped at MAX_DRAG from disc centre
  const tipX = fx + (dx / dragLen) * (dragLen > MAX_DRAG ? MAX_DRAG : dragLen);
  const tipY = fy + (dy / dragLen) * (dragLen > MAX_DRAG ? MAX_DRAG : dragLen);

  // Colour: green → red with power
  const rr = Math.round(50  + 205 * pct);
  const gg = Math.round(200 - 180 * pct);
  const lineColor = `rgba(${rr},${gg},60,0.92)`;

  ctx.save();

  // Dashed line
  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead
  const angle = Math.atan2(dy, dx);
  const hl = 13;
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - hl * Math.cos(angle - 0.42), tipY - hl * Math.sin(angle - 0.42));
  ctx.lineTo(tipX - hl * Math.cos(angle + 0.42), tipY - hl * Math.sin(angle + 0.42));
  ctx.closePath();
  ctx.fill();

  // Power percentage label (offset perpendicular to the arrow)
  const nx = -dy / dragLen, ny = dx / dragLen;  // unit normal
  const lx = (fx + tipX) / 2 + nx * 16;
  const ly = (fy + tipY) / 2 + ny * 16;
  ctx.font         = 'bold 11px "Trebuchet MS",sans-serif';
  ctx.fillStyle    = lineColor;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(pct * 100)}%`, lx, ly);

  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, CW, CH);
  drawBoard();
  drawZoneHighlight();

  // Ghost disc snapped to baseline when hovering in bottom half (placing phase only)
  if (gs.phase === 'placing' && gs.turn === 'player' && gs.mouse && !gs.dragFrom) {
    if (inBottomHalf(gs.mouse.x, gs.mouse.y)) {
      const snapped = snapToBaseline(gs.mouse.x, gs.mouse.y);
      const clear   = discs.every(d => dd(d, snapped) > DISC_R * 2.1);
      drawDisc(snapped.x, snapped.y, 'player', clear ? 0.45 : 0.18);
    }
  }

  // All board discs
  discs.forEach(d => drawDisc(d.x, d.y, d.owner));

  // Placed disc + aim arrow
  if (gs.dragFrom) {
    drawDisc(gs.dragFrom.x, gs.dragFrom.y, 'player');
    drawAimVector();
  }
}

/* ═══════════════════════════════════════════════════════════
   PHYSICS ENGINE
   ═══════════════════════════════════════════════════════════ */

function updatePhysics(dt) {
  // Integrate motion with friction
  discs.forEach(d => {
    const spd = Math.hypot(d.vx, d.vy);
    if (spd < STOP_V) { d.vx = 0; d.vy = 0; return; }
    const decel = Math.min(FRICTION * dt, spd);
    d.vx -= (d.vx / spd) * decel;
    d.vy -= (d.vy / spd) * decel;
    d.x  += d.vx * dt;
    d.y  += d.vy * dt;
  });

  // Disc–disc collisions
  for (let i = 0; i < discs.length - 1; i++) {
    for (let j = i + 1; j < discs.length; j++) {
      resolveDiscDisc(discs[i], discs[j]);
    }
  }

  // Disc–peg collisions
  discs.forEach(d => PEGS.forEach(p => resolveDiscPeg(d, p)));

  // Remove discs that entered the hole or fell in the ditch
  for (let i = discs.length - 1; i >= 0; i--) {
    const d = discs[i];
    const r = Math.hypot(d.x - CX, d.y - CY);
    if (r < R_20 - DISC_R * 0.5) {
      removeDisc(i, 'hole20');
    } else if (r + DISC_R > R_BOARD + 3) {
      removeDisc(i, 'ditch');
    }
  }
}

function resolveDiscDisc(a, b) {
  const dx   = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minD = DISC_R * 2;
  if (dist >= minD || dist < 0.001) return;

  // Positional correction (push apart)
  const nx = dx / dist, ny = dy / dist;
  const overlap = (minD - dist) * 0.5;
  a.x -= nx * overlap; a.y -= ny * overlap;
  b.x += nx * overlap; b.y += ny * overlap;

  // Velocity components along the normal
  const v1n = a.vx * nx + a.vy * ny;
  const v2n = b.vx * nx + b.vy * ny;
  if (v1n - v2n <= 0) return;  // already separating

  // Equal-mass collision with coefficient of restitution e
  const e   = COR_DISC;
  const v1n_ = ((1 - e) * v1n + (1 + e) * v2n) / 2;
  const v2n_ = ((1 + e) * v1n + (1 - e) * v2n) / 2;
  a.vx += (v1n_ - v1n) * nx;  a.vy += (v1n_ - v1n) * ny;
  b.vx += (v2n_ - v2n) * nx;  b.vy += (v2n_ - v2n) * ny;
}

function resolveDiscPeg(d, p) {
  const dx   = d.x - p.x, dy = d.y - p.y;
  const dist = Math.hypot(dx, dy);
  const minD = DISC_R + PEG_R;
  if (dist >= minD || dist < 0.001) return;

  // Push disc out
  const nx = dx / dist, ny = dy / dist;
  const overlap = minD - dist;
  d.x += nx * overlap;
  d.y += ny * overlap;

  // Reflect velocity along normal with restitution
  const vn = d.vx * nx + d.vy * ny;
  if (vn >= 0) return;  // moving away
  d.vx -= (1 + COR_PEG) * vn * nx;
  d.vy -= (1 + COR_PEG) * vn * ny;
}

function removeDisc(idx, reason) {
  const d = {...discs[idx], _removedReason: reason};
  gs.removedThisShot.push(d);
  if (reason === 'hole20') hole20[discs[idx].owner]++;
  discs.splice(idx, 1);
}

function allStopped() {
  return discs.every(d => Math.hypot(d.vx, d.vy) < STOP_V);
}

/* ═══════════════════════════════════════════════════════════
   FLICK — fires a disc and records shot context for rule check
   ═══════════════════════════════════════════════════════════ */

function flick(x, y, vx, vy, owner) {
  const opponent = owner === 'player' ? 'ai' : 'player';
  const opponentSnaps = discs
    .filter(d => d.owner === opponent)
    .map(d => ({id: d.id, x: d.x, y: d.y}));

  const shotId = ++nextId;
  gs.shotCtx = {
    shooter:          owner,
    shotId,
    opponentHadDiscs: opponentSnaps.length > 0,
    opponentSnaps,
  };
  gs.removedThisShot = [];

  discs.push({x, y, vx, vy, owner, id: shotId});
  gs.phase = 'shooting';
}

/* ═══════════════════════════════════════════════════════════
   RULES CHECK (called after shot settles)
   ═══════════════════════════════════════════════════════════ */

function checkRulesAfterShot() {
  const {shooter, shotId, opponentHadDiscs, opponentSnaps} = gs.shotCtx;
  const shotIdx     = discs.findIndex(d => d.id === shotId);
  const shotRemoved = gs.removedThisShot.find(d => d.id === shotId);

  let violation = false;

  if (opponentHadDiscs) {
    // Must have made contact with at least one opponent disc
    const hitAny = opponentSnaps.some(snap => {
      const still   = discs.find(d => d.id === snap.id);
      const removed = gs.removedThisShot.find(d => d.id === snap.id);
      if (removed) return true;  // knocked off = definitely hit
      if (!still)  return false;
      return Math.hypot(still.x - snap.x, still.y - snap.y) > 2;
    });
    if (!hitAny) violation = true;
  } else {
    // No opponent discs: shot disc must reach the scoring area (r < R_5)
    if (shotIdx >= 0) {
      if (Math.hypot(discs[shotIdx].x - CX, discs[shotIdx].y - CY) >= R_5) {
        violation = true;
      }
    } else if (shotRemoved && shotRemoved._removedReason === 'ditch') {
      violation = true;
      // (scored 20 with no opponent present is perfectly valid)
    }
  }

  if (violation) {
    // Remove the shot disc if it is still on the board
    if (shotIdx >= 0) discs.splice(shotIdx, 1);
    // Undo any 20 mistakenly credited to the shot disc
    if (shotRemoved && shotRemoved._removedReason === 'hole20') {
      hole20[shooter] = Math.max(0, hole20[shooter] - 1);
    }
    setMsg(shooter === 'player'
      ? 'Your disc removed — rule violation!'
      : 'AI disc removed — rule violation!');
  }
}

/* ═══════════════════════════════════════════════════════════
   TURN & ROUND MANAGEMENT
   ═══════════════════════════════════════════════════════════ */

function afterShot() {
  checkRulesAfterShot();
  gs.dragFrom = null;
  gs.dragCur  = null;

  if (gs.turn === 'player') {
    gs.playerHand--;
    if (gs.aiHand > 0) {
      gs.turn  = 'ai';
      gs.phase = 'ai-thinking';
      setTimeout(aiTurn, AI_DELAY);
    } else {
      endRound(); return;
    }
  } else {
    gs.aiHand--;
    if (gs.playerHand > 0) {
      gs.turn  = 'player';
      gs.phase = 'placing';
      setMsg('Your turn — click the baseline to place your disc');
    } else {
      endRound(); return;
    }
  }
  updateUI();
}

function endRound() {
  gs.phase = 'round-over';

  // Tally scores: board discs + 20s already removed
  let pScore = hole20.player * 20;
  let aScore = hole20.ai    * 20;
  discs.forEach(d => {
    const pts = ptScore(d.x, d.y);
    if (d.owner === 'player') pScore += pts;
    else                      aScore += pts;
  });

  const diff = Math.abs(pScore - aScore);
  let msg = `Round ${gs.round}: You ${pScore} – AI ${aScore}. `;
  if (diff === 0) {
    msg += 'Tie — no points.';
  } else if (pScore > aScore) {
    gs.gameScore.player += diff;
    msg += `You score ${diff}!`;
  } else {
    gs.gameScore.ai += diff;
    msg += `AI scores ${diff}.`;
  }
  setMsg(msg);
  updateUI();

  const gameWon = gs.gameScore.player >= 100 || gs.gameScore.ai >= 100;
  setTimeout(() => {
    if (gameWon) {
      gs.phase = 'game-over';
      const winner = gs.gameScore.player >= gs.gameScore.ai ? 'You win!' : 'AI wins!';
      setMsg(`Game over — ${winner}  (You ${gs.gameScore.player} – AI ${gs.gameScore.ai})`);
      document.getElementById('btn-new-game').classList.remove('hidden');
    } else {
      startNewRound();
    }
    updateUI();
  }, 3000);
}

function startNewRound() {
  discs  = [];
  hole20 = {player: 0, ai: 0};
  gs.playerHand = 12;
  gs.aiHand     = 12;
  gs.turn        = 'player';
  gs.phase       = 'placing';
  gs.round++;
  gs.dragFrom    = null;
  gs.dragCur     = null;
  setMsg('Your turn — click the baseline to place your disc');
  updateUI();
}

function resetGame() {
  discs  = [];
  hole20 = {player: 0, ai: 0};
  Object.assign(gs, {
    phase: 'placing', turn: 'player',
    playerHand: 12, aiHand: 12,
    gameScore: {player: 0, ai: 0},
    round: 1,
    dragFrom: null, dragCur: null,
    shotCtx: null, removedThisShot: [],
  });
  document.getElementById('btn-new-game').classList.add('hidden');
  setMsg('Your turn — click the baseline to place your disc');
  updateUI();
}

/* ═══════════════════════════════════════════════════════════
   AI PLAYER
   ═══════════════════════════════════════════════════════════ */

// Approximate Gaussian noise via Box–Muller
function randn() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function aiTurn() {
  if (gs.phase !== 'ai-thinking') return;

  // ── Pick a placement on the R_5 baseline in the top half ──
  let fx = CX, fy = CY - R_5;
  for (let attempt = 0; attempt < 25; attempt++) {
    const a = -Math.PI + Math.random() * Math.PI;   // −π to 0 = top semicircle
    const cx = CX + Math.cos(a) * R_5;
    const cy = CY + Math.sin(a) * R_5;
    if (discs.every(d => dd(d, {x: cx, y: cy}) > DISC_R * 2.2)) {
      fx = cx; fy = cy; break;
    }
  }

  // ── Choose a target ──
  const playerDiscs = discs.filter(d => d.owner === 'player');
  let tx = CX, ty = CY;     // default: aim at hole

  if (playerDiscs.length > 0) {
    // Aim at the nearest player disc
    const nearest = playerDiscs.reduce((best, d) =>
      dd(d, {x: fx, y: fy}) < dd(best, {x: fx, y: fy}) ? d : best
    );
    tx = nearest.x;
    ty = nearest.y;
  }

  // ── Calculate velocity with noise ──
  const baseAngle = Math.atan2(ty - fy, tx - fx);
  const shotAngle = baseAngle + randn() * 0.11;   // ±~6° std dev

  const targetDist = Math.hypot(tx - fx, ty - fy);
  // Speed calibrated to travel roughly the target distance
  const idealSpeed = clamp(targetDist * 2.4 + 60, 280, MAX_SPEED);
  const speed      = clamp(idealSpeed + randn() * 75, 180, MAX_SPEED);

  gs.turn = 'ai';
  flick(fx, fy, Math.cos(shotAngle) * speed, Math.sin(shotAngle) * speed, 'ai');
  setMsg('AI is shooting…');
  updateUI();
}

/* ═══════════════════════════════════════════════════════════
   INPUT HANDLING
   ═══════════════════════════════════════════════════════════ */

function canvasXY(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = CW / rect.width;
  const scaleY = CH / rect.height;
  const src    = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY,
  };
}

// Track hover
canvas.addEventListener('mousemove', e => {
  gs.mouse = canvasXY(e);
});

// Mousedown on canvas: snap to baseline and begin aiming
canvas.addEventListener('mousedown', e => {
  if (gs.phase !== 'placing' || gs.turn !== 'player') return;
  const pt = canvasXY(e);
  if (!inBottomHalf(pt.x, pt.y)) return;
  const snapped = snapToBaseline(pt.x, pt.y);
  if (discs.some(d => dd(d, snapped) < DISC_R * 2.1)) return;
  gs.dragFrom = snapped;
  gs.dragCur  = snapped;
  gs.phase    = 'aiming';
  e.preventDefault();
});

// Update drag on document (so it works outside canvas)
document.addEventListener('mousemove', e => {
  if (gs.phase === 'aiming') gs.dragCur = canvasXY(e);
});

// Release: fire if drag is long enough
document.addEventListener('mouseup', () => {
  if (gs.phase !== 'aiming') return;
  const from = gs.dragFrom, cur = gs.dragCur;
  if (!from || !cur) { gs.phase = 'placing'; return; }

  const dx = from.x - cur.x, dy = from.y - cur.y;
  const dragLen = Math.hypot(dx, dy);

  if (dragLen < 6) {
    // Too short — cancel and let them try again
    gs.dragFrom = null;
    gs.dragCur  = null;
    gs.phase    = 'placing';
    return;
  }

  const pct   = clamp(dragLen / MAX_DRAG, 0, 1);
  const spd   = pct * MAX_SPEED;
  const angle = Math.atan2(dy, dx);
  flick(from.x, from.y, Math.cos(angle) * spd, Math.sin(angle) * spd, 'player');
  setMsg('');
});

// Touch support
canvas.addEventListener('touchstart', e => {
  if (gs.phase !== 'placing' || gs.turn !== 'player') return;
  const pt = canvasXY(e);
  if (!inBottomHalf(pt.x, pt.y)) return;
  const snapped = snapToBaseline(pt.x, pt.y);
  if (discs.some(d => dd(d, snapped) < DISC_R * 2.1)) return;
  gs.dragFrom = snapped;
  gs.dragCur  = snapped;
  gs.phase    = 'aiming';
  e.preventDefault();
}, {passive: false});

document.addEventListener('touchmove', e => {
  if (gs.phase === 'aiming') { gs.dragCur = canvasXY(e); e.preventDefault(); }
}, {passive: false});

document.addEventListener('touchend', () => {
  if (gs.phase !== 'aiming') return;
  const from = gs.dragFrom, cur = gs.dragCur;
  if (!from || !cur) { gs.phase = 'placing'; return; }
  const dx = from.x - cur.x, dy = from.y - cur.y;
  const dragLen = Math.hypot(dx, dy);
  if (dragLen < 6) { gs.dragFrom = null; gs.dragCur = null; gs.phase = 'placing'; return; }
  const pct = clamp(dragLen / MAX_DRAG, 0, 1);
  flick(from.x, from.y,
        Math.cos(Math.atan2(dy, dx)) * pct * MAX_SPEED,
        Math.sin(Math.atan2(dy, dx)) * pct * MAX_SPEED, 'player');
  setMsg('');
});

/* ═══════════════════════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════════════════════ */

function setMsg(txt) {
  document.getElementById('message-bar').textContent = txt || '\u00a0';
}

function updateUI() {
  document.getElementById('score-player').textContent = gs.gameScore.player;
  document.getElementById('score-ai').textContent     = gs.gameScore.ai;
  document.getElementById('round-label').textContent  = `Round ${gs.round}`;
  document.getElementById('hand-player').textContent  = gs.playerHand;
  document.getElementById('hand-ai').textContent      = gs.aiHand;

  const ti = document.getElementById('turn-indicator');
  const tt = document.getElementById('turn-text');
  ti.classList.toggle('ai-turn', gs.turn === 'ai');
  tt.textContent = gs.turn === 'player' ? 'Your turn' : 'AI thinking…';
}

/* ═══════════════════════════════════════════════════════════
   GAME LOOP
   ═══════════════════════════════════════════════════════════ */

let lastTime = 0;

function gameLoop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;

  if (gs.phase === 'shooting') {
    updatePhysics(dt);
    if (allStopped()) afterShot();
  }

  render();
  requestAnimationFrame(gameLoop);
}

/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */

document.getElementById('btn-new-game').addEventListener('click', resetGame);

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

setMsg('Your turn — click the baseline to place your disc');
updateUI();
requestAnimationFrame(gameLoop);
