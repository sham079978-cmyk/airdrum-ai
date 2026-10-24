/**
 * recorder.js
 * ---------------------------------------------------------------------------
 * The "fun for the demo" layer: a live hit counter and a looping pattern
 * recorder, so a visitor at the Tech Expo can lay down a beat, hit play, and
 * hear it back.
 *
 * Two independent pieces:
 *   HitCounter  — totals + per-instrument tallies, updated on every hit.
 *   PatternRecorder — captures (time, instrument) pairs while recording and
 *     replays them with setTimeout scheduling against the audio engine.
 *
 * Recording and playback share one clock: `performance.now()` for capture, and
 * a wall-clock timer for replay. Playback calls back into the DrumEngine so the
 * same samples (and the same limiter) are used — the pattern is silent if audio
 * has not been started.
 */

export class HitCounter {
  constructor(instrumentIds) {
    this.totals = { all: 0 };
    for (const id of instrumentIds) this.totals[id] = 0;
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this.totals); }

  hit(instrumentId) {
    this.totals.all += 1;
    if (instrumentId in this.totals) this.totals[instrumentId] += 1;
    this._emit();
    return this.totals;
  }

  reset() {
    for (const k of Object.keys(this.totals)) this.totals[k] = 0;
    this._emit();
  }
}

export class PatternRecorder {
  /**
   * @param {(instrumentId:string, velocity:number)=>void} playFn
   *        called for every replayed note
   */
  constructor(playFn) {
    this.playFn = playFn;
    this.events = [];          // { t, instrumentId, velocity }
    this.recording = false;
    this.playing = false;
    this.loop = true;
    this._startTime = 0;
    this._timers = new Set();
    this._playStart = 0;
    this.onStateChange = null; // () => void
  }

  get hasPattern() { return this.events.length > 0; }
  get durationMs() {
    if (!this.events.length) return 0;
    return this.events[this.events.length - 1].t;
  }

  startRecording() {
    this.stopPlayback();
    this.events = [];
    this.recording = true;
    this._startTime = performance.now();
    this._notify();
  }

  capture(instrumentId, velocity = 1) {
    if (!this.recording) return;
    const t = performance.now() - this._startTime;
    this.events.push({ t, instrumentId, velocity });
    this._notify();
  }

  stopRecording() {
    this.recording = false;
    this._notify();
    return this.events.length;
  }

  clear() {
    this.stopPlayback();
    this.events = [];
    this._notify();
  }

  startPlayback() {
    if (!this.events.length) return false;
    this.stopPlayback();
    this.playing = true;
    this._playStart = performance.now();
    this._schedule();
    this._notify();
    return true;
  }

  stopPlayback() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    if (this.playing) {
      this.playing = false;
      this._notify();
    }
  }

  _schedule() {
    const total = this.durationMs + 120; // small gap before the loop repeats
    for (const ev of this.events) {
      const id = setTimeout(() => {
        if (!this.playing) return;
        this.playFn(ev.instrumentId, ev.velocity);
      }, ev.t);
      this._timers.add(id);
    }
    if (this.loop) {
      const loopId = setTimeout(() => {
        this._timers.delete(loopId);
        if (this.playing) this._schedule();
      }, total);
      this._timers.add(loopId);
    } else {
      const endId = setTimeout(() => {
        this._timers.delete(endId);
        this.playing = false;
        this._notify();
      }, total);
      this._timers.add(endId);
    }
  }

  _notify() {
    if (this.onStateChange) this.onStateChange();
  }

  dispose() {
    this.stopPlayback();
    this.recording = false;
    this.events = [];
    this.onStateChange = null;
  }
}
