// Pixel petal storm. The canvas is drawn at art resolution (1 canvas pixel
// = 1 art pixel) and scaled up by CSS with nearest-neighbour, so every petal
// is a chunky, crisp pixel cluster. Driven by gsap.ticker.
import { PETAL_COLORS } from './config.js';
import { PX } from './pixel.js';

const GRAVITY = 0.025;
const DRAG = 0.985;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Tiny petal shapes; a petal cycles through them to "tumble"
const SHAPES = [
  [[0, 0], [1, 0]],
  [[0, 0], [1, 0], [0, 1]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [0, 1]],
];

export function createPetalStorm(canvas) {
  const ctx = canvas.getContext('2d');
  const petals = [];
  let w = 0, h = 0;
  let running = false;

  function resize() {
    w = Math.ceil(canvas.clientWidth / PX);
    h = Math.ceil(canvas.clientHeight / PX);
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false;
  }
  resize();
  window.addEventListener('resize', resize);

  function spawn(x, y, vx, vy) {
    petals.push({
      x, y, vx, vy,
      color: pick(PETAL_COLORS),
      shape: (Math.random() * SHAPES.length) | 0,
      spin: 0,
      spinRate: rand(0.08, 0.2),
      sway: rand(0, 6.28),
      big: Math.random() < 0.25,
    });
  }

  function tick(time, deltaTime) {
    const dt = Math.min(deltaTime / 16.667, 3);
    ctx.clearRect(0, 0, w, h);
    for (let i = petals.length - 1; i >= 0; i--) {
      const p = petals[i];
      p.vx *= Math.pow(DRAG, dt);
      p.vy = Math.min(p.vy * Math.pow(DRAG, dt) + GRAVITY * dt, 1.1);
      p.sway += 0.05 * dt;
      p.x += (p.vx + Math.sin(p.sway) * 0.25) * dt;
      p.y += p.vy * dt;
      p.spin += p.spinRate * dt;
      if (p.spin >= 1) { p.spin = 0; p.shape = (p.shape + 1) % SHAPES.length; }
      if (p.y > h + 4 || p.x < -6 || p.x > w + 6) {
        petals.splice(i, 1);
        continue;
      }
      ctx.fillStyle = p.color;
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      const k = p.big ? 2 : 1;
      for (const [dx, dy] of SHAPES[p.shape]) ctx.fillRect(px + dx * k, py + dy * k, k, k);
    }
    if (!petals.length) stop();
  }

  function startLoop() {
    if (running) return;
    resize();
    running = true;
    gsap.ticker.add(tick);
  }
  function stop() {
    running = false;
    gsap.ticker.remove(tick);
    ctx.clearRect(0, 0, w, h);
  }

  return {
    // Explosion from a screen point (CSS px), biased upward.
    burst(x, y, count) {
      const ax = x / PX, ay = y / PX;
      for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(0.8, 3.6);
        spawn(ax, ay, Math.cos(a) * s, Math.sin(a) * s - rand(0.6, 1.8));
      }
      startLoop();
    },
    // Shower from above the screen.
    rain(count) {
      for (let i = 0; i < count; i++) spawn(rand(0, w), rand(-h * 0.8, -2), rand(-0.3, 0.3), rand(0.2, 0.8));
      startLoop();
    },
  };
}
