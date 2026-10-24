/**
 * Unit tests for the hit counter and the pattern recorder.
 * Run with:  npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { HitCounter, PatternRecorder } from '../src/recorder.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('HitCounter tallies per instrument and total, and notifies listeners', () => {
  const c = new HitCounter(['kick', 'snare']);
  let notifications = 0;
  c.on(() => notifications++);

  c.hit('kick');
  c.hit('kick');
  c.hit('snare');

  assert.equal(c.totals.all, 3);
  assert.equal(c.totals.kick, 2);
  assert.equal(c.totals.snare, 1);
  assert.equal(notifications, 3);

  c.reset();
  assert.equal(c.totals.all, 0);
  assert.equal(c.totals.kick, 0);
});

test('HitCounter ignores unknown instruments for the per-pad tally', () => {
  const c = new HitCounter(['kick']);
  c.hit('not-a-drum');
  assert.equal(c.totals.all, 1);
  assert.equal(c.totals.kick, 0);
});

test('PatternRecorder captures hits with increasing timestamps', () => {
  const rec = new PatternRecorder(() => {});
  rec.startRecording();
  rec.capture('kick');
  rec.capture('snare');
  rec.capture('hihat');
  const n = rec.stopRecording();

  assert.equal(n, 3);
  assert.equal(rec.events.length, 3);
  assert.deepEqual(rec.events.map((e) => e.instrumentId), ['kick', 'snare', 'hihat']);
  for (let i = 1; i < rec.events.length; i++) {
    assert.ok(rec.events[i].t >= rec.events[i - 1].t);
  }
  assert.equal(rec.recording, false);
});

test('capture() does nothing when not recording', () => {
  const rec = new PatternRecorder(() => {});
  rec.capture('kick');
  assert.equal(rec.events.length, 0);
});

test('playback replays every recorded hit', async () => {
  const played = [];
  const rec = new PatternRecorder((id, v) => played.push(id));
  rec.loop = false;

  rec.startRecording();
  rec.capture('kick');
  await sleep(30);
  rec.capture('snare');
  await sleep(30);
  rec.capture('crash');
  rec.stopRecording();

  assert.equal(rec.startPlayback(), true);
  await sleep(400);
  assert.deepEqual(played, ['kick', 'snare', 'crash']);
  assert.equal(rec.playing, false, 'non-looping playback stops itself');
});

test('looping playback repeats the pattern', async () => {
  const played = [];
  const rec = new PatternRecorder((id) => played.push(id));
  rec.loop = true;

  rec.startRecording();
  rec.capture('kick');
  rec.stopRecording();

  rec.startPlayback();
  await sleep(500);
  rec.stopPlayback();

  assert.ok(played.length >= 2, `expected the loop to repeat, got ${played.length} hits`);
});

test('clear() empties the pattern and stops playback', () => {
  const rec = new PatternRecorder(() => {});
  rec.startRecording();
  rec.capture('kick');
  rec.stopRecording();
  assert.equal(rec.hasPattern, true);

  rec.clear();
  assert.equal(rec.hasPattern, false);
  assert.equal(rec.startPlayback(), false, 'nothing to play');
});

test('stopPlayback() cancels pending timers', async () => {
  const played = [];
  const rec = new PatternRecorder((id) => played.push(id));
  rec.startRecording();
  await sleep(10);
  rec.capture('kick');
  await sleep(80);
  rec.capture('snare');
  rec.stopRecording();

  rec.startPlayback();
  await sleep(20);
  rec.stopPlayback();
  await sleep(300);
  assert.ok(played.length <= 1, 'no further hits after stop');
});
