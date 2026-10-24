/**
 * Unit tests for the strike detector — the part most likely to misbehave.
 * Run with:  npm test
 *
 * The detector is deliberately DOM-free, so it can be exercised directly here
 * with synthetic hand paths instead of a webcam.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GestureDetector,
  DEFAULT_GESTURE_CONFIG,
  sensitivityToThreshold,
  thresholdToSensitivity,
} from '../src/gestureDetection.js';

/**
 * Feed a sequence of [x, y] points to one hand at a fixed frame interval.
 * @returns {Array} the hits produced, each with the timestamp that fired it.
 */
function feed(det, handId, points, { dt = 33, start = 1000, zoneAt } = {}) {
  const hits = [];
  points.forEach(([x, y], i) => {
    const tMs = start + i * dt;
    const zoneId = zoneAt ? zoneAt(i, x, y) : 'kick';
    const hit = det.update({ handId, x, y, tMs, zoneId });
    if (hit) hits.push({ ...hit, tMs });
  });
  return hits;
}

const V = DEFAULT_GESTURE_CONFIG.velocityThreshold;

test('a still hand resting inside a pad never triggers', () => {
  const det = new GestureDetector();
  const pts = Array.from({ length: 40 }, () => [0.5, 0.72]);
  assert.equal(feed(det, 'Left', pts).length, 0);
});

test('small jitter inside a pad does not trigger', () => {
  const det = new GestureDetector();
  const pts = Array.from({ length: 60 }, (_, i) => [0.5, 0.72 + (i % 2 ? 0.005 : -0.005)]);
  assert.equal(feed(det, 'Left', pts).length, 0);
});

test('a fast downward strike inside a pad triggers exactly once', () => {
  const det = new GestureDetector();
  // hover, then chop down through the pad
  const pts = [
    [0.5, 0.30], [0.5, 0.30], [0.5, 0.30],
    [0.5, 0.40], [0.5, 0.50], [0.5, 0.60], [0.5, 0.70], [0.5, 0.80],
  ];
  const hits = feed(det, 'Left', pts);
  assert.equal(hits.length, 1, 'exactly one hit from one gesture');
  assert.equal(hits[0].zoneId, 'kick');
  assert.ok(hits[0].velocity >= V);
});

test('a single fast gesture cannot machine-gun (cooldown + re-arm)', () => {
  const det = new GestureDetector();
  const pts = [];
  // one big chop, then keep chopping with no upward reset
  for (let i = 0; i < 10; i++) pts.push([0.5, 0.30 + i * 0.06]);
  const hits = feed(det, 'Left', pts);
  assert.equal(hits.length, 1);
});

test('after a hit the hand must be re-armed by moving up before it can hit again', () => {
  const det = new GestureDetector({ cooldownMs: 0 });
  // chop 1
  feed(det, 'Left', [[0.5, 0.30], [0.5, 0.30], [0.5, 0.55], [0.5, 0.80]]);
  // keep going down (no re-arm) -> nothing
  const noRearm = feed(det, 'Left', [[0.5, 0.85], [0.5, 0.88]], { start: 5000 });
  assert.equal(noRearm.length, 0, 'still descending must not re-fire');

  // now lift the hand up, then chop again -> fires
  const up = feed(det, 'Left', [[0.5, 0.50], [0.5, 0.20]], { start: 6000 });
  assert.equal(up.length, 0, 'moving up is not a strike');
  const second = feed(det, 'Left', [[0.5, 0.35], [0.5, 0.60], [0.5, 0.85]], { start: 7000 });
  assert.equal(second.length, 1, 're-armed hand can strike again');
});

test('descending fast OUTSIDE any pad triggers nothing', () => {
  const det = new GestureDetector();
  const pts = [[0.5, 0.20], [0.5, 0.30], [0.5, 0.45], [0.5, 0.60]];
  const hits = feed(det, 'Left', pts, { zoneAt: () => null });
  assert.equal(hits.length, 0);
});

test('two hands are tracked independently', () => {
  const det = new GestureDetector();
  const hits = [];
  const chop = (handId, x, zone) => {
    [[0.30], [0.35], [0.50], [0.65], [0.80]].forEach(([y], i) => {
      const h = det.update({ handId, x, y, tMs: 1000 + i * 33, zoneId: zone });
      if (h) hits.push(h);
    });
  };
  chop('Left', 0.28, 'snare');
  chop('Right', 0.72, 'kick');
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.zoneId).sort(), ['kick', 'snare']);
});

test('a long tracking gap does not invent a huge velocity', () => {
  const det = new GestureDetector();
  det.update({ handId: 'Left', x: 0.5, y: 0.20, tMs: 1000, zoneId: null });
  // 1 second later the hand is way down — but that gap must be discarded
  const hit = det.update({ handId: 'Left', x: 0.5, y: 0.95, tMs: 2000, zoneId: 'kick' });
  assert.equal(hit, null);
});

test('a slow drift into a pad does not trigger', () => {
  const det = new GestureDetector();
  const pts = [];
  for (let i = 0; i < 30; i++) pts.push([0.5, 0.40 + i * 0.012]); // gentle slide
  assert.equal(feed(det, 'Left', pts).length, 0);
});

test('raising sensitivity lowers the velocity threshold', () => {
  const lo = sensitivityToThreshold(0);
  const hi = sensitivityToThreshold(1);
  assert.ok(hi < lo, 'high sensitivity => lower threshold');
  // round-trips
  assert.ok(Math.abs(thresholdToSensitivity(sensitivityToThreshold(0.5)) - 0.5) < 1e-6);
});

test('configure() takes effect immediately', () => {
  const det = new GestureDetector();
  det.configure({ velocityThreshold: 99 });
  const hits = feed(det, 'Left', [[0.5, 0.30], [0.5, 0.35], [0.5, 0.60], [0.5, 0.85]]);
  assert.equal(hits.length, 0, 'an unreachable threshold blocks everything');
});

test('forget() and reset() clear hand state', () => {
  const det = new GestureDetector();
  det.update({ handId: 'Left', x: 0.5, y: 0.5, tMs: 1, zoneId: 'kick' });
  assert.equal(det.hands.size, 1);
  det.forget('Left');
  assert.equal(det.hands.size, 0);
  det.update({ handId: 'Right', x: 0.5, y: 0.5, tMs: 1, zoneId: 'kick' });
  det.reset();
  assert.equal(det.hands.size, 0);
});
