/**
 * Unit tests for the pad layout / hit-testing / session persistence.
 * Run with:  npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// drumMapping's persistence helpers touch localStorage; provide a tiny stub so
// the module can be exercised in Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  INSTRUMENTS,
  DEFAULT_ZONES,
  createZones,
  hitTest,
  nearestZone,
  saveZones,
  loadZones,
  clearSavedZones,
} = await import('../src/drumMapping.js');

test('the kit has the five required instruments', () => {
  assert.deepEqual(
    Object.keys(INSTRUMENTS).sort(),
    ['crash', 'hihat', 'kick', 'snare', 'tom']
  );
  for (const inst of Object.values(INSTRUMENTS)) {
    assert.ok(inst.sound.endsWith('.wav'), `${inst.id} points at a .wav`);
    assert.ok(inst.label && inst.color && inst.glow);
  }
});

test('createZones produces one zone per instrument with a sound attached', () => {
  const zones = createZones();
  assert.equal(zones.length, DEFAULT_ZONES.length);
  for (const z of zones) {
    assert.ok(INSTRUMENTS[z.instrument], `zone ${z.id} maps to a real instrument`);
    assert.equal(z.id, z.instrument);
    assert.ok(z.r > 0 && z.x >= 0 && z.x <= 1 && z.y >= 0 && z.y <= 1);
  }
});

test('hitTest finds the pad a point is inside', () => {
  const zones = createZones();
  const W = 1280;
  const H = 720;
  const kick = zones.find((z) => z.id === 'kick');
  assert.equal(hitTest(zones, kick.x, kick.y, W, H), 'kick');

  // Dead centre of the stage should miss every pad in the default layout.
  assert.equal(hitTest(zones, 0.5, 0.95, W, H), null);
});

test('hitTest respects the radius, not just the centre', () => {
  const zones = createZones();
  const W = 1280;
  const H = 720;
  const scale = Math.min(W, H);
  const snare = zones.find((z) => z.id === 'snare');

  const insideX = snare.x + (snare.r * scale * 0.5) / W;
  assert.equal(hitTest(zones, insideX, snare.y, W, H), 'snare');

  const outsideX = snare.x + (snare.r * scale * 2.0) / W;
  assert.notEqual(hitTest(zones, outsideX, snare.y, W, H), 'snare');
});

test('hitTest works the same for a tall (portrait) stage', () => {
  const zones = createZones();
  const kick = zones.find((z) => z.id === 'kick');
  assert.equal(hitTest(zones, kick.x, kick.y, 720, 1280), 'kick');
});

test('nearestZone returns the closest pad even when outside all of them', () => {
  const zones = createZones();
  const kick = zones.find((z) => z.id === 'kick');
  const near = nearestZone(zones, kick.x + 0.02, kick.y + 0.02, 1280, 720);
  assert.equal(near.id, 'kick');
});

test('zones survive a save / load round-trip and can be reset', () => {
  const zones = createZones();
  zones[0].x = 0.123;
  zones[0].y = 0.456;
  assert.equal(saveZones(zones), true);

  const loaded = loadZones();
  assert.ok(loaded);
  assert.equal(loaded[0].x, 0.123);
  assert.equal(loaded[0].y, 0.456);
  // colours/labels are re-attached from INSTRUMENTS on load
  assert.ok(loaded[0].label && loaded[0].glow);

  clearSavedZones();
  assert.equal(loadZones(), null);
});
