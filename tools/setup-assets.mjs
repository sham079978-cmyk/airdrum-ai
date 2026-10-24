#!/usr/bin/env node
/**
 * tools/setup-assets.mjs
 * ---------------------------------------------------------------------------
 * Runs automatically after `npm install` (see the "postinstall" script).
 *
 * It does two things:
 *
 * 1. Copies the MediaPipe WASM runtime out of node_modules and into
 *    public/wasm/. Doing it here — rather than committing the ~33 MB of
 *    binaries — guarantees the WASM always matches the installed
 *    @mediapipe/tasks-vision version. A version mismatch is the classic cause
 *    of "the model loads but tracking does nothing".
 *
 * 2. Downloads public/models/hand_landmarker.task if it is not already there.
 *    The model is a ~7.5 MB binary of float16 weights that does not compress,
 *    so it is fetched once from Google's public MediaPipe storage rather than
 *    committed. If the file is already present this step is skipped.
 *
 * After this has run once, the app needs no internet connection at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const WASM_SRC = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const WASM_DEST = path.join(ROOT, 'public', 'wasm');
const MODEL_DEST = path.join(ROOT, 'public', 'models', 'hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function copyWasm() {
  if (!fs.existsSync(WASM_SRC)) {
    console.warn(
      '[setup-assets] @mediapipe/tasks-vision not found in node_modules.\n' +
        '              Run `npm install` again, or the hand tracking will not work.'
    );
    return false;
  }
  fs.mkdirSync(WASM_DEST, { recursive: true });
  const files = fs.readdirSync(WASM_SRC).filter((f) => f.endsWith('.wasm') || f.endsWith('.js'));
  for (const f of files) {
    fs.copyFileSync(path.join(WASM_SRC, f), path.join(WASM_DEST, f));
  }
  console.log(`[setup-assets] copied ${files.length} MediaPipe WASM files -> public/wasm/`);
  return true;
}

async function ensureModel() {
  if (fs.existsSync(MODEL_DEST) && fs.statSync(MODEL_DEST).size > 100000) {
    console.log('[setup-assets] hand_landmarker.task already present.');
    return true;
  }

  console.log('[setup-assets] fetching the hand model once (~7.5 MB)…');
  fs.mkdirSync(path.dirname(MODEL_DEST), { recursive: true });

  // Attempt 1: the built-in fetch (works on a normal home/office network).
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100000) throw new Error('response was too small to be the model');
    fs.writeFileSync(MODEL_DEST, buf);
    console.log(`[setup-assets] downloaded ${(buf.length / 1048576).toFixed(1)} MB -> public/models/hand_landmarker.task`);
    return true;
  } catch (err) {
    console.log(`[setup-assets] fetch did not work (${err.message}); trying curl…`);
  }

  // Attempt 2: curl. Windows 10+ ships curl.exe, and curl honours the usual
  // *_proxy environment variables, which Node's fetch does not.
  const curl = spawnSync(
    'curl',
    ['-L', '--fail', '--silent', '--show-error', '-o', MODEL_DEST, MODEL_URL],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
  if (!curl.error && curl.status === 0 && fs.existsSync(MODEL_DEST) && fs.statSync(MODEL_DEST).size > 100000) {
    const mb = (fs.statSync(MODEL_DEST).size / 1048576).toFixed(1);
    console.log(`[setup-assets] downloaded ${mb} MB via curl -> public/models/hand_landmarker.task`);
    return true;
  }

  // Attempt 3: give the user exact manual instructions.
  const lines = [
    '[setup-assets] could not download the hand model.',
    '              This download is the only step that needs the internet.',
    '              Reconnect, then run:',
    '                node tools/setup-assets.mjs',
    '              Or download this URL and save it as',
    '              public/models/hand_landmarker.task :',
    '                ' + MODEL_URL,
  ];
  console.warn(lines.join('\n'));
  return false;
}

const wasmOk = copyWasm();
const modelOk = await ensureModel();

if (wasmOk && modelOk) {
  console.log('[setup-assets] all local assets ready — the app runs fully offline.');
} else {
  console.warn('[setup-assets] some assets are missing; see the messages above.');
  // Do not fail the install — the user may want to fix it later.
}
