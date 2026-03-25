const TAU = Math.PI * 2;
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

const vectorDefinitions = {
  radius: { label: 'r', color: '#2563eb' },
  velocity: { label: 'v', color: '#0f766e' },
  acceleration: { label: 'a', color: '#dc2626' },
  force: { label: 'F_c', color: '#7c3aed' },
};

const modeDefinitions = {
  'find-acceleration-force': {
    label: 'Set radius, period, mass',
    summary: 'Students control radius, period, and mass, then reveal acceleration and centripetal force.',
    equations: '\\(v = \\frac{2\\pi r}{T}\\), \\(a = \\frac{v^2}{r} = \\frac{4\\pi^2 r}{T^2}\\), \\(F_c = ma\\)',
    controls: [
      field('radius', 'Radius, r', 'm', 1.0, 9.99, 0.01, 2.40, 1),
      field('period', 'Period, T', 's', 1.0, 9.99, 0.01, 6.00, 0),
      field('mass', 'Mass, m', 'kg', 1.0, 9.99, 0.01, 5.00, 0),
    ],
    hidden: ['acceleration', 'force'],
    compute(values) {
      const velocity = TAU * values.radius / values.period;
      const acceleration = (velocity * velocity) / values.radius;
      const force = values.mass * acceleration;
      return { ...values, velocity, acceleration, force };
    },
  },
  'find-radius': {
    label: 'Set acceleration, velocity, mass',
    summary: 'Students control acceleration, velocity, and mass, then reveal the radius needed for that motion.',
    equations: '\\(a = \\frac{v^2}{r}\\Rightarrow r = \\frac{v^2}{a}\\), \\(F_c = ma\\)',
    controls: [
      field('acceleration', 'Acceleration, a', 'm/s^2', 1.0, 9.99, 0.01, 8.00, 0),
      field('velocity', 'Speed, v', 'm/s', 1.0, 9.99, 0.01, 1.20, 1),
      field('mass', 'Mass, m', 'kg', 1.0, 9.99, 0.01, 5.00, 0),
    ],
    hidden: ['radius', 'force'],
    compute(values) {
      const radius = (values.velocity * values.velocity) / values.acceleration;
      const period = TAU * radius / values.velocity;
      const force = values.mass * values.acceleration;
      return { ...values, radius, period, force };
    },
  },
  'find-period': {
    label: 'Set radius, velocity, mass',
    summary: 'Students control radius, speed, and mass, then reveal the period and the corresponding force.',
    equations: '\\(T = \\frac{2\\pi r}{v}\\), \\(a = \\frac{v^2}{r}\\), \\(F_c = ma\\)',
    controls: [
      field('radius', 'Radius, r', 'm', 1.0, 9.99, 0.01, 2.00, 1),
      field('velocity', 'Speed, v', 'm/s', 1.0, 9.99, 0.01, 1.00, 1),
      field('mass', 'Mass, m', 'kg', 1.0, 9.99, 0.01, 5.00, 0),
    ],
    hidden: ['period', 'force'],
    compute(values) {
      const period = TAU * values.radius / values.velocity;
      const acceleration = (values.velocity * values.velocity) / values.radius;
      const force = values.mass * acceleration;
      return { ...values, period, acceleration, force };
    },
  },
  'find-velocity': {
    label: 'Set radius, period',
    summary: 'Students control radius and period, then reveal the speed and acceleration required for that motion.',
    equations: '\\(v = \\frac{2\\pi r}{T}\\), \\(a = \\frac{v^2}{r}\\)',
    controls: [
      field('radius', 'Radius, r', 'm', 1.0, 9.99, 0.01, 1.80, 1),
      field('period', 'Period, T', 's', 1.0, 9.99, 0.01, 4.50, 0),
    ],
    hidden: ['velocity', 'acceleration'],
    compute(values) {
      const velocity = TAU * values.radius / values.period;
      const acceleration = (velocity * velocity) / values.radius;
      return { ...values, velocity, acceleration };
    },
  },
};

const valueFormatters = {
  radius: (value) => formatScientific(value, 'm'),
  period: (value) => formatScientific(value, 's'),
  mass: (value) => formatScientific(value, 'kg'),
  velocity: (value) => formatScientific(value, 'm/s'),
  acceleration: (value) => formatScientific(value, 'm/s^2'),
  force: (value) => formatScientific(value, 'N'),
};

