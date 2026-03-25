const G = 6.67e-11;
const CANVAS_FONT = '"Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
const SUPERSCRIPT_DIGITS = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};
const SUBSCRIPT_DIGITS = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
};

const state = {
  model: 'two',
  m1: { mantissa: 5.97, exponent: 24, value: 5.97e24 },
  m2: { mantissa: 7.35, exponent: 22, value: 7.35e22 },
  m3: { mantissa: 1.0, exponent: 3, value: 1.0e3 },
  r: { mantissa: 3.84, exponent: 8, value: 3.84e8 },
  offset: { mantissa: 3.30, exponent: 8, value: 3.30e8 },
  configuration: 'between',
  showForces: false,
  showReactionForces: false,
};

const controls = {
  model: document.getElementById('model-select'),
  configuration: document.getElementById('configuration-select'),
  threeBodyOnly: Array.from(document.querySelectorAll('.three-body-only')),
  reactionToggle: document.getElementById('toggle-reaction-forces'),
  m1: buildControlRefs('m1'),
  m2: buildControlRefs('m2'),
  m3: buildControlRefs('m3'),
  r: buildControlRefs('r'),
  offset: buildControlRefs('offset'),
  rLabel: document.getElementById('r-label'),
  offsetLabel: document.getElementById('offset-label'),
  summaryValue: document.getElementById('summary-value'),
  toggleForces: document.getElementById('toggle-forces'),
};

const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');

