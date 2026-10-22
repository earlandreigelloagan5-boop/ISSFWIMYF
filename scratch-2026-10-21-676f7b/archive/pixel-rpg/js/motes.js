// Pixel hearts and sparkles drifting up through the scene, moving on the
// art-pixel grid and flipping between their two frames.
import { createSprite, setFrame, onGrid } from './pixel.js';

const random = gsap.utils.random;

export function initMotes(container, count, { reduced }) {
  if (reduced) return;
  const height = () => container.offsetHeight || window.innerHeight;

  for (let i = 0; i < count; i++) {
    const sprite = createSprite(i % 3 === 0 ? 'sparkle' : 'heart', { scale: random([1, 1, 2]) });
    sprite.el.style.left = `${random(4, 90)}%`;
    container.append(sprite.el);

    const D = random(12, 22);
    const rise = gsap.timeline({ repeat: -1 })
      .fromTo(sprite.el, { y: height() + 20 }, { y: -40, duration: D, ease: 'none', modifiers: onGrid }, 0)
      .fromTo(sprite.el, { opacity: 0 }, { opacity: 1, duration: D * 0.15, ease: 'steps(3)' }, 0)
      .to(sprite.el, { opacity: 0, duration: D * 0.15, ease: 'steps(3)' }, D * 0.8);
    rise.progress(Math.random());

    gsap.fromTo(sprite.el, { x: -random(6, 14) },
      { x: random(6, 14), duration: random(1.6, 3), ease: 'steps(5)', yoyo: true, repeat: -1, modifiers: onGrid });

    // Heartbeat / twinkle
    let f = 0;
    gsap.to({}, { duration: random(0.35, 0.6), repeat: -1, onRepeat: () => setFrame(sprite, (f ^= 1)) });
  }
}