const resultLabels = {
  radius: 'Radius, r',
  period: 'Period, T',
  mass: 'Mass, m',
  velocity: 'Speed, v',
  acceleration: 'Acceleration, a',
  force: 'Centripetal force, F_c',
};

const state = {
  mode: 'find-acceleration-force',
  revealed: {},
  vectors: {
    radius: false,
    velocity: false,
    acceleration: false,
    force: false,
  },
  values: {},
  angle: 0,
  lastTime: null,
};

const controlsRoot = document.getElementById('active-controls');
const modeSelect = document.getElementById('mode-select');
const equationText = document.getElementById('equation-text');
const modeSummary = document.getElementById('mode-summary');
const resultsRoot = document.getElementById('results');
const vectorTogglesRoot = document.getElementById('vector-toggles');
const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');

function field(key, label, unit, minMantissa, maxMantissa, step, mantissa, exponent) {
  return { key, label, unit, minMantissa, maxMantissa, step, mantissa, exponent };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scientificValue(entry) {
  return entry.mantissa * (10 ** entry.exponent);
}

function formatScientific(value, unit = '') {
  const unitPart = unit ? ` ${unit}` : '';
  if (value === 0) return `0${unitPart}`;
  if (!Number.isFinite(value)) return `Overflow${unitPart}`;
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / (10 ** exponent);
  const roundedMantissa = Math.abs(mantissa) >= 9.995 ? 10 : mantissa;
  const finalExponent = roundedMantissa === 10 ? exponent + 1 : exponent;
  const finalMantissa = roundedMantissa === 10 ? 1 : roundedMantissa;
  return `${finalMantissa.toFixed(3)} × 10${toSuperscript(finalExponent)}${unitPart}`;
}

function toSuperscript(value) {
  return String(value).split('').map((char) => SUPERSCRIPT_DIGITS[char] ?? char).join('');
}

function updateMath() {
  if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise();
}

function getMode() {
  return modeDefinitions[state.mode];
}

function isHidden(key) {
  return getMode().hidden.includes(key);
}

function isRevealed(key) {
  return !isHidden(key) || !!state.revealed[key];
}

function maybeFormatted(key, value) {
  return isRevealed(key) ? valueFormatters[key](value) : 'Hidden';
}

function initializeMode(modeKey) {
  state.mode = modeKey;
  state.revealed = {};
  state.values = {};
  const mode = getMode();
  mode.controls.forEach((control) => {
    state.values[control.key] = {
      mantissa: control.mantissa,
      exponent: control.exponent,
      value: control.mantissa * (10 ** control.exponent),
    };
  });
  mode.hidden.forEach((key) => {
    state.revealed[key] = false;
  });
  modeSelect.value = modeKey;
  equationText.innerHTML = mode.equations;
  modeSummary.textContent = mode.summary;
  renderVectorToggles();
  renderControls();
  renderResults();
  draw();
  updateMath();
}

function renderVectorToggles() {
  vectorTogglesRoot.innerHTML = '';
  const computed = getComputedValues();
  Object.entries(vectorDefinitions).forEach(([key, definition]) => {
    if (key === 'force' && typeof computed.force !== 'number') return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `vector-chip${state.vectors[key] ? ' active' : ''}`;
    button.textContent = definition.label;
    button.addEventListener('click', () => {
      state.vectors[key] = !state.vectors[key];
      renderVectorToggles();
      draw();
    });
    vectorTogglesRoot.appendChild(button);
  });
}

function renderControls() {
  const mode = getMode();
  controlsRoot.innerHTML = '';
  mode.controls.forEach((control) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'control-group';
    const label = document.createElement('label');
    label.htmlFor = `${control.key}-slider`;
    label.textContent = `${control.label} (${control.unit})`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `${control.key}-slider`;
    slider.min = String(control.minMantissa);
    slider.max = String(control.maxMantissa);
    slider.step = String(control.step);
    slider.value = String(state.values[control.key].mantissa);
    const row = document.createElement('div');
    row.className = 'scientific-row';
    const mantissaInput = document.createElement('input');
    mantissaInput.type = 'number';
    mantissaInput.min = String(control.minMantissa);
    mantissaInput.max = String(control.maxMantissa);
    mantissaInput.step = String(control.step);
    mantissaInput.value = state.values[control.key].mantissa.toFixed(2);
    const timesTen = document.createElement('span');
    timesTen.className = 'times-ten';
    timesTen.textContent = '× 10';
    const exponentInput = document.createElement('input');
    exponentInput.type = 'number';
    exponentInput.min = '-99';
    exponentInput.max = '99';
    exponentInput.step = '1';
    exponentInput.value = String(state.values[control.key].exponent);
    row.appendChild(mantissaInput);
    row.appendChild(timesTen);
    row.appendChild(exponentInput);
    const display = document.createElement('p');
    display.className = 'value-display';
    display.textContent = `${control.label} = ${valueFormatters[control.key](state.values[control.key].value)}`;

    function sync() {
      const current = state.values[control.key];
      current.value = scientificValue(current);
      slider.value = String(current.mantissa);
      mantissaInput.value = current.mantissa.toFixed(2);
      exponentInput.value = String(current.exponent);
      display.textContent = `${control.label} = ${valueFormatters[control.key](current.value)}`;
      renderVectorToggles();
      renderResults();
      draw();
    }
    function commitMantissa(rawValue) {
      const snapped = Math.round(rawValue / control.step) * control.step;
      state.values[control.key].mantissa = Number(clamp(snapped, control.minMantissa, control.maxMantissa).toFixed(2));
      sync();
    }
    function commitExponent(rawValue) {
      const safeValue = Number.isFinite(rawValue) ? rawValue : state.values[control.key].exponent;
      state.values[control.key].exponent = clamp(Math.round(safeValue), -99, 99);
      sync();
    }

    slider.addEventListener('input', () => commitMantissa(Number(slider.value)));
    mantissaInput.addEventListener('input', () => {
      if (mantissaInput.value !== '') commitMantissa(Number(mantissaInput.value));
    });
    mantissaInput.addEventListener('blur', () => commitMantissa(Number(mantissaInput.value || state.values[control.key].mantissa)));
    exponentInput.addEventListener('input', () => {
      if (exponentInput.value !== '' && exponentInput.value !== '-') commitExponent(Number(exponentInput.value));
    });
    exponentInput.addEventListener('blur', () => commitExponent(Number(exponentInput.value || state.values[control.key].exponent)));

    wrapper.appendChild(label);
    wrapper.appendChild(slider);
    wrapper.appendChild(row);
    wrapper.appendChild(display);
    controlsRoot.appendChild(wrapper);
  });
}

