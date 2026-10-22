// The pixel grid: an integer art-pixel size (--px), sprite frames, and snapping.
import { SPRITES } from './config.js';

export let PX = 3;

// Whole-number scaling keeps every art pixel the same size: no blur, no uneven pixels.
export function measurePx() {
  const w = Math.min(window.innerWidth, 480);
  PX = Math.max(2, Math.min(4, Math.floor(w / 110)));
  document.documentElement.style.setProperty('--px', `${PX}px`);
  return PX;
}

// Round a CSS-px value onto the art-pixel grid.
export const snap = (v) => Math.round(v / PX) * PX;

// GSAP modifiers that make any x/y tween move in whole art pixels, like a sprite.
export const onGrid = {
  x: (v) => `${snap(parseFloat(v))}px`,
  y: (v) => `${snap(parseFloat(v))}px`,
};

// <div class="pixel-sprite pixel-NAME"><div class="pixel-sprite__strip"></div></div>
export function createSprite(name, { scale = 1, className = '' } = {}) {
  const cfg = SPRITES[name];
  const el = document.createElement('div');
  el.className = `pixel-sprite pixel-${name} ${className}`.trim();
  el.style.setProperty('--w', cfg.w);
  el.style.setProperty('--h', cfg.h);
  el.style.setProperty('--frames', cfg.frames);
  el.style.setProperty('--s', scale);
  const strip = document.createElement('div');
  strip.className = 'pixel-sprite__strip';
  el.append(strip);
  return { el, strip, frames: cfg.frames, frame: 0, ready: false };
}

// Jump the strip to a frame. Whole-frame steps, transform only.
export function setFrame(sprite, n) {
  if (sprite.frame === n) return;
  sprite.frame = n;
  gsap.set(sprite.strip, { xPercent: (-100 * n) / sprite.frames });
}

// Play frames from → to, one hard step per frame (like a sprite sheet).
export function playFrames(sprite, from, to, { duration = 0.6, onComplete } = {}) {
  const p = { f: from };
  setFrame(sprite, from);
  return gsap.to(p, {
    f: to,
    duration,
    ease: `steps(${Math.abs(to - from)})`,
    onUpdate: () => setFrame(sprite, Math.round(p.f)),
    onComplete,
  });
}

// Scatter twinkling star pixels in a container (top `maxY` % only).
export function scatterStars(container, count, maxY, { reduced }) {
  const frag = document.createDocumentFragment();
  const stars = [];
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 'px-star';
    s.style.left = `${gsap.utils.random(0, 100)}%`;
    s.style.top = `${gsap.utils.random(0, maxY)}%`;
    frag.append(s);
    stars.push(s);
  }
  container.append(frag);
  if (reduced) return;
  stars.forEach((s) => {
    gsap.to(s, { opacity: 0, duration: gsap.utils.random(0.4, 1.2), ease: 'steps(1)',
      repeat: -1, yoyo: true, repeatDelay: gsap.utils.random(0.5, 3), delay: gsap.utils.random(0, 3) });
  });
}
