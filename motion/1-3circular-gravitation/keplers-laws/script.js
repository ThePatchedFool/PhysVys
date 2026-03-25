const TAU = Math.PI * 2;

const state = {
  a: 180,
  e: 0,
  period: 18,
  interval: 1.6,
  areaSeparationDeg: 180,
  comparisonA: 270,
  showFoci: false,
  showAreas: false,
  showThirdLaw: false,
  animate: true,
  time: 0,
  lastTimestamp: null,
  areaSweep: {
    startMeanAnomaly: 0,
    firstAngles: [],
    secondAngles: [],
  },
};

const controls = {
  aSlider: document.getElementById('a-slider'),
  aInput: document.getElementById('a-input'),
  aDisplay: document.getElementById('a-display'),
  eSlider: document.getElementById('e-slider'),
  eInput: document.getElementById('e-input'),
  eDisplay: document.getElementById('e-display'),
  periodSlider: document.getElementById('period-slider'),
  periodInput: document.getElementById('period-input'),
  periodDisplay: document.getElementById('period-display'),
  intervalSlider: document.getElementById('interval-slider'),
  intervalInput: document.getElementById('interval-input'),
  intervalDisplay: document.getElementById('interval-display'),
  separationSlider: document.getElementById('separation-slider'),
  separationInput: document.getElementById('separation-input'),
  separationDisplay: document.getElementById('separation-display'),
  comparisonSlider: document.getElementById('comparison-slider'),
  comparisonInput: document.getElementById('comparison-input'),
  comparisonDisplay: document.getElementById('comparison-display'),
  toggleFoci: document.getElementById('toggle-foci'),
  toggleAreas: document.getElementById('toggle-areas'),
  toggleThirdLaw: document.getElementById('toggle-third-law'),
  toggleAnimation: document.getElementById('toggle-animation'),
  areaReadout: document.getElementById('area-readout'),
  thirdLawReadout: document.getElementById('third-law-readout'),
};

const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function resetAreaSweep() {
  state.areaSweep.startMeanAnomaly = normalizeAngle((state.time / state.period) * TAU);
  state.areaSweep.firstAngles = [];
  state.areaSweep.secondAngles = [];
}

function clearAreaSweepLines() {
  state.areaSweep.firstAngles = [];
  state.areaSweep.secondAngles = [];
}

function syncPair(slider, input, display, key, formatter) {
  function commit(raw) {
    const step = Number(slider.step);
    const min = Number(slider.min);
    const max = Number(slider.max);
    const snapped = Math.round(raw / step) * step;
    const decimals = step < 1 ? 2 : 0;
    const value = Number(clamp(snapped, min, max).toFixed(decimals));
    state[key] = value;
    slider.value = String(value);
    input.value = String(value);
    display.textContent = formatter(value);
    if (key === 'a' || key === 'e' || key === 'period' || key === 'interval') {
      if (state.showAreas) {
        clearAreaSweepLines();
      } else {
        resetAreaSweep();
      }
    }
    if (key === 'areaSeparationDeg' && state.showAreas) {
      clearAreaSweepLines();
    }
    updateReadouts();
    draw();
  }

  slider.addEventListener('input', () => commit(Number(slider.value)));
  input.addEventListener('input', () => {
    if (input.value !== '') commit(Number(input.value));
  });
  input.addEventListener('blur', () => commit(Number(input.value || state[key])));
  commit(state[key]);
}


function solveEccentricAnomaly(meanAnomaly, eccentricity) {
  let E = meanAnomaly;
  for (let i = 0; i < 8; i += 1) {
    E -= (E - eccentricity * Math.sin(E) - meanAnomaly) / (1 - eccentricity * Math.cos(E));
  }
  return E;
}

function orbitalPointFromFocus(a, e, meanAnomaly) {
  const E = solveEccentricAnomaly(meanAnomaly, e);
  const b = a * Math.sqrt(1 - e * e);
  const x = a * (e - Math.cos(E));
  const y = b * Math.sin(E);
  return { x, y, E, b };
}

function toCanvas(point, originX, originY) {
  return { x: originX + point.x, y: originY - point.y };
}

function orbitPeriodFromThirdLaw(a1, t1, a2) {
  return t1 * Math.pow(a2 / a1, 1.5);
}

function angularTravel(start, target) {
  return normalizeAngle(target - start);
}

