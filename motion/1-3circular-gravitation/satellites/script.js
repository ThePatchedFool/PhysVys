const state = {
  mode: 'compare',
  speed: 1.2,
  showPolar: false,
  showEquatorial: false,
  showGeostationary: false,
  geoRequirements: {
    equatorialPlane: false,
    sameDirection: false,
    largeRadius: false,
  },
  applicationOrbit: 'polar',
  geoRadiusMode: 'small',
  time: 0,
  lastTimestamp: null,
};

const controls = {
  modeButtons: Array.from(document.querySelectorAll('[data-mode]')),
  speedSlider: document.getElementById('speed-slider'),
  speedInput: document.getElementById('speed-input'),
  speedDisplay: document.getElementById('speed-display'),
  comparePanel: document.getElementById('compare-controls'),
  geoPanel: document.getElementById('geo-controls'),
  applicationsPanel: document.getElementById('applications-controls'),
  scalePanel: document.getElementById('scale-controls'),
  togglePolar: document.getElementById('toggle-polar'),
  toggleEquatorial: document.getElementById('toggle-equatorial'),
  toggleGeostationary: document.getElementById('toggle-geostationary'),
  toggleEquatorialPlane: document.getElementById('toggle-equatorial-plane'),
  toggleSameDirection: document.getElementById('toggle-same-direction'),
  toggleLargeRadius: document.getElementById('toggle-large-radius'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  applicationSelect: document.getElementById('application-select'),
  modeSummary: document.getElementById('mode-summary'),
  keyIdea: document.getElementById('key-idea'),
  orbitNote: document.getElementById('orbit-note'),
  root: document.getElementById('three-root'),
};

const ORBIT_COLORS = {
  polar: 0x2563eb,
  equatorial: 0xf97316,
  geostationary: 0xa855f7,
};

const NORMAL_RADII = {
  polar: 5.3,
  equatorial: 6.4,
  geostationary: 8.55,
  geostationarySmall: 5.55,
};

const SCALE_RADII = {
  polar: 3.2 * ((6371 + 500) / 6371),
  equatorial: 3.2 * ((6371 + 500) / 6371),
  geostationary: 3.2 * ((6371 + 35786) / 6371),
};

const APPLICATION_TEXT = {
  polar: {
    title: 'Polar orbit',
    note: 'Good for Earth observation, mapping, climate work, and reconnaissance because the Earth rotates underneath the orbital plane.',
  },
  equatorial: {
    title: 'Equatorial orbit',
    note: 'Useful when repeated low-latitude coverage or efficient low-inclination launch geometry matters.',
  },
  geostationary: {
    title: 'Geostationary orbit',
    note: 'Best for continuous communication, television, and weather monitoring over one fixed region of Earth.',
  },
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe7f1ff);

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
const cameraTarget = new THREE.Vector3(0, 0.7, 0);
const cameraState = { radius: 24, yaw: 0.42, pitch: 0.38 };
const interactionState = { dragging: false, lastX: 0, lastY: 0 };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
controls.root.appendChild(renderer.domElement);

const world = new THREE.Group();
scene.add(world);

const ambient = new THREE.HemisphereLight(0xf8fbff, 0x9fb8d9, 0.22);
scene.add(ambient);
const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
sunLight.position.set(14, 7, 11);
scene.add(sunLight);

const earthGroup = new THREE.Group();
world.add(earthGroup);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function createFallbackEarthTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const ocean = ctx.createLinearGradient(0, 0, 0, canvas.height);
  ocean.addColorStop(0, '#8ee3ff');
  ocean.addColorStop(0.45, '#2885f0');
  ocean.addColorStop(1, '#123d96');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= canvas.width; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 64; y < canvas.height; y += 96) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#74b816';
  const landShapes = [
    [110, 128, 180, 68, 0.24],
    [220, 258, 116, 96, -0.32],
    [460, 152, 196, 76, 0.08],
    [560, 298, 86, 58, 0.18],
    [742, 126, 196, 72, -0.14],
    [882, 272, 118, 78, 0.26],
  ];
  landShapes.forEach(([x, y, rx, ry, rotation]) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.ellipse(220, 86, 126, 34, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(664, 74, 146, 30, -0.08, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

const earthGeometry = new THREE.SphereGeometry(3.2, 40, 28);
const earthMaterial = new THREE.MeshStandardMaterial({
  map: createFallbackEarthTexture(),
  color: 0xffffff,
  roughness: 0.9,
  metalness: 0.01,
});
const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
earthGroup.add(earthMesh);

function createCoveragePaintLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3.215, 40, 28), material);
  mesh.visible = false;
  earthGroup.add(mesh);
  return { canvas, ctx, texture, mesh };
}

