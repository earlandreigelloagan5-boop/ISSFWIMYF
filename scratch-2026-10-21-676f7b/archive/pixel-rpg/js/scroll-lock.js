// Scroll lock used by the gate and the finale.
// iOS Safari ignores overflow:hidden for touch scrolling in some versions,
// so touchmove is also blocked everywhere except elements marked [data-scrollable].

function blockTouch(e) {
  if (!e.target.closest('[data-scrollable]')) e.preventDefault();
}

export function lockScroll() {
  document.documentElement.classList.add('is-locked');
  document.addEventListener('touchmove', blockTouch, { passive: false });
}

export function unlockScroll() {
  document.documentElement.classList.remove('is-locked');
  document.removeEventListener('touchmove', blockTouch);
}
