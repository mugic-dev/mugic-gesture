// One MUGIC connection shared by the menu and the gesture pages it opens in its frame (as in mugic-arcade): the
// menu owns the Bluetooth connection and passes every sample on, so changing gesture never reconnects. A gesture
// page opened on its own gets a hub of its own and connects by itself. Beeps are played by the hub's page, whose
// audio is unlocked by the Connect click.
// The hub also keeps the diagnostic log shared by all its pages: the last LOG_MAX entries, kept across reloads
// (localStorage) and echoed to the console; downloadLog() saves it as a file to send for debugging.
import { connect } from './device.js';
import { download } from './recording.js';

const LOG_KEY = 'mugicGesture.log', LOG_MAX = 3000, STATS_S = 5;

function createHub() {
  const subs = new Set();
  let device = null, audio = null, entries = [], dirty = false;
  try { entries = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) {}
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(entries)); } catch (e) {}
  }, 2000);
  const here = location.pathname.split('/').filter(Boolean).pop() || 'menu';
  const log = (event, data, page = here) => {
    const entry = { at: new Date().toISOString(), page, event, ...(data === undefined ? {} : { data }) };
    entries.push(entry);
    if (entries.length > LOG_MAX) entries.splice(0, entries.length - LOG_MAX);
    dirty = true;
    console.info('[mugic-gesture]', page, event, data ?? '');
  };
  const each = fn => subs.forEach(s => { try { fn(s); } catch (e) { subs.delete(s); log('subscriber-dropped', String(e)); } });
  const notify = () => each(s => s.status?.());
  // Every STATS_S seconds while streaming: packet rate and peak motion, to see what the device sent.
  let stats = null;
  const count = (s, t) => {
    stats ??= { t0: t, n: 0, gyro: 0, acc: 0 };
    ++stats.n;
    stats.gyro = Math.max(stats.gyro, Math.hypot(...s.gyro));
    stats.acc = Math.max(stats.acc, Math.hypot(...s.acc));
    if (t - stats.t0 >= STATS_S) {
      log('ble.stats', { hz: +(stats.n / (t - stats.t0)).toFixed(1), maxGyroDps: Math.round(stats.gyro), maxAccMs2: +stats.acc.toFixed(1), subscribers: subs.size });
      stats = null;
    }
  };
  log('page.load', { url: location.href, ua: navigator.userAgent });
  return {
    get device() { return device; },
    log,
    downloadLog() { download(`mugic-gesture-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, entries); },
    // s: { sample(sample, seconds), status() }; returns the unsubscribe function
    subscribe(s) { subs.add(s); s.status?.(); return () => subs.delete(s); },
    async connect() {
      log('connect.click', { bluetooth: !!navigator.bluetooth, connected: !!device });
      try { audio ??= new AudioContext(); } catch (e) { log('audio.error', String(e)); }
      try {
        device = await connect((sample, t) => { count(sample, t); each(s => s.sample?.(sample, t)); },
          () => { log('ble.disconnected', { id: device?.id }); device = null; notify(); }, log);
      } catch (e) {
        log('connect.error', { name: e.name, message: e.message });
        throw e;
      }
      log('connect.ok', { id: device.id });
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
  if (!window.mugicGestureHub) {
    const hub = window.mugicGestureHub = createHub();
    addEventListener('error', e => hub.log('js.error', { message: e.message, at: `${e.filename}:${e.lineno}` }));
    addEventListener('unhandledrejection', e => hub.log('js.rejection', String(e.reason)));
  }
  return { hub: window.mugicGestureHub, framed: false };
}
