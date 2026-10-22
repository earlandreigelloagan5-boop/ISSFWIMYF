// Entry point. GSAP, ScrollTrigger and TextPlugin load as classic scripts before this module.
import { prefersReducedMotion as reduced } from './config.js';
import { measurePx } from './pixel.js';
import { lockScroll, unlockScroll } from './scroll-lock.js';
import { createAudio } from './audio.js';
import { initGate } from './gate.js';
import { initCursor } from './cursor.js';
import { initAnchor } from './anchor.js';
import { initJourney } from './journey.js';
import { initDialogue } from './dialogue.js';
import { initHold } from './hold.js';
import { createPetalStorm } from './petals.js';
import { initFinale } from './finale.js';

gsap.registerPlugin(ScrollTrigger, TextPlugin);
ScrollTrigger.config({ ignoreMobileResize: true });

// Lock in a whole-number pixel size before anything is measured.
measurePx();

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
lockScroll();

const audio = createAudio(document.getElementById('bgm'), document.getElementById('sound'));
const storm = createPetalStorm(document.getElementById('petals'));

initCursor({ reduced });
const anchor = initAnchor({ reduced, storm, audio });
const journey = initJourney({ reduced, audio });
const dialogue = initDialogue({ audio, reduced });

let hold;
const finale = initFinale({
  storm, audio, reduced,
  onReplay: () => { hold.reset(); dialogue.open(); },
});
hold = initHold({ reduced, audio, onComplete: (origin) => finale.play(origin) });

initGate({
  audio,
  reduced,
  onEnter: () => {
    unlockScroll();
    ScrollTrigger.refresh();
    anchor.play();
    gsap.delayedCall(1.4, journey.showFirstArea);
  },
});

// Pixel size only changes with the width (rotation, split view).
let lastW = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastW) return;
  lastW = window.innerWidth;
  measurePx();
  ScrollTrigger.refresh();
});

document.fonts?.ready.then(() => ScrollTrigger.refresh());
window.addEventListener('load', () => ScrollTrigger.refresh());
