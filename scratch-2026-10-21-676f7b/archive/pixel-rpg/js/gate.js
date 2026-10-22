// Title screen. "PRESS START" is the user gesture that unlocks audio.
import { TULIP } from './config.js';
import { createSprite, playFrames, scatterStars, PX } from './pixel.js';
import { sway } from './breeze.js';

export function initGate({ audio, reduced, onEnter }) {
  const gate = document.getElementById('gate');
  const btn = document.getElementById('gate-btn');
  const lines = gsap.utils.toArray('.gate__line');

  scatterStars(document.getElementById('gate-stars'), 40, 100, { reduced });

  const tulip = createSprite('tulip', { scale: 2 });
  document.getElementById('gate-tulip').append(tulip.el);

  const loops = [];
  gsap.timeline({ delay: 0.3 })
    // Title drops in from above in hard steps, one line after the other
    .from(lines, { y: -PX * 24, opacity: 0, duration: 0.6, ease: 'steps(6)', stagger: 0.3 })
    .from(['.gate__sub', '.gate__hint'], { opacity: 0, duration: 0.5, ease: 'steps(4)' }, '<0.2')
    .add(playFrames(tulip, TULIP.SPROUT, TULIP.OPEN, { duration: 0.9, onComplete: () => { tulip.ready = true; } }), 0.6)
    .from(btn, { opacity: 0, duration: 0.4, ease: 'steps(2)' })
    .add(() => {
      if (reduced) return;
      loops.push(
        sway(tulip),
        gsap.to(tulip.el, { y: -PX * 2, duration: 0.5, ease: 'steps(1)', yoyo: true, repeat: -1 }),
        gsap.to('.gate__line--pink', { y: -PX, duration: 0.6, ease: 'steps(1)', yoyo: true, repeat: -1 }),
        gsap.to(btn, { opacity: 0.25, duration: 0.55, ease: 'steps(1)', yoyo: true, repeat: -1 }),
      );
    });

  btn.addEventListener('click', () => {
    btn.disabled = true;
    audio.start();        // must stay synchronous inside the tap for iOS
    audio.jingle();
    loops.forEach((l) => l?.kill());

    gsap.timeline({ onComplete: () => gate.remove() })
      // Classic "selected" flicker, then a stepped fade to black
      .to(btn, { keyframes: { opacity: [0, 1, 0, 1, 0, 1] }, duration: 0.5, ease: 'none' })
      .to(gate, { opacity: 0, duration: 0.7, ease: 'steps(5)' })
      .add(onEnter, '-=0.35');
  }, { once: true });
}
