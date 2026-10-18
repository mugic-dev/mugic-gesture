import { getHub } from './hub.js';
import { openMic } from './mic.js';
import { addSample, download, newRecording, save } from './recording.js';
import { DEG, geodesic, normalize } from './quat.js';
import * as ex from './exercises/sonfile.js';
import { plot } from './plot.js';
import { takeDetector } from './takes.js';
import { flickDetector } from './flick.js';

const cfg = ex.config, $ = id => document.getElementById(id), cap = w => w[0].toUpperCase() + w.slice(1);
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(`mugicGesture.${cfg.name}.${k}`)); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(`mugicGesture.${cfg.name}.${k}`, JSON.stringify(v)); } catch (e) {} },
};

const { hub, framed } = getHub();   // in the menu's frame: its connection
let mic = null, rec = null, live = null;   // rec: the take being saved
// Who is playing: teacher takes become the reference, student takes are scored against it right away. There is
// no calibration step: each take finds its own bow direction, and the teacher's largest stroke is the full bow
// that the student's bow use and speed are measured against.
let mode = store.get('mode') ?? 'teacher';
// The reference pools the teacher takes (strokes and bow changes only) of the latest teacher session: pressing
// Teacher starts a session, and its first take replaces the previous pool.
let teacher = store.get('teacher') ?? [], refA = teacher.length ? ex.pool(teacher) : null;
let teacherBow = store.get('teacherBow'), calib = store.get('lastCalib');   // calib: latest take's, for the live view
let newTeacher = false, refSource = store.get('refSource');   // where the reference came from, for display
const last = {};   // latest recording per role, for download

function status(text) { $('status').textContent = text; }

// Reference file: the teacher pool (per-stroke measures and shapes) and the teacher's full bow, to reuse across
// sessions, send to a remote student, or ship with the app as references/<exercise>.json (used when there is no
// reference of one's own).
const REF_KIND = 'mugic-gesture-reference';
$('saveRef').onclick = () => refA && download(`${cfg.name}-reference.json`,
  { kind: REF_KIND, version: 1, exercise: cfg.name, created: new Date().toISOString(), fullBowDeg: teacherBow, takes: teacher });
$('loadRef').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { useReference(JSON.parse(await file.text()), `Loaded from ${file.name}`); } catch (err) { status(`${file.name}: ${err.message}`); }
};

function useReference(data, source) {
  if (data.kind !== REF_KIND || data.exercise !== cfg.name || !data.takes?.length) {
    throw new Error(`not a ${cfg.title} reference file`);
  }
  teacher = data.takes; teacherBow = data.fullBowDeg ?? null; refA = ex.pool(teacher); newTeacher = false;
  refSource = source;
  store.set('teacher', teacher); store.set('teacherBow', teacherBow); store.set('refSource', refSource);
  status(`reference: ${source.toLowerCase()}`);
  render();
}

if (!teacher.length) {
  fetch(`../references/${cfg.name}.json`)
    .then(r => (r.ok ? r.json() : null))
    .then(d => { if (d && !teacher.length) useReference(d, 'Built into the app'); })
    .catch(() => {});
}

$('connect').onclick = () => hub.connect().catch(e => status(e.message));

$('mic').onchange = async e => {
  if (e.target.checked) {
    try { mic = await openMic(); } catch (err) { e.target.checked = false; status('microphone: ' + err.message); }
  } else { mic?.close(); mic = null; }
};

document.querySelectorAll('[data-save]').forEach(b => { b.onclick = () => last[b.dataset.save] && save(last[b.dataset.save]); });
document.querySelectorAll('[data-mode]').forEach(b => {
  b.onclick = () => {
    mode = b.dataset.mode; store.set('mode', mode);
    if (mode === 'teacher') newTeacher = true;
    render();
  };
});

$('load').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { finish(JSON.parse(await file.text())); } catch (err) { status(`${file.name}: ${err.message}`); }
  e.target.value = '';
};

