// Synthetic son filé on a forearm: alternating strokes about `axis`, with optional tilt wobble about the forearm
// and uneven bow speed. Returns a recording like the app's.
import { DEG, apply, fromAxisAngle, mul, toMatrix, transpose } from '../src/quat.js';

// calib is what a calibration would give for this mount.
export function synthBow({ strokes = 4, strokeS = 8, angle = 60, rate = 50, rest = 1, ramp = 0.3,
  wobble = 0, uneven = 0, axis = [0, 0, 1], along = [1, 0, 0] } = {}) {
  const dt = 1 / rate, total = rest + strokes * strokeS + rest;
  const d = { id: 'synth', mount: 'bow_forearm', t: [], q: [], gyro: [], accel: [] };
  const vmax = angle / (strokeS - ramp);
  let theta = 0;
  for (let i = 0; i * dt <= total; ++i) {
    const t = i * dt, s = t - rest, k = Math.floor(s / strokeS), tau = s - k * strokeS;
    let v = 0;
    if (s >= 0 && k < strokes) {
      const r = Math.min(1, tau / ramp, (strokeS - tau) / ramp);
      v = (k % 2 ? -1 : 1) * vmax * (0.5 - 0.5 * Math.cos(Math.PI * r)) * (1 + uneven * Math.sin(2 * Math.PI * 3 * tau / strokeS));
    }
    const tilt = wobble * Math.sin(2 * Math.PI * 0.5 * t), tiltRate = wobble * 2 * Math.PI * 0.5 * Math.cos(2 * Math.PI * 0.5 * t);
    const qt = fromAxisAngle(along, tilt / DEG);
    const w = apply(transpose(toMatrix(qt)), axis.map(a => a * v)).map((x, j) => x + along[j] * tiltRate);
    d.t.push(t); d.q.push(mul(fromAxisAngle(axis, theta / DEG), qt)); d.gyro.push(w); d.accel.push([0, 0, 0]);
    theta += v * dt;
  }
  return { exercise: 'son_file', role: 'reference', devices: [d], extra: {}, calib: { axis, fullBowDeg: angle } };
}
