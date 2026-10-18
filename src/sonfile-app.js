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
const log = (event, data) => hub.log(event, data, 'sonfile');
if (framed) {   // the menu's hub only sees its own page's errors
  addEventListener('error', e => log('js.error', { message: e.message, at: `${e.filename}:${e.lineno}` }));
  addEventListener('unhandledrejection', e => log('js.rejection', String(e.reason)));
}
log('page.open', { framed });
$('downloadLog').onclick = () => hub.downloadLog();
let mic = null, rec = null, live = null;   // rec: the take being saved
// Who is playing: teacher takes become the reference, student takes are scored against it right away. There is
// no calibration step: each take finds its own bow direction, and the teacher's largest stroke is the full bow
// that the student's bow use and speed are measured against.
let mode = 'student', modePicked = false;   // starts in Teacher only while there is no reference at all
// The reference pools the teacher takes (strokes and bow changes only) of the latest teacher session: pressing
// Teacher starts a session, and its first take replaces the previous pool.
let teacher = store.get('teacher') ?? [], refA = teacher.length ? ex.pool(teacher) : null;
if (!refA) mode = 'teacher';
let teacherBow = store.get('teacherBow'), calib = store.get('lastCalib');   // calib: latest take's, for the live view
// The reference's stamp: the teacher's name, where it came from and when it was recorded (its latest teacher take),
// for display and the file.
let newTeacher = false, refSource = store.get('refSource'), refCreated = store.get('refCreated'), refTeacher = store.get('refTeacher');
const when = iso => (iso && !isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);
const refWhere = () => [refTeacher && `Teacher ${refTeacher}`, refSource ?? 'Recorded here', when(refCreated) && `recorded ${when(refCreated)}`]
  .filter(Boolean).map((part, i) => (i ? part.replace(/^./, c => c.toLowerCase()) : part)).join(', ');
const setRefTeacher = name => { refTeacher = name?.trim() || null; store.set('refTeacher', refTeacher); };
$('teacherName').value = store.get('teacherName') ?? '';
$('teacherName').onchange = () => {   // the name this browser's teacher records under; renames a reference recorded here
  store.set('teacherName', $('teacherName').value.trim());
  if (refA && refSource === 'Recorded here') setRefTeacher($('teacherName').value);
  render();
};
// Target stroke duration: set by the teacher's slider (refTarget, kept in the reference), else the teacher's average.
let refTarget = store.get('refTarget') ?? null;
$('tickTarget').checked = mode === 'teacher';   // a tick at the target time helps the teacher hold the tempo
const tempoText = () => { const { s, tol } = ex.tempo(refA, cfg, refTarget); return `${s.toFixed(1)} s ± ${tol.toFixed(1)}`; };
// Detection thresholds for the current target tempo and the teacher's full bow.
const pace = () => ex.paced(ex.tempo(refA, cfg, refTarget).s, teacherBow ?? 60);
const setTarget = v => { refTarget = v; store.set('refTarget', v); log('reference.target', v); render(); };
$('target').oninput = () => setTarget(+$('target').value);
$('targetNum').onchange = () => { const v = +$('targetNum').value; if (v >= 2 && v <= 60) setTarget(v); else render(); };
$('targetAuto').onclick = () => setTarget(null);
const last = {};   // latest recording per role, for download

function status(text) { $('status').textContent = text; }

// Reference file: the teacher pool (per-stroke measures and shapes) and the teacher's full bow, to reuse across
// sessions, send to a remote student, or ship with the app as references/<exercise>.json (used when there is no
// reference of one's own).
const REF_KIND = 'mugic-gesture-reference';
$('saveRef').onclick = () => {
  if (!refA) return;
  const saved = new Date().toISOString(), created = refCreated ?? saved;
  const d = new Date(created), p = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;   // local time
  const who = refTeacher ? `-${refTeacher.replace(/[^\p{L}\p{N}]+/gu, '-')}` : '';
  download(`${cfg.name}-reference${who}-${stamp}.json`,   // e.g. son_file-reference-MARI-2026-10-18-1530.json
    { kind: REF_KIND, version: 1, exercise: cfg.name, teacher: refTeacher, created, saved, fullBowDeg: teacherBow,
      strokeTarget: refTarget, strokeSeconds: +ex.tempo(refA, cfg, refTarget).s.toFixed(2), takes: teacher });   // strokeSeconds: informative
  log('reference.save', { teacher: refTeacher, created, saved });
};
$('loadRef').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { useReference(JSON.parse(await file.text()), `Loaded from ${file.name}`); showReference(); } catch (err) { log('reference.error', err.message); status(`${file.name}: ${err.message}`); }
};

