import { connect } from './device.js';
import { openMic } from './mic.js';
import { addSample, newRecording, save } from './recording.js';
import { normalize, vdot } from './quat.js';
import * as ex from './exercises/sonfile.js';
import { plot } from './plot.js';
import { takeDetector } from './takes.js';

const cfg = ex.config, $ = id => document.getElementById(id);
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(`mugicGesture.${cfg.name}.${k}`)); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(`mugicGesture.${cfg.name}.${k}`, JSON.stringify(v)); } catch (e) {} },
};

let device = null, mic = null, rec = null, live = null;   // rec: the take being saved
let calib = store.get('calib'), reference = store.get('reference'), refA = reference && ex.analyze(reference);
const last = {};   // latest recording per role, for download

function status(text) { $('status').textContent = text; }

$('connect').onclick = async () => {
  try {
    device = await connect(onSample, () => { device = null; live = null; state = 'waiting'; status('disconnected'); render(); });
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
$('recal').onclick = () => { calib = null; store.set('calib', null); render(); };

$('load').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { finish(JSON.parse(await file.text())); } catch (err) { status(`${file.name}: ${err.message}`); }
  e.target.value = '';
};

// What the next take will be used for.
const nextRole = () => (!calib ? 'calibration' : !reference || $('asRef').checked ? 'reference' : 'attempt');

// Short tone so the player knows the state without looking: high = ready, low = take captured.
let audio = null;
function beep(freq) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; g.gain.setValueAtTime(0.2, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.15);
  } catch (e) {}
}

let state = 'waiting';
const feed = takeDetector({ max_s: cfg.window_s[1] }, (e, take) => {
  state = e === 'start' ? 'moving' : 'ready';
  if (e === 'ready') beep(880);
  if (e === 'start') {
    live = { q0: null, f: ex.frame(calib?.axis ?? [0, 0, 1]), t: [], speed: [], off: [], tilt: [], sweep: 0 };
  }
  if (e === 'end') {
    beep(440);
    live = null;
    const role = nextRole();
    rec = newRecording({ exercise: cfg.name, class: cfg.class, mount: cfg.mount, role, performer: 'me' },
      [{ id: device.id, mount: cfg.mount }]);
    if (role !== 'calibration') rec.calib = calib;
    if (mic) rec.extra.mic_rms = take.map(r => r.sample.mic);
    for (const r of take) addSample(rec, 0, r.t, r.sample);
    finish(rec);
    rec = null;
  }
  render();
});

function onSample(s, now) {
  if (mic) s.mic = mic.rms();
  feed(s, now);
  if (!live) return;
  const q = normalize(s.q);
  live.q0 ??= q;
  const a = ex.angles(live.q0, q, live.f), t = now - (live.tStart ??= now);
  live.t.push(t); live.speed.push(vdot(s.gyro, live.f.axis)); live.off.push(a.off); live.tilt.push(a.tilt);
  live.sweep = a.sweep;
}

function finish(r) {
  last[r.role] = r;
  try {
    if (r.role === 'calibration') {
      calib = ex.calibrate(r); store.set('calib', calib);
    } else if (r.role === 'reference') {
      const a = ex.analyze(r);
      if (!a.strokes.length) throw new Error('Take ignored: no strokes found.');
      reference = r; refA = a; store.set('reference', r);
    } else {
      showResults(ex.analyze(r));
    }
    if (r.role === 'reference') $('asRef').checked = false;
  } catch (e) { status(e.message); }
  render();
}

const prompts = {
  calibration: 'Calibration: hold the bow still at the frog, then play one slow full down-bow and hold still at the tip.',
  reference: 'Reference: hold still at the frog, play four sons filés (down, up, down, up, about 8 s each), then hold still.',
  attempt: 'Attempt: hold still at the frog, play the same four strokes, then hold still.',
};

function render() {
  document.querySelectorAll('[data-save]').forEach(b => { b.disabled = !last[b.dataset.save]; });
  $('calibInfo').textContent = calib ? `full bow = ${calib.fullBowDeg.toFixed(0)}° of forearm sweep` : 'not calibrated';
  $('refInfo').textContent = refA ? `${refA.strokes.length} strokes, ${refA.summary.duration?.toFixed(1) ?? '–'} s each` : 'none yet';
  $('connect').textContent = device ? 'MUGIC connected' : 'Connect MUGIC';
  $('connect').classList.toggle('on', !!device);
  $('prompt').textContent = !device ? 'Connect the MUGIC to start.' : prompts[nextRole()];
  $('state').textContent = !device ? '' : state === 'moving' ? '● recording' : state === 'ready' ? 'ready: play when you like' : 'hold still…';
  $('state').className = state;
  $('live').hidden = !live;
}

const span = 10;   // seconds of live trace shown
(function tick() {
  if (live?.t.length) {
    const t1 = live.t[live.t.length - 1], i = live.t.findIndex(t => t > t1 - span), x = live.t.slice(i);
    $('elapsed').textContent = `${t1.toFixed(1)} s`;
    plot($('liveSpeed'), [{ x, y: live.speed.slice(i), color: '--c1' }], { xmin: t1 - span, xmax: t1 });
    plot($('liveAngles'), [{ x, y: live.off.slice(i), color: '--c2' }, { x, y: live.tilt.slice(i), color: '--c3' }],
      { xmin: t1 - span, xmax: t1, ymin: -10, ymax: 10 });
    const pos = calib ? Math.min(1, Math.max(0, live.sweep / calib.fullBowDeg)) : 0;
    $('bowPos').style.left = `${pos * 100}%`;
  }
  requestAnimationFrame(tick);
})();

function showResults(a) {
  const out = $('results');
  out.hidden = false;
  if (!a.strokes.length) { $('score').textContent = '–'; $('coach').textContent = 'No strokes found.'; return; }
  const s = refA?.strokes.length ? ex.score(a, refA) : null;
  $('score').textContent = s?.total ?? '–';
  $('coach').textContent = s ? s.coach : 'Record a reference to get a score.';
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