function flattenedValues() {
  const flattened = {};
  Object.entries(state.values).forEach(([key, entry]) => {
    flattened[key] = entry.value;
  });
  return flattened;
}

function getComputedValues() {
  return getMode().compute(flattenedValues());
}

function renderResults() {
  const mode = getMode();
  const computed = getComputedValues();
  resultsRoot.innerHTML = '';
  mode.hidden.forEach((key) => {
    const card = document.createElement('div');
    card.className = `result-card${state.revealed[key] ? '' : ' hidden'}`;
    const label = document.createElement('span');
    label.className = 'result-label';
    label.textContent = resultLabels[key];
    const value = document.createElement('span');
    value.className = 'result-value';
    value.textContent = valueFormatters[key](computed[key]);
    const actions = document.createElement('div');
    actions.className = 'result-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `reveal-chip${state.revealed[key] ? ' active' : ''}`;
    button.textContent = state.revealed[key] ? `Hide ${resultLabels[key]}` : `Reveal ${resultLabels[key]}`;
    button.addEventListener('click', () => {
      state.revealed[key] = !state.revealed[key];
      renderResults();
      draw();
    });
    actions.appendChild(button);
    card.appendChild(label);
    card.appendChild(value);
    card.appendChild(actions);
    resultsRoot.appendChild(card);
  });
}

function scaledRadius(radiusValue) {
  if (!Number.isFinite(radiusValue) || radiusValue <= 0) return 120;
  const exponent = clamp(Math.log10(radiusValue), -99, 99);
  const normalized = (exponent + 99) / 198;
  return 110 + normalized * 90;
}