const roleOf = who => (who === 'teacher' ? 'reference' : 'attempt');

// Short tones so the player knows the state without looking: high = ready, low = take captured,
// rising pair = ON, falling pair = OFF.
const beep = (...freqs) => hub.beep(...freqs);

// Session: 'off' (motion ignored) -> flick -> 'arming' (settle_s) -> 'waiting' / 'ready' / 'moving' -> flick ->
// 'resting' (flicks ignored while the player takes the device off and lays it down: at least rest_s, and until
// it has been still for still_s) -> 'off'.
const settle_s = 1, flickCut_s = 0.4, rest_s = 10, still_s = 2, still_deg = 1.5;
let state = 'off', det = null, armAt = 0, restUntil = 0, now = 0, endedAt = -1;
let calm = null;   // { q, t }: orientation and time since which the device has been still
const flick = flickDetector();

function turnOn(t) { state = 'arming'; armAt = t + settle_s; beep(660, 990); render(); }
function turnOff(t) {
  det?.stop(t - flickCut_s);
  det = null; live = null; state = 'resting'; restUntil = t + rest_s; beep(990, 660); render();
}
$('power').onclick = () => (state === 'off' || state === 'resting' ? turnOn(now) : turnOff(now));

function onTake(e, take, why) {
  state = e === 'start' ? 'moving' : e === 'cancel' ? state : 'ready';
  if (e === 'ready' && now !== endedAt) beep(880);   // no ready beep right after the take-saved beep
  if (e === 'start') {
    live = { q0: null, bow: ex.liveBow(), lastT: null, t: [], speed: [], off: [], tilt: [], theta: 0 };
  }
  if (e === 'cancel') live = null;
  if (e === 'end') {
    beep(440); endedAt = now;
    live = null;
    rec = newRecording({ exercise: cfg.name, class: cfg.class, mount: cfg.mount, role: roleOf(mode), performer: mode },
      [{ id: hub.device.id, mount: cfg.mount }]);
    if (mic) rec.extra.mic_rms = take.map(r => r.sample.mic);
    for (const r of take) addSample(rec, 0, r.t, r.sample);
    finish(rec, why === 'limit' ? ` Stopped at the ${cfg.window_s[1] / 60}-minute limit.` : '');
    rec = null;
  }
  render();
}

function onSample(s, t) {
  now = t;
  if (mic) s.mic = mic.rms();
  const q = normalize(s.q);
  if (!calm || geodesic(q, calm.q) * DEG > still_deg) calm = { q, t };
  if (state === 'resting' && t >= restUntil && t - calm.t >= still_s) { state = 'off'; render(); }
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
  const b = live.bow(s.gyro, live.lastT == null ? 0 : t - live.lastT), qo = normalize(ex.orient(s.q, calib));
  live.lastT = t;
  live.q0 ??= qo;
  const a = ex.angles(live.q0, qo, ex.frame(b.axis)), lt = t - (live.tStart ??= t);
  live.t.push(lt); live.speed.push(b.u); live.off.push(a.off); live.tilt.push(a.tilt);
  live.theta = b.theta;
}

// Calibrate, analyze and report a finished (or loaded) take; every take ends with the result card.
function finish(r, note = '') {
  const who = r.role === 'reference' ? 'teacher' : 'student';
  last[r.role] = r;
  try {
    if (who === 'teacher' && newTeacher) { teacher = []; teacherBow = null; newTeacher = false; }
    if (!r.calib) {
      const c = ex.calibrate(r);
      if (who === 'teacher') { teacherBow = Math.max(c.fullBowDeg, teacherBow ?? 0); store.set('teacherBow', teacherBow); }
      r.calib = calib = { ...c, fullBowDeg: teacherBow ?? c.fullBowDeg };
      store.set('lastCalib', calib);
    }
    const a = ex.analyze(r);
    if (who === 'teacher') {
      teacher.push(ex.refPart(a)); refA = ex.pool(teacher); store.set('teacher', teacher);
      refSource = 'Recorded here'; store.set('refSource', refSource);
      showResults(a, who, `Saved to the reference: ${a.strokes.length} strokes. Reference now ${teacher.length} ` +
        `take${teacher.length > 1 ? 's' : ''}, ${refA.strokes.length} strokes.${note}`);
    } else {
      showResults(a, who, undefined, note);
    }
  } catch (e) { showResults(null, who, `${cap(who)} take not used: ${e.message}`); }
  render();
}


