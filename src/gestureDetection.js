/**
 * gestureDetection.js
 * ---------------------------------------------------------------------------
 * Turns a stream of hand positions into drum strikes.
 *
 * This module is intentionally free of any browser/DOM/MediaPipe dependency so
 * it can be unit-tested in plain Node (see tests/gestureDetection.test.mjs).
 * Feed it positions; it hands back hit events.
 *
 * The core idea
 * -------------
 * A drum is only struck when the hand is (a) INSIDE a pad and (b) MOVING DOWN
 * FAST enough. Merely hovering a hand over a pad does nothing. After a hit the
 * hand must RE-ARM — either by pulling back up past a threshold, or by leaving
 * the pad for a moment — before it can fire again. That combination kills the
 * two classic false-trigger modes (a resting hand and a single gesture
 * machine-gunning the sample).
 */

export const DEFAULT_GESTURE_CONFIG = {
  // Temporal smoothing: exponential moving average weight for the newest
  // sample. 1.0 = no smoothing (jittery), lower = smoother but laggier.
  smoothingAlpha: 0.55,

  // Minimum downward speed to count as a strike, in *stage-heights per second*.
  // Downward is +y in screen space. Raise it to ignore gentle movements.
  velocityThreshold: 1.15,

  // How far (stage-heights) the hand must have descended since it last armed,
  // so a slow drift inside a pad cannot trigger.
  minTravel: 0.025,

  // Per-pad cooldown after a hit (ms) — a hard floor on repeats.
  cooldownMs: 110,

  // Re-arm rule A: hand must move UP at least this fast (stage-heights/sec).
  // Negative because upward is -y.
  rearmUpVelocity: -0.35,

  // Re-arm rule B: or stay outside any pad for this long (ms).
  rearmZoneExitMs: 260,

  // Ignore velocity computed across a gap longer than this (ms) — happens when
  // tracking drops a frame or a hand disappears and reappears.
  maxSampleGapMs: 220,
};

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Per-hand tracking state. */
class HandState {
  constructor(id) {
    this.id = id;
    this.initialised = false;
    this.smoothX = 0;
    this.smoothY = 0;
    this.prevSmoothY = 0;
    this.lastT = 0;
    this.armed = true;
    this.rearmY = 0;        // highest point (smallest y) since last arm
    this.lastHitT = -Infinity;
    this.outsideSince = null;
    this.lastVelocity = 0;
  }
}

export class GestureDetector {
  constructor(config = {}) {
    this.config = { ...DEFAULT_GESTURE_CONFIG, ...config };
    /** @type {Map<string, HandState>} */
    this.hands = new Map();
  }

  /** Merge new values into the live config (used by the UI sliders). */
  configure(partial) {
    Object.assign(this.config, partial);
  }

  /** Forget a hand (called when it leaves the frame). */
  forget(handId) {
    this.hands.delete(handId);
  }

  /** Forget everything (camera stopped / restarted). */
  reset() {
    this.hands.clear();
  }

  /**
   * Feed one frame for one hand.
   *
   * @param {object} sample
   * @param {string} sample.handId   stable id for this hand ('Left'/'Right')
   * @param {number} sample.x        normalised display x
   * @param {number} sample.y        normalised display y
   * @param {number} sample.tMs      timestamp in ms (monotonic)
   * @param {string|null} sample.zoneId  pad the point is currently inside, or null
   * @param {number} [sample.confidence]
   * @returns {{zoneId:string, handId:string, velocity:number}|null}
   */
  update({ handId, x, y, tMs, zoneId = null, confidence = 1 }) {
    const c = this.config;
    let s = this.hands.get(handId);
    if (!s) {
      s = new HandState(handId);
      this.hands.set(handId, s);
    }

    const px = clamp01(x);
    const py = clamp01(y);

    // First sample for this hand: just seed the state.
    if (!s.initialised) {
      s.initialised = true;
      s.smoothX = px;
      s.smoothY = py;
      s.prevSmoothY = py;
      s.lastT = tMs;
      s.rearmY = py;
      return null;
    }

    const dtMs = tMs - s.lastT;
    s.lastT = tMs;

    // Stale or non-monotonic timing -> reseed, don't guess a velocity.
    // A gap this long means tracking was lost and picked up again, so treat
    // the hand as freshly armed; otherwise a hand that happened to be mid-hit
    // when tracking dropped could stay stuck disarmed forever.
    if (dtMs <= 0 || dtMs > c.maxSampleGapMs) {
      s.smoothX = px;
      s.smoothY = py;
      s.prevSmoothY = py;
      s.rearmY = py;
      s.outsideSince = null;
      s.armed = true;
      return null;
    }

    const dt = dtMs / 1000;
    const a = Math.min(Math.max(c.smoothingAlpha, 0.05), 1);
    const prevY = s.smoothY;
    s.smoothX = a * px + (1 - a) * s.smoothX;
    s.smoothY = a * py + (1 - a) * s.smoothY;
    s.prevSmoothY = prevY;

    const vy = (s.smoothY - prevY) / dt; // +ve = downward
    s.lastVelocity = vy;

    // Track how high the hand has been since it armed.
    if (s.armed && s.smoothY < s.rearmY) s.rearmY = s.smoothY;

    // --- Re-arming ---------------------------------------------------------
    if (!s.armed) {
      if (vy <= c.rearmUpVelocity) {
        // Pulled the hand back up: ready again.
        s.armed = true;
        s.rearmY = s.smoothY;
        s.outsideSince = null;
      } else if (zoneId === null) {
        // Or simply left the pads for a while.
        if (s.outsideSince === null) s.outsideSince = tMs;
        else if (tMs - s.outsideSince >= c.rearmZoneExitMs) {
          s.armed = true;
          s.rearmY = s.smoothY;
          s.outsideSince = null;
        }
      } else {
        s.outsideSince = null;
      }
      if (!s.armed) return null;
    }

    // --- Strike test -------------------------------------------------------
    if (zoneId === null) return null;
    if (vy < c.velocityThreshold) return null;

    const travel = s.smoothY - s.rearmY; // +ve = descended since arming
    if (travel < c.minTravel) return null;

    if (tMs - s.lastHitT < c.cooldownMs) return null;

    // Fire.
    s.lastHitT = tMs;
    s.armed = false;
    s.rearmY = s.smoothY;
    s.outsideSince = null;

    return { zoneId, handId, velocity: vy };
  }
}

/**
 * Map a 0..1 "sensitivity" value to a velocity threshold.
 * Higher sensitivity -> lower threshold -> easier to trigger.
 */
export function sensitivityToThreshold(sensitivity) {
  const s = Math.min(Math.max(sensitivity, 0), 1);
  const easy = 0.55;  // threshold at maximum sensitivity
  const hard = 2.4;   // threshold at minimum sensitivity
  return hard + (easy - hard) * s;
}

/** Inverse of the above, for initialising a slider from a config value. */
export function thresholdToSensitivity(threshold) {
  const easy = 0.55;
  const hard = 2.4;
  const s = (hard - threshold) / (hard - easy);
  return Math.min(Math.max(s, 0), 1);
}