const coveragePaint = createCoveragePaintLayer();

function clearCoveragePaint() {
  coveragePaint.ctx.clearRect(0, 0, coveragePaint.canvas.width, coveragePaint.canvas.height);
  coveragePaint.texture.needsUpdate = true;
}

function paintCoverageFromOrbit(orbitKey) {
  if (!currentCoverageFootprint || currentCoverageFootprint.length < 3) return;

  const style = {
    polar: { color: 'rgba(37, 99, 235, 0.22)', outline: 'rgba(37, 99, 235, 0.38)' },
    equatorial: { color: 'rgba(249, 115, 22, 0.2)', outline: 'rgba(249, 115, 22, 0.34)' },
    geostationary: { color: 'rgba(168, 85, 247, 0.16)', outline: 'rgba(168, 85, 247, 0.28)' },
  }[orbitKey];

  const xs = currentCoverageFootprint.map((point) => point.x);
  const wrappedPoints = (Math.max(...xs) - Math.min(...xs) > coveragePaint.canvas.width * 0.5)
    ? currentCoverageFootprint.map((point) => ({ x: point.x < coveragePaint.canvas.width * 0.5 ? point.x + coveragePaint.canvas.width : point.x, y: point.y }))
    : currentCoverageFootprint;

  function stampPolygon(offsetX) {
    coveragePaint.ctx.fillStyle = style.color;
    coveragePaint.ctx.strokeStyle = style.outline;
    coveragePaint.ctx.lineWidth = 1.5;
    coveragePaint.ctx.beginPath();
    coveragePaint.ctx.moveTo(wrappedPoints[0].x + offsetX, wrappedPoints[0].y);
    for (let i = 1; i < wrappedPoints.length; i += 1) {
      coveragePaint.ctx.lineTo(wrappedPoints[i].x + offsetX, wrappedPoints[i].y);
    }
    coveragePaint.ctx.closePath();
    coveragePaint.ctx.fill();
    coveragePaint.ctx.stroke();
  }

  stampPolygon(0);
  stampPolygon(-coveragePaint.canvas.width);
  coveragePaint.texture.needsUpdate = true;
}

if (window.EARTH_TEXTURE_DATA_URL) {
  const embeddedEarthImage = new Image();
  embeddedEarthImage.onload = () => {
    const earthTexture = new THREE.Texture(embeddedEarthImage);
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    earthTexture.needsUpdate = true;
    earthMaterial.map = earthTexture;
    earthMaterial.needsUpdate = true;
  };
  embeddedEarthImage.src = window.EARTH_TEXTURE_DATA_URL;
}

const cloudMaterial = new THREE.MeshPhongMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.12,
  shininess: 8,
  depthWrite: false,
});
const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(3.28, 24, 18), cloudMaterial);
earthGroup.add(cloudMesh);

const equatorRing = new THREE.Mesh(
  new THREE.TorusGeometry(3.45, 0.04, 12, 140),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
);
equatorRing.rotation.x = Math.PI / 2;
earthGroup.add(equatorRing);

