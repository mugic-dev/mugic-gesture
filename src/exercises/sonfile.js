// Son filé (class C, SPEC §9.2): long, even bow strokes. One MUGIC on the bow-arm forearm, just above the wrist.
// Per stroke, over the middle 80%: bow speed evenness, drift of the forearm out of its bowing plane, forearm tilt
// wobble, loudness evenness (mic); plus the jerk around each bow change and the stroke duration.
// All thresholds are starting guesses, to be fixed from recorded data.
import { DEG, apply, clamp, conj, continuous, cross, mul, normalize, reject, toMatrix, vdot, vnormalize } from '../quat.js';

export const config = {
  name: 'son_file', title: 'Son filé', class: 'C', mount: 'bow_forearm',
  window_s: [2, 40],
  stroke_s: [8, 0.5],       // target stroke duration and tolerance
  tempo_mandatory: true,    // duration counts in the score
  bow_length_cm: 65,
  forearm_axis: [1, 0, 0],  // device axis lying along the forearm
  reversal_dps: 3,          // bow angular speed below this counts as stopped
  min_stroke_s: 1,
  turnaround_s: 0.3,
  middle: 0.8,
};

// Lower is better for all of these; floor is the smallest spread used when turning a value into a z-score.
export const metrics = [
  { key: 'speedCv', label: 'Bow speed unevenness (CV)', digits: 2, floor: 0.03, text: 'Bow speed uneven' },
  { key: 'offPlane', label: 'Off-plane drift (°)', digits: 1, floor: 1, text: 'Bow arm drifting off its path' },
  { key: 'tiltStd', label: 'Forearm tilt wobble (°)', digits: 1, floor: 1, text: 'Forearm tilt wobbling' },
  { key: 'turnJerk', label: 'Bow-change jerk (°/s³)', digits: 0, floor: 50, text: 'Bow changes jerky' },
  { key: 'loudCv', label: 'Loudness unevenness (CV)', digits: 2, floor: 0.05, text: 'Loudness uneven' },
];

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const rms = a => Math.sqrt(mean(a.map(v => v * v)));
const cv = a => std(a) / (mean(a) || 1);
const smooth = (a, k) => a.map((_, i) => mean(a.slice(Math.max(0, i - (k >> 1)), i + (k >> 1) + 1)));
const wrap = a => ((a + 540) % 360) - 180;
export const resample = (a, n = 100) => Array.from({ length: n }, (_, i) => {
  const x = i * (a.length - 1) / (n - 1), j = Math.floor(x), f = x - j;
  return j + 1 < a.length ? a[j] * (1 - f) + a[j + 1] * f : a[j];
});

// Dominant rotation axis of the gyro (top eigenvector of Σ g gᵀ), signed so the mean speed along it is positive.
export function bowAxis(gyro) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const g of gyro) {
    for (let i = 0; i < 3; ++i) {
      for (let j = 0; j < 3; ++j) C[i][j] += g[i] * g[j];
    }
  }
  let v = [1, 0.9, 0.8];
  for (let k = 0; k < 60; ++k) v = vnormalize(apply(C, v));
  return gyro.reduce((s, g) => s + vdot(g, v), 0) < 0 ? v.map(x => -x) : v;
}

// Body-frame axes: the bow rotation axis, the forearm direction (perpendicular to it) and their cross product.
export function frame(axis, cfg = config) {
  const along = vnormalize(reject(cfg.forearm_axis, axis));
  return { axis, along, across: cross(axis, along) };
}

// Angles (degrees) of orientation q relative to q0, in q0's body frame: bow sweep of the forearm in its plane,
// forearm direction out of that plane, and twist (tilt) about the forearm.
export function angles(q0, q, f) {
  let qr = mul(conj(q0), q);
  if (qr[0] < 0) qr = qr.map(v => -v);
  const v = apply(toMatrix(qr), f.along);
  return {
    sweep: Math.atan2(vdot(v, f.across), vdot(v, f.along)) * DEG,
    off: Math.asin(clamp(vdot(v, f.axis), -1, 1)) * DEG,
    tilt: wrap(2 * Math.atan2(vdot(qr.slice(1), f.along), qr[0]) * DEG),
  };
}

