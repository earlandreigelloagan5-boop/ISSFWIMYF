// The resolution: white flash, pixel petal storm, then an ending screen
// that types itself out while a little garden blooms frame by frame.
import { PETALS, TULIP } from './config.js';
import { createSprite, playFrames, scatterStars, PX } from './pixel.js';
import { sway } from './breeze.js';
import { reserveText, typeText, blinkCursor } from './typewriter.js';
import { lockScroll, unlockScroll } from './scroll-lock.js';

const GARDEN = [1, 1, 3, 1, 1];   // tulip scales, left to right (7 × 16 art px wide: fits any phone)

export function initFinale({ storm, audio, reduced, onReplay }) {
  const finale = document.getElementById('finale');
  const flash = document.getElementById('flash');
  const title = reserveText(document.getElementById('finale-title'));
  const body = reserveText(document.getElementById('finale-text'));
  const love = document.getElementById('finale-love');
  const again = document.getElementById('read-again');

  scatterStars(document.getElementById('finale-stars'), 36, 70, { reduced });

  const garden = GARDEN.map((s) => {
    const sprite = createSprite('tulip', { scale: s });
    document.getElementById('bouquet').append(sprite.el);
    sway(sprite);
    return sprite;
  });

  gsap.set([love, again], { opacity: 0 });
  let played = false;

  function play(origin) {
    lockScroll();
    audio.swell();
    audio.fanfare();
    finale.setAttribute('aria-hidden', 'false');

    const tl = gsap.timeline();
    // Three-frame white flash, like a level clear
    tl.set(flash, { visibility: 'visible' })
      .to(flash, { keyframes: { opacity: [1, 0.3, 1, 0] }, duration: 0.45, ease: 'none' })
      .set(flash, { visibility: 'hidden' })
      .add(() => {
        storm.burst(origin.x, origin.y, reduced ? 30 : PETALS.burst);
        if (!reduced) gsap.delayedCall(0.4, () => storm.rain(PETALS.rain));
      }, 0.1)
      .to(['#content', '#stage'], { opacity: 0, duration: 0.6, ease: 'steps(4)' }, 0.2)
      .set(['#content', '#stage'], { visibility: 'hidden' })
      .set(finale, { visibility: 'visible', opacity: 0 }, 0.6)
      .to(finale, { opacity: 1, duration: 0.6, ease: 'steps(4)' }, 0.6);

    if (!played) {
      played = true;
      tl.add(() => { title.cursor.style.visibility = 'visible'; blinkCursor(title.cursor); }, 1.3)
        .add(typeText(title.typed, title.text, { cps: 12, onChar: (c) => audio.blip(c) }))
        .add(() => {
          title.cursor.remove();
          body.cursor.style.visibility = 'visible';
          blinkCursor(body.cursor);
        }, '+=0.3')
        .add(typeText(body.typed, body.text, { onChar: (c) => audio.blip(c) }))
        .to(love, { opacity: 1, duration: 0.4, ease: 'steps(4)' }, '+=0.3')
        .add(() => {
          if (!reduced) gsap.to(love, { y: -PX * 2, duration: 0.5, ease: 'steps(1)', yoyo: true, repeat: -1 });
        })
        .to(again, { opacity: 1, duration: 0.3, ease: 'steps(3)' }, '+=0.4');

      garden.forEach((sprite, i) => {
        tl.add(playFrames(sprite, TULIP.SPROUT, TULIP.OPEN, {
          duration: 0.8, onComplete: () => { sprite.ready = true; },
        }), 1.2 + i * 0.25);
      });
    }

    again.focus({ preventScroll: true });
  }

  again.addEventListener('click', () => {
    audio.select();
    gsap.timeline()
      .to(finale, { opacity: 0, duration: 0.4, ease: 'steps(4)' })
      .set(finale, { visibility: 'hidden' })
      .set(['#content', '#stage'], { visibility: 'visible' })
      .add(() => {
        finale.setAttribute('aria-hidden', 'true');
        unlockScroll();
        const top = document.getElementById('letter-section').getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top, behavior: 'instant' });
        onReplay();
      })
      .to(['#content', '#stage'], { opacity: 1, duration: 0.4, ease: 'steps(4)' });
  });

  return { play };
}