function buildControlRefs(prefix) {
  return {
    slider: document.getElementById(`${prefix}-mantissa-slider`),
    mantissa: document.getElementById(`${prefix}-mantissa-input`),
    exponent: document.getElementById(`${prefix}-exponent-input`),
    display: document.getElementById(`${prefix}-display`),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scientificValue(entry) {
  return entry.mantissa * (10 ** entry.exponent);
}

function toSuperscript(value) {
  return String(value).split('').map((char) => SUPERSCRIPT_DIGITS[char] ?? char).join('');
}

function toSubscript(value) {
  return String(value).split('').map((char) => SUBSCRIPT_DIGITS[char] ?? char).join('');
}

function forceLabel(base, suffix) {
  return `${base}${toSubscript(suffix)}`;
}

function massLabel(index) {
  return `m${toSubscript(index)}`;
}

function formatScientific(value, unit = '') {
  const unitPart = unit ? ` ${unit}` : '';
  if (value === 0) {
    return `0${unitPart}`;
  }
  if (!Number.isFinite(value)) {
    return `Overflow${unitPart}`;
  }
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / (10 ** exponent);
  const roundedMantissa = Math.abs(mantissa) >= 9.995 ? 10 : mantissa;
  const finalExponent = roundedMantissa === 10 ? exponent + 1 : exponent;
  const finalMantissa = roundedMantissa === 10 ? 1 : roundedMantissa;
  return `${finalMantissa.toFixed(3)} × 10${toSuperscript(finalExponent)}${unitPart}`;
}

function updateMath() {
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise();
  }
}

function updateVariable(key, unit) {
  const entry = state[key];
  const control = controls[key];
  entry.value = scientificValue(entry);
  control.slider.value = entry.mantissa.toFixed(2);
  control.mantissa.value = entry.mantissa.toFixed(2);
  control.exponent.value = String(entry.exponent);
  control.display.textContent = `${massOrVarLabel(key)} = ${formatScientific(entry.value, unit)}`;
}

function massOrVarLabel(key) {
  if (key === 'm1') return massLabel(1);
  if (key === 'm2') return massLabel(2);
  if (key === 'm3') return massLabel(3);
  return key;
}

function updateModeUI() {
  const isThreeBody = state.model === 'three';
  controls.threeBodyOnly.forEach((element) => {
    element.classList.toggle('is-hidden', !isThreeBody);
  });
  controls.reactionToggle.classList.toggle('is-hidden', !isThreeBody);
  if (!isThreeBody) {
    state.showReactionForces = false;
    controls.reactionToggle.textContent = `Show ${forceLabel('F', '31')} and ${forceLabel('F', '32')}`;
    controls.reactionToggle.classList.remove('active');
    controls.reactionToggle.setAttribute('aria-pressed', 'false');
  }
}

function updateOffsetLabel() {
  if (state.configuration === 'between') {
    controls.offsetLabel.textContent = `Distance of ${massLabel(3)} from ${massLabel(1)} along the line (m)`;
  } else if (state.configuration === 'left') {
    controls.offsetLabel.textContent = `Distance of ${massLabel(3)} to the left of ${massLabel(1)} (m)`;
  } else {
    controls.offsetLabel.textContent = `Distance of ${massLabel(3)} to the right of ${massLabel(2)} (m)`;
  }
}

function updateSummary() {
  if (state.model === 'two') {
    controls.summaryValue.textContent = `Two equal-and-opposite forces act along the line joining ${massLabel(1)} and ${massLabel(2)}.`;
    return;
  }

  controls.summaryValue.textContent = `Show ${forceLabel('F', '13')}, ${forceLabel('F', '23')}, and ${forceLabel('F', 'total')} on ${massLabel(3)}. All three use one shared scale so ${forceLabel('F', 'total')} is drawn as the visual sum.`;
}

function commitScientificValue(key, valueType, rawValue) {
  const control = controls[key];
  const entry = state[key];

  if (valueType === 'mantissa') {
    const step = Number(control.slider.step);
    const snapped = Math.round(rawValue / step) * step;
    entry.mantissa = Number(clamp(snapped, Number(control.slider.min), Number(control.slider.max)).toFixed(2));
  } else {
    const safeValue = Number.isFinite(rawValue) ? rawValue : entry.exponent;
    entry.exponent = clamp(Math.round(safeValue), -99, 99);
  }

  updateAllDisplays();
  draw();
}

function wireScientificControl(key, unit) {
  const control = controls[key];
  control.slider.addEventListener('input', () => commitScientificValue(key, 'mantissa', Number(control.slider.value)));
  control.mantissa.addEventListener('input', () => {
    if (control.mantissa.value !== '') {
      commitScientificValue(key, 'mantissa', Number(control.mantissa.value));
    }
  });
  control.mantissa.addEventListener('blur', () => commitScientificValue(key, 'mantissa', Number(control.mantissa.value || state[key].mantissa)));
  control.exponent.addEventListener('input', () => {
    if (control.exponent.value !== '' && control.exponent.value !== '-') {
      commitScientificValue(key, 'exponent', Number(control.exponent.value));
    }
  });
  control.exponent.addEventListener('blur', () => commitScientificValue(key, 'exponent', Number(control.exponent.value || state[key].exponent)));
  updateVariable(key, unit);
}

function getPositions() {
  if (state.model === 'two') {
    return [0, state.r.value];
  }

  const x1 = 0;
  const x2 = state.r.value;
  let x3;

  if (state.configuration === 'between') {
    const safeOffset = clamp(state.offset.value, Math.max(state.r.value * 1e-9, 1e-12), Math.max(state.r.value * (1 - 1e-9), 1e-12));
    state.offset.value = safeOffset;
    x3 = safeOffset;
  } else if (state.configuration === 'left') {
    x3 = -state.offset.value;
  } else {
    x3 = x2 + state.offset.value;
  }

  return [x1, x2, x3];
}

function getMasses() {
  return state.model === 'two'
    ? [state.m1.value, state.m2.value]
    : [state.m1.value, state.m2.value, state.m3.value];
}

function pairForce(massA, massB, xA, xB) {
  const dx = xB - xA;
  const distance = Math.abs(dx);
  if (distance === 0) {
    return Infinity;
  }
  const magnitude = (G * massA * massB) / (distance * distance);
  if (!Number.isFinite(magnitude)) {
    return Infinity;
  }
  return magnitude * Math.sign(dx);
}

function computeSharedArrowScale(forces, maxLength, minVisibleLength = 24) {
  const finiteMagnitudes = forces.map((force) => Math.abs(force)).filter((value) => Number.isFinite(value) && value > 0);
  if (finiteMagnitudes.length === 0) {
    return 0;
  }
  const maxMagnitude = Math.max(...finiteMagnitudes);
  return Math.max(minVisibleLength / maxMagnitude, maxLength / maxMagnitude);
}

function computeArrowLength(force, scale, maxLength, minVisibleLength = 24) {
  if (!Number.isFinite(force)) {
    return maxLength;
  }
  const magnitude = Math.abs(force);
  if (magnitude === 0) {
    return 0;
  }
  return clamp(magnitude * scale, minVisibleLength, maxLength);
}

function drawArrow(x, y, force, color, label, magnitudeLabel, options = {}) {
  const maxLength = options.maxLength ?? 142;
  const minVisibleLength = options.minVisibleLength ?? 24;
  const forcedScale = options.scale ?? null;
  const labelGap = options.labelGap ?? 20;
  const magnitudeGap = options.magnitudeGap ?? 26;

  if (force === 0) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `700 15px ${CANVAS_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - labelGap);
    if (magnitudeLabel) {
      ctx.font = `500 13px ${CANVAS_FONT}`;
      ctx.fillText('0 N', x, y + magnitudeGap);
    }
    ctx.restore();
    return;
  }

  const direction = Math.sign(force) || 1;
  const length = forcedScale === null
    ? computeArrowLength(force, computeSharedArrowScale([force], maxLength, minVisibleLength), maxLength, minVisibleLength)
    : computeArrowLength(force, forcedScale, maxLength, minVisibleLength);
  const x2 = x + direction * length;
  const headLength = 12;
  const midX = (x + x2) / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y);
  ctx.lineTo(x2 - direction * headLength, y - headLength * 0.7);
  ctx.lineTo(x2 - direction * headLength, y + headLength * 0.7);
  ctx.closePath();
  ctx.fill();

  ctx.font = `700 14px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(label, midX, y - labelGap);
  if (magnitudeLabel) {
    ctx.font = `500 13px ${CANVAS_FONT}`;
    ctx.fillText(magnitudeLabel, midX, y + magnitudeGap);
  }
  ctx.restore();
}

function drawMass(x, y, radius, color, label, value) {
  const gradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.2, x, y, radius);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.2, color);
  gradient.addColorStop(1, 'rgba(16, 24, 40, 0.95)');

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#10253d';
  ctx.textAlign = 'center';
  ctx.font = `700 22px ${CANVAS_FONT}`;
  ctx.fillText(label, x, y + 7);
  ctx.font = `500 15px ${CANVAS_FONT}`;
  ctx.fillText(formatScientific(value, 'kg'), x, y + radius + 24);
  ctx.restore();
}