const axisMaterial = new THREE.LineDashedMaterial({ color: 0x15304d, dashSize: 0.22, gapSize: 0.12, transparent: true, opacity: 0.65 });
const axisGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, -5.8, 0),
  new THREE.Vector3(0, 5.8, 0),
]);
const axisLine = new THREE.Line(axisGeometry, axisMaterial);
axisLine.computeLineDistances();
earthGroup.add(axisLine);


function createOrbitGroup(color, radius, tiltX, tiltZ, labelText) {
  const group = new THREE.Group();
  group.rotation.x = tiltX;
  group.rotation.z = tiltZ;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.04, 12, 220),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const satellite = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 10),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
  );
  group.add(satellite);

  const tail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.55, 0, 0)]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 })
  );
  satellite.add(tail);

  world.add(group);
  return { group, ring, satellite, radius };
}

function setOrbitRadius(entry, radius, tubeRadius = 0.04) {
  if (Math.abs(entry.radius - radius) < 0.0001) return;
  entry.radius = radius;
  entry.ring.geometry.dispose();
  entry.ring.geometry = new THREE.TorusGeometry(radius, tubeRadius, 12, 220);
  entry.ring.rotation.x = Math.PI / 2;
}

function setOrbitVisualScale(entry, satelliteScale, labelScale, lineOpacity) {
  entry.satellite.scale.setScalar(satelliteScale);
  entry.ring.material.opacity = lineOpacity;
}

const polarOrbit = createOrbitGroup(ORBIT_COLORS.polar, NORMAL_RADII.polar, 0, 0, 'Polar');
polarOrbit.group.rotation.z = Math.PI / 2;
const equatorialOrbit = createOrbitGroup(ORBIT_COLORS.equatorial, NORMAL_RADII.equatorial, 0, 0, 'Equatorial');
const geostationaryOrbit = createOrbitGroup(ORBIT_COLORS.geostationary, NORMAL_RADII.geostationary, 0, 0, 'Geostationary');

function createCoverageCone() {
  const geometry = new THREE.ConeGeometry(1, 1, 28, 1, true);
  geometry.translate(0, -0.5, 0);
  const material = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const cone = new THREE.Mesh(geometry, material);
  cone.visible = false;
  return cone;
}

const coverageCone = createCoverageCone();
world.add(coverageCone);
let currentCoverageFootprint = [];

function setOrbitPosition(entry, angle) {
  entry.satellite.position.set(entry.radius * Math.cos(angle), 0, entry.radius * Math.sin(angle));
}

