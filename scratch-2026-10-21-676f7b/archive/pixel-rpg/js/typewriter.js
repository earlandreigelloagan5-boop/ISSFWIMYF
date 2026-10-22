// NPC-style typing with GSAP TextPlugin: one character at a time,
// a speech blip per letter, and a blinking █ cursor.
import { TYPE_CPS } from './config.js';

// Hard on/off blink, like a terminal or an RPG text cursor.
export function blinkCursor(el) {
  return gsap.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.45, ease: 'steps(1)', repeat: -1, yoyo: true });
}

// Types `text` into `el`. onChar fires once for each new character (for blips).
export function typeText(el, text, { cps = TYPE_CPS, onChar } = {}) {
  el.textContent = '';
  let shown = 0;
  return gsap.to(el, {
    text: { value: text },
    duration: Math.max(text.length / cps, 0.1),
    ease: 'none',
    onUpdate() {
      const n = el.textContent.length;
      if (n > shown) {
        onChar?.(el.textContent[n - 1], n);
        shown = n;
      }
    },
  });
}

// Keeps the final layout reserved while typing: the full text sits in the
// element as transparent "ghost" text and the typed copy is drawn on top,
// so nothing below it jumps. Screen readers still read the whole line.
export function reserveText(el) {
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  el.textContent = '';
  el.style.position = 'relative';

  const ghost = document.createElement('span');
  ghost.textContent = text;
  ghost.style.cssText = 'color:transparent;text-shadow:none';

  const layer = document.createElement('span');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:absolute;inset:0;padding:inherit';
  const typed = document.createElement('span');
  const cursor = document.createElement('span');
  cursor.className = 'px-cursor';
  cursor.textContent = '█';
  cursor.style.visibility = 'hidden';
  layer.append(typed, cursor);

  // The ghost reserves room for the cursor too, so it can't wrap past the box.
  const ghostCursor = cursor.cloneNode(true);
  ghostCursor.style.visibility = 'hidden';
  ghost.append(ghostCursor);

  el.append(ghost, layer);
  return { text, typed, cursor };
}

// Splits a long speech into pages that fit the box, breaking between sentences.
export function paginate(text, max) {
  const sentences = text.match(/[^.!?]+[.!?]+["')]*\s*|[^.!?]+$/g) || [text];
  const pages = [];
  let page = '';
  for (const s of sentences) {
    if (page && (page + s).length > max) {
      pages.push(page.trim());
      page = '';
    }
    page += s;
  }
  if (page.trim()) pages.push(page.trim());
  return pages;
}