function render() {
  document.querySelectorAll('[data-save]').forEach(b => { b.disabled = !last[b.dataset.save]; });
  $('saveRef').disabled = !refA;
  $('refInfo').innerHTML = (refA
    ? [`${teacher.length} take${teacher.length > 1 ? 's' : ''}`, 'Several strokes',
      teacherBow && `Full bow ≈ ${teacherBow.toFixed(0)}° of forearm sweep`, refSource,
      newTeacher && 'Replaced by the next teacher take']
    : ['None yet']).filter(Boolean).map(x => `<li>${x}</li>`).join('');
  $('connect').textContent = hub.device ? 'MUGIC connected' : 'Connect MUGIC';
  $('connect').classList.toggle('on', !!hub.device);
  $('connect').hidden = framed && !!hub.device;   // the menu's Connect is behind this frame
  $('prompt').textContent = !hub.device ? 'Connect the MUGIC to start.'
    : `${cap(mode)}: start still at the frog, play sons filés (down-bow first, about 8 s each, as many as you like), then hold still.`;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('state').textContent = !hub.device ? '' : {
    off: 'OFF: flick to start', arming: 'ON…', resting: 'OFF: take the MUGIC off and lay it down', waiting: 'ON: hold still…', ready: 'ready: play when you like',
    moving: '● recording',
  }[state];
  $('state').className = state;
  $('power').textContent = state === 'off' || state === 'resting' ? 'Turn ON' : 'Turn OFF';
  $('power').disabled = !hub.device;
  $('live').hidden = !live;
}

const span = 10;   // seconds of live trace shown
(function tick() {
  if (state === 'resting') {
    const left = Math.ceil(restUntil - now);
    $('state').textContent = `OFF: take the MUGIC off and lay it down (${left > 0 ? `${left} s` : 'waiting for it to be still'})`;
  }
  if (live?.t.length) {
    const t1 = live.t[live.t.length - 1], i = live.t.findIndex(t => t > t1 - span), x = live.t.slice(i);
    $('elapsed').textContent = `${t1.toFixed(1)} s`;
    plot($('liveSpeed'), [{ x, y: live.speed.slice(i), color: '--c1' }], { xmin: t1 - span, xmax: t1 });
    plot($('liveAngles'), [{ x, y: live.off.slice(i), color: '--c2' }, { x, y: live.tilt.slice(i), color: '--c3' }],
      { xmin: t1 - span, xmax: t1, ymin: -10, ymax: 10 });
    const pos = Math.min(1, Math.max(0, live.theta / (teacherBow ?? 60)));   // ~60° until the teacher has played
    $('bowPos').style.left = `${(1 - pos) * 100}%`;   // tip on the left, frog on the right
  }
  requestAnimationFrame(tick);
})();

// Mean and ± one standard deviation of stroke speed profiles.
function band(profiles) {
  const n = profiles.length, m = profiles[0].map((_, i) => profiles.reduce((s, p) => s + p[i], 0) / n);
  const sd = m.map((mi, i) => Math.sqrt(profiles.reduce((s, p) => s + (p[i] - mi) ** 2, 0) / n));
  return { y: m, band: [m.map((v, i) => v - sd[i]), m.map((v, i) => v + sd[i])] };
}

