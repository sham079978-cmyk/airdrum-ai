/**
 * main.js
 * ---------------------------------------------------------------------------
 * The conductor. It wires the pieces together and owns the single animation
 * loop:
 *
 *   camera -> handTracker -> gestureDetector -> drumEngine
 *                                     \-> ui feedback -> recorder
 *
 * Design notes
 *  - The overlay is drawn every animation frame (cheap, keeps trails smooth)
 *    but hand DETECTION is throttled to ~30 FPS, which is the target on a
 *    typical Windows laptop and keeps CPU usage sane.
 *  - Every loop, listener and camera track is torn down on stop()/unload().
 */

import { Camera, CameraState } from './camera.js';
import { HandTracker } from './handTracking.js';
import { DrumEngine } from './drumEngine.js';
import {
  GestureDetector,
  sensitivityToThreshold,
  thresholdToSensitivity,
} from './gestureDetection.js';
import {
  createZones,
  hitTest,
  saveZones,
  loadZones,
  clearSavedZones,
  INSTRUMENTS,
} from './drumMapping.js';
import { UI } from './ui.js';
import { HitCounter, PatternRecorder } from './recorder.js';

const TARGET_FPS = 30;
const DETECT_INTERVAL_MS = 1000 / TARGET_FPS;

/* ------------------------------------------------------------------ setup */
const ui = new UI();
const camera = new Camera(ui.el.video, { width: 1280, height: 720, frameRate: 30 });
const tracker = new HandTracker({ numHands: 2 });
const engine = new DrumEngine();
const detector = new GestureDetector();
const counter = new HitCounter(Object.keys(INSTRUMENTS));

let zones = loadZones() || createZones();

const recorder = new PatternRecorder((instrumentId, velocity) => {
  engine.play(instrumentId, velocity);
  ui.flashPad(instrumentId);
});

let playing = false;
let calibration = false;
let rafId = null;
let lastDetectTime = 0;
let currentHands = [];
let running = false;
let lastHoverZoneId = null;

/* FPS meter */
let fpsFrames = 0;
let fpsWindowStart = 0;

/* --------------------------------------------------------------- UI init */
ui.buildPads(zones);
ui.layoutPads(zones);
ui.updateCounters(counter.totals);

// Seed the controls from the live config.
document.getElementById('in-sens').value = Math.round(
  thresholdToSensitivity(detector.config.velocityThreshold) * 100
);
document.getElementById('in-smooth').value = Math.round(detector.config.smoothingAlpha * 100);
document.getElementById('in-cool').value = detector.config.cooldownMs;
syncControlOutputs();

counter.on((totals) => ui.updateCounters(totals));

/* ------------------------------------------------------------- detection */
function fireHit(hit) {
  engine.play(hit.zoneId, hit.velocity);
  ui.flashPad(hit.zoneId);
  ui.pushHitLog(hit.zoneId, hit.velocity);
  counter.hit(hit.zoneId);
  recorder.capture(hit.zoneId, hit.velocity);
}

function processHands(hands, now, stageW, stageH) {
  const seen = new Set();
  let hoverZoneId = null;

  for (const hand of hands) {
    seen.add(hand.id);
    const { x, y } = hand.strike;
    const zoneId = hitTest(zones, x, y, stageW, stageH);
    if (zoneId && !hoverZoneId) hoverZoneId = zoneId;

    const hit = detector.update({ handId: hand.id, x, y, tMs: now, zoneId });
    if (hit && playing) fireHit(hit);
  }

  // Forget hands that left the frame so their state doesn't linger.
  for (const id of [...detector.hands.keys()]) {
    if (!seen.has(id)) detector.forget(id);
  }

  lastHoverZoneId = hoverZoneId;
  ui.setHover(hoverZoneId);
  return hoverZoneId;
}