function drawArrow(x1, y1, x2, y2, color, label, magnitude) {
  const headLength = 12;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  ctx.font = `700 15px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(label, midX, midY - 16);
  if (magnitude) {
    ctx.font = `500 13px ${CANVAS_FONT}`;
    ctx.fillText(magnitude, midX, midY + 20);
  }
  ctx.restore();
}

function draw() {
  const width = canvas.width;
  const height = canvas.height;
  const computed = getComputedValues();
  const radius = scaledRadius(computed.radius ?? 12);
  const centerX = width * 0.5;
  const centerY = height * 0.52;

  ctx.clearRect(0, 0, width, height);
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

  ctx.save();
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.25)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, TAU);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#15304d';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 8, 0, TAU);
  ctx.fill();
  ctx.font = `700 16px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Centre', centerX, centerY - 16);
  ctx.restore();

  const particleX = centerX + radius * Math.cos(state.angle);
  const particleY = centerY + radius * Math.sin(state.angle);
  ctx.save();
  const particleGradient = ctx.createRadialGradient(particleX - 10, particleY - 10, 5, particleX, particleY, 24);
  particleGradient.addColorStop(0, 'rgba(255,255,255,0.96)');
  particleGradient.addColorStop(0.2, '#ea580c');
  particleGradient.addColorStop(1, 'rgba(120, 53, 15, 0.94)');
  ctx.fillStyle = particleGradient;
  ctx.beginPath();
  ctx.arc(particleX, particleY, 20, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#10253d';
  ctx.font = `700 15px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('m', particleX, particleY + 5);
  ctx.restore();

  const velocityMagnitude = computed.velocity ?? (TAU * computed.radius / computed.period);
  const accelerationMagnitude = computed.acceleration ?? ((velocityMagnitude * velocityMagnitude) / computed.radius);
  const forceMagnitude = typeof computed.force === 'number' ? computed.force : null;

  if (state.vectors.radius) {
    drawArrow(centerX, centerY, particleX, particleY, vectorDefinitions.radius.color, vectorDefinitions.radius.label, isRevealed('radius') ? valueFormatters.radius(computed.radius) : null);
  }
  if (state.vectors.velocity) {
    const tangentLength = 100;
    const tangentAngle = state.angle + Math.PI / 2;
    const velocityX = particleX + tangentLength * Math.cos(tangentAngle);
    const velocityY = particleY + tangentLength * Math.sin(tangentAngle);
    drawArrow(particleX, particleY, velocityX, velocityY, vectorDefinitions.velocity.color, vectorDefinitions.velocity.label, isRevealed('velocity') ? valueFormatters.velocity(velocityMagnitude) : null);
  }
  if (state.vectors.acceleration) {
    const accelerationLength = 92;
    const accelAngle = state.angle + Math.PI;
    const accelX = particleX + accelerationLength * Math.cos(accelAngle);
    const accelY = particleY + accelerationLength * Math.sin(accelAngle);
    drawArrow(particleX, particleY, accelX, accelY, vectorDefinitions.acceleration.color, vectorDefinitions.acceleration.label, isRevealed('acceleration') ? valueFormatters.acceleration(accelerationMagnitude) : null);
  }
  if (state.vectors.force && forceMagnitude !== null) {
    const forceLength = 66;
    const forceAngle = state.angle + Math.PI;
    const forceX = particleX + forceLength * Math.cos(forceAngle);
    const forceY = particleY + forceLength * Math.sin(forceAngle);
    drawArrow(particleX, particleY, forceX, forceY, vectorDefinitions.force.color, vectorDefinitions.force.label, isRevealed('force') ? valueFormatters.force(forceMagnitude) : null);
  }

  ctx.save();
  ctx.fillStyle = '#15304d';
  ctx.textAlign = 'left';
  ctx.font = `700 18px ${CANVAS_FONT}`;
  ctx.fillText(`Mode: ${getMode().label}`, 28, 34);
  ctx.font = `500 16px ${CANVAS_FONT}`;
  ctx.fillText(`r = ${maybeFormatted('radius', computed.radius)}`, 28, 64);
  ctx.fillText(`T = ${maybeFormatted('period', computed.period)}`, 28, 90);
  ctx.fillText(`v = ${maybeFormatted('velocity', velocityMagnitude)}`, 28, 116);
  ctx.fillText(`a = ${maybeFormatted('acceleration', accelerationMagnitude)}`, 28, 142);
  if (forceMagnitude !== null) {
    ctx.fillText(`F_c = ${maybeFormatted('force', forceMagnitude)}`, 28, 168);
  }
  ctx.restore();
}

function animate(timestamp) {
  if (state.lastTime === null) state.lastTime = timestamp;
  const deltaSeconds = (timestamp - state.lastTime) / 1000;
  state.lastTime = timestamp;
  const computed = getComputedValues();
  const period = Math.max(computed.period ?? 1, 0.25);
  state.angle = (state.angle + (TAU * deltaSeconds) / period) % TAU;
  draw();
  window.requestAnimationFrame(animate);
}

modeSelect.addEventListener('change', () => initializeMode(modeSelect.value));

initializeMode(state.mode);
window.requestAnimationFrame(animate);
