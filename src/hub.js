// One MUGIC connection shared by the menu and the gesture pages it opens in its frame (as in mugic-arcade): the
// menu owns the Bluetooth connection and passes every sample on, so changing gesture never reconnects. A gesture
// page opened on its own gets a hub of its own and connects by itself. Beeps are played by the hub's page, whose
// audio is unlocked by the Connect click.
import { connect } from './device.js';

function createHub() {
  const subs = new Set();
  let device = null, audio = null;
  const each = fn => subs.forEach(s => { try { fn(s); } catch (e) { subs.delete(s); } });
  const notify = () => each(s => s.status?.());
  return {
    get device() { return device; },
    // s: { sample(sample, seconds), status() }; returns the unsubscribe function
    subscribe(s) { subs.add(s); s.status?.(); return () => subs.delete(s); },
    async connect() {
      try { audio ??= new AudioContext(); } catch (e) {}
      device = await connect((sample, t) => each(s => s.sample?.(sample, t)), () => { device = null; notify(); });
      notify();
    },
    beep(...freqs) {
      if (!audio) return;
      audio.resume();
      freqs.forEach((freq, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * 0.18;
        o.frequency.value = freq; g.gain.setValueAtTime(0.2, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
        o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.15);
      });
    },
  };
}

// The menu's hub when running in its frame, else this page's own.
export function getHub() {
  try { if (window.parent !== window && window.parent.mugicGestureHub) return { hub: window.parent.mugicGestureHub, framed: true }; } catch (e) {}
  window.mugicGestureHub ??= createHub();
  return { hub: window.mugicGestureHub, framed: false };
}
