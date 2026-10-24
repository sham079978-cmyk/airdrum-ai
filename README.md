# 🥁 AirDrum AI

**Play a drum kit in mid-air.** AirDrum AI watches your webcam, tracks both your
hands with MediaPipe, and fires real drum sounds the moment you chop down into
one of five on-screen pads — no drumsticks, no MIDI controller, no hardware.

Built as a single-page web app: **no Python backend, no GPU, no cloud.** All
hand tracking runs locally in your browser and your camera feed never leaves
your machine.

```
  webcam ──► MediaPipe Hand Landmarker ──► gesture detector ──► Web Audio API
                                              │
                                              └──► visual feedback + recorder
```

---

## Contents

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Quick start (Windows / PowerShell)](#quick-start-windows--powershell)
- [How to play](#how-to-play)
- [Controls](#controls)
- [Calibration mode](#calibration-mode)
- [Pattern recorder](#pattern-recorder)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [Tuning the feel](#tuning-the-feel)
- [Testing](#testing)
- [Offline use and network requirements](#offline-use-and-network-requirements)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Licensing](#licensing)

---

## What you get

| Feature | Notes |
| --- | --- |
| Real-time two-hand tracking | MediaPipe Hand Landmarker, 21 landmarks per hand, up to 2 hands |
| Five playable pads | Kick, Snare, Hi-Hat, High Tom, Crash — each with its own sound |
| Strike detection | Velocity + travel + cooldown + re-arm. Holding still does nothing |
| Neon studio UI | Dark theme, animated pads, hand skeleton, movement trails, live hit log |
| Web Audio engine | Preloaded samples, overlapping hits, master limiter, volume + mute |
| Calibration mode | See the zones, drag pads around, tune sensitivity, save the layout |
| Session features | Live hit counter (total + per pad) and a looping pattern recorder |
| Status indicators | Camera, hands, audio and FPS are all reported live |
| Fully offline | Model, WASM runtime and drum samples all ship with the project |

---

## Requirements

- **Node.js 18 or newer** (20 LTS recommended) — [nodejs.org](https://nodejs.org)
- A **webcam**
- **Chrome, Edge or Firefox** (any recent version)
- A laptop with 2 cores is plenty. No GPU required — the model runs on CPU.

> **Why a local server?** Browsers only grant camera access on `localhost` or
> `https://`. That is why we run Vite instead of just double-clicking
> `index.html`. Opening the file directly will not work.

---

## Quick start (Windows / PowerShell)

### 1. Get the project

Unzip / clone the project so you have a folder containing `package.json`, then
open that folder in VS Code.

### 2. Open a terminal in VS Code

**Terminal → New Terminal** (or `` Ctrl+` ``). Make sure it says **PowerShell**.

### 3. Go to the project folder

```powershell
cd C:\path\to\airdrum-ai
```

Tip: in Explorer you can copy the folder path from the address bar and paste it
after `cd `.

### 4. Install dependencies

```powershell
npm install
```

This downloads Vite and the MediaPipe library (about 40 MB) and then runs
`tools/setup-assets.mjs` automatically, which:

- copies the MediaPipe WASM runtime from `node_modules` into `public/wasm/`,
- confirms `public/models/hand_landmarker.task` is present.

You should see:

```
[setup-assets] copied 6 MediaPipe WASM files -> public/wasm/
[setup-assets] hand_landmarker.task present.
[setup-assets] all local assets ready — the app runs fully offline.
```

> If PowerShell refuses to run `npm` with a script-execution error, run this
> once and reopen the terminal:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

### 5. Start the app

```powershell
npm run dev
```

You will see something like:

```
  VITE v5.4.21  ready in 900 ms
  ➜  Local:   http://localhost:5173/
```

### 6. Open it

Hold **Ctrl** and click the `http://localhost:5173/` link, or paste it into
Chrome. Click **Start Camera** and press **Allow** when the browser asks for
camera permission.

That's it — you should see yourself on screen with five glowing pads overlaid.

### 7. Stop the server

Click the terminal and press **Ctrl + C**.

### Building a production version (optional)

```powershell
npm run build     # writes a static site into dist\
npm run preview   # serves dist\ at http://localhost:4173
```

The `dist\` folder is a self-contained static site — it includes the model, the
WASM runtime and the drum samples.

---

## How to play

1. Click **Start Camera** and allow access.
2. Wait for the status pills to read **Camera ready**, **Audio ready** and
   **Hand detected**.
3. Hold a hand up in front of the camera so the skeleton appears.
4. **Chop downward** into a pad — a fast, deliberate downward swing.
5. After a hit, **lift your hand back up** before striking again. This is what
   stops one swing from firing the sound repeatedly.
6. Try both hands. Left and right are tracked completely independently.

**Important:** a hand that is merely resting over a pad, or drifting slowly
across it, produces **no sound**. A strike requires real downward speed *and*
real downward travel. If you find it too hard or too easy to trigger, drag the
**Sensitivity** slider — or use **Calibration Mode**.

---

## Controls

| Control | What it does |
| --- | --- |
| **Start Camera** | Requests the camera, loads the model, loads the audio samples and starts tracking |
| **Stop Camera** | Releases the camera, stops the loop and resets the display |
| **Start / Stop Playing** | Pauses and resumes sound triggering. Tracking keeps running while paused |
| **Start Audio** | Manually initialises audio if your browser blocked it at startup |
| **Mute / Unmute** | Silences the master output (tracking continues) |
| **Master volume** | 0–100 % output level |
| **Sensitivity** | How fast a downward move must be to count as a strike |
| **Smoothing** | How much hand jitter is filtered out (higher = calmer, slightly laggier) |
| **Cooldown** | Minimum time between two hits on the same pad |
| **Calibration mode** | Shows the zones and lets you drag the pads |
| **Save pad layout** | Stores your zone positions for the session |
| **Reset pads** | Restores the default kit layout |
| **● Record / ▶ Play** | Record a beat and play it back |
| **Loop** | Makes playback repeat |
| **Clear** | Deletes the recorded pattern |

---

## Calibration mode

Turn on **Calibration mode** to:

- see every activation zone drawn on the video with its exact centre and radius,
- **drag the pads** anywhere on the stage to fit your own reach and camera angle,
- watch your hand position and see which pad it is hovering,
- adjust **Sensitivity** until your natural swing triggers reliably,
- click **Save pad layout** to keep the mapping for the session.

**Reset pads** puts everything back to the default kit arrangement. Your saved
layout lives in the browser's `localStorage`, so closing the tab clears it.

---

## Pattern recorder

1. Click **● Record**.
2. Play a beat with your hands.
3. Click **■ Stop rec**.
4. Click **▶ Play** to hear it back. With **Loop** ticked it repeats until you
   press **■ Stop**.

The hit counter above it tracks your total hits and a per-pad breakdown, live.

---

## Project structure

```
airdrum-ai/
├── index.html                 # page shell: stage, panels, controls
├── package.json
├── vite.config.js
├── README.md
├── LICENSE
├── src/
│   ├── main.js                # conductor: wires everything, owns the loop
│   ├── styles.css             # neon studio theme
│   ├── camera.js              # getUserMedia wrapper + cleanup
│   ├── handTracking.js        # MediaPipe Hand Landmarker wrapper
│   ├── gestureDetection.js    # strike detection (pure logic, unit-tested)
│   ├── drumEngine.js          # Web Audio playback + mixer
│   ├── drumMapping.js         # where each pad is, which sound it plays
│   ├── recorder.js            # hit counter + pattern record/playback
│   └── ui.js                  # all DOM + canvas drawing
├── public/
│   ├── sounds/                # kick/snare/hihat/tom/crash.wav + LICENSE.txt
│   ├── models/
│   │   └── hand_landmarker.task   # MediaPipe model (shipped, ~7.5 MB)
│   └── wasm/                  # MediaPipe runtime (created by npm install)
├── tests/                     # unit tests (node --test)
│   ├── gestureDetection.test.mjs
│   ├── drumMapping.test.mjs
│   └── recorder.test.mjs
└── tools/
    ├── setup-assets.mjs       # postinstall: sync WASM + verify model
    ├── generate_samples.py    # synthesises the five drum samples
    └── smoke-test.mjs         # headless-browser end-to-end check
```

---

## How it works

**1. Camera** (`camera.js`) — `getUserMedia()` opens a 1280×720 front camera
stream. Only one stream can exist at a time; `stop()` always stops every track
so the camera light actually goes out.

**2. Hand tracking** (`handTracking.js`) — MediaPipe's Hand Landmarker runs in
`VIDEO` mode on the live video element and returns 21 normalised landmarks per
hand. Landmark `x` is mirrored (`1 - x`) so the coordinates match the mirrored
selfie preview. From the landmarks we derive a **palm centre**, a **fingertip
centroid**, and a **strike point** blended between them — the palm is the most
stable cluster, which keeps detection calm.

**3. Strike detection** (`gestureDetection.js`) — for each hand, per frame:

- smooth the position with an exponential moving average,
- compute vertical velocity in *stage-heights per second* (downward is positive),
- a hit fires only when **all** of these hold:
  - the strike point is inside a pad,
  - velocity ≥ `velocityThreshold`,
  - the hand has descended at least `minTravel` since it last armed,
  - the per-pad cooldown has elapsed,
  - the hand is **armed**.
- after firing, the hand disarms. It re-arms by moving **up** past
  `rearmUpVelocity`, or by leaving the pads for `rearmZoneExitMs`.
- a tracking gap longer than `maxSampleGapMs` reseeds the hand instead of
  inventing an enormous velocity.

**4. Audio** (`drumEngine.js`) — the five WAVs are fetched and decoded into
`AudioBuffer`s once. Each hit creates a short `BufferSource → GainNode` chain
into a master gain and a limiter, so hits overlap freely and never clip. The
`AudioContext` is created synchronously inside the Start click, which is what
satisfies browser autoplay rules.

**5. UI** (`ui.js`) — pads are DOM elements positioned from the zone list so CSS
can animate them; the hand skeleton, movement trails and zone outlines are drawn
on a canvas overlay sized to the video.

**Detection runs at ~30 FPS** while the overlay redraws every animation frame,
so trails stay smooth without paying for model inference 60 times a second.

---

## Tuning the feel

Everything tunable lives in one place — `DEFAULT_GESTURE_CONFIG` in
`src/gestureDetection.js`:

| Setting | Default | Effect |
| --- | --- | --- |
| `smoothingAlpha` | `0.55` | Higher = more responsive, more jitter |
| `velocityThreshold` | `1.15` | Minimum downward speed to strike |
| `minTravel` | `0.025` | Minimum downward distance since arming |
| `cooldownMs` | `110` | Hard floor between repeats on one pad |
| `rearmUpVelocity` | `-0.35` | How fast you must pull back up to re-arm |
| `rearmZoneExitMs` | `260` | Or how long to stay off the pads to re-arm |
| `maxSampleGapMs` | `220` | Gaps longer than this are treated as a fresh hand |

The **Sensitivity** slider maps onto `velocityThreshold` at runtime; **Smoothing**
and **Cooldown** map onto the other two. Pad positions and sounds live in
`DEFAULT_ZONES` and `INSTRUMENTS` in `src/drumMapping.js` — change the `x`/`y`/`r`
values there to remap the kit permanently.

---

## Testing

```powershell
npm test      # 27 unit tests — gesture logic, pad mapping, recorder
npm run smoke # production build + 17 end-to-end checks in headless Chrome
```

`npm test` runs on Node alone (no browser needed). `npm run smoke` builds the
app, serves `dist\`, launches Chrome with a **synthetic camera**, and checks the
whole pipeline. If Chrome is not found automatically, point at it:

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run smoke
```

Because a headless machine has no hands, the smoke test injects landmark
coordinates into `window.AirDrum.__test.processPoint()`. That is the **only**
substitution — hit-testing, the gesture detector, the audio engine and the UI
are all the real production code paths. Real hand tracking is never simulated in
the app itself.

---

## Offline use and network requirements

The app is designed to run with **no internet connection**:

- `public/models/hand_landmarker.task` (the hand model) ships in the repository.
- `public/wasm/` is filled from `node_modules` on `npm install`, so the runtime
  always matches the installed MediaPipe version.
- `public/sounds/` contains the five drum samples.

The only network access ever needed is the initial `npm install` (to fetch Vite
and MediaPipe from npm). If `hand_landmarker.task` is ever deleted,
`tools/setup-assets.mjs` downloads it once from Google's public MediaPipe
storage — that is the only external URL the project knows about.

---

## Known limitations

Being straight with you about what this does and does not do:

- **The kick drum is played by a hand strike, not a foot pedal.** There is no
  foot or leg tracking in this build, so nothing here claims foot-controlled
  kick. The kick is a pad you strike like the others.
- **Handedness labels are corrected for the mirrored preview.** MediaPipe
  assumes a selfie-mirrored image while we feed it the raw frame, so the label
  is flipped back. If the "Left"/"Right" labels ever look swapped on your
  camera, set `handednessFlip: false` where `HandTracker` is constructed in
  `src/main.js`.
- **Verified with the real model but not with real hands.** Automated checks
  confirmed the camera, model loading, detection pipeline, audio and UI all work
  end-to-end in a real browser — but the build environment has no physical
  webcam, so the detection thresholds were tuned by reasoning and are exposed as
  sliders for you to dial in. Expect to spend a minute with **Calibration Mode**
  on first use.
- **~25–30 FPS is the target, not a guarantee.** It depends on your CPU and
  camera. The FPS pill in the header shows what you are actually getting.
- **Only the five listed instruments exist.** Adding more means adding a zone in
  `drumMapping.js` and a sample in `public/sounds/`.
- **Recording is in-memory only.** Patterns are not saved to disk or across
  reloads.

---

## Troubleshooting

**"Camera permission was denied"**
Click the camera icon in Chrome's address bar, set it to *Allow*, then press
**Start Camera** again. On Windows, also check Settings → Privacy → Camera.

**"The camera is already in use by another app"**
Close Zoom / Teams / Meet / other browser tabs that are holding the camera, then
retry.

**The camera light stays on after pressing Stop Camera**
It shouldn't — `stop()` stops every track. If it does, reload the page; and
please open an issue with your browser version.

**No sound at all**
Check the **Mute** checkbox and the volume slider, and make sure the status pill
reads **Audio ready**. If it says *Audio failed to load*, confirm the five `.wav`
files exist in `public/sounds/`. If audio was blocked at startup, press
**Start Audio**.

**Hands are tracked but nothing triggers**
Open **Calibration Mode** and watch the strike point. Move the **Sensitivity**
slider toward the right. Strike *through* the pad with some force rather than
touching it gently — remember that the hand must also travel downward
meaningfully, and must be lifted back up between hits.

**"Could not load the hand-tracking model"**
Run `npm install` again (it re-runs `tools/setup-assets.mjs`), or
`node tools/setup-assets.mjs` directly. Confirm `public/models/hand_landmarker.task`
and `public/wasm/` both exist.

**Tracking is laggy**
Lower the camera resolution in `src/main.js` (the `Camera` constructor options),
close other heavy tabs, and make sure hardware acceleration is on in
`chrome://settings/system`.

**`npm install` fails on PowerShell with a script-execution error**
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

---

## Licensing

- **Project code:** MIT — see [LICENSE](LICENSE).
- **Drum samples:** original, synthesised by `tools/generate_samples.py`,
  released under **CC0 1.0** (public domain) — see
  [public/sounds/LICENSE.txt](public/sounds/LICENSE.txt).
- **MediaPipe** (`@mediapipe/tasks-vision` + `hand_landmarker.task`): Apache 2.0.
- **Vite:** MIT. **puppeteer-core:** Apache 2.0 (development only).

## Privacy

Camera frames are processed entirely inside your browser by a local WASM model.
Nothing is recorded, uploaded or sent anywhere. There is no backend.