function updateCoverageCone(entry, coneAngle, surfaceRadius = 2.95, minRadius = 0.28, lengthScale = 1) {
  const satelliteWorld = new THREE.Vector3();
  entry.satellite.getWorldPosition(satelliteWorld);
  const surfaceWorld = satelliteWorld.clone().normalize().multiplyScalar(surfaceRadius);
  const satelliteLocal = world.worldToLocal(satelliteWorld.clone());
  const surfaceLocal = world.worldToLocal(surfaceWorld.clone());
  const axisDirection = surfaceLocal.clone().sub(satelliteLocal);
  const distance = axisDirection.length();
  if (!distance) {
    coverageCone.visible = false;
    coveragePaint.mesh.visible = false;
    currentCoverageFootprint = [];
    return;
  }

  const axisUnit = axisDirection.clone().normalize();
  const scaledDistance = distance * lengthScale;
  const radius = Math.max(minRadius, scaledDistance * Math.tan(coneAngle));
  coverageCone.position.copy(satelliteLocal);
  coverageCone.scale.set(radius, scaledDistance, radius);
  coverageCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axisUnit);
  coverageCone.visible = true;

  const overlayRadius = 3.215;
  const helper = Math.abs(axisUnit.y) < 0.92
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const basisU = new THREE.Vector3().crossVectors(axisUnit, helper).normalize();
  const basisV = new THREE.Vector3().crossVectors(axisUnit, basisU).normalize();
  const sinAngle = Math.sin(coneAngle);
  const cosAngle = Math.cos(coneAngle);
  const sampleCount = 96;
  const footprint = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const phi = (i / sampleCount) * Math.PI * 2;
    const rimDirection = basisU.clone().multiplyScalar(Math.cos(phi)).add(basisV.clone().multiplyScalar(Math.sin(phi)));
    const rayDirection = axisUnit.clone().multiplyScalar(cosAngle).add(rimDirection.multiplyScalar(sinAngle)).normalize();
    const b = 2 * satelliteLocal.dot(rayDirection);
    const c = satelliteLocal.lengthSq() - overlayRadius * overlayRadius;
    const discriminant = b * b - 4 * c;
    if (discriminant <= 0) continue;
    const sqrtDiscriminant = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDiscriminant) / 2;
    const t2 = (-b + sqrtDiscriminant) / 2;
    const t = t1 > 0 ? t1 : t2 > 0 ? t2 : null;
    if (t === null) continue;

    const pointWorldLocal = satelliteLocal.clone().add(rayDirection.multiplyScalar(t));
    const pointEarthLocal = earthGroup.worldToLocal(world.localToWorld(pointWorldLocal.clone()));
    const lon = Math.atan2(pointEarthLocal.z, pointEarthLocal.x);
    const lat = Math.asin(clamp(pointEarthLocal.y / overlayRadius, -1, 1));
    footprint.push({
      x: ((lon + Math.PI) / (Math.PI * 2)) * coveragePaint.canvas.width,
      y: ((Math.PI / 2 - lat) / Math.PI) * coveragePaint.canvas.height,
    });
  }

  currentCoverageFootprint = footprint;
}

function syncSpeed() {
  function commit(raw) {
    const value = Number(clamp(raw, 0.4, 2.4).toFixed(1));
    state.speed = value;
    controls.speedSlider.value = String(value);
    controls.speedInput.value = String(value);
    controls.speedDisplay.textContent = `Animation speed = ${value.toFixed(1)}x`;
  }

  controls.speedSlider.addEventListener('input', () => commit(Number(controls.speedSlider.value)));
  controls.speedInput.addEventListener('input', () => {
    if (controls.speedInput.value !== '') commit(Number(controls.speedInput.value));
  });
  controls.speedInput.addEventListener('blur', () => commit(Number(controls.speedInput.value || state.speed)));
  commit(state.speed);
}

function setMode(mode) {
  state.mode = mode;
  controls.modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  controls.comparePanel.classList.toggle('active', mode === 'compare');
  controls.geoPanel.classList.toggle('active', mode === 'geo');
  controls.applicationsPanel.classList.toggle('active', mode === 'applications');
  controls.scalePanel.classList.toggle('active', mode === 'scale');
  if (mode === 'scale') {
    cameraState.radius = Math.max(cameraState.radius, 40);
  }
  updateReadouts();
}

function wireModeButtons() {
  controls.modeButtons.forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });
}

function wireToggle(button, getter, setter, onText, offText) {
  function refresh() {
    const active = getter();
    button.classList.toggle('active', active);
    button.textContent = active ? onText : offText;
  }
  button.addEventListener('click', () => {
    setter(!getter());
    refresh();
    updateReadouts();
  });
  refresh();
}

