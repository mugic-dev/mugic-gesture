import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeDetector } from '../src/takes.js';
import { flickDetector } from '../src/flick.js';
import { analyze } from '../src/exercises/sonfile.js';
import { synthBow } from './synth.js';

// Feed a recording; stopAt = time of an OFF flick.
function run(rec, stopAt = Infinity) {
  const d = rec.devices[0], events = [], takes = [];
  const det = takeDetector({}, (e, take) => { events.push(e); if (take) takes.push(take); });
  for (let i = 0; i < d.t.length && d.t[i] < stopAt; ++i) det.feed({ q: d.q[i], gyro: d.gyro[i], acc: d.accel[i] }, d.t[i]);
  if (stopAt < Infinity) det.stop(stopAt - 0.4);
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

test('OFF flick mid-take keeps the take up to just before the flick', () => {
  const { events, takes } = run(synthBow({ rest: 3 }), 20);
  assert.deepEqual(events, ['ready', 'start', 'end']);
  assert.ok(takes[0].at(-1).t <= 19.6);
});

test('OFF flick right after the motion starts cancels the take', () => {
  // ready at 2 s; the bow starts moving at 3 s, the flick lands at 3.6 s
  assert.deepEqual(run(synthBow({ rest: 3 }), 3.6).events, ['ready', 'start', 'cancel']);
});

test('flick fires once per acceleration spike, not on bowing', () => {
  const fire = flickDetector(), hits = [];
  for (let i = 0; i < 500; ++i) {
    const t = i / 50, spike = (i >= 100 && i < 105) || (i >= 300 && i < 304) ? 12 : 0;
    const acc = [0.8 * Math.sin(t) + spike, 0.5 * Math.cos(2 * t), 0.3];   // bowing-sized linear accel + spikes
    if (fire(acc, t)) hits.push(t);
  }
  assert.deepEqual(hits, [2, 6]);
});

test('a take longer than the limit is cut and says so', () => {
  const d = synthBow({ rest: 3 }).devices[0], ends = [];
  const det = takeDetector({ max_s: 20 }, (e, take, why) => { if (e === 'end') ends.push(why); });
  d.t.forEach((t, i) => det.feed({ q: d.q[i] }, t));
  assert.deepEqual(ends, ['limit']);
});
