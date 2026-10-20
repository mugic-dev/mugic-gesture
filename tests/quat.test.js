import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, continuous, dot, fromAxisAngle, gravityCheck, mul, orthoError, toMatrix, transpose, yaw, yawReset } from '../src/quat.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('continuous normalizes and removes sign flips', () => {
  const q = fromAxisAngle([0, 1, 0], 0.3);
  const out = continuous([q.map(v => v * 3), q.map(v => -v), [0, 0, 0, 2]]);
  for (const o of out) close(Math.hypot(...o), 1);
  close(out[1][0], q[0]);
  assert.ok(dot(out[1], out[2]) >= 0);
});

test('R(q) is a rotation', () => {
  for (let k = 0; k < 50; ++k) {
    const q = fromAxisAngle([Math.sin(k), Math.cos(3 * k), 0.5], k * 0.37);
    const e = orthoError(toMatrix(q));
    assert.ok(e.ortho < 1e-12 && e.det < 1e-3);
  }
});

test('R(q) maps body to world', () => {
  const R = toMatrix(fromAxisAngle([0, 0, 1], Math.PI / 2));
  apply(R, [1, 0, 0]).forEach((v, i) => close(v, [0, 1, 0][i]));
});

test('yaw-only reset cancels heading and keeps pitch and roll', () => {
  const q = mul(fromAxisAngle([0, 0, 1], 1.1), mul(fromAxisAngle([0, 1, 0], 0.4), fromAxisAngle([1, 0, 0], -0.25)));
  const R = toMatrix(q), Rrel = yawReset(R)(R);
  close(yaw(Rrel), 0);
  R[2].forEach((v, j) => close(Rrel[2][j], v));   // gravity row untouched
  assert.throws(() => yawReset(toMatrix(fromAxisAngle([0, 1, 0], Math.PI / 2))));
});

test('gravity check picks R or Rᵀ', () => {
  const q = fromAxisAngle([1, 1, 0], 0.7), g = [0, 0, 9.81];
  const body = apply(transpose(toMatrix(q)), g);   // what a body->world quaternion's sensor reads at rest
  const r = gravityCheck(q, body);
  assert.equal(r.useTranspose, false);
  assert.equal(r.up, 1);
  close(r.tilt, 0, 1e-9);
  assert.equal(gravityCheck(q, apply(toMatrix(q), g)).useTranspose, true);
});