function wireControls() {
  wireToggle(controls.togglePolar, () => state.showPolar, (value) => { state.showPolar = value; }, 'Polar On', 'Polar Off');
  wireToggle(controls.toggleEquatorial, () => state.showEquatorial, (value) => { state.showEquatorial = value; }, 'Equatorial On', 'Equatorial Off');
  wireToggle(controls.toggleGeostationary, () => state.showGeostationary, (value) => { state.showGeostationary = value; }, 'Geostationary On', 'Geostationary Off');
  wireToggle(controls.toggleEquatorialPlane, () => state.geoRequirements.equatorialPlane, (value) => { state.geoRequirements.equatorialPlane = value; }, 'Equatorial Plane', 'Tilted Plane');
  wireToggle(controls.toggleSameDirection, () => state.geoRequirements.sameDirection, (value) => { state.geoRequirements.sameDirection = value; }, 'Same Direction', 'Opposite Direction');
  wireToggle(controls.toggleLargeRadius, () => state.geoRequirements.largeRadius, (value) => { state.geoRequirements.largeRadius = value; }, 'Large Radius', 'Small Radius');
  controls.zoomIn.addEventListener('click', () => adjustZoom(-4));
  controls.zoomOut.addEventListener('click', () => adjustZoom(4));
  controls.applicationSelect.addEventListener('input', () => {
    state.applicationOrbit = controls.applicationSelect.value;
    updateReadouts();
  });
}

function updateReadouts() {
  coveragePaint.mesh.visible = false;

  if (state.mode === 'compare') {
    controls.modeSummary.textContent = 'Compare the three orbit types on one rotating Earth.';
    controls.keyIdea.textContent = 'Polar orbits pass over both poles, equatorial orbits stay above the equator, and geostationary orbits are a special high equatorial case.';
    controls.orbitNote.textContent = 'Use the orbit toggles to isolate one path or compare all three at once.';
    return;
  }

  if (state.mode === 'geo') {
    const radiusText = state.geoRequirements.largeRadius ? 'large enough for a 24 h period' : 'too small, so the satellite laps Earth too quickly';
    const planeText = state.geoRequirements.equatorialPlane ? 'equatorial plane' : 'tilted plane';
    const directionText = state.geoRequirements.sameDirection ? 'same direction as Earth rotation' : 'opposite direction to Earth rotation';
    controls.modeSummary.textContent = 'A geostationary satellite must stay above one fixed point on Earth.';
    controls.keyIdea.textContent = `That only works if the orbit is in the ${planeText}, moves in the ${directionText}, and has a radius ${radiusText}.`;
    controls.orbitNote.textContent = 'Geostationary satellites are ideal for continuous communication and weather monitoring over one region.';
    return;
  }

  if (state.mode === 'scale') {
    controls.modeSummary.textContent = 'Orbit radii are shown on a much more realistic common scale with Earth.';
    controls.keyIdea.textContent = 'The polar and equatorial examples are representative 500 km low-Earth orbits, while geostationary orbit is shown at about 35,786 km altitude.';
    controls.orbitNote.textContent = 'Satellite icons and orbit strokes are enlarged so they remain visible, but the orbit sizes relative to Earth are much closer to reality.';
    return;
  }

  const app = APPLICATION_TEXT[state.applicationOrbit];
  controls.modeSummary.textContent = `Application focus: ${app.title}.`;
  controls.keyIdea.textContent = app.note;
  controls.orbitNote.textContent = 'Different orbit choices trade off global coverage, repeat viewing, and fixed-position monitoring.';
}

