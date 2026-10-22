// Scene 4: press-and-hold the pixel tulip.
// touchstart charges the segmented meter, touchend/touchcancel drains it.
// Two full seconds of holding calls onComplete with the button's centre point.
import { HOLD_DURATION, HOLD_MOVE_TOLERANCE, HOLD_SEGMENTS, TULIP } from './config.js';
import { createSprite, playFrames, PX } from './pixel.js';
import { sway } from './breeze.js';

const LABELS = { idle: 'PRESS & HOLD', holding: 'KEEP HOLDING', almost: 'ALMOST...', done: 'THANK YOU' };

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* iOS: no Vibration API */ }
}

export function initHold({ reduced, audio, onComplete }) {
  const btn = document.getElementById('hold');
  const label = document.getElementById('hold-label');
  const track = document.getElementById('charge');

  const segs = Array.from({ length: HOLD_SEGMENTS }, () => {
    const s = document.createElement('span');
    s.className = 'charge__seg';
    track.append(s);
    return s;
  });

  const tulip = createSprite('tulip', { scale: 2 });
  document.getElementById('hold-tulip').append(tulip.el);
  ScrollTrigger.create({
    trigger: btn, start: 'top 85%', once: true,
    onEnter: () => playFrames(tulip, TULIP.SPROUT, TULIP.OPEN, { duration: 0.9, onComplete: () => { tulip.ready = true; } }),
  });
  sway(tulip);

  const bob = reduced ? null : gsap.to(btn, { y: -PX * 2, duration: 0.6, ease: 'steps(1)', yoyo: true, repeat: -1 });
  const shake = gsap.to(tulip.el, { x: PX, duration: 0.05, ease: 'steps(1)', yoyo: true, repeat: -1, paused: true });

  const state = { p: 0 };
  let lit = 0;
  let labelKey = 'idle';
  const setLabel = (key) => {
    if (key === labelKey) return;
    labelKey = key;
    label.textContent = LABELS[key];
  };

  // Segments light one at a time (opacity only), with a rising tone per segment.
  const render = () => {
    const next = Math.floor(state.p * HOLD_SEGMENTS + 0.0001);
    if (next === lit) return;
    for (let i = Math.min(lit, next); i < Math.max(lit, next); i++) {
      segs[i].style.opacity = i < next ? '1' : '.2';
    }
    if (next > lit) audio.charge(state.p);
    lit = next;
    // the shake gets faster as the meter fills
    shake.timeScale(1 + state.p * 2);
  };

  let tween = null;
  let holding = false;
  let done = false;
  let origin = null;

  function start() {
    if (done || holding || !tulip.ready) return;
    holding = true;
    bob?.pause();
    shake.play();
    setLabel('holding');
    vibrate(12);
    tween?.kill();
    tween = gsap.to(state, {
      p: 1,
      duration: HOLD_DURATION * (1 - state.p),
      ease: 'none',
      onUpdate() {
        render();
        if (state.p > 0.7) setLabel('almost');
      },
      onComplete: complete,
    });
  }

  function cancel() {
    if (done || !holding) return;
    holding = false;
    tween?.kill();
    shake.pause(0);
    setLabel('idle');
    tween = gsap.to(state, {
      p: 0, duration: 0.2 + state.p * 0.4, ease: `steps(${Math.max(lit, 1)})`, onUpdate: render,
      onComplete: () => bob?.play(),
    });
  }

  function complete() {
    done = true;
    holding = false;
    shake.pause(0);
    setLabel('done');
    vibrate([30, 40, 90]);
    const r = btn.getBoundingClientRect();
    onComplete({ x: r.left + r.width / 2, y: r.top + r.height / 3 });
  }

  // ---- Touch (primary) ----
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();   // no long-press callout, no text selection, no synthetic mouse events
    const t = e.changedTouches[0];
    origin = { x: t.clientX, y: t.clientY };
    start();
  }, { passive: false });

  btn.addEventListener('touchmove', (e) => {
    if (!origin) return;
    const t = e.changedTouches[0];
    if (Math.hypot(t.clientX - origin.x, t.clientY - origin.y) > HOLD_MOVE_TOLERANCE) cancel();
  }, { passive: true });

  const end = () => { origin = null; cancel(); };
  btn.addEventListener('touchend', end);
  btn.addEventListener('touchcancel', end);

  // ---- Mouse + keyboard fallbacks ----
  btn.addEventListener('mousedown', (e) => { if (e.button === 0) start(); });
  btn.addEventListener('mouseup', cancel);
  btn.addEventListener('mouseleave', cancel);
  btn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); }
  });
  btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') cancel(); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });

  return {
    reset() {
      done = false;
      holding = false;
      tween?.kill();
      state.p = 0;
      segs.forEach((s) => { s.style.opacity = '.2'; });
      lit = 0;
      setLabel('idle');
      gsap.set(btn, { scale: 1, opacity: 1 });
      bob?.play();
    },
  };
}