function frame(now) {
  if (!running) return;
  rafId = requestAnimationFrame(frame);

  const stageRect = ui.el.stage.getBoundingClientRect();

  // --- throttled detection ---
  if (now - lastDetectTime >= DETECT_INTERVAL_MS) {
    lastDetectTime = now;
    const result = tracker.detect(ui.el.video, now);
    currentHands = result.hands;

    processHands(currentHands, now, stageRect.width, stageRect.height);

    // status + fps
    if (currentHands.length > 0) {
      ui.setStatus('hands', 'ok', currentHands.length === 1 ? 'Hand detected' : `${currentHands.length} hands detected`);
    } else {
      ui.setStatus('hands', 'warn', 'No hand detected');
    }

    fpsFrames++;
    if (!fpsWindowStart) fpsWindowStart = now;
    if (now - fpsWindowStart >= 1000) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
      ui.setStatus('fps', fps >= 22 ? 'ok' : 'warn', `${fps} FPS`);
      fpsFrames = 0;
      fpsWindowStart = now;
    }
  }

  // --- overlay every frame ---
  ui.renderOverlay({
    hands: currentHands,
    zones,
    calibration,
    nowMs: now,
    hoverZoneId: lastHoverZoneId,
  });
}

/* --------------------------------------------------------------- lifecycle */
async function startCamera() {
  const btnStart = document.getElementById('btn-start');
  btnStart.disabled = true;

  // Create the AudioContext synchronously, inside the click gesture.
  try {
    engine.ensureContext();
  } catch (err) {
    ui.toast(err.message);
  }

  ui.setStatus('camera', CameraState.REQUESTING, 'Requesting camera permission…');

  try {
    const size = await camera.start();
    ui.setStatus('camera', 'ok', `Camera ready · ${size.width}×${size.height}`);
    ui.showHint(false);
  } catch (err) {
    ui.setStatus('camera', 'error', 'Camera error');
    ui.toast(err.message);
    btnStart.disabled = false;
    return;
  }

  // Audio (non-fatal if it fails).
  try {
    const res = await engine.init();
    if (res.loaded.length > 0) {
      ui.setStatus('audio', 'ok', `Audio ready · ${res.loaded.length}/5 samples`);
    } else {
      ui.setStatus('audio', 'error', 'Audio failed to load');
    }
    const failedIds = Object.keys(res.failed);
    if (failedIds.length) {
      ui.toast('Some drum samples failed to load: ' + failedIds.join(', ') + '. Check public/sounds/.');
    }
  } catch (err) {
    ui.setStatus('audio', 'error', 'Audio error');
    ui.toast('Audio could not start: ' + err.message);
  }

  // Hand-tracking model (fatal for the core experience).
  try {
    ui.setStatus('hands', 'busy', 'Loading hand model…');
    await tracker.load((msg) => ui.setStatus('hands', 'busy', msg));
    ui.setStatus('hands', 'warn', 'No hand detected');
  } catch (err) {
    ui.setStatus('hands', 'error', 'Tracking error');
    ui.toast(err.message);
    camera.stop();
    ui.setStatus('camera', 'error', 'Camera stopped');
    btnStart.disabled = false;
    return;
  }

  // Start the loop.
  running = true;
  detector.reset();
  lastDetectTime = 0;
  fpsFrames = 0;
  fpsWindowStart = 0;
  rafId = requestAnimationFrame(frame);

  playing = true;
  refreshButtons();
}

function stopCamera() {
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  camera.stop();
  detector.reset();
  currentHands = [];
  lastHoverZoneId = null;
  ui.clearOverlay();
  ui.setHover(null);
  playing = false;
  recorder.stopPlayback();
  ui.setStatus('camera', 'idle', 'Camera not started');
  ui.setStatus('hands', 'idle', 'No hand detected');
  ui.setStatus('fps', 'idle', '— FPS');
  ui.showHint(true);
  refreshButtons();
}

function refreshButtons() {
  document.getElementById('btn-start').disabled = running;
  document.getElementById('btn-stop').disabled = !running;
  document.getElementById('btn-play').disabled = !running;
  document.getElementById('btn-mute').disabled = false;

  const playBtn = document.getElementById('btn-play');
  playBtn.textContent = playing ? 'Stop Playing' : 'Start Playing';
  playBtn.classList.toggle('active', running && !playing);

  const muteBtn = document.getElementById('btn-mute');
  muteBtn.textContent = engine.muted ? 'Unmute' : 'Mute';
  muteBtn.classList.toggle('active', engine.muted);
}