function updateScene(deltaSeconds) {
  state.time += deltaSeconds;
  ambient.intensity = 0.22;
  sunLight.intensity = 2.4;
  earthMaterial.emissive.setHex(0x000000);
  earthMaterial.emissiveIntensity = 0;

  const earthSpin = state.time * 0.42 * state.speed;
  earthGroup.rotation.y = earthSpin;
  cloudMesh.rotation.y = earthSpin * 1.06;

  const polarAngle = state.time * 1.5 * state.speed;
  const equatorialAngle = state.time * 1.0 * state.speed;
  const geoAngle = state.time * 0.42 * state.speed;

  setOrbitPosition(polarOrbit, polarAngle);
  setOrbitPosition(equatorialOrbit, -equatorialAngle);
  setOrbitPosition(geostationaryOrbit, -geoAngle);

  world.rotation.y = 0.45 + Math.sin(state.time * 0.18) * 0.18;
  world.rotation.x = -0.32 + Math.sin(state.time * 0.11) * 0.04;
  axisLine.visible = true;
  equatorRing.visible = true;

  coveragePaint.mesh.visible = false;

  if (state.mode === 'compare') {
    setOrbitRadius(polarOrbit, NORMAL_RADII.polar, 0.04);
    setOrbitRadius(equatorialOrbit, NORMAL_RADII.equatorial, 0.04);
    setOrbitRadius(geostationaryOrbit, NORMAL_RADII.geostationary, 0.04);
    setOrbitVisualScale(polarOrbit, 1, { x: 2.25, y: 0.78 }, 0.92);
    setOrbitVisualScale(equatorialOrbit, 1, { x: 2.25, y: 0.78 }, 0.92);
    setOrbitVisualScale(geostationaryOrbit, 1, { x: 2.25, y: 0.78 }, 0.92);    geostationaryOrbit.group.rotation.x = 0;
    polarOrbit.group.visible = state.showPolar;
    equatorialOrbit.group.visible = state.showEquatorial;
    geostationaryOrbit.group.visible = state.showGeostationary;
    coverageCone.visible = false;
    coveragePaint.mesh.visible = false;
    return;
  }

  if (state.mode === 'geo') {
    setOrbitRadius(polarOrbit, NORMAL_RADII.polar, 0.04);
    setOrbitRadius(equatorialOrbit, NORMAL_RADII.equatorial, 0.04);
    setOrbitVisualScale(polarOrbit, 1, { x: 2.25, y: 0.78 }, 0.92);
    setOrbitVisualScale(equatorialOrbit, 1, { x: 2.25, y: 0.78 }, 0.92);
    setOrbitVisualScale(geostationaryOrbit, 1, { x: 2.25, y: 0.78 }, 0.92);
    geostationaryOrbit.group.rotation.x = state.geoRequirements.equatorialPlane ? 0 : 0.58;

    const nextGeoRadiusMode = state.geoRequirements.largeRadius ? 'large' : 'small';
    const nextGeoRadius = nextGeoRadiusMode === 'large' ? NORMAL_RADII.geostationary : NORMAL_RADII.geostationarySmall;
    if (state.geoRadiusMode !== nextGeoRadiusMode) {
      setOrbitRadius(geostationaryOrbit, nextGeoRadius, 0.04);
      state.geoRadiusMode = nextGeoRadiusMode;
    }

    polarOrbit.group.visible = false;
    equatorialOrbit.group.visible = false;
    geostationaryOrbit.group.visible = true;
    setOrbitPosition(geostationaryOrbit, state.geoRequirements.sameDirection ? -geoAngle : geoAngle * 1.9);
    coverageCone.visible = false;
    coveragePaint.mesh.visible = false;
    return;
  }

  if (state.mode === 'applications') {
    setOrbitRadius(polarOrbit, NORMAL_RADII.polar, 0.04);
    setOrbitRadius(equatorialOrbit, NORMAL_RADII.equatorial, 0.04);
    setOrbitRadius(geostationaryOrbit, NORMAL_RADII.geostationary, 0.04);
    setOrbitVisualScale(polarOrbit, 1, { x: 2.25, y: 0.78 }, 0.92);
    setOrbitVisualScale(equatorialOrbit, 1, { x: 2.25, y: 0.78 }, 0.92);
    setOrbitVisualScale(geostationaryOrbit, 1, { x: 2.25, y: 0.78 }, 0.92);    geostationaryOrbit.group.rotation.x = 0;

    polarOrbit.group.visible = state.applicationOrbit === 'polar';
    equatorialOrbit.group.visible = state.applicationOrbit === 'equatorial';
    geostationaryOrbit.group.visible = state.applicationOrbit === 'geostationary';

    if (state.applicationOrbit === 'polar') {
      updateCoverageCone(polarOrbit, 0.24, 2.95, 0.28, 1);
    } else if (state.applicationOrbit === 'equatorial') {
      updateCoverageCone(equatorialOrbit, 0.3, 2.95, 0.28, 1);
    } else {
      updateCoverageCone(geostationaryOrbit, 0.37, 2.75, 0.22, 1.2);
    }
    return;
  }

  setOrbitRadius(polarOrbit, SCALE_RADII.polar, 0.035);
  setOrbitRadius(equatorialOrbit, SCALE_RADII.equatorial, 0.035);
  setOrbitRadius(geostationaryOrbit, SCALE_RADII.geostationary, 0.05);
  setOrbitVisualScale(polarOrbit, 1.45, { x: 2.45, y: 0.86 }, 0.95);
  setOrbitVisualScale(equatorialOrbit, 1.45, { x: 2.75, y: 0.86 }, 0.95);
  setOrbitVisualScale(geostationaryOrbit, 1.75, { x: 3.35, y: 0.96 }, 0.98);  geostationaryOrbit.group.rotation.x = 0;
  polarOrbit.group.visible = true;
  equatorialOrbit.group.visible = true;
  geostationaryOrbit.group.visible = true;
  coverageCone.visible = false;
}