function angleIsBetween(start, end, angle) {
  const span = angularTravel(start, end);
  const travel = angularTravel(start, angle);
  return travel <= span;
}

function drawPowerText(base, power, x, y, options = {}) {
  const align = options.align ?? 'left';
  const rotation = options.rotation ?? 0;
  const baseFont = options.baseFont ?? '500 13px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  const powerFont = options.powerFont ?? '700 10px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  const color = options.color ?? '#15304d';
  const powerDx = options.powerDx ?? 1;
  const powerDy = options.powerDy ?? -7;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.font = baseFont;
  ctx.fillText(base, 0, 0);

  const baseWidth = ctx.measureText(base).width;
  const offsetX = align === 'center' ? baseWidth * 0.5 : align === 'right' ? 0 : baseWidth;
  ctx.font = powerFont;
  ctx.fillText(power, offsetX + powerDx, powerDy);
  ctx.restore();
}

function drawEllipse(centerX, centerY, a, e, color, alpha = 1) {
  const b = a * Math.sqrt(1 - e * e);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, a, b, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawFocus(centerX, centerY, offsetX, label, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(centerX + offsetX, centerY, 6, 0, TAU);
  ctx.fill();
  ctx.font = '700 15px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, centerX + offsetX, centerY - 14);
  ctx.restore();
}

function drawAxesAndFoci(centerX, centerY, a, e) {
  const b = a * Math.sqrt(1 - e * e);
  const c = a * e;

  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = 'rgba(21,48,77,0.36)';
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(centerX - a, centerY);
  ctx.lineTo(centerX + a, centerY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX, centerY - b);
  ctx.lineTo(centerX, centerY + b);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(21,48,77,0.7)';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 4, 0, TAU);
  ctx.fill();
  ctx.font = '700 14px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Centre', centerX + 10, centerY - 10);
  ctx.textAlign = 'center';
  ctx.fillText('Major axis', centerX, centerY + 24);
  ctx.save();
  ctx.translate(centerX - 12, centerY);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Minor axis', 0, 0);
  ctx.restore();
  ctx.restore();

  drawFocus(centerX, centerY, -c, 'Sun focus', '#f59e0b');
  drawFocus(centerX, centerY, c, 'Second focus', '#64748b');
}

function maybeStoreSweepAngle(bucket, angle, start, end, spacing) {
  if (!angleIsBetween(start, end, angle)) {
    return;
  }
  if (bucket.length === 0 || Math.abs(angle - bucket[bucket.length - 1]) >= spacing) {
    bucket.push(angle);
  }
}

function drawStoredSweepLines(angles, a, e, focusX, focusY, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  angles.forEach((angle) => {
    const point = toCanvas(orbitalPointFromFocus(a, e, angle), focusX, focusY);
    ctx.beginPath();
    ctx.moveTo(focusX, focusY);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawThirdLawPlot(x, y, width, height, a1, t1, a2, t2) {
  const a1Cubed = a1 ** 3;
  const a2Cubed = a2 ** 3;
  const t1Squared = t1 ** 2;
  const t2Squared = t2 ** 2;
  const maxX = Math.max(a1Cubed, a2Cubed) * 1.12;
  const maxY = Math.max(t1Squared, t2Squared) * 1.12;

  function px(value) {
    return x + (value / maxX) * width;
  }

  function py(value) {
    return y + height - (value / maxY) * height;
  }

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.74)';
  ctx.strokeStyle = 'rgba(21,48,77,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - 18, y - 28, width + 42, height + 52, 18);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(21,48,77,0.25)';
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.moveTo(x, y + height);
  ctx.lineTo(x, y);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(15,118,110,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px(0), py(0));
  ctx.lineTo(px(maxX), py((t1Squared / a1Cubed) * maxX));
  ctx.stroke();

  const points = [
    { x: px(a1Cubed), y: py(t1Squared), label: 'Orbit 1', color: '#2563eb' },
    { x: px(a2Cubed), y: py(t2Squared), label: 'Orbit 2', color: '#ea580c' },
  ];

  points.forEach((point) => {
    ctx.fillStyle = point.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, TAU);
    ctx.fill();
    ctx.font = '700 13px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(point.label, point.x + 10, point.y - 8);
  });

  ctx.fillStyle = '#15304d';
  ctx.font = '700 15px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.fillText('Kepler III:', x, y - 8);
  drawPowerText('T', '2', x + 88, y - 8, { baseFont: '700 15px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif', powerFont: '700 11px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif' });
  ctx.fillText('vs', x + 114, y - 8);
  drawPowerText('a', '3', x + 138, y - 8, { baseFont: '700 15px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif', powerFont: '700 11px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif' });
  drawPowerText('a', '3', x + width - 10, y + height + 22, { align: 'right' });
  drawPowerText('T', '2', x - 22, y + 18, { rotation: -Math.PI / 2, align: 'left' });
  ctx.restore();
}

function updateReadouts() {
  const intervalAngle = (state.interval / state.period) * TAU;
  const startDegrees = ((state.areaSweep.startMeanAnomaly * 180) / Math.PI).toFixed(0);
  controls.areaReadout.textContent = `Area 1 begins from the captured start angle (${startDegrees}\u00B0). Area 2 begins ${state.areaSeparationDeg.toFixed(0)}\u00B0 later. Each sweep lasts \u0394t = ${state.interval.toFixed(1)}.`;

  const t2 = orbitPeriodFromThirdLaw(state.a, state.period, state.comparisonA);
  const ratio1 = (state.period ** 2 / state.a ** 3).toFixed(5);
  const ratio2 = (t2 ** 2 / state.comparisonA ** 3).toFixed(5);
  controls.thirdLawReadout.innerHTML = `Orbit 1: T<sup>2</sup>/a<sup>3</sup> = ${ratio1}, Orbit 2: T<sup>2</sup>/a<sup>3</sup> = ${ratio2}.`;
}

function updateMath() {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise().catch(() => {});
  }
}

