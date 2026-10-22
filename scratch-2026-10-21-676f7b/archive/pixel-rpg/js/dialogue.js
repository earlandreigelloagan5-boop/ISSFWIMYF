// Scene 3: the letter, spoken through a fixed RPG dialogue box.
// Each page types out one character at a time with speech blips.
// Tap while typing → the page finishes instantly. Tap when done → next page.
import { PAGE_CHARS, TYPE_CPS } from './config.js';
import { createSprite, setFrame, PX } from './pixel.js';
import { typeText, blinkCursor, paginate } from './typewriter.js';
import { lockScroll, unlockScroll } from './scroll-lock.js';

export function initDialogue({ audio, reduced }) {
  const overlay = document.getElementById('dialogue');
  const box = document.getElementById('dialogue-box');
  const textEl = document.getElementById('dialogue-text');
  const cursor = overlay.querySelector('.px-cursor');
  const next = document.getElementById('dialogue-next');
  const count = document.getElementById('dialogue-count');
  const source = document.getElementById('letter-source');
  const again = document.getElementById('letter-again');
  const status = document.getElementById('letter-status');

  document.getElementById('dialogue-speaker').textContent = source.dataset.speaker || 'ME';

  const pages = gsap.utils.toArray('p', source)
    .flatMap((p) => paginate(p.textContent.replace(/\s+/g, ' ').trim(), PAGE_CHARS));

  // Small heart on the nameplate + on the letter sign, beating in two frames
  const heart = createSprite('heart', { scale: 1 });
  document.getElementById('dialogue-heart').append(heart.el);
  const signHeart = createSprite('heart', { scale: 2 });
  document.getElementById('letter-icon').append(signHeart.el);
  if (!reduced) {
    let f = 0;
    gsap.to({}, { duration: 0.45, repeat: -1, onRepeat: () => { f ^= 1; setFrame(heart, f); setFrame(signHeart, f); } });
  }

  blinkCursor(cursor);
  const arrowBob = gsap.to(next.querySelector('.px-arrow'), {
    y: PX * 2, duration: 0.35, ease: 'steps(1)', yoyo: true, repeat: -1, paused: true,
  });

  let index = 0;
  let typing = null;
  let open = false;
  let onClosed = null;

  function showNext(visible) {
    next.style.visibility = visible ? 'visible' : 'hidden';
    visible ? arrowBob.play() : arrowBob.pause();
  }

  function showPage(i) {
    index = i;
    count.textContent = `${i + 1}/${pages.length}`;
    showNext(false);
    typing = typeText(textEl, pages[i], { cps: TYPE_CPS, onChar: (c) => audio.blip(c) });
    typing.eventCallback('onComplete', pageDone);
  }

  function pageDone() {
    typing = null;
    showNext(true);
  }

  function advance() {
    if (!open) return;
    if (typing) {                      // finish this page instantly, like mashing A
      typing.progress(1).kill();
      pageDone();
      return;
    }
    audio.select();
    if (index < pages.length - 1) showPage(index + 1);
    else close();
  }

  function openBox(callback) {
    if (open) return;
    open = true;
    onClosed = callback;
    lockScroll();
    overlay.hidden = false;
    textEl.textContent = '';
    showNext(false);
    gsap.timeline()
      .fromTo(box, { scaleY: 0, opacity: 1 }, { scaleY: 1, duration: 0.3, ease: 'steps(5)' })
      .add(() => showPage(0));
  }

  function close() {
    open = false;
    showNext(false);
    gsap.to(box, {
      scaleY: 0, duration: 0.25, ease: 'steps(4)',
      onComplete: () => {
        overlay.hidden = true;
        unlockScroll();
        again.hidden = false;
        status.textContent = 'read with love';
        onClosed?.();
      },
    });
  }

  overlay.addEventListener('click', advance);
  document.addEventListener('keydown', (e) => {
    if (open && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); advance(); }
  });
  again.addEventListener('click', () => openBox());

  // Opens when she scrolls to the letter.
  ScrollTrigger.create({
    trigger: '#letter-section',
    start: 'top 40%',
    once: true,
    onEnter: () => openBox(),
  });

  return { open: openBox };
}
