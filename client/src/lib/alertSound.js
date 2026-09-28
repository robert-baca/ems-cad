// Audible alerts for the dispatcher dashboard. Backup requests and
// unacknowledged dispatches used to be visual-only banners, easy to miss
// while a dispatcher is on the radio or looking away from the screen.
// Generated with Web Audio so there are no sound files to ship or load.
//
// Browsers only allow audio after the page has had a user gesture. Signing
// in counts, but a reloaded dashboard starts muted until the first click or
// key press, so the context is (re)resumed on any interaction.

let ctx = null;

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

if (typeof window !== 'undefined') {
  const unlock = () => getCtx();
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

function tone(ac, freq, start, duration, volume = 0.25, type = 'square') {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
  gain.gain.setValueAtTime(volume, start + duration - 0.03);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration);
}

const PATTERNS = {
  // Fast high-low siren, three cycles -- unmistakable, for backup requests.
  sos: (ac, t) => {
    for (let i = 0; i < 3; i++) {
      tone(ac, 1250, t + i * 0.5, 0.25, 0.3);
      tone(ac, 850, t + i * 0.5 + 0.25, 0.25, 0.3);
    }
  },
  // Two firm beeps -- a unit hasn't acknowledged its dispatch.
  warning: (ac, t) => {
    tone(ac, 880, t, 0.18, 0.22);
    tone(ac, 880, t + 0.3, 0.18, 0.22);
  },
  // One soft low beep -- something needs a look, not urgent.
  info: (ac, t) => {
    tone(ac, 520, t, 0.2, 0.15, 'sine');
  },
};

export function playAlert(kind) {
  try {
    const ac = getCtx();
    if (!ac) return;
    (PATTERNS[kind] || PATTERNS.info)(ac, ac.currentTime + 0.02);
  } catch { /* audio is best-effort; the visual banner is still there */ }
}
