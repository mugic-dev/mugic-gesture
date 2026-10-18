import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, calibrate, pool, refPart, score, toTen } from '../src/exercises/sonfile.js';
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

test('any take calibrates: full-bow sweep, and the first stroke is the down-bow', () => {
  for (const strokes of [1, 4]) {
    const c = calibrate(synthBow({ strokes, axis: [0, 1, 0], along: [0, 0, 1] }));
    assert.ok(Math.abs(c.fullBowDeg - 60) < 3);
    assert.ok(c.axis[1] > 0.99, `${strokes} strokes: axis ${c.axis}`);
  }
});

test('0-10 scale', () => {
  assert.deepEqual([0, 1, 2, 3, 6].map(toTen), [10, 9, 6.9, 5, 2]);
});

test('score flags the defect against a pooled clean reference', () => {
  const ref = pool([refPart(analyze(synthBow())), refPart(analyze(synthBow({ strokes: 2 })))]);
  assert.equal(ref.strokes.length, 6);
  const clean = score(analyze(synthBow()), ref);
  assert.equal(clean.flagged.length, 0);
  assert.ok(clean.total >= 9.5, `clean ${clean.total}`);
  const s = score(analyze(synthBow({ wobble: 4 })), ref);
  assert.deepEqual(s.flagged.map(r => r.key), ['tiltStd']);
  assert.ok(s.total < clean.total);
  assert.match(s.coach, /tilt/);
});

test('down-bow sweeps toward the tip whichever way the device quaternion turns', () => {
  for (const flip of [false, true]) {
    const start = [0.8, 0.3, -0.4, 0.33];   // held at an angle at the frog
    const device = opts => {   // a device whose quaternion is world -> body when flipped
      const rec = synthBow({ start: start.map(v => v / Math.hypot(...start)), ...opts });
      if (flip) rec.devices[0].q = rec.devices[0].q.map(q => [q[0], -q[1], -q[2], -q[3]]);
      return rec;
    };
    const calib = calibrate(device({ strokes: 1 }));
    assert.equal(calib.conj, flip);
    const a = analyze({ ...device(), calib });
    assert.ok(a.ang[a.strokes[0].i1].sweep > 50, `flip ${flip}: sweep ${a.ang[a.strokes[0].i1].sweep}`);
  }
});
