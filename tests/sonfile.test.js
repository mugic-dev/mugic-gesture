import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, calibrate, liveBow, pool, refPart, paced, score, tempo, toTen } from '../src/exercises/sonfile.js';
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

test('live bow position: down-bow toward the tip, back to the frog on the up-bow, with no calibration', () => {
  const d = synthBow({ strokes: 2, axis: [0.6, 0, 0.8], along: [0.8, 0, -0.6] }).devices[0], bow = liveBow();
  const theta = d.t.map((t, i) => bow(d.gyro[i], i ? t - d.t[i - 1] : 0).theta);
  const mid = theta[Math.round(d.t.length / 2)];
  assert.ok(Math.abs(mid - 60) < 3, `tip ${mid}`);
  assert.ok(Math.abs(theta.at(-1)) < 3, `frog ${theta.at(-1)}`);
});

test('stroke duration is scored against the teacher tempo, not a fixed 8 s', () => {
  const slow = synthBow({ strokes: 4, strokeS: 16 });
  const ref = pool([refPart(analyze(slow))]);
  const t = tempo(ref);
  assert.ok(t.teacher && Math.abs(t.s - 16) < 1, `tempo ${t.s}`);
  const row = att => score(analyze(att), ref).rows.find(r => r.key === 'duration');
  assert.ok(row(synthBow({ strokes: 4, strokeS: 16 })).score >= 9);
  assert.ok(row(synthBow({ strokes: 4, strokeS: 8 })).score < 3);
  assert.equal(tempo(null).s, 8);
  // a target set by the teacher overrides the measured average
  assert.equal(tempo(ref, undefined, 30).s, 30);
  assert.ok(score(analyze(synthBow({ strokes: 4, strokeS: 16 })), ref, undefined, 30).rows.find(r => r.key === 'duration').score < 3);
});

test('a one-minute bow is found once the thresholds follow the target tempo', () => {
  const rec = synthBow({ strokes: 3, strokeS: 60, angle: 60 });
  assert.equal(analyze(rec).strokes.length, 0);   // 1 °/s: below the default 3 °/s
  const s = analyze(rec, paced(60, 60)).strokes;
  assert.equal(s.length, 3);
  assert.ok(s.every(k => Math.abs(k.duration - 60) < 6), s.map(k => k.duration).join());
  assert.equal(paced(4.7, 79).reversal_dps, 3);   // normal tempos keep the default
});
