// Chunk 1 scaffold — layout and MathJax only, no simulation logic yet.

function updateMath() {
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise();
  }
}

const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');

// Seed the display values so the panel isn't blank on load.
document.getElementById('q1-display').textContent = 'q₁ = +1 μC';
document.getElementById('q2-display').textContent = 'q₂ = −1 μC';

function drawPlaceholder() {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.fillStyle = 'rgba(21, 48, 77, 0.18)';
  ctx.font = '500 22px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Simulation coming soon.', width / 2, height / 2);
  ctx.restore();
}

drawPlaceholder();
updateMath();
