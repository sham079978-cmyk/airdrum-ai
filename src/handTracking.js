/**
 * handTracking.js
 * ---------------------------------------------------------------------------
 * Wraps MediaPipe's Hand Landmarker (the modern "tasks-vision" API).
 *
 * What it does
 *  - Loads the WASM runtime and the hand_landmarker.task model FROM LOCAL FILES
 *    (public/wasm and public/models), so after the first install the app runs
 *    with no internet connection.
 *  - Runs in VIDEO mode against the live <video> element.
 *  - Returns, for each detected hand, the 21 landmarks converted into the same
 *    normalised *display* space the drum pads use (x mirrored for the selfie
 *    view), plus a stable hand id and a hand label.
 *
 * MediaPipe landmark indices used elsewhere:
 *   0 wrist · 4 thumb tip · 8 index tip · 12 middle tip · 16 ring tip · 20 pinky tip
 *   5/9/13/17 index/middle/ring/pinky knuckles (MCP)
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL || '/';
const PALM_INDICES = [0, 5, 9, 13, 17];
const TIP_INDICES = [8, 12, 16, 20];

/** Bone connections for drawing the hand skeleton. */
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // index
  [5, 9], [9, 10], [10, 11], [11, 12],     // middle
  [9, 13], [13, 14], [14, 15], [15, 16],   // ring
  [13, 17], [17, 18], [18, 19], [19, 20],  // pinky
  [0, 17],                                  // palm base
];

export class HandTracker {
  /**
   * @param {object} opts
   * @param {number} [opts.numHands=2]
   * @param {boolean} [opts.handednessFlip=true] We feed MediaPipe the UNMIRRORED
   *   camera frame while the preview is mirrored for the user. MediaPipe's
   *   handedness assumes a selfie-mirrored image, so we flip its label to match
   *   what the user sees. If labels ever look swapped, set this to false.
   */
  constructor({ numHands = 2, handednessFlip = true } = {}) {
    this.numHands = numHands;
    this.handednessFlip = handednessFlip;
    this.landmarker = null;
    this.loaded = false;
    this.lastVideoTime = -1;
    this.lastResult = { hands: [] };
  }

  /** Load the WASM fileset + model. Throws a friendly error on failure. */
  async load(onProgress) {
    if (this.loaded) return;
    try {
      onProgress && onProgress('Loading tracking runtime…');
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);

      onProgress && onProgress('Loading hand model…');
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: `${BASE}models/hand_landmarker.task`,
          delegate: 'CPU', // no GPU required — works on any laptop
        },
        runningMode: 'VIDEO',
        numHands: this.numHands,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.loaded = true;
    } catch (err) {
      this.loaded = false;
      throw new Error(
        'Could not load the hand-tracking model. Check that public/models/hand_landmarker.task and the public/wasm folder are present. (' +
          (err.message || err) +
          ')'
      );
    }
  }

  /**
   * Detect hands in the current video frame.
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs monotonic timestamp (performance.now())
   * @returns {{hands:Array}}
   */
  detect(video, timestampMs) {
    if (!this.loaded || !this.landmarker) return { hands: [] };
    if (!video || video.readyState < 2 || video.videoWidth === 0) return { hands: [] };

    // Skip work if the frame hasn't advanced (saves CPU).
    if (video.currentTime === this.lastVideoTime) return this.lastResult;
    this.lastVideoTime = video.currentTime;

    let result;
    try {
      result = this.landmarker.detectForVideo(video, timestampMs);
    } catch (err) {
      // A transient WASM hiccup shouldn't kill the loop.
      return { hands: [] };
    }

    const hands = [];
    const landmarksList = result.landmarks || [];
    const handednessList = result.handednesses || result.handedness || [];

    for (let i = 0; i < landmarksList.length; i++) {
      const lms = landmarksList[i];
      const cat = handednessList[i] && handednessList[i][0];
      let label = cat ? cat.categoryName : `Hand ${i + 1}`;
      const score = cat ? cat.score : 1;

      if (this.handednessFlip) label = label === 'Left' ? 'Right' : 'Left';

      // Convert to display space: mirror x so the preview matches the user.
      const pts = lms.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z || 0 }));

      const palm = avg(pts, PALM_INDICES);
      const fingertip = avg(pts, TIP_INDICES);
      const wrist = pts[0];

      // Strike point: mostly the palm, nudged toward the fingers. The palm is
      // the most stable landmark cluster, which keeps hit detection calm.
      const strike = {
        x: palm.x * 0.65 + fingertip.x * 0.35,
        y: palm.y * 0.65 + fingertip.y * 0.35,
      };

      // Hand scale (wrist -> middle knuckle) drives skeleton line width.
      const scale = Math.hypot(pts[9].x - wrist.x, pts[9].y - wrist.y);

      hands.push({
        id: label,               // stable id used for gesture state
        label,
        score,
        landmarks: pts,
        wrist,
        palm,
        fingertip,
        strike,
        scale,
      });
    }

    this.lastResult = { hands };
    return this.lastResult;
  }

  /** Free the WASM/GPU resources. */
  dispose() {
    if (this.landmarker) {
      try { this.landmarker.close(); } catch { /* ignore */ }
      this.landmarker = null;
    }
    this.loaded = false;
    this.lastVideoTime = -1;
    this.lastResult = { hands: [] };
  }
}

function avg(pts, indices) {
  let x = 0;
  let y = 0;
  for (const i of indices) {
    x += pts[i].x;
    y += pts[i].y;
  }
  return { x: x / indices.length, y: y / indices.length };
}
