import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, calibrate, score } from '../src/exercises/sonfile.js';
import { synthBow } from './synth.js';

test('clean bows: strokes, durations and near-zero defects', () => {
  const a = analyze(synthBow());
  assert.equal(a.strokes.length, 4);
  assert.equal(a.turns.length, 3);
  for (const s of a.strokes) {
    assert.ok(Math.abs(s.duration - 8) < 0.5, `duration ${s.duration}`);
    assert.ok(Math.abs(s.extent - 60) < 3, `extent ${s.extent}`);
    assert.ok(s.speedCv < 0.02 && s.offPlane < 0.1 && s.tiltStd < 0.1);
  }
});

test('tilt wobble and uneven speed are measured where they belong', () => {
  const w = analyze(synthBow({ wobble: 4 })).summary, u = analyze(synthBow({ uneven: 0.3 })).summary;
  assert.ok(Math.abs(w.tiltStd - 4 / Math.SQRT2) < 0.3, `tilt ${w.tiltStd}`);
  assert.ok(w.offPlane < 0.1 && w.speedCv < 0.02);
  assert.ok(u.speedCv > 0.15 && u.tiltStd < 0.1);
});

test('calibration finds the full-bow sweep and down-bow direction', () => {
  const c = calibrate(synthBow({ strokes: 1, axis: [0, 1, 0], along: [0, 0, 1] }));
  assert.ok(Math.abs(c.fullBowDeg - 60) < 3);
  assert.ok(c.axis[1] > 0.99);
});

test('score flags the defect against a clean reference', () => {
  const ref = analyze(synthBow());
  assert.equal(score(ref, ref).flagged.length, 0);
  const s = score(analyze(synthBow({ wobble: 4 })), ref);
  assert.deepEqual(s.flagged.map(r => r.key), ['tiltStd']);
  assert.ok(s.total < score(ref, ref).total);
  assert.match(s.coach, /tilt/);
});
