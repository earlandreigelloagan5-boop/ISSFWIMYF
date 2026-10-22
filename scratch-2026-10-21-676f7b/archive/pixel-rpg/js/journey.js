// Scene 2: Pakuranga → the Swiss Alps.
// A retro tile wipe swaps the scenes, an RPG area banner announces each place,
// pixel tulips bloom frame by frame along the edges, and snow falls on the grid.
import { FRAME_TULIPS, SNOWFLAKES, MOTES, AREAS, TULIP } from './config.js';
import { createSprite, setFrame, scatterStars, onGrid, PX } from './pixel.js';
import { sway } from './breeze.js';
import { initMotes } from './motes.js';
import { typeText } from './typewriter.js';

const rand = gsap.utils.random;
const WIPE = { cols: 6, rows: 13 };

function buildSnow(container, stage) {
  const height = stage.offsetHeight;
  const tweens = [];
  for (let i = 0; i < SNOWFLAKES; i++) {
    const f = document.createElement('span');
    f.className = 'flake';
    f.style.left = `${rand(0, 100)}%`;
    container.append(f);
    const fall = gsap.fromTo(f, { y: -10 }, {
      y: height + 10, duration: rand(8, 15), ease: 'none', repeat: -1, paused: true, modifiers: onGrid,
    });
    fall.progress(Math.random());
    const drift = gsap.to(f, { x: rand(-12, 12), duration: rand(1.5, 3), ease: 'steps(4)',
      yoyo: true, repeat: -1, paused: true, modifiers: onGrid });
    tweens.push(fall, drift);
  }
  let running = false;
  return (on) => {
    if (on === running) return;
    running = on;
    tweens.forEach((t) => t.paused(!on));
  };
}

function buildFrame(frame, stage) {
  const sprites = FRAME_TULIPS.map((cfg) => {
    const sprite = createSprite('tulip', { scale: cfg.s });
    frame.append(sprite.el);
    sway(sprite);
    return { sprite, cfg };
  });

  // Positions sit on the art-pixel grid; written only when the width changes.
  const place = () => {
    const H = stage.offsetHeight;
    sprites.forEach(({ sprite, cfg }) => {
      const h = 32 * PX * cfg.s;
      const edge = `${cfg.x * PX}px`;
      sprite.el.style.left = cfg.side === 'left' ? edge : 'auto';
      sprite.el.style.right = cfg.side === 'right' ? edge : 'auto';
      sprite.el.style.top = `${Math.round((cfg.y * H - h) / PX) * PX}px`;
    });
  };
  place();
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    place();
  });
  return sprites.map(({ sprite }) => sprite);
}

function buildWipe(container) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < WIPE.cols * WIPE.rows; i++) {
    const t = document.createElement('span');
    t.className = 'wipe__tile';
    frag.append(t);
  }
  container.append(frag);
  return container.children;
}

function initBanner() {
  const banner = document.getElementById('banner');
  const text = document.getElementById('banner-text');
  let current = null;
  let tl = null;
  return (area) => {
    if (area === current) return;
    current = area;
    tl?.kill();
    text.textContent = AREAS[area];
    // Slides down in steps, waits, slides back up: like entering a new map
    tl = gsap.timeline()
      .set(banner, { visibility: 'visible' })
      .fromTo(banner, { y: -PX * 30 }, { y: 0, duration: 0.3, ease: 'steps(5)' })
      .to(banner, { y: -PX * 30, duration: 0.3, ease: 'steps(5)' }, '+=2.2')
      .set(banner, { visibility: 'hidden' });
  };
}

export function initJourney({ reduced, audio }) {
  const stage = document.getElementById('stage');

  scatterStars(document.getElementById('stars-nz'), 10, 30, { reduced });
  scatterStars(document.getElementById('stars-alps'), 18, 45, { reduced });
  const setSnow = reduced ? () => {} : buildSnow(document.getElementById('snow'), stage);
  const tulips = buildFrame(document.getElementById('frame'), stage);
  const tiles = buildWipe(document.getElementById('wipe'));
  initMotes(document.getElementById('motes'), MOTES, { reduced });
  const showArea = initBanner();

  // ---- Master journey timeline (10 units ↔ the #journey scroll distance) ----
  let area = 'nz';
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '#journey',
      start: 'top bottom',
      end: 'bottom bottom',
      scrub: 0.5,
      onUpdate: (self) => {
        const next = self.progress > 0.42 ? 'alps' : 'nz';
        setSnow(next === 'alps');
        if (next !== area) {
          area = next;
          showArea(area);
        }
      },
    },
  });

  // Parallax that moves in whole art pixels
  tl.to('#nz-land', { y: () => PX * 24, duration: 4, modifiers: onGrid }, 0)
    .fromTo('#alps-land', { y: () => PX * 30 }, { y: 0, duration: 5, modifiers: onGrid }, 4.4);

  // Tile wipe: tiles snap shut across the screen, the scene swaps underneath,
  // then they snap open again from the other side.
  // Every tile is fully shut by 4.0 (2.2 + 1.2 stagger + 0.6); the swap waits until 4.2.
  tl.to(tiles, { scale: 1, duration: 0.6, ease: 'steps(3)',
      stagger: { grid: [WIPE.rows, WIPE.cols], from: 'start', amount: 1.2 } }, 2.2)
    .set('#scene-nz', { visibility: 'hidden' }, 4.2)
    .set('#scene-alps', { visibility: 'visible' }, 4.2)
    .to(tiles, { scale: 0, duration: 0.6, ease: 'steps(3)',
      stagger: { grid: [WIPE.rows, WIPE.cols], from: 'end', amount: 1.2 } }, 4.4);

  // Edge tulips bloom frame by frame (sprout → bud → opening → open)
  tulips.forEach((sprite, i) => {
    const p = { f: 0 };
    tl.to(p, {
      f: TULIP.OPEN,
      duration: 1,
      ease: `steps(${TULIP.OPEN})`,
      onUpdate: () => {
        sprite.ready = p.f >= TULIP.OPEN;
        if (!sprite.ready) setFrame(sprite, Math.round(p.f));
      },
    }, 0.6 + i * 0.95);
  });

  // ---- Captions type themselves out when they arrive ----
  gsap.utils.toArray('.caption').forEach((cap) => {
    const text = cap.textContent.trim();
    cap.style.minHeight = `${cap.offsetHeight}px`;   // reserve the finished size before emptying it
    cap.textContent = '';
    const typed = document.createElement('span');
    cap.append(typed);
    ScrollTrigger.create({
      trigger: cap,
      start: 'top 78%',
      once: true,
      onEnter: () => {
        gsap.timeline()
          .set(cap, { visibility: 'visible' })
          .fromTo(cap, { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.2, ease: 'steps(4)' })
          .add(typeText(typed, text, { onChar: (c) => audio.blip(c) }));
      },
    });
  });

  // Dim the world in four hard steps as the letter arrives
  gsap.to('#veil', {
    opacity: 0.5, ease: 'steps(4)',
    scrollTrigger: { trigger: '#letter-section', start: 'top 85%', end: 'top 35%', scrub: true },
  });

  return { showFirstArea: () => showArea('nz') };
}