/* ---------------------------------------------------------------- controls */
document.getElementById('btn-start').addEventListener('click', startCamera);
document.getElementById('btn-stop').addEventListener('click', stopCamera);

document.getElementById('btn-play').addEventListener('click', () => {
  playing = !playing;
  if (!playing) detector.reset(); // re-arm cleanly when resuming
  refreshButtons();
  ui.toast(playing ? 'Playing — strike the pads!' : 'Paused — tracking continues.', true);
});

document.getElementById('btn-audio').addEventListener('click', async () => {
  try {
    const res = await engine.init();
    ui.setStatus('audio', res.loaded.length ? 'ok' : 'error',
      res.loaded.length ? `Audio ready · ${res.loaded.length}/5 samples` : 'Audio failed to load');
    ui.toast('Audio engine started.', true);
  } catch (err) {
    ui.toast('Audio could not start: ' + err.message);
  }
});

document.getElementById('btn-mute').addEventListener('click', () => {
  engine.toggleMute();
  document.getElementById('in-mute').checked = engine.muted;
  refreshButtons();
});

document.getElementById('in-mute').addEventListener('change', (e) => {
  engine.setMuted(e.target.checked);
  refreshButtons();
});

document.getElementById('in-volume').addEventListener('input', (e) => {
  const v = Number(e.target.value) / 100;
  engine.setVolume(v);
  document.getElementById('out-volume').textContent = `${e.target.value}%`;
});

document.getElementById('in-sens').addEventListener('input', (e) => {
  const s = Number(e.target.value) / 100;
  detector.configure({ velocityThreshold: sensitivityToThreshold(s) });
  document.getElementById('out-sens').textContent = `${e.target.value}%`;
});

document.getElementById('in-smooth').addEventListener('input', (e) => {
  detector.configure({ smoothingAlpha: Number(e.target.value) / 100 });
  document.getElementById('out-smooth').textContent = `${e.target.value}%`;
});

document.getElementById('in-cool').addEventListener('input', (e) => {
  detector.configure({ cooldownMs: Number(e.target.value) });
  document.getElementById('out-cool').textContent = `${e.target.value} ms`;
});

document.getElementById('in-calib').addEventListener('change', (e) => {
  setCalibration(e.target.checked);
});

document.getElementById('btn-save-map').addEventListener('click', () => {
  if (saveZones(zones)) ui.toast('Pad layout saved for this session.', true);
  else ui.toast('Could not save the layout (storage blocked).');
});

document.getElementById('btn-reset-map').addEventListener('click', () => {
  clearSavedZones();
  zones = createZones();
  ui.buildPads(zones);
  ui.layoutPads(zones);
  setCalibration(calibration);
  ui.toast('Pad layout reset to defaults.', true);
});

/* ------------------------------------------------------------- calibration */
function setCalibration(on) {
  calibration = on;
  ui.setCalibrationBadge(on);
  document.getElementById('in-calib').checked = on;
  ui.setCalibrationInteractive(on, {
    onDragStart: () => {},
    onDragMove: (id, x, y) => {
      const z = zones.find((zz) => zz.id === id);
      if (!z) return;
      z.x = x;
      z.y = y;
      ui.layoutPads(zones);
    },
    onDragEnd: () => {},
  });
  ui.toast(on ? 'Calibration mode: drag pads to reposition, then Save pad layout.' : 'Normal mode.', true);
}

/* ---------------------------------------------------------------- recorder */
document.getElementById('btn-record').addEventListener('click', () => {
  const btn = document.getElementById('btn-record');
  if (recorder.recording) {
    const n = recorder.stopRecording();
    ui.toast(`Recorded ${n} hits. Press Play to hear it back.`, true);
  } else {
    recorder.startRecording();
    ui.toast('Recording… play a beat!', true);
  }
  refreshRecorder();
});

