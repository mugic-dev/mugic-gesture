// Quaternion, vector and rotation-matrix helpers (SPEC §3). Quaternions are [w, x, y, z], body -> world.

export const DEG = 180 / Math.PI;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vnormalize = v => { const n = Math.hypot(v[0], v[1], v[2]); return v.map(x => x / n); };
// Component of v perpendicular to the unit vector n.
export const reject = (v, n) => { const d = vdot(v, n); return v.map((x, i) => x - d * n[i]); };

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export const normalize = q => { const n = Math.hypot(q[0], q[1], q[2], q[3]); return q.map(v => v / n); };
export const conj = q => [q[0], -q[1], -q[2], -q[3]];
export function mul(a, b) {
  const [aw, ax, ay, az] = a, [bw, bx, by, bz] = b;
  return [aw * bw - ax * bx - ay * by - az * bz,
          aw * bx + ax * bw + ay * bz - az * by,
          aw * by - ax * bz + ay * bw + az * bx,
          aw * bz + ax * by - ay * bx + az * bw];
}
export const fromAxisAngle = (axis, rad) => {
  const s = Math.sin(rad / 2), n = vnormalize(axis);
  return [Math.cos(rad / 2), n[0] * s, n[1] * s, n[2] * s];
};

// Normalize every sample and flip signs so that q_i · q_{i-1} >= 0 (q and -q are the same rotation).
export function continuous(qs) {
  const out = [];
  for (const q of qs) {
    let n = normalize(q);
    if (out.length && dot(n, out[out.length - 1]) < 0) n = n.map(v => -v);
    out.push(n);
  }
  return out;
}

export function toMatrix([w, x, y, z]) {
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
          [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
          [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
}
export const transpose = R => R[0].map((_, j) => R.map(r => r[j]));
export const matMul = (A, B) => A.map(r => B[0].map((_, j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
export const apply = (R, v) => R.map(r => vdot(r, v));
export const det = R => vdot(R[0], cross(R[1], R[2]));

// Largest |RᵀR - I| entry and |det R - 1|: both ~0 for a rotation.
export function orthoError(R) {
  const P = matMul(transpose(R), R);
  let ortho = 0;
  for (let i = 0; i < 3; ++i) {
    for (let j = 0; j < 3; ++j) ortho = Math.max(ortho, Math.abs(P[i][j] - (i === j ? 1 : 0)));
  }
  return { ortho, det: Math.abs(det(R) - 1) };
}

// At rest, R·a (raw accel, RAW_ACCEL mode) should lie on world z. Says whether R or Rᵀ does that, and the sign.
export function gravityCheck(q, acc) {
  const R = toMatrix(normalize(q));
  const tilt = v => Math.hypot(v[0], v[1]) / Math.hypot(v[0], v[1], v[2]);
  const a = apply(R, acc), b = apply(transpose(R), acc);
  const useTranspose = tilt(b) < tilt(a), g = useTranspose ? b : a;
  return { useTranspose, up: Math.sign(g[2]), tilt: Math.min(tilt(a), tilt(b)) };
}

export const rotZ = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
// Heading of the body `forward` axis projected on the horizontal plane, or null when it points near vertical.
export function yaw(R, forward = [1, 0, 0]) {
  const f = apply(R, forward);
  return Math.hypot(f[0], f[1]) < 0.1 ? null : Math.atan2(f[1], f[0]);
}
// R_rel = R_yaw0ᵀ · R: cancels only the starting heading, so pitch and roll stay tied to gravity.
export function yawReset(R0, forward = [1, 0, 0]) {
  const y0 = yaw(R0, forward);
  if (y0 === null) throw new Error('forward axis is near vertical: use another axis or start from the neutral pose');
  const Rt = transpose(rotZ(y0));
  return R => matMul(Rt, R);
}

// Angle between two orientations, radians.
export const geodesic = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dot(a, b))));