function useReference(data, source) {
  if (data.kind !== REF_KIND || data.exercise !== cfg.name || !data.takes?.length) {
    throw new Error(`not a ${cfg.title} reference file`);
  }
  teacher = data.takes; teacherBow = data.fullBowDeg ?? null; refA = ex.pool(teacher); newTeacher = false;
  refSource = source;
  log('reference.use', { source, takes: teacher.length, fullBowDeg: teacherBow });
  if (!modePicked) { mode = 'student'; $('tickTarget').checked = false; }   // e.g. the built-in reference arrived after the page opened in Teacher
  store.set('teacher', teacher); store.set('teacherBow', teacherBow); store.set('refSource', refSource);
  refCreated = data.created ?? null;
  store.set('refCreated', refCreated); setRefTeacher(data.teacher);
  refTarget = data.strokeTarget ?? null; store.set('refTarget', refTarget);
  status(`reference: ${source.replace(/^./, c => c.toLowerCase())}`);
  render();
}

// The reference card: what was loaded (or recorded) and the teacher's strokes, shape and averages.
function showReference() {
  if (!refA) return;
  const n = teacher.length;
  showResults({ strokes: refA.strokes, turns: refA.turns }, 'teacher',
    `${refWhere()} · ${n} take${n > 1 ? 's' : ''} · tempo ${tempoText()} per stroke` +
    (teacherBow ? ` · full bow ≈ ${teacherBow.toFixed(0)}° of forearm sweep` : ''), '', 'Teacher reference');
}
$('viewRef').onclick = showReference;

if (!teacher.length) {
  fetch(`../references/${cfg.name}.json`)
    .then(r => (r.ok ? r.json() : null))
    .then(d => { if (d && !teacher.length) useReference(d, 'Built into the app'); })
    .catch(() => {});
}

$('connect').onclick = () => hub.connect().catch(e => status(`${e.name}: ${e.message}`));

$('mic').onchange = async e => {
  if (e.target.checked) {
    try { mic = await openMic(); } catch (err) { e.target.checked = false; status('microphone: ' + err.message); }
  } else { mic?.close(); mic = null; }
};