// Strokes are runs where the bow moves one way faster than reversal_dps, split at direction reversals. Runs
// shorter than min_stroke_s are dropped and neighbours then left going the same way are merged.
function segment(t, u, cfg) {
  const runs = [];
  for (let i = 0; i < u.length; ++i) {
    const dir = u[i] > cfg.reversal_dps ? 1 : u[i] < -cfg.reversal_dps ? -1 : 0;
    if (!dir) continue;
    const last = runs[runs.length - 1];
    if (last && last.dir === dir) last.i1 = i;
    else runs.push({ dir, i0: i, i1: i });
  }
  const out = [];
  for (const r of runs.filter(r => t[r.i1] - t[r.i0] >= cfg.min_stroke_s)) {
    const last = out[out.length - 1];
    if (last && last.dir === r.dir) last.i1 = r.i1;
    else out.push(r);
  }
  return out;
}

// The device quaternion as body -> world: calibration finds whether it has to be conjugated.
export const orient = (q, calib) => (calib?.conj ? conj(q) : q);

// Analyze the first device of a recording. Uses rec.calib ({axis, fullBowDeg, conj}) when present.
export function analyze(rec, cfg = config) {
  const d = rec.devices[0], t = d.t, calib = rec.calib, mic = rec.extra?.mic_rms;
  if (t.length < 10) return { strokes: [], turns: [], summary: {} };
  const q = continuous(d.q.map(qi => orient(qi, calib)));
  const f = frame(calib?.axis ?? bowAxis(d.gyro), cfg);
  const u = smooth(d.gyro.map(g => vdot(g, f.axis)), 5);
  const ang = q.map(qi => angles(q[0], qi, f));
  const dt = (t[t.length - 1] - t[0]) / (t.length - 1);

  const strokes = segment(t, u, cfg).map(({ dir, i0, i1 }) => {
    const pad = Math.round((i1 - i0) * (1 - cfg.middle) / 2), idx = [];
    for (let i = i0 + pad; i <= i1 - pad; ++i) idx.push(i);
    const speed = idx.map(i => Math.abs(u[i])), extent = Math.abs(ang[i1].sweep - ang[i0].sweep);
    return {
      dir, i0, i1,
      duration: t[i1] - t[i0],
      extent,
      bowFrac: calib ? extent / calib.fullBowDeg : null,
      speedCmS: calib ? mean(speed) / calib.fullBowDeg * cfg.bow_length_cm : null,
      speedCv: cv(speed),
      offPlane: rms(idx.map(i => ang[i].off - ang[i0].off)),
      tiltStd: std(idx.map(i => ang[i].tilt)),
      loudCv: mic?.length === t.length ? cv(idx.map(i => mic[i])) : null,
      profile: resample(speed),
    };
  });

  // Bow changes: consecutive strokes in opposite directions less than a second apart.
  const half = Math.round(cfg.turnaround_s / dt), turns = [];
  for (let k = 1; k < strokes.length; ++k) {
    const a = strokes[k - 1], b = strokes[k];
    if (a.dir === b.dir || t[b.i0] - t[a.i1] > 1) continue;
    const c = (a.i1 + b.i0) >> 1, jerk = [];
    for (let i = Math.max(1, c - half); i <= Math.min(u.length - 2, c + half); ++i) {
      jerk.push((u[i + 1] - 2 * u[i] + u[i - 1]) / (dt * dt));
    }
    turns.push({ t: t[c], turnJerk: rms(jerk) });
  }

  const summary = { duration: strokes.length ? mean(strokes.map(s => s.duration)) : null };
  for (const m of metrics) {
    const vals = (m.key === 'turnJerk' ? turns : strokes).map(s => s[m.key]).filter(v => v != null);
    summary[m.key] = vals.length ? mean(vals) : null;
  }
  return { t, u, ang, strokes, turns, summary };
}