document.getElementById('btn-playback').addEventListener('click', () => {
  if (recorder.playing) recorder.stopPlayback();
  else if (!recorder.startPlayback()) ui.toast('Nothing recorded yet — hit ● Record first.');
  refreshRecorder();
});

document.getElementById('btn-clear').addEventListener('click', () => {
  recorder.clear();
  refreshRecorder();
  ui.toast('Pattern cleared.', true);
});

document.getElementById('in-loop').addEventListener('change', (e) => {
  recorder.loop = e.target.checked;
});

recorder.onStateChange = refreshRecorder;

function refreshRecorder() {
  const recBtn = document.getElementById('btn-record');
  const playBtn = document.getElementById('btn-playback');
  const clearBtn = document.getElementById('btn-clear');

  recBtn.textContent = recorder.recording ? '■ Stop rec' : '● Record';
  recBtn.classList.toggle('active', recorder.recording);

  playBtn.disabled = !recorder.hasPattern && !recorder.playing;
  playBtn.textContent = recorder.playing ? '■ Stop' : '▶ Play';

  clearBtn.disabled = !recorder.hasPattern;

  if (recorder.recording) {
    ui.setRecorderStatus(`Recording… ${recorder.events.length} hits captured.`);
  } else if (recorder.playing) {
    ui.setRecorderStatus(`Playing back ${recorder.events.length} hits${recorder.loop ? ' (looping)' : ''}.`);
  } else if (recorder.hasPattern) {
    ui.setRecorderStatus(`Pattern ready · ${recorder.events.length} hits · ${(recorder.durationMs / 1000).toFixed(1)}s`);
  } else {
    ui.setRecorderStatus('No pattern recorded.');
  }
}

function syncControlOutputs() {
  document.getElementById('out-volume').textContent = document.getElementById('in-volume').value + '%';
  document.getElementById('out-sens').textContent = document.getElementById('in-sens').value + '%';
  document.getElementById('out-smooth').textContent = document.getElementById('in-smooth').value + '%';
  document.getElementById('out-cool').textContent = document.getElementById('in-cool').value + ' ms';
}

/* ----------------------------------------------------------------- cleanup */
function cleanup() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  recorder.dispose();
  camera.stop();
  tracker.dispose();
  engine.dispose();
  ui.dispose();
}

window.addEventListener('beforeunload', cleanup);
window.addEventListener('pagehide', cleanup);

// Keep pads positioned if the window resizes.
window.addEventListener('resize', () => ui.layoutPads(zones));

refreshButtons();
refreshRecorder();

/* ------------------------------------------------------------------ test API
 * A small, documented handle on the live objects. It exists so the automated
 * browser smoke test (tools/smoke-test.mjs) can drive the REAL detection
 * pipeline — hitTest -> GestureDetector -> DrumEngine — without a human in
 * front of a webcam. It is also handy for poking around in DevTools.
 *
 * Nothing here fakes hand tracking: __test.processPoint injects coordinates,
 * which is exactly what the tracker does in normal use, and the same code path
 * runs. In real use, coordinates come from MediaPipe landmarks.
 */
window.AirDrum = {
  version: '1.0.0',
  engine,
  detector,
  counter,
  recorder,
  ui,
  camera,
  tracker,
  get zones() { return zones; },
  get running() { return running; },
  get playing() { return playing; },
  setPlaying(v) { playing = !!v; refreshButtons(); return playing; },
  start: startCamera,
  stop: stopCamera,
  __test: {
    /** Run one hand sample through the real detection chain. */
    processPoint(handId, x, y, tMs) {
      const rect = ui.el.stage.getBoundingClientRect();
      const zoneId = hitTest(zones, x, y, rect.width, rect.height);
      const hit = detector.update({ handId, x, y, tMs, zoneId });
      if (hit && playing) fireHit(hit);
      return hit;
    },
  },
};

console.info('[AirDrum AI] ready — press Start Camera to begin.');
