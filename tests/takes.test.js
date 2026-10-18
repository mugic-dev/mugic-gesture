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
  assert.deepEqual(events, ['ready', 'start', 'end']);
  const t = takes[0].map(s => s.t);
  assert.ok(t[0] < 3 && t[0] > 2, `starts ${t[0]}`);
  assert.ok(t[t.length - 1] > 35, `ends ${t[t.length - 1]}`);
  const d = { t: [], q: [], gyro: [] };
  for (const { t: ti, sample } of takes[0]) { d.t.push(ti); d.q.push(sample.q); d.gyro.push(sample.gyro); }
  assert.equal(analyze({ devices: [d], calib: synthBow().calib }).strokes.length, 4);
});

test('a very slow bow is not mistaken for a held pose', () => {
  const { events } = run(synthBow({ rest: 3, strokes: 2, strokeS: 20, angle: 50 }));
  assert.deepEqual(events, ['ready', 'start', 'end']);
});

test('moving right after a take does not start another: the next take needs a fresh hold', () => {
  const d = synthBow({ rest: 3 }).devices[0], events = [];
  const det = takeDetector({}, e => events.push(e));
  d.t.forEach((t, i) => det.feed({ q: d.q[i] }, t));
  const end = d.t.at(-1), q = d.q.at(-1), turned = [q[0], q[1] + 0.2, q[2], q[3]];
  for (let i = 1; i <= 50; ++i) det.feed({ q: i < 10 ? q : turned }, end + i / 50);           // reach for the mouse
  for (let i = 1; i <= 150; ++i) det.feed({ q: turned }, end + 1 + i / 50);                  // then hold still
  assert.deepEqual(events, ['ready', 'start', 'end', 'ready']);
});

test('a one-minute bow is not cut at its bow changes when the end hold follows the tempo', () => {
  const rec = synthBow({ rest: 8, strokes: 3, strokeS: 60, angle: 60 }), d = rec.devices[0];
  const takes = [], det = takeDetector({ end_hold_s: 6, max_s: 600 }, (e, take) => take && takes.push(take));
  d.t.forEach((t, i) => det.feed({ q: d.q[i] }, t));
  assert.equal(takes.length, 1);
  assert.ok(takes[0].at(-1).t - takes[0][0].t > 180, `take ${takes[0].at(-1).t - takes[0][0].t} s`);
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
