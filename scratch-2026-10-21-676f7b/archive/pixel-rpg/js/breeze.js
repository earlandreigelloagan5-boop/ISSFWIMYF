// Idle sprite animation for tulips: open → lean left → open → lean right,
// one hard frame at a time. Every few seconds a gust speeds every tulip up together.
import { TULIP, prefersReducedMotion as reduced } from './config.js';
import { setFrame } from './pixel.js';

const random = gsap.utils.random;
const SWAY = [TULIP.OPEN, TULIP.LEFT, TULIP.OPEN, TULIP.RIGHT];
const loops = [];
let gusting = false;

function gust() {
  gsap.to(loops, {
    timeScale: random(1.8, 2.6),
    duration: random(0.8, 1.4),
    ease: 'steps(4)',
    yoyo: true,
    repeat: 1,
    onComplete: () => gsap.delayedCall(random(3, 7), gust),
  });
}

// Only animates once sprite.ready is true (set when its bloom finishes),
// so it never fights a scroll-scrubbed bloom for the same frames.
export function sway(sprite, { interval = 0.42 } = {}) {
  if (reduced) return null;
  let i = Math.floor(Math.random() * SWAY.length);
  const loop = gsap.to({}, {
    duration: interval * random(0.85, 1.2),
    repeat: -1,
    onRepeat() {
      if (!sprite.ready) return;
      i = (i + 1) % SWAY.length;
      setFrame(sprite, SWAY[i]);
    },
  });
  loops.push(loop);
  if (!gusting) {
    gusting = true;
    gsap.delayedCall(random(2, 4), gust);
  }
  return loop;
}
