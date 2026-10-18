import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeDetector } from '../src/takes.js';
import { analyze } from '../src/exercises/sonfile.js';
import { synthBow } from './synth.js';

function run(rec) {
  const d = rec.devices[0], events = [], takes = [];
  const feed = takeDetector({}, (e, take) => { events.push(e); if (take) takes.push(take); });
  d.t.forEach((t, i) => feed({ q: d.q[i], gyro: d.gyro[i], acc: d.accel[i] }, t));
  return { events, takes };
}

test('hold, play, hold makes exactly one take covering the strokes', () => {
  const { events, takes } = run(synthBow({ rest: 3 }));
  assert.deepEqual(events, ['ready', 'start', 'end', 'ready']);
  const t = takes[0].map(s => s.t);
  assert.ok(t[0] < 3 && t[0] > 2, `starts ${t[0]}`);
  assert.ok(t[t.length - 1] > 35, `ends ${t[t.length - 1]}`);
  const d = { t: [], q: [], gyro: [] };
  for (const { t: ti, sample } of takes[0]) { d.t.push(ti); d.q.push(sample.q); d.gyro.push(sample.gyro); }
  assert.equal(analyze({ devices: [d], calib: synthBow().calib }).strokes.length, 4);
});

test('a very slow bow is not mistaken for a held pose', () => {
  const { events } = run(synthBow({ rest: 3, strokes: 2, strokeS: 20, angle: 50 }));
  assert.deepEqual(events, ['ready', 'start', 'end', 'ready']);
});

test('no take without a held pose first', () => {
  assert.deepEqual(run(synthBow({ rest: 1 })).events, []);
});