function adjustZoom(delta) {
  cameraState.radius = clamp(cameraState.radius + delta, 15, 60);
  updateCamera();
}

function updateCamera() {
  const safePitch = clamp(cameraState.pitch, -1.15, 1.15);
  const radius = clamp(cameraState.radius, 15, 60);
  camera.position.set(
    cameraTarget.x + radius * Math.cos(safePitch) * Math.sin(cameraState.yaw),
    cameraTarget.y + radius * Math.sin(safePitch),
    cameraTarget.z + radius * Math.cos(safePitch) * Math.cos(cameraState.yaw)
  );
  camera.lookAt(cameraTarget);
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = controls.root;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  updateCamera();
}

function animate(timestamp) {
  if (state.lastTimestamp === null) state.lastTimestamp = timestamp;
  const deltaSeconds = (timestamp - state.lastTimestamp) / 1000;
  state.lastTimestamp = timestamp;
  resizeRenderer();
  updateScene(deltaSeconds);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function wireViewControls() {
  controls.root.style.cursor = 'grab';

  controls.root.addEventListener('pointerdown', (event) => {
    interactionState.dragging = true;
    interactionState.lastX = event.clientX;
    interactionState.lastY = event.clientY;
    controls.root.style.cursor = 'grabbing';
    controls.root.setPointerCapture(event.pointerId);
  });

  controls.root.addEventListener('pointermove', (event) => {
    if (!interactionState.dragging) return;
    const dx = event.clientX - interactionState.lastX;
    const dy = event.clientY - interactionState.lastY;
    interactionState.lastX = event.clientX;
    interactionState.lastY = event.clientY;
    cameraState.yaw -= dx * 0.008;
    cameraState.pitch = clamp(cameraState.pitch - dy * 0.006, -1.15, 1.15);
    updateCamera();
  });

  function finishDrag(event) {
    if (interactionState.dragging && event.pointerId !== undefined && controls.root.hasPointerCapture(event.pointerId)) {
      controls.root.releasePointerCapture(event.pointerId);
    }
    interactionState.dragging = false;
    controls.root.style.cursor = 'grab';
  }

  controls.root.addEventListener('pointerup', finishDrag);
  controls.root.addEventListener('pointerleave', finishDrag);
  controls.root.addEventListener('wheel', (event) => {
    event.preventDefault();
    adjustZoom(event.deltaY * 0.015);
  }, { passive: false });
}

window.addEventListener('resize', resizeRenderer);

syncSpeed();
wireModeButtons();
wireControls();
wireViewControls();
setMode(state.mode);
resizeRenderer();
requestAnimationFrame(animate);