function drawOrbitSystem(centerX, centerY, a, e, period, orbitColor, planetColor, sunRadius, planetRadius) {
  const c = a * e;
  const sun = { x: centerX - c, y: centerY };
  drawEllipse(centerX, centerY, a, e, orbitColor);

  const meanAnomaly = normalizeAngle((state.time / period) * TAU);
  const planetPoint = orbitalPointFromFocus(a, e, meanAnomaly);
  const planet = toCanvas(planetPoint, sun.x, sun.y);

  ctx.save();
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sunRadius, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(21,48,77,0.38)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sun.x, sun.y);
  ctx.lineTo(planet.x, planet.y);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = planetColor;
  ctx.beginPath();
  ctx.arc(planet.x, planet.y, planetRadius, 0, TAU);
  ctx.fill();
  ctx.restore();

  return { sun, planet, meanAnomaly };
}

function draw() {
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = 'rgba(21,48,77,0.08)';
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

  const mainCenterX = width * 0.39;
  const mainCenterY = height * 0.42;
  const mainSystem = drawOrbitSystem(mainCenterX, mainCenterY, state.a, state.e, state.period, 'rgba(37,99,235,0.75)', '#2563eb', 18, 10);

  if (state.showAreas) {
    const intervalAngle = (state.interval / state.period) * TAU;
    const startAngle = state.areaSweep.startMeanAnomaly;
    const secondStart = normalizeAngle(startAngle + degreesToRadians(state.areaSeparationDeg));
    const firstEnd = normalizeAngle(startAngle + intervalAngle);
    const secondEnd = normalizeAngle(secondStart + intervalAngle);
    const spacing = Math.max(0.0035, intervalAngle / 96);

    maybeStoreSweepAngle(state.areaSweep.firstAngles, mainSystem.meanAnomaly, startAngle, firstEnd, spacing);
    maybeStoreSweepAngle(state.areaSweep.secondAngles, mainSystem.meanAnomaly, secondStart, secondEnd, spacing);

    drawStoredSweepLines(state.areaSweep.firstAngles, state.a, state.e, mainSystem.sun.x, mainSystem.sun.y, 'rgba(37,99,235,0.24)');
    drawStoredSweepLines(state.areaSweep.secondAngles, state.a, state.e, mainSystem.sun.x, mainSystem.sun.y, 'rgba(234,88,12,0.24)');
  }

  if (state.showFoci) {
    drawAxesAndFoci(mainCenterX, mainCenterY, state.a, state.e);
  }

  ctx.save();
  ctx.font = '700 15px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7c2d12';
  ctx.fillText('Sun', mainSystem.sun.x, mainSystem.sun.y + 38);
  ctx.restore();

  if (state.showThirdLaw) {
    const comparisonE = state.e;
    const comparisonT = orbitPeriodFromThirdLaw(state.a, state.period, state.comparisonA);
    const comparisonScale = 0.55;
    const comparisonA = state.comparisonA * comparisonScale;
    const comparisonCenterX = width * 0.39;
    const comparisonCenterY = 887;
    drawOrbitSystem(comparisonCenterX, comparisonCenterY, comparisonA, comparisonE, comparisonT, 'rgba(234,88,12,0.75)', '#ea580c', 10, 7);

    ctx.save();
    ctx.fillStyle = '#15304d';
    ctx.font = '700 15px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Orbit 2', comparisonCenterX, comparisonCenterY - comparisonA - 16);
    ctx.font = '500 13px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
    ctx.fillText(`a2 = ${state.comparisonA.toFixed(0)}`, comparisonCenterX, comparisonCenterY - comparisonA + 4);
    ctx.fillText(`T2 = ${comparisonT.toFixed(2)}`, comparisonCenterX, comparisonCenterY - comparisonA + 22);
    ctx.restore();

    drawThirdLawPlot(width * 0.60, height * 0.60, width * 0.27, height * 0.22, state.a, state.period, state.comparisonA, comparisonT);
  }

  ctx.save();
  ctx.fillStyle = '#15304d';
  ctx.font = '700 18px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.fillText(`Orbit 1: a = ${state.a.toFixed(0)}, e = ${state.e.toFixed(2)}, T = ${state.period.toFixed(1)}`, 28, 34);
  ctx.font = '500 15px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.fillText('Use the area toggle to capture a starting position anywhere on the orbit.', 28, 58);
  if (state.showAreas) {
    ctx.fillText(`Area 2 begins ${state.areaSeparationDeg.toFixed(0)}\u00B0 after the captured start position.`, 28, 82);
  }
  ctx.restore();
}