document.querySelectorAll('[data-save]').forEach(b => { b.onclick = () => last[b.dataset.save] && save(last[b.dataset.save]); });
document.querySelectorAll('[data-mode]').forEach(b => {
  b.onclick = () => {
    mode = b.dataset.mode; modePicked = true;
    log('mode', mode);
    $('tickTarget').checked = mode === 'teacher';
    if (shownFor !== mode) $('results').hidden = true;   // each role sees only its own result card
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
let state = 'off', det = null, armAt = 0, restUntil = 0, now = 0;
let calm = null;   // { q, t }: orientation and time since which the device has been still
const flick = flickDetector();

function turnOn(t, how) { log('session.on', { how, from: state }); state = 'arming'; armAt = t + settle_s; beep(660, 990); render(); }
function turnOff(t, how) {
  log('session.off', { how, from: state });
  det?.stop(t - flickCut_s);
  det = null; live = null; state = 'resting'; restUntil = t + rest_s; beep(990, 660); render();
}
$('power').onclick = () => (state === 'off' || state === 'resting' ? turnOn(now, 'button') : turnOff(now, 'button'));

function onTake(e, take, why) {
  log(`take.${e}`, take ? { why, samples: take.length, seconds: +(take.at(-1).t - take[0].t).toFixed(1), mode } : { mode });
  state = e === 'start' ? 'moving' : e === 'ready' ? 'ready' : e === 'end' ? 'waiting' : state;
  if (e === 'ready') beep(880);
  if (e === 'start') {
    const p = pace();
    // stroke timer: counts up from the start of the take, restarts at each bow change (zero crossing of the
    // smoothed bow speed, confirmed once it passes the moving threshold the other way)
    live = { pace: p, target: ex.tempo(refA, cfg, refTarget).s, ue: 0, dir: 0, n: 1, strokeT0: 0, flipT: 0, ticked: false,
      q0: null, bow: ex.liveBow(p), lastT: null, t: [], speed: [], off: [], tilt: [], theta: 0 };
  }
  if (e === 'cancel') live = null;
  if (e === 'end') {   // one take per ON: the session then rests as after an OFF flick
    if (why !== 'off') { det = null; state = 'resting'; restUntil = now + rest_s; beep(440, 990, 660); }
    live = null;
    rec = newRecording({ exercise: cfg.name, class: cfg.class, mount: cfg.mount, role: roleOf(mode), performer: mode },
      [{ id: hub.device.id, mount: cfg.mount }]);
    if (mic) rec.extra.mic_rms = take.map(r => r.sample.mic);
    for (const r of take) addSample(rec, 0, r.t, r.sample);
    finish(rec, why === 'limit' ? ` Stopped at the ${Math.round(pace().window_s[1] / 60)}-minute limit.` : '', why);
    rec = null;
  }
  render();
}

function onSample(s, t) {
  now = t;
  if (mic) s.mic = mic.rms();
  const q = normalize(s.q);
  if (!calm || geodesic(q, calm.q) * DEG > still_deg) calm = { q, t };
  if (state === 'resting' && t >= restUntil && t - calm.t >= still_s) { log('session.rested'); state = 'off'; render(); }
  if (flick(s.acc, t)) {
    const energy = Math.round(flick.energy);
    if (state === 'off') turnOn(t, `flick ${energy}`);
    else if (state !== 'arming' && state !== 'resting') turnOff(t, `flick ${energy}`);
    else log('flick.ignored', { state, energy });
    return;
  }
  if (state === 'arming' && t >= armAt) {
    log('session.armed');
    const p = pace();
    log('session.pace', { strokeS: ex.tempo(refA, cfg, refTarget).s, reversalDps: +p.reversal_dps.toFixed(2), endHoldS: p.end_hold_s, maxS: p.window_s[1] });
    state = 'waiting'; det = takeDetector({ max_s: p.window_s[1], end_hold_s: p.end_hold_s }, onTake); render();
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
  const ue = live.ue + 0.2 * (b.u - live.ue), th = live.pace.reversal_dps;
  if (Math.sign(ue) !== Math.sign(live.ue)) live.flipT = lt;
  live.ue = ue;
  const dir = ue > th ? 1 : ue < -th ? -1 : 0;
  if (dir && dir !== live.dir) {
    if (live.dir) { ++live.n; live.strokeT0 = live.flipT; live.ticked = false; }
    live.dir = dir;
  }
  if (!live.ticked && lt - live.strokeT0 >= live.target) {
    live.ticked = true;
    if ($('tickTarget').checked) beep(1320);
  }
}

// Calibrate, analyze and report a finished (or loaded) take; every take ends with the result card.
function finish(r, note = '', why = '') {
  const who = r.role === 'reference' ? 'teacher' : 'student';
  try {
    const fresh = who === 'teacher' && newTeacher;   // first take of a teacher session replaces the reference
    let bow = fresh ? null : teacherBow;
    if (!r.calib) {
      const c = ex.calibrate(r, pace());
      if (who === 'teacher') bow = Math.max(c.fullBowDeg, bow ?? 0);
      r.calib = { ...c, fullBowDeg: bow ?? c.fullBowDeg };
    }
    const a = ex.analyze(r, pace());
    last[r.role] = r;
    calib = r.calib; store.set('lastCalib', calib);
    if (fresh) { teacher = []; newTeacher = false; }
    if (who === 'teacher') { teacherBow = bow; store.set('teacherBow', teacherBow); }
    log('take.analyzed', { who, strokes: a.strokes.length, durations: a.strokes.map(k => +k.duration.toFixed(1)),
      fullBowDeg: Math.round(r.calib.fullBowDeg), conj: r.calib.conj });
    if (who === 'teacher') {
      teacher.push(ex.refPart(a)); refA = ex.pool(teacher); store.set('teacher', teacher);
      refSource = 'Recorded here'; refCreated = new Date().toISOString(); setRefTeacher($('teacherName').value);
      store.set('refSource', refSource); store.set('refCreated', refCreated);
      showResults(a, who, `Saved to the reference: ${a.strokes.length} strokes. Reference now ${teacher.length} ` +
        `take${teacher.length > 1 ? 's' : ''}, ${refA.strokes.length} strokes.${note}`);
    } else {
      showResults(a, who, undefined, note);
    }
  } catch (e) { log('take.error', { who, message: e.message }); showResults(null, who, `${cap(who)} take not used: ${e.message}`); }
  render();
}


function render() {
  document.querySelectorAll('[data-save]').forEach(b => { b.disabled = !last[b.dataset.save]; });
  $('saveRef').disabled = $('viewRef').disabled = !refA;
  $('teacherPanel').hidden = mode !== 'teacher';
  $('studentPanel').hidden = mode !== 'student';
  const tp = ex.tempo(refA, cfg, refTarget);
  if (document.activeElement !== $('target')) $('target').value = tp.s;
  if (document.activeElement !== $('targetNum')) $('targetNum').value = tp.s.toFixed(1);
  $('targetText').textContent = tp.set ? '(set)' : refA ? '(measured average)' : '(default)';
  $('targetAuto').disabled = !tp.set;
  $('tempo').textContent = refA ? `Target: ${tempoText()} per stroke${refTeacher ? ` (${refTeacher}'s tempo)` : ' (the teacher\'s tempo)'}.` : '';
  $('refLine').textContent = refA ? `Scored against ${refTeacher ? `${refTeacher}'s` : 'the teacher'} reference (${refWhere().replace(/^Teacher [^,]*, /, '').replace(/^./, c => c.toLowerCase())}).`
    : 'No teacher reference yet: pick Teacher to record one, or load one there.';
  $('refInfo').innerHTML = (refA
    ? [`${teacher.length} take${teacher.length > 1 ? 's' : ''}`, 'Several strokes',
      refA && `Tempo ${tempoText()} per stroke`, teacherBow && `Full bow ≈ ${teacherBow.toFixed(0)}° of forearm sweep`, refA && refWhere(),
      newTeacher && 'Replaced by the next teacher take']
    : ['None yet']).filter(Boolean).map(x => `<li>${x}</li>`).join('');
  $('connect').textContent = hub.device ? 'MUGIC connected' : 'Connect MUGIC';
  $('connect').classList.toggle('on', !!hub.device);
  $('connect').hidden = framed && !!hub.device;   // the menu's Connect is behind this frame
  $('prompt').textContent = !hub.device ? 'Connect the MUGIC to start.'
    : mode === 'teacher'
      ? 'Teacher: start still at the frog, play sons filés (down-bow first) at the tempo students should hold, then hold still.'
      : `Student: start still at the frog, play sons filés (down-bow first, ${tempoText()} each), then hold still.`;
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
    const el = t1 - live.strokeT0, over = el > live.target + ex.tempo(refA, cfg, refTarget).tol;
    $('strokeTimer').textContent = `${el.toFixed(1)} / ${live.target.toFixed(1)} s`;
    $('strokeProg').style.width = `${Math.min(1, el / live.target) * 100}%`;
    $('strokeProg').parentElement.classList.toggle('over', over);
    $('strokeInfo').textContent = `stroke ${live.n}${live.dir ? (live.dir > 0 ? ' · down-bow' : ' · up-bow') : ''}`;
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
let shownFor = null;   // whose take the result card shows
function showResults(a, who, message, note = '', title = `${cap(who)} take`) {
  shownFor = who;
  const ok = a?.strokes.length > 0, student = who === 'student';
  $('results').hidden = false;
  $('resultTitle').textContent = title;
  $('details').hidden = !ok;
  const s = student && ok && refA?.strokes.length ? ex.score(a, refA, cfg, refTarget) : null;
  $('scoreBox').hidden = !s;
  $('score').textContent = s?.total?.toFixed(1) ?? '–';
  $('coach').textContent = (message ?? (s ? s.coach : ok ? 'Record the teacher first to get a score.' : 'No strokes found.')) + note;
  if (!ok) return;
  const avg = key => a.strokes.reduce((t, k) => t + k[key], 0) / a.strokes.length;
  $('summary').textContent = `${a.strokes.length} strokes · ${avg('duration').toFixed(1)} s each · ` +
    `average speed ${avg('speedCmS').toFixed(1)} cm/s · evenness ${Math.round(100 * (1 - avg('speedCv')))}%`;
  // student: measures against the teacher with scores; teacher take or reference: the teacher's average per measure
  const mean = vals => (vals.length ? vals.reduce((t, v) => t + v, 0) / vals.length : null);
  $('metrics').innerHTML = s
    ? '<tr><th>Measure</th><th>Student</th><th>Teacher</th><th>Score /10</th></tr>' + s.rows.map(r =>
      `<tr class="${r.bad > 2 ? 'bad' : ''}"><td>${r.label}</td><td>${r.value.toFixed(r.digits)}</td>` +
      `<td>${r.ref.toFixed(r.digits)}${r.tol ? ` ± ${r.tol.toFixed(1)}` : ''}</td><td>${r.score.toFixed(1)}</td></tr>`).join('')
    : '<tr><th>Measure</th><th>Teacher average</th></tr>' + ex.metrics.map(m => {
      const v = mean((m.key === 'turnJerk' ? a.turns ?? [] : a.strokes).map(k => k[m.key]).filter(x => x != null));
      return v == null ? '' : `<tr><td>${m.label}</td><td>${v.toFixed(m.digits)}</td></tr>`;
    }).join('');
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
  $('traceBox').hidden = !a.t;   // a reference has strokes only, no recording
  if (a.t) plot($('trace'), [{ x: a.t, y: a.ang.map(g => g.off), color: '--c2' }, { x: a.t, y: a.ang.map(g => g.tilt), color: '--c3' }]);
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