function drawDistanceMarkers(screenXs, y) {
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 7]);

  ctx.beginPath();
  ctx.moveTo(screenXs[0], y);
  ctx.lineTo(screenXs[1], y);
  ctx.stroke();

  if (state.model === 'three' && state.configuration === 'between' && screenXs[2] !== undefined) {
    ctx.beginPath();
    ctx.moveTo(screenXs[0], y + 36);
    ctx.lineTo(screenXs[2], y + 36);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.font = `700 16px ${CANVAS_FONT}`;
  ctx.fillStyle = '#15304d';
  ctx.textAlign = 'center';
  ctx.fillText(`r = ${formatScientific(state.r.value, 'm')}`, (screenXs[0] + screenXs[1]) / 2, y - 12);

  if (state.model === 'three' && state.configuration === 'between' && screenXs[2] !== undefined) {
    ctx.fillText(`x = ${formatScientific(state.offset.value, 'm')}`, (screenXs[0] + screenXs[2]) / 2, y + 28);
  }
  ctx.restore();
}

function drawGrid(width, height) {
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function updateAllDisplays() {
  updateVariable('m1', 'kg');
  updateVariable('m2', 'kg');
  updateVariable('m3', 'kg');
  updateVariable('r', 'm');
  updateVariable('offset', 'm');
  updateModeUI();
  updateOffsetLabel();
  updateSummary();
}

function drawTwoBody(screenXs, masses, radii, baseY, width, height, positions) {
  const forceOn1 = pairForce(masses[0], masses[1], positions[0], positions[1]);
  const forceOn2 = pairForce(masses[1], masses[0], positions[1], positions[0]);
  const sharedScale = computeSharedArrowScale([forceOn1, forceOn2], 140, 30);
  const arrowY = baseY - 2 * radii[0] - 52;

  if (state.showForces) {
    drawArrow(screenXs[0], arrowY, forceOn1, '#3b82f6', `F on ${massLabel(1)}`, formatScientific(Math.abs(forceOn1), 'N'), { scale: sharedScale, maxLength: 140, minVisibleLength: 30, labelGap: 20, magnitudeGap: 28 });
    drawArrow(screenXs[1], arrowY, forceOn2, '#ef4444', `F on ${massLabel(2)}`, formatScientific(Math.abs(forceOn2), 'N'), { scale: sharedScale, maxLength: 140, minVisibleLength: 30, labelGap: 20, magnitudeGap: 28 });
    ctx.save();
    ctx.font = `700 18px ${CANVAS_FONT}`;
    ctx.fillStyle = '#15304d';
    ctx.textAlign = 'center';
    ctx.fillText(`|F| = ${formatScientific(Math.abs(forceOn1), 'N')}`, width / 2, 52);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(21, 48, 77, 0.75)';
    ctx.textAlign = 'center';
    ctx.font = `500 18px ${CANVAS_FONT}`;
    ctx.fillText(`Press Show Forces to reveal the equal-and-opposite gravitational forces on ${massLabel(1)} and ${massLabel(2)}.`, width / 2, 52);
    ctx.restore();
  }
}

function drawThreeBody(screenXs, masses, radii, baseY, width, height, positions) {
  const f13 = pairForce(masses[2], masses[0], positions[2], positions[0]);
  const f23 = pairForce(masses[2], masses[1], positions[2], positions[1]);
  const fTotal = Number.isFinite(f13) && Number.isFinite(f23) ? f13 + f23 : Infinity;
  const f31 = Number.isFinite(f13) ? -f13 : Infinity;
  const f32 = Number.isFinite(f23) ? -f23 : Infinity;

  const sharedM3Scale = computeSharedArrowScale([f13, f23, fTotal], 150, 28);
  const reactionScale = computeSharedArrowScale([f31, f32], 140, 28);

  const upperArrowBase = baseY - 2 * radii[2] - 72;
  const middleArrowBase = upperArrowBase + 82;
  const lowerArrowBase = baseY + 2 * radii[2] + 72;
  const reactionArrowBase = baseY - 2 * Math.max(radii[0], radii[1]) - 52;

  if (state.showForces) {
    drawArrow(screenXs[2], upperArrowBase, f13, '#2563eb', forceLabel('F', '13'), formatScientific(Math.abs(f13), 'N'), { scale: sharedM3Scale, maxLength: 150, minVisibleLength: 28, labelGap: 22, magnitudeGap: 30 });
    drawArrow(screenXs[2], middleArrowBase, fTotal, '#0f766e', forceLabel('F', 'total'), formatScientific(Math.abs(fTotal), 'N'), { scale: sharedM3Scale, maxLength: 150, minVisibleLength: 28, labelGap: 22, magnitudeGap: 30 });
    drawArrow(screenXs[2], lowerArrowBase, f23, '#dc2626', forceLabel('F', '23'), formatScientific(Math.abs(f23), 'N'), { scale: sharedM3Scale, maxLength: 150, minVisibleLength: 28, labelGap: 22, magnitudeGap: 30 });

    if (state.showReactionForces) {
      drawArrow(screenXs[0], reactionArrowBase, f31, '#7c3aed', forceLabel('F', '31'), formatScientific(Math.abs(f31), 'N'), { scale: reactionScale, maxLength: 140, minVisibleLength: 28, labelGap: 20, magnitudeGap: 28 });
      drawArrow(screenXs[1], reactionArrowBase, f32, '#7c3aed', forceLabel('F', '32'), formatScientific(Math.abs(f32), 'N'), { scale: reactionScale, maxLength: 140, minVisibleLength: 28, labelGap: 20, magnitudeGap: 28 });
    }

    ctx.save();
    ctx.font = `700 18px ${CANVAS_FONT}`;
    ctx.fillStyle = '#15304d';
    ctx.textAlign = 'center';
    ctx.fillText(`${forceLabel('F', 'total')} on ${massLabel(3)} = ${formatScientific(Math.abs(fTotal), 'N')}`, width / 2, 46);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(21, 48, 77, 0.75)';
    ctx.textAlign = 'center';
    ctx.font = `500 18px ${CANVAS_FONT}`;
    ctx.fillText(`Press Show Forces to reveal ${forceLabel('F', '13')}, ${forceLabel('F', '23')}, and ${forceLabel('F', 'total')} on ${massLabel(3)}.`, width / 2, 52);
    ctx.restore();
  }
}

function draw() {
  const width = canvas.width;
  const height = canvas.height;
  const positions = getPositions();
  const masses = getMasses();
  const labels = state.model === 'two' ? [massLabel(1), massLabel(2)] : [massLabel(1), massLabel(2), massLabel(3)];
  const colors = state.model === 'two' ? ['#3b82f6', '#ef4444'] : ['#3b82f6', '#ef4444', '#8b5cf6'];

  const minX = Math.min(...positions);
  const maxX = Math.max(...positions);
  const span = Math.max(maxX - minX, 1);
  const margin = 120;
  const usableWidth = width - margin * 2;
  const screenXs = positions.map((x) => margin + ((x - minX) / span) * usableWidth);

  ctx.clearRect(0, 0, width, height);
  drawGrid(width, height);

  const baseY = height * 0.50;
  const radii = masses.map((mass) => 26 + ((clamp(Math.log10(mass), -99, 99) + 99) / 198) * 30);

  drawDistanceMarkers(screenXs, height * 0.9);
  screenXs.forEach((screenX, index) => {
    drawMass(screenX, baseY, radii[index], colors[index], labels[index], masses[index]);
  });

  if (state.model === 'two') {
    drawTwoBody(screenXs, masses, radii, baseY, width, height, positions);
  } else {
    drawThreeBody(screenXs, masses, radii, baseY, width, height, positions);
  }
}

controls.model.addEventListener('change', () => {
  state.model = controls.model.value;
  updateAllDisplays();
  draw();
});

controls.configuration.addEventListener('change', () => {
  state.configuration = controls.configuration.value;
  updateAllDisplays();
  draw();
});

controls.toggleForces.addEventListener('click', () => {
  state.showForces = !state.showForces;
  controls.toggleForces.textContent = state.showForces ? 'Hide Forces' : 'Show Forces';
  controls.toggleForces.classList.toggle('active', state.showForces);
  controls.toggleForces.setAttribute('aria-pressed', String(state.showForces));
  draw();
});

controls.reactionToggle.addEventListener('click', () => {
  state.showReactionForces = !state.showReactionForces;
  controls.reactionToggle.textContent = state.showReactionForces ? `Hide ${forceLabel('F', '31')} and ${forceLabel('F', '32')}` : `Show ${forceLabel('F', '31')} and ${forceLabel('F', '32')}`;
  controls.reactionToggle.classList.toggle('active', state.showReactionForces);
  controls.reactionToggle.setAttribute('aria-pressed', String(state.showReactionForces));
  draw();
});

wireScientificControl('m1', 'kg');
wireScientificControl('m2', 'kg');
wireScientificControl('m3', 'kg');
wireScientificControl('r', 'm');
wireScientificControl('offset', 'm');
updateAllDisplays();
draw();
updateMath();
