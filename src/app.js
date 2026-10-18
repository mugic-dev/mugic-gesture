import { connect } from './device.js';
import { openMic } from './mic.js';
import { addSample, newRecording, save } from './recording.js';
import { normalize, vdot } from './quat.js';
import * as ex from './exercises/sonfile.js';
import { plot } from './plot.js';
import { takeDetector } from './takes.js';
import { flickDetector } from './flick.js';

const cfg = ex.config, $ = id => document.getElementById(id), cap = w => w[0].toUpperCase() + w.slice(1);
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(`mugicGesture.${cfg.name}.${k}`)); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(`mugicGesture.${cfg.name}.${k}`, JSON.stringify(v)); } catch (e) {} },
};

let device = null, mic = null, rec = null, live = null;   // rec: the take being saved
// Who is playing: teacher takes become the reference, student takes are scored. Each has its own calibration
// (arms differ in how far the forearm sweeps over a full bow).
let mode = store.get('mode') ?? 'teacher';
const calibs = { teacher: store.get('calib.teacher'), student: store.get('calib.student') };
let calib = calibs[mode], reference = store.get('reference'), refA = reference && ex.analyze(reference);
const last = {};   // latest recording per role, for download

function status(text) { $('status').textContent = text; }

$('connect').onclick = async () => {
  try {
    device = await connect(onSample, () => { device = null; live = null; det = null; state = 'off'; status('disconnected'); render(); });
    status(`connected: ${device.id}`);
  } catch (e) { status(e.message); }
  render();
};

$('mic').onchange = async e => {
  if (e.target.checked) {
    try { mic = await openMic(); } catch (err) { e.target.checked = false; status('microphone: ' + err.message); }
  } else { mic?.close(); mic = null; }
};

document.querySelectorAll('[data-save]').forEach(b => { b.onclick = () => last[b.dataset.save] && save(last[b.dataset.save]); });
$('recal').onclick = () => { calib = calibs[mode] = null; store.set(`calib.${mode}`, null); render(); };
document.querySelectorAll('[data-mode]').forEach(b => {
  b.onclick = () => { mode = b.dataset.mode; calib = calibs[mode]; store.set('mode', mode); render(); };
});

$('load').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { finish(JSON.parse(await file.text())); } catch (err) { status(`${file.name}: ${err.message}`); }
  e.target.value = '';
};

// What the next take will be used for.
const nextRole = () => (!calib ? 'calibration' : mode === 'teacher' ? 'reference' : 'attempt');

// Short tones so the player knows the state without looking: high = ready, low = take captured,
// rising pair = ON, falling pair = OFF.
let audio = null;
function beep(...freqs) {
  try {
    audio ??= new AudioContext();
    freqs.forEach((freq, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * 0.18;
      o.frequency.value = freq; g.gain.setValueAtTime(0.2, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
      o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.15);
    });
  } catch (e) {}
}

// Session: 'off' (motion ignored) -> flick -> 'arming' (settle_s) -> 'waiting' / 'ready' / 'moving' -> flick ->
// 'resting' (rest_s: flicks ignored while the player takes the device off and lays it down) -> 'off'.
const settle_s = 1, flickCut_s = 0.4, rest_s = 10;
let state = 'off', det = null, armAt = 0, restUntil = 0, now = 0;
const flick = flickDetector();

function turnOn(t) { state = 'arming'; armAt = t + settle_s; beep(660, 990); render(); }
function turnOff(t) {
  det?.stop(t - flickCut_s);
  det = null; live = null; state = 'resting'; restUntil = t + rest_s; beep(990, 660); render();
}
$('power').onclick = () => (state === 'off' || state === 'resting' ? turnOn(now) : turnOff(now));

