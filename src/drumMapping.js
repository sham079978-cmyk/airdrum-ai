/**
 * drumMapping.js
 * ---------------------------------------------------------------------------
 * The "brain" that says where each drum lives on screen and which sound it
 * plays. Everything here is plain data + tiny pure helpers, so it is easy to
 * read, easy to change, and easy to unit-test.
 *
 * Coordinate system
 * -----------------
 * All coordinates are NORMALISED to the play stage and expressed in *display*
 * space:
 *   x: 0 = left edge of the stage,  1 = right edge
 *   y: 0 = top of the stage,        1 = bottom
 * Because the camera preview is mirrored (like a selfie), the tracking layer
 * flips the raw MediaPipe x (`1 - x`) before handing points to this module, so
 * what you see on screen is exactly what you aim at.
 *
 * `r` is a radius expressed as a fraction of the stage's SHORTER side, so the
 * pads stay circular regardless of the window aspect ratio.
 */

/** The five instruments, their sample files and their accent colours. */
export const INSTRUMENTS = {
  kick:  { id: 'kick',  label: 'Kick',       sound: 'sounds/kick.wav',  color: '#8b5cff', glow: '139,92,255' },
  snare: { id: 'snare', label: 'Snare',      sound: 'sounds/snare.wav', color: '#00e5ff', glow: '0,229,255' },
  hihat: { id: 'hihat', label: 'Hi-Hat',     sound: 'sounds/hihat.wav', color: '#22ffb0', glow: '34,255,176' },
  tom:   { id: 'tom',   label: 'High Tom',   sound: 'sounds/tom.wav',   color: '#ff5cf0', glow: '255,92,240' },
  crash: { id: 'crash', label: 'Crash',      sound: 'sounds/crash.wav', color: '#ffc23d', glow: '255,194,61' },
};

/**
 * Default kit layout — a practical, symmetric-ish arrangement modelled on a
 * real kit: left hand covers hi-hat + snare, right hand covers tom + crash +
 * kick. Change any x / y / r value here (or via Calibration Mode) to remap.
 */
export const DEFAULT_ZONES = [
  { instrument: 'hihat', x: 0.22, y: 0.30, r: 0.135 },
  { instrument: 'snare', x: 0.28, y: 0.70, r: 0.135 },
  { instrument: 'tom',   x: 0.52, y: 0.24, r: 0.120 },
  { instrument: 'crash', x: 0.80, y: 0.30, r: 0.130 },
  { instrument: 'kick',  x: 0.72, y: 0.72, r: 0.145 },
];

const STORAGE_KEY = 'airdrum.zones.v1';

/** Build a fresh, mutable zone list from the defaults (or saved overrides). */
export function createZones() {
  return DEFAULT_ZONES.map((z) => ({ ...z, ...INSTRUMENTS[z.instrument] }));
}

/**
 * Hit-test a point against every zone. Returns the zone id that contains the
 * point, or null. If several overlap, the closest centre wins.
 *
 * @param {Array} zones  zone list (from createZones)
 * @param {number} x     normalised x (display space)
 * @param {number} y     normalised y (display space)
 * @param {number} stageW stage width in pixels
 * @param {number} stageH stage height in pixels
 */
export function hitTest(zones, x, y, stageW, stageH) {
  const scale = Math.min(stageW, stageH);
  let best = null;
  let bestD = Infinity;
  for (const z of zones) {
    const dx = (x - z.x) * stageW;
    const dy = (y - z.y) * stageH;
    const d = Math.hypot(dx, dy);
    if (d <= z.r * scale && d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best ? best.id : null;
}

/** Closest zone centre to a point (used for calibration feedback). */
export function nearestZone(zones, x, y, stageW, stageH) {
  let best = null;
  let bestD = Infinity;
  for (const z of zones) {
    const d = Math.hypot((x - z.x) * stageW, (y - z.y) * stageH);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

/* ---------------------------------------------------------------------------
 * Session persistence for Calibration Mode — saves the current layout so a
 * demo keeps the mapping you dialled in until the tab is closed.
 * ------------------------------------------------------------------------- */
export function saveZones(zones) {
  try {
    const slim = zones.map(({ instrument, x, y, r }) => ({ instrument, x, y, r }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    return true;
  } catch {
    return false;
  }
}

export function loadZones() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const slim = JSON.parse(raw);
    if (!Array.isArray(slim) || slim.length === 0) return null;
    return slim.map((z) => ({ ...z, ...INSTRUMENTS[z.instrument] }));
  } catch {
    return null;
  }
}

export function clearSavedZones() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