// Result card after every take. Both players: stroke count, average time and speed, evenness and stroke shape.
// The student also gets the 0-10 score, the measures against the teacher and the overlay on the teacher's shape.
function showResults(a, who, message, note = '') {
  const ok = a?.strokes.length > 0, student = who === 'student';
  $('results').hidden = false;
  $('resultTitle').textContent = `${cap(who)} take`;
  $('details').hidden = !ok;
  const s = student && ok && refA?.strokes.length ? ex.score(a, refA) : null;
  $('scoreBox').hidden = !s;
  $('metrics').hidden = !s;
  $('score').textContent = s?.total?.toFixed(1) ?? '–';
  $('coach').textContent = (message ?? (s ? s.coach : ok ? 'Record the teacher first to get a score.' : 'No strokes found.')) + note;
  if (!ok) return;
  const avg = key => a.strokes.reduce((t, k) => t + k[key], 0) / a.strokes.length;
  $('summary').textContent = `${a.strokes.length} strokes · ${avg('duration').toFixed(1)} s each · ` +
    `average speed ${avg('speedCmS').toFixed(1)} cm/s · evenness ${Math.round(100 * (1 - avg('speedCv')))}%`;
  $('metrics').innerHTML = '<tr><th>Measure</th><th>Student</th><th>Teacher</th><th>Score /10</th></tr>' + (s ? s.rows : []).map(r =>
    `<tr class="${r.bad > 2 ? 'bad' : ''}"><td>${r.label}</td><td>${r.value.toFixed(r.digits)}</td>` +
    `<td>${r.ref.toFixed(r.digits)}${r.key === 'duration' ? ` ± ${cfg.stroke_s[1]}` : ''}</td><td>${r.score.toFixed(1)}</td></tr>`).join('');
  const f = (v, d) => (v == null ? '–' : v.toFixed(d));
  $('strokes').innerHTML = '<tr><th>#</th><th>Bow</th><th>Time (s)</th><th>Bow used</th><th>Speed (cm/s)</th><th>Speed CV</th><th>Off-plane (°)</th><th>Tilt (°)</th><th>Loudness CV</th></tr>' +
    a.strokes.map((k, i) => `<tr><td>${i + 1}</td><td>${k.dir > 0 ? 'down' : 'up'}</td><td>${f(k.duration, 1)}</td>` +
      `<td>${k.bowFrac == null ? '–' : Math.round(k.bowFrac * 100) + '%'}</td><td>${f(k.speedCmS, 1)}</td><td>${f(k.speedCv, 2)}</td>` +
      `<td>${f(k.offPlane, 1)}</td><td>${f(k.tiltStd, 1)}</td><td>${f(k.loudCv, 2)}</td></tr>`).join('');
  // stroke shape: speed over normalized stroke time. Teacher: this take's strokes over their own mean ± spread;
  // student: the student's strokes over the teacher's (pooled) mean ± spread.
  const own = a.strokes.map(k => ({ y: k.profile, color: student ? '--c2' : '--c1' }));
  const ref = student ? refA?.strokes.length && band(refA.strokes.map(k => k.profile)) : band(a.strokes.map(k => k.profile));
  plot($('profile'), ref ? [{ ...ref, color: '--c1' }, ...own] : own);
  $('profileTitle').innerHTML = student
    ? '<span class="k2">Student</span> strokes over the <span class="k1">teacher</span>\'s shape (bow speed over each stroke)'
    : 'Stroke shape: each stroke\'s bow speed, with the average ± spread';
  plot($('trace'), [{ x: a.t, y: a.ang.map(g => g.off), color: '--c2' }, { x: a.t, y: a.ang.map(g => g.tilt), color: '--c3' }]);
}

// Last: subscribing reports the connection state right away, which renders the page.
const unsubscribe = hub.subscribe({
  sample: onSample,
  status() {
    if (!hub.device) { live = null; det = null; state = 'off'; }
    status(hub.device ? `connected: ${hub.device.id}` : 'not connected');
    render();
  },
});
addEventListener('pagehide', unsubscribe);
