// Scene 1: Pakuranga at twilight. The hero box types itself out like an NPC
// greeting, and the pixel tulip sprouts, blooms and sways.
import { TULIP } from './config.js';
import { createSprite, playFrames, setFrame, PX } from './pixel.js';
import { sway } from './breeze.js';
import { reserveText, typeText, blinkCursor } from './typewriter.js';

export function initAnchor({ reduced, storm, audio }) {
  const tulip = createSprite('tulip', { scale: 3 });
  const mount = document.getElementById('hero-tulip');
  mount.append(tulip.el);

  const name = reserveText(document.getElementById('hero-name'));
  const body = reserveText(document.getElementById('hero-text'));

  gsap.set('#stage', { opacity: 0 });
  gsap.set('#hero-box', { opacity: 0 });
  gsap.set('.scroll-hint', { opacity: 0 });

  const intro = gsap.timeline({ paused: true });
  intro
    .to('#stage', { opacity: 1, duration: 1.2, ease: 'steps(6)' })
    // The box pops open top-down in four frames, like a menu window
    .fromTo('#hero-box', { opacity: 1, scaleY: 0, transformOrigin: '50% 0%' },
      { scaleY: 1, duration: 0.25, ease: 'steps(4)' }, 0.6)
    .add(() => { name.cursor.style.visibility = 'visible'; blinkCursor(name.cursor); })
    .add(typeText(name.typed, name.text, { cps: 10, onChar: (c) => audio.blip(c) }))
    .add(() => {
      name.cursor.remove();
      body.cursor.style.visibility = 'visible';
      blinkCursor(body.cursor);
    }, '+=0.2')
    .add(typeText(body.typed, body.text, { onChar: (c) => audio.blip(c) }))
    .add(playFrames(tulip, TULIP.SPROUT, TULIP.OPEN, { duration: 1.2, onComplete: () => { tulip.ready = true; } }), 1.4)
    .to('.scroll-hint', { opacity: 1, duration: 0.3, ease: 'steps(2)' });

  intro.eventCallback('onComplete', () => {
    if (reduced) return;
    gsap.to('.scroll-hint', { opacity: 0.2, duration: 0.6, ease: 'steps(1)', yoyo: true, repeat: -1 });
    gsap.to('.scroll-hint .px-arrow', { y: PX * 2, duration: 0.4, ease: 'steps(2)', yoyo: true, repeat: -1 });
  });
  sway(tulip);

  // Tap the tulip: it hops two frames up and drops pixel petals.
  mount.addEventListener('click', () => {
    if (!tulip.ready) return;
    const r = tulip.el.getBoundingClientRect();
    storm.burst(r.left + r.width / 2, r.top + r.height * 0.25, reduced ? 6 : 18);
    audio.select();
    gsap.timeline()
      .to(tulip.el, { y: -PX * 6, duration: 0.15, ease: 'steps(3)' })
      .to(tulip.el, { y: 0, duration: 0.2, ease: 'steps(3)' });
    setFrame(tulip, TULIP.LEFT);
    try { navigator.vibrate?.(8); } catch { /* no-op */ }
  });

  // Scroll away in chunky steps
  gsap.to('#hero-box', {
    y: -PX * 30, opacity: 0, ease: 'steps(8)',
    scrollTrigger: { trigger: '#anchor', start: 'top top', end: 'bottom 40%', scrub: true },
  });

  return { play: () => intro.play() };
}
