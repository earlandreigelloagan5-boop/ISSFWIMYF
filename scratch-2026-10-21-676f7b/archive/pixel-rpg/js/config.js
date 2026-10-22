// Shared tuning knobs. Everything you might want to tweak lives here.

export const HOLD_DURATION = 2;          // seconds the tulip must be held
export const HOLD_MOVE_TOLERANCE = 40;   // px a thumb may drift before the hold cancels
export const HOLD_SEGMENTS = 12;

// Sprite sheets in assets/: frame size in art pixels + frame count.
// Replace the PNGs with your own art using the same layout.
export const SPRITES = {
  tulip:   { w: 16, h: 32, frames: 6 },   // sprout, bud, opening, open, lean-left, lean-right
  heart:   { w: 8,  h: 8,  frames: 2 },   // big, small (heartbeat)
  sparkle: { w: 7,  h: 7,  frames: 2 },   // big, small (twinkle)
};
export const TULIP = { SPROUT: 0, BUD: 1, OPENING: 2, OPEN: 3, LEFT: 4, RIGHT: 5 };

// Palette (same 16 colours as css/variables.css)
export const PAL = {
  c0: '#0d0221', c1: '#1a0b3d', c2: '#2e1760', c3: '#4b2a8c', c4: '#6d3fc0', c5: '#9b6fe0',
  c6: '#c5a3ff', c7: '#e8d5ff', c8: '#ff7eb6', c9: '#ffb3d1', c10: '#ffe4f0', c11: '#fff7fb',
};
export const PETAL_COLORS = [PAL.c8, PAL.c9, PAL.c10, PAL.c5, PAL.c6, PAL.c4, PAL.c7];

// Edge tulips that bloom during the journey.
// side: which edge · x: art pixels in from that edge · y: where the sprite's base sits (fraction of height) · s: integer scale
export const FRAME_TULIPS = [
  { side: 'left',  x: 2,  y: 1.0,  s: 2 },
  { side: 'left',  x: 16, y: 0.99, s: 1 },
  { side: 'right', x: 2,  y: 1.0,  s: 2 },
  { side: 'right', x: 15, y: 0.98, s: 1 },
  { side: 'left',  x: 1,  y: 0.74, s: 1 },
  { side: 'right', x: 1,  y: 0.66, s: 1 },
  { side: 'left',  x: 2,  y: 0.46, s: 1 },
  { side: 'right', x: 2,  y: 0.38, s: 1 },
];

// Area names shown in the banner
export const AREAS = { nz: 'PAKURANGA, NZ', alps: 'SWISS ALPS' };

const lowPower = (navigator.hardwareConcurrency || 4) <= 4;
export const PETALS = { burst: lowPower ? 90 : 160, rain: lowPower ? 60 : 110 };
export const SNOWFLAKES = lowPower ? 22 : 34;
export const MOTES = lowPower ? 7 : 11;

// Music
export const MUSIC_VOLUME = 0.6;
export const MUSIC_FADE_IN = 4;
export const MUSIC_SWELL = 0.9;

// NPC typing speed (characters per second)
export const TYPE_CPS = 34;
// Longest page in the letter box before it splits onto the next page
export const PAGE_CHARS = 150;

export const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
