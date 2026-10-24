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
 * 2. Makes sure public/models/hand_landmarker.task is present. The model ships
 *    in the repository, so this is normally a no-op; if it is missing (e.g. it
 *    was deleted), we try to download it once and say so plainly.
 *
 * After this has run, the app needs no internet connection at all.
 */

import fs from 'node:fs';
import path from 'node:path';
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
    console.log('[setup-assets] hand_landmarker.task present.');
    return true;
  }
  console.log('[setup-assets] hand_landmarker.task missing — downloading once (~7.5 MB)…');
  fs.mkdirSync(path.dirname(MODEL_DEST), { recursive: true });
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(MODEL_DEST, buf);
    console.log(`[setup-assets] downloaded ${(buf.length / 1048576).toFixed(1)} MB -> public/models/hand_landmarker.task`);
    return true;
  } catch (err) {
    console.warn(
      '[setup-assets] could not download the model: ' + err.message + '\n' +
        '              Reconnect to the internet and run `node tools/setup-assets.mjs`,\n' +
        '              or copy hand_landmarker.task into public/models/ manually.'
    );
    return false;
  }
}

const wasmOk = copyWasm();
const modelOk = await ensureModel();

if (wasmOk && modelOk) {
  console.log('[setup-assets] all local assets ready — the app runs fully offline.');
} else {
  console.warn('[setup-assets] some assets are missing; see the messages above.');
  // Do not fail the install — the user may want to fix it later.
}
