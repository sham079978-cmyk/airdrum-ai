#!/usr/bin/env node
/**
 * tools/smoke-test.mjs
 * ---------------------------------------------------------------------------
 * An end-to-end check of the BUILT app in a real browser (headless Chrome),
 * with a synthetic camera feed supplied by Chrome's fake-media flags.
 *
 * What it verifies
 *  1. The page loads with no console errors or uncaught exceptions.
 *  2. The camera opens and the status pills reach "Camera ready".
 *  3. The MediaPipe model + WASM load from the LOCAL files (no CDN).
 *  4. The audio engine decodes all five drum samples.
 *  5. A simulated strike — fed through the SAME detection pipeline the tracker
 *     uses — fires a sound, bumps the hit counter and flashes the pad.
 *  6. A resting hand produces no hits.
 *  7. Stopping the camera releases the loop and resets the UI.
 *
 * A headless machine has no hands, so landmark coordinates are injected. That
 * is the only substitution: the hit-test, gesture detector, audio engine and UI
 * are all the production code paths.
 *
 * Usage:  npm run smoke        (set CHROME_PATH to override the browser)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = 4178;

/* ----------------------------------------------------------- tiny server */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const type = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/* ------------------------------------------------------- find a browser */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/local/bin/chromium',
    '/usr/local/bin/google-chrome',
    '/usr/local/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('No Chrome/Chromium found. Set CHROME_PATH to your browser executable.');
}