// Calibration from any take that starts at the frog, so no separate calibration take is needed: the bow axis
// (from the gyro) signed so that the first stroke is a down-bow; whether the quaternion must be conjugated to be
// body -> world (the reading under which the first stroke turns about +axis); and the largest stroke's forearm
// sweep, a lower bound on the full bow (the app keeps the largest seen per player).
export function calibrate(rec, cfg = config) {
  const d = rec.devices[0];
  let axis = bowAxis(d.gyro);
  const first = analyze({ ...rec, calib: { axis, fullBowDeg: 1 } }, cfg).strokes[0];
  if (!first || first.extent < 5) throw new Error('no bow stroke found: start still at the frog, then bow.');
  if (first.dir < 0) axis = axis.map(x => -x);
  const along = q => { const v = q.slice(1), n = Math.hypot(...v) || 1; return Math.sign(q[0]) * vdot(v, axis) / n; };
  const p0 = normalize(d.q[first.i0]), p1 = normalize(d.q[first.i1]);
  const calib = { axis, fullBowDeg: 1, conj: along(mul(p0, conj(p1))) > along(mul(conj(p0), p1)) };
  calib.fullBowDeg = Math.max(...analyze({ ...rec, calib }, cfg).strokes.map(s => s.extent));
  return calib;
}

// Teacher strokes kept for the reference (no sample indices), and the pool of several teacher takes.
export const refPart = a => ({ strokes: a.strokes.map(({ i0, i1, ...k }) => k), turns: a.turns });
export const pool = parts => ({ strokes: parts.flatMap(p => p.strokes), turns: parts.flatMap(p => p.turns) });

// 0-10 from how many reference spreads worse than the reference: 0 -> 10, 1 -> 9, 2 -> 6.9, 3 -> 5, 6 -> 2.
export const toTen = z => Math.round(100 / (1 + (z / 3) ** 2)) / 10;

// Score an attempt against a reference (teacher) pool: each metric becomes a z-score against the reference
// strokes, only worse-than-reference counts; duration is scored against the target. Overall and per-metric
// scores are 0-10 (toTen of the mean / the metric's z); flags at z > 2.
export function score(att, ref, cfg = config) {
  const rows = [];
  for (const m of metrics) {
    const a = att.summary[m.key];
    const vals = (m.key === 'turnJerk' ? ref.turns : ref.strokes).map(s => s[m.key]).filter(v => v != null);
    if (a == null || !vals.length) continue;
    const r = mean(vals), z = (a - r) / Math.max(std(vals), m.floor, 0.15 * Math.abs(r));
    rows.push({ ...m, value: a, ref: r, z, bad: Math.max(0, z), score: toTen(Math.max(0, z)) });
  }
  const dur = att.summary.duration;
  if (dur != null) {
    const [target, tol] = cfg.stroke_s, z = (dur - target) / tol;
    rows.push({ key: 'duration', label: 'Stroke duration (s)', digits: 1, value: dur, ref: target, z,
      bad: cfg.tempo_mandatory ? Math.abs(z) : 0, score: toTen(Math.abs(z)),
      text: dur < target ? 'Strokes too short' : 'Strokes too long' });
  }
  const total = rows.length ? toTen(mean(rows.map(r => r.bad))) : null;
  const flagged = rows.filter(r => r.bad > 2).sort((a, b) => b.bad - a.bad);
  const coach = flagged.length
    ? flagged.slice(0, 2).map(r => `${r.text}: ${r.value.toFixed(r.digits)} vs ${r.ref.toFixed(r.digits)}`).join('. ') + '.'
    : 'Clean: within the reference on every measure.';
  return { total, rows, flagged, coach };
}
