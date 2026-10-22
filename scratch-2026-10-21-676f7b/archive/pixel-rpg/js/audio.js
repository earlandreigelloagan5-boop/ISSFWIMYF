// Music + chiptune sound effects through the Web Audio API.
// iOS Safari ignores <audio>.volume, so fades go through a GainNode.
// The AudioContext must be created inside the title-screen tap.
import { MUSIC_VOLUME, MUSIC_FADE_IN, MUSIC_SWELL, prefersReducedMotion as reduced } from './config.js';

export function createAudio(el, toggleBtn) {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let music = null;      // GainNode for the song
  let sfx = null;        // GainNode for blips and jingles
  let songOk = true;
  let started = false;
  let muted = false;
  let level = MUSIC_VOLUME;
  let bars = null;
  let blipCount = 0;

  el.addEventListener('error', () => {
    songOk = false;
    toggleBtn.hidden = true;
  });

  function setup() {
    if (ctx || !AC) return;
    ctx = new AC();
    music = ctx.createGain();
    music.gain.value = 0;
    sfx = ctx.createGain();
    sfx.gain.value = 1;
    const source = ctx.createMediaElementSource(el);
    source.connect(music);
    music.connect(ctx.destination);
    sfx.connect(ctx.destination);
  }

  function ramp(node, value, seconds) {
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(value, now + seconds);
  }

  function setMusic(value, seconds) {
    if (music) ramp(music, value, seconds);
    else gsap.to(el, { volume: value, duration: seconds, overwrite: true });
  }

  // One square-wave note: the NES/Game Boy voice.
  function tone(freq, dur, { when = 0, vol = 0.05, type = 'square', slide } = {}) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Stepped equalizer bars on the toggle
  function buildBars() {
    if (reduced) return null;
    return gsap.utils.toArray('.sound__bar', toggleBtn).map((bar, i) =>
      gsap.fromTo(bar, { scaleY: 0.4 }, {
        scaleY: 1, duration: () => gsap.utils.random(0.3, 0.6), ease: 'steps(3)',
        yoyo: true, repeat: -1, repeatRefresh: true, delay: i * 0.1,
      }));
  }

  function setMuted(next) {
    muted = next;
    setMusic(muted ? 0 : level, 0.4);
    toggleBtn.setAttribute('aria-pressed', String(muted));
    toggleBtn.setAttribute('aria-label', muted ? 'Play music' : 'Mute music');
    bars?.forEach((t) => (muted ? t.pause() : t.play()));
  }
  toggleBtn.addEventListener('click', () => setMuted(!muted));

  document.addEventListener('visibilitychange', () => {
    if (!started || !songOk) return;
    if (document.hidden) el.pause();
    else el.play().catch(() => {});
  });

  return {
    // Call synchronously inside the tap handler, before any await.
    start() {
      if (started) return;
      started = true;
      setup();
      ctx?.resume();
      if (!music) el.volume = 0;
      const playing = el.play();
      setMusic(level, MUSIC_FADE_IN);
      Promise.resolve(playing)
        .then(() => {
          if (!songOk) return;
          toggleBtn.hidden = false;
          gsap.to(toggleBtn, { opacity: 1, duration: 0.6, ease: 'steps(3)', delay: 1.2 });
          bars = buildBars();
        })
        .catch(() => { songOk = false; });
    },
    swell() {
      level = MUSIC_SWELL;
      if (!muted) setMusic(level, 5);
    },
    // ---- Sound effects ----
    jingle() {   // "press start"
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, { when: i * 0.08, vol: 0.06 }));
    },
    blip(ch) {   // NPC speech, every other letter
      if (!ch || ch === ' ' || blipCount++ % 2) return;
      tone(gsap.utils.random([494, 523, 587, 622]), 0.04, { vol: 0.03 });
    },
    select() {   // advance the dialogue
      tone(880, 0.05, { vol: 0.05 });
      tone(1318, 0.07, { when: 0.05, vol: 0.05 });
    },
    charge(p) {  // rising tone while holding
      tone(300 + p * 600, 0.05, { vol: 0.025, type: 'triangle' });
    },
    fanfare() {  // the finale
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
        tone(f, i === 6 ? 0.5 : 0.14, { when: i * 0.11, vol: 0.06 }));
    },
  };
}