function onTake(e, take) {
  state = e === 'start' ? 'moving' : e === 'cancel' ? state : 'ready';
  if (e === 'ready') beep(880);
  if (e === 'start') {
    live = { q0: null, f: ex.frame(calib?.axis ?? [0, 0, 1]), t: [], speed: [], off: [], tilt: [], sweep: 0 };
  }
  if (e === 'cancel') live = null;
  if (e === 'end') {
    beep(440);
    live = null;
    const role = nextRole();
    rec = newRecording({ exercise: cfg.name, class: cfg.class, mount: cfg.mount, role, performer: mode },
      [{ id: device.id, mount: cfg.mount }]);
    if (role !== 'calibration') rec.calib = calib;
    if (mic) rec.extra.mic_rms = take.map(r => r.sample.mic);
    for (const r of take) addSample(rec, 0, r.t, r.sample);
    finish(rec);
    rec = null;
  }
  render();
}

function onSample(s, t) {
  now = t;
  if (mic) s.mic = mic.rms();
  if (state === 'resting' && t >= restUntil) { state = 'off'; render(); }
  if (flick(s.acc, t)) {
    if (state === 'off') turnOn(t);
    else if (state !== 'arming' && state !== 'resting') turnOff(t);
    return;
  }
  if (state === 'arming' && t >= armAt) {
    state = 'waiting'; det = takeDetector({ max_s: cfg.window_s[1] }, onTake); render();
  }
  if (!det) return;
  det.feed(s, t);
  if (!live) return;
  const q = normalize(ex.orient(s.q, calib));
  live.q0 ??= q;
  const a = ex.angles(live.q0, q, live.f), lt = t - (live.tStart ??= t);
  live.t.push(lt); live.speed.push(vdot(s.gyro, live.f.axis)); live.off.push(a.off); live.tilt.push(a.tilt);
  live.sweep = a.sweep;
}

function finish(r) {
  last[r.role] = r;
  try {
    if (r.role === 'calibration') {
      calib = calibs[mode] = ex.calibrate(r); store.set(`calib.${mode}`, calib);
    } else if (r.role === 'reference') {
      const a = ex.analyze(r);
      if (!a.strokes.length) throw new Error('Take ignored: no strokes found.');
      reference = r; refA = a; store.set('reference', r);
    } else {
      showResults(ex.analyze(r));
    }
  } catch (e) { status(e.message); }
  render();
}

const prompts = {
  calibration: 'calibration: hold the bow still at the frog, then play one slow full down-bow and hold still at the tip.',
  reference: 'reference: hold still at the frog, play four sons filés (down, up, down, up, about 8 s each), then hold still.',
  attempt: 'Attempt: hold still at the frog, play the same four strokes, then hold still.',
};

function render() {
  document.querySelectorAll('[data-save]').forEach(b => { b.disabled = !last[b.dataset.save]; });
  $('calibInfo').textContent = calib ? `${cap(mode)}: full bow = ${calib.fullBowDeg.toFixed(0)}° of forearm sweep` : 'not calibrated';
  $('refInfo').textContent = refA ? `${refA.strokes.length} strokes, ${refA.summary.duration?.toFixed(1) ?? '–'} s each` : 'none yet';
  $('connect').textContent = device ? 'MUGIC connected' : 'Connect MUGIC';
  $('connect').classList.toggle('on', !!device);
  $('prompt').textContent = !device ? 'Connect the MUGIC to start.' : `${cap(mode)} ${prompts[nextRole()]}`;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('state').textContent = !device ? '' : {
    off: 'OFF: flick to start', arming: 'ON…', resting: 'OFF: take the MUGIC off and lay it flat', waiting: 'ON: hold still…', ready: 'ready: play when you like',
    moving: '● recording',
  }[state];
  $('state').className = state;
  $('power').textContent = state === 'off' || state === 'resting' ? 'Turn ON' : 'Turn OFF';
  $('power').disabled = !device;
  $('live').hidden = !live;
}