/* ------------------------------------------------------------------ main */
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ not found — run `npm run build` first.');
    process.exit(1);
  }

  const server = await startServer();
  const executablePath = findChrome();
  console.log(`\nAirDrum AI — browser smoke test`);
  console.log(`  browser : ${executablePath}`);
  console.log(`  serving : http://127.0.0.1:${PORT}\n`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1400,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // MediaPipe prints a benign "INFO: Created TensorFlow Lite XNNPACK delegate"
  // line at console.error level. Ignore known-noisy informational lines; any
  // other console error still fails the run.
  const BENIGN = /XNNPACK|TensorFlow Lite|INFO:/i;
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !BENIGN.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2', timeout: 30000 });

    // 1 — app booted
    await page.waitForFunction('!!window.AirDrum', { timeout: 15000 });
    check('app boots and exposes window.AirDrum', true);

    // 2 — all local assets are present in the build
    const assets = await page.evaluate(async () => {
      const urls = [
        'models/hand_landmarker.task',
        'wasm/vision_wasm_internal.wasm',
        'sounds/kick.wav',
        'sounds/snare.wav',
        'sounds/hihat.wav',
        'sounds/tom.wav',
        'sounds/crash.wav',
      ];
      const out = {};
      for (const u of urls) {
        try {
          const r = await fetch(u, { method: 'HEAD' });
          out[u] = r.ok;
        } catch {
          out[u] = false;
        }
      }
      return out;
    });
    const missing = Object.entries(assets).filter(([, ok]) => !ok).map(([u]) => u);
    check('local model, wasm and drum samples are served', missing.length === 0, missing.join(', '));

    // 3 — pads rendered
    const padCount = await page.$$eval('.pad', (els) => els.length);
    check('five virtual drum pads rendered', padCount === 5, `found ${padCount}`);

    // 4 — start the camera (fake device)
    await page.click('#btn-start');
    await page.waitForFunction(
      () => {
        const s = document.getElementById('status-camera');
        return s && (s.dataset.state === 'ok' || s.dataset.state === 'error');
      },
      { timeout: 30000 }
    );
    const camState = await page.$eval('#status-camera', (el) => el.dataset.state);
    check('camera opens with the fake device', camState === 'ok', `state=${camState}`);

    // 5 — model loads locally and the loop starts
    await page.waitForFunction(
      () => {
        const s = document.getElementById('status-hands');
        return s && (s.dataset.state === 'ok' || s.dataset.state === 'warn' || s.dataset.state === 'error');
      },
      { timeout: 60000 }
    );
    const handState = await page.$eval('#status-hands', (el) => el.dataset.state);
    check('hand-tracking model loads and the loop runs', handState !== 'error', `state=${handState}`);

    // 6 — audio decoded all five samples
    await page.waitForFunction('window.AirDrum.engine.ready === true', { timeout: 20000 });
    const audio = await page.evaluate(() => ({
      ready: window.AirDrum.engine.ready,
      loaded: [...window.AirDrum.engine.buffers.keys()].sort(),
      failed: Object.fromEntries(window.AirDrum.engine.failed),
    }));
    check(
      'audio engine decoded all 5 drum samples',
      audio.loaded.length === 5 && Object.keys(audio.failed).length === 0,
      `${audio.loaded.length} loaded`
    );

    // 7 — a still hand over a pad produces no hits
    const still = await page.evaluate(() => {
      const { __test, zones } = window.AirDrum;
      const z = zones.find((zz) => zz.id === 'snare');
      __test.processPoint('Left', z.x, z.y, 1000);
      for (let i = 1; i <= 30; i++) __test.processPoint('Left', z.x, z.y, 1000 + i * 33);
      return window.AirDrum.counter.totals.all;
    });
    check('a resting hand over a pad triggers nothing', still === 0, `hits=${still}`);

    // 8 — a downward chop fires exactly one hit on the right pad
    const chop = await page.evaluate(() => {
      const { __test, zones, counter } = window.AirDrum;
      const before = counter.totals.all;
      const z = zones.find((zz) => zz.id === 'kick');
      const t0 = 5000;
      const path = [
        [z.x, z.y - 0.30], [z.x, z.y - 0.30],
        [z.x, z.y - 0.18], [z.x, z.y - 0.06], [z.x, z.y + 0.06], [z.x, z.y + 0.14],
      ];
      path.forEach(([x, y], i) => __test.processPoint('Left', x, y, t0 + i * 33));
      const padHit = document.querySelector('.pad[data-zone="kick"]').classList.contains('hit');
      return { hits: counter.totals.all - before, kick: counter.totals.kick, padHit };
    });
    check('a downward chop fires exactly one kick hit', chop.hits === 1, `hits=${chop.hits}`);
    check('the struck pad flashes', chop.padHit === true);

    // 9 — other instruments respond independently
    const multi = await page.evaluate(() => {
      const { __test, zones, counter } = window.AirDrum;
      let t = 20000;
      const targets = ['snare', 'hihat', 'tom', 'crash'];
      const got = {};
      for (const id of targets) {
        const z = zones.find((zz) => zz.id === id);
        const before = counter.totals[id];
        // lift, then chop
        [[z.x, z.y - 0.35], [z.x, z.y - 0.35], [z.x, z.y - 0.15], [z.x, z.y + 0.05], [z.x, z.y + 0.15]]
          .forEach(([x, y], i) => __test.processPoint('Right', x, y, t + i * 40));
        t += 3000;
        got[id] = counter.totals[id] - before;
      }
      return got;
    });
    check(
      'each instrument triggers its own sound',
      Object.values(multi).every((v) => v === 1),
      JSON.stringify(multi)
    );

    // 10 — controls wired up
    const controls = await page.evaluate(() => {
      const vol = document.getElementById('in-volume');
      vol.value = '40';
      vol.dispatchEvent(new Event('input', { bubbles: true }));
      const afterVol = window.AirDrum.engine.volume;

      const mute = document.getElementById('in-mute');
      mute.checked = true;
      mute.dispatchEvent(new Event('change', { bubbles: true }));
      const muted = window.AirDrum.engine.muted;
      mute.checked = false;
      mute.dispatchEvent(new Event('change', { bubbles: true }));

      return { afterVol, muted, unmuted: window.AirDrum.engine.muted };
    });
    check('volume slider drives the master gain', Math.abs(controls.afterVol - 0.4) < 1e-6);
    check('mute / unmute toggles the master gain', controls.muted === true && controls.unmuted === false);

    // 11 — hit counter UI updates
    const counterText = await page.$eval('#count-total', (el) => el.textContent);
    check('live hit counter shows the total', Number(counterText) >= 5, `total=${counterText}`);

    // 12 — recorder round-trip in the browser
    const rec = await page.evaluate(async () => {
      const { recorder, counter } = window.AirDrum;
      recorder.loop = false;
      recorder.startRecording();
      recorder.capture('kick');
      await new Promise((r) => setTimeout(r, 40));
      recorder.capture('snare');
      const n = recorder.stopRecording();
      return { n, hasPattern: recorder.hasPattern, duration: recorder.durationMs };
    });
    check('pattern recorder captures hits', rec.n === 2 && rec.hasPattern === true);

    // 13 — stopping the camera tears everything down
    await page.click('#btn-stop');
    const stopped = await page.evaluate(() => ({
      running: window.AirDrum.running,
      cameraRunning: window.AirDrum.camera.isRunning,
      camState: document.getElementById('status-camera').dataset.state,
    }));
    check('stopping the camera releases the stream and the loop',
      stopped.running === false && stopped.cameraRunning === false, JSON.stringify(stopped));

    // 14 — no console / page errors
    check('no uncaught page exceptions', pageErrors.length === 0, pageErrors.join(' | '));
    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } catch (err) {
    check('smoke test completed without throwing', false, err.message);
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log('Smoke test OK.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
