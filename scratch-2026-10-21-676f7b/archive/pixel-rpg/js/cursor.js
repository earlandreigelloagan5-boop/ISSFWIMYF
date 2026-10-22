// Pixel cursor: a square head with hard pixel "glow" rings and a three-square
// trail that lags behind, plus a square ring that pops on every tap.
// All listeners are passive, so native scrolling is never delayed.
import { snap } from './pixel.js';

export function initCursor({ reduced }) {
  const parts = ['head', 'tail-1', 'tail-2', 'tail-3'].map((name) => {
    const el = document.createElement('div');
    el.className = `cursor-px cursor-px--${name}`;
    return el;
  });
  const rings = Array.from({ length: 3 }, () => {
    const r = document.createElement('div');
    r.className = 'cursor-ring';
    return r;
  });
  document.body.append(...parts.slice().reverse(), ...rings);
  gsap.set([...parts, ...rings], { xPercent: -50, yPercent: -50, opacity: 0 });

  // Each trail square lags a little more than the one before it.
  const movers = parts.map((el, i) => ({
    x: gsap.quickTo(el, 'x', { duration: reduced ? 0.05 : 0.06 + i * 0.09, ease: 'none' }),
    y: gsap.quickTo(el, 'y', { duration: reduced ? 0.05 : 0.06 + i * 0.09, ease: 'none' }),
  }));

  let hide = null;
  let visible = false;
  let ring = 0;

  const show = () => {
    hide?.kill();
    if (visible) return;
    visible = true;
    gsap.to(parts, { opacity: (i) => 1 - i * 0.2, duration: 0.15, ease: 'steps(2)', overwrite: 'auto' });
  };
  const fadeOut = (delay) => {
    hide?.kill();
    hide = gsap.delayedCall(delay, () => {
      visible = false;
      gsap.to(parts, { opacity: 0, duration: 0.4, ease: 'steps(3)', overwrite: 'auto' });
    });
  };
  const moveTo = (x, y, jump) => {
    const sx = snap(x);
    const sy = snap(y);
    movers.forEach((m) => {
      m.x(sx, jump ? sx : undefined);
      m.y(sy, jump ? sy : undefined);
    });
  };
  const tap = (x, y) => {
    if (reduced) return;
    const r = rings[ring++ % rings.length];
    gsap.fromTo(r, { x: snap(x), y: snap(y), scale: 0.25, opacity: 1 },
      { scale: 1.25, opacity: 0, duration: 0.4, ease: 'steps(4)', overwrite: true });
  };

  window.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    moveTo(t.clientX, t.clientY, !visible);
    show();
    tap(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    moveTo(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener('touchend', () => fadeOut(0.5), { passive: true });
  window.addEventListener('touchcancel', () => fadeOut(0.5), { passive: true });

  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    window.addEventListener('mousemove', (e) => {
      moveTo(e.clientX, e.clientY, !visible);
      show();
    }, { passive: true });
    window.addEventListener('mousedown', (e) => tap(e.clientX, e.clientY), { passive: true });
    document.addEventListener('mouseleave', () => fadeOut(0));
  }
}