function animate(timestamp) {
  if (state.lastTimestamp === null) state.lastTimestamp = timestamp;
  const deltaSeconds = (timestamp - state.lastTimestamp) / 1000;
  state.lastTimestamp = timestamp;
  if (state.animate) {
    state.time += deltaSeconds * 1.5;
  }
  draw();
  window.requestAnimationFrame(animate);
}

syncPair(controls.aSlider, controls.aInput, controls.aDisplay, 'a', (value) => `a = ${value.toFixed(0)}`);
syncPair(controls.eSlider, controls.eInput, controls.eDisplay, 'e', (value) => `e = ${value.toFixed(2)}`);
syncPair(controls.periodSlider, controls.periodInput, controls.periodDisplay, 'period', (value) => `T = ${value.toFixed(1)}`);
syncPair(controls.intervalSlider, controls.intervalInput, controls.intervalDisplay, 'interval', (value) => `\u0394t = ${value.toFixed(1)}`);
syncPair(controls.separationSlider, controls.separationInput, controls.separationDisplay, 'areaSeparationDeg', (value) => `Separation = ${value.toFixed(0)}\u00B0`);
syncPair(controls.comparisonSlider, controls.comparisonInput, controls.comparisonDisplay, 'comparisonA', (value) => `a2 = ${value.toFixed(0)}`);

function wireToggle(button, key, activeText, inactiveText = activeText) {
  button.addEventListener('click', () => {
    state[key] = !state[key];
    if (key === 'showAreas' && state[key]) {
      resetAreaSweep();
    }
    if (key === 'showAreas' && !state[key]) {
      state.areaSweep.firstAngles = [];
      state.areaSweep.secondAngles = [];
    }
    button.classList.toggle('active', state[key]);
    button.textContent = state[key] ? activeText : inactiveText;
    updateReadouts();
    draw();
  });
  button.classList.toggle('active', state[key]);
  button.textContent = state[key] ? activeText : inactiveText;
}

wireToggle(controls.toggleFoci, 'showFoci', 'Hide Axes and Foci', 'Show Axes and Foci');
wireToggle(controls.toggleAreas, 'showAreas', 'Hide Equal Areas', 'Show Equal Areas');
wireToggle(controls.toggleThirdLaw, 'showThirdLaw', 'Hide Third Law', 'Show Third Law');
wireToggle(controls.toggleAnimation, 'animate', 'Pause Orbit', 'Resume Orbit');

updateReadouts();
draw();
updateMath();
window.requestAnimationFrame(animate);