const span = 10;   // seconds of live trace shown
(function tick() {
  if (state === 'resting') $('state').textContent = `OFF: take the MUGIC off and lay it flat (${Math.max(0, Math.ceil(restUntil - now))} s)`;
  if (live?.t.length) {
    const t1 = live.t[live.t.length - 1], i = live.t.findIndex(t => t > t1 - span), x = live.t.slice(i);
    $('elapsed').textContent = `${t1.toFixed(1)} s`;
    plot($('liveSpeed'), [{ x, y: live.speed.slice(i), color: '--c1' }], { xmin: t1 - span, xmax: t1 });
    plot($('liveAngles'), [{ x, y: live.off.slice(i), color: '--c2' }, { x, y: live.tilt.slice(i), color: '--c3' }],
      { xmin: t1 - span, xmax: t1, ymin: -10, ymax: 10 });
    $('bow').hidden = !calib;   // no bow size until calibrated
    const pos = calib ? Math.min(1, Math.max(0, live.sweep / calib.fullBowDeg)) : 0;
    $('bowPos').style.left = `${(1 - pos) * 100}%`;   // tip on the left, frog on the right
  }
  requestAnimationFrame(tick);
})();

function showResults(a) {
  const out = $('results');
  out.hidden = false;
  if (!a.strokes.length) { $('score').textContent = '–'; $('coach').textContent = 'No strokes found.'; return; }
  const s = refA?.strokes.length ? ex.score(a, refA) : null;
  $('score').textContent = s?.total ?? '–';
  $('coach').textContent = s ? s.coach : 'Record the teacher first to get a score.';
  $('metrics').innerHTML = '<tr><th>Measure</th><th>You</th><th>Reference</th><th>z</th></tr>' + (s ? s.rows : []).map(r =>
    `<tr class="${r.bad > 2 ? 'bad' : ''}"><td>${r.label}</td><td>${r.value.toFixed(r.digits)}</td>` +
    `<td>${r.ref.toFixed(r.digits)}${r.key === 'duration' ? ` ± ${cfg.stroke_s[1]}` : ''}</td><td>${r.z.toFixed(1)}</td></tr>`).join('');
  const f = (v, d) => (v == null ? '–' : v.toFixed(d));
  $('strokes').innerHTML = '<tr><th>#</th><th>Bow</th><th>Time (s)</th><th>Bow used</th><th>Speed (cm/s)</th><th>Speed CV</th><th>Off-plane (°)</th><th>Tilt (°)</th><th>Loudness CV</th></tr>' +
    a.strokes.map((k, i) => `<tr><td>${i + 1}</td><td>${k.dir > 0 ? 'down' : 'up'}</td><td>${f(k.duration, 1)}</td>` +
      `<td>${k.bowFrac == null ? '–' : Math.round(k.bowFrac * 100) + '%'}</td><td>${f(k.speedCmS, 1)}</td><td>${f(k.speedCv, 2)}</td>` +
      `<td>${f(k.offPlane, 1)}</td><td>${f(k.tiltStd, 1)}</td><td>${f(k.loudCv, 2)}</td></tr>`).join('');
  // speed profile on normalized stroke time: reference mean ± std band, attempt strokes on top
  const series = a.strokes.map(k => ({ y: k.profile, color: '--c2' }));
  if (refA?.strokes.length) {
    const p = refA.strokes.map(k => k.profile), m = p[0].map((_, i) => p.reduce((s, r) => s + r[i], 0) / p.length);
    const sd = m.map((mi, i) => Math.sqrt(p.reduce((s, r) => s + (r[i] - mi) ** 2, 0) / p.length));
    series.unshift({ y: m, color: '--c1', band: [m.map((v, i) => v - sd[i]), m.map((v, i) => v + sd[i])] });
  }
  plot($('profile'), series);
  plot($('trace'), [{ x: a.t, y: a.ang.map(g => g.off), color: '--c2' }, { x: a.t, y: a.ang.map(g => g.tilt), color: '--c3' }]);
}

if (reference) last.reference = reference;
render();
