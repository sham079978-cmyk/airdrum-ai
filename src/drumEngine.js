/**
 * drumEngine.js
 * ---------------------------------------------------------------------------
 * The audio side of AirDrum AI, built on the Web Audio API.
 *
 * Responsibilities
 *  - Load the five local WAV samples once and decode them into AudioBuffers.
 *  - Play any number of overlapping hits with very low latency.
 *  - Guard the output with a limiter/compressor so rapid hits never clip.
 *  - Expose master volume + mute.
 *  - Report per-sample load failures instead of silently going quiet.
 *
 * Browsers block audio until the user interacts with the page, so the
 * AudioContext is only created/resumed inside `init()` — which we call from the
 * Start button.
 */

import { INSTRUMENTS } from './drumMapping.js';

const BASE = import.meta.env.BASE_URL || '/';

export class DrumEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.buffers = new Map();   // instrumentId -> AudioBuffer
    this.failed = new Map();    // instrumentId -> error message
    this.ready = false;
    this.muted = false;
    this.volume = 0.85;
    this.activeVoices = 0;
    this.maxVoices = 24;        // safety cap on simultaneous sources
  }

  /**
   * Create the AudioContext + effect graph SYNCHRONOUSLY.
   * Call this straight from a click handler (before any await) so browsers
   * count it as a user gesture and let audio start.
   */
  ensureContext() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio API is not supported in this browser.');
    this.ctx = new AC({ latencyHint: 'interactive' });

    // Master gain -> limiter -> speakers.
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;

    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    return this.ctx;
  }

  /**
   * Resume the context and load every sample. Safe to call more than once.
   * @returns {Promise<{ok:boolean, loaded:string[], failed:Object}>}
   */
  async init() {
    this.ensureContext();

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (!this.ready) {
      await this._loadAll();
      this.ready = true;
    }

    return {
      ok: this.buffers.size > 0,
      loaded: [...this.buffers.keys()],
      failed: Object.fromEntries(this.failed),
    };
  }

  async _loadAll() {
    const entries = Object.values(INSTRUMENTS);
    await Promise.all(
      entries.map(async (inst) => {
        try {
          const url = `${BASE}${inst.sound}`.replace(/\/{2,}/g, '/');
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = await res.arrayBuffer();
          const buffer = await this.ctx.decodeAudioData(bytes);
          this.buffers.set(inst.id, buffer);
        } catch (err) {
          this.failed.set(inst.id, err.message || String(err));
        }
      })
    );
  }

  /**
   * Play one instrument.
   * @param {string} instrumentId
   * @param {number} velocity  normalised 0..1-ish strike strength (affects loudness)
   * @returns {boolean} whether a sound actually started
   */
  play(instrumentId, velocity = 1) {
    if (!this.ready || !this.ctx) return false;
    const buffer = this.buffers.get(instrumentId);
    if (!buffer) return false;

    // Voice cap: if we're already saturated, drop the quietest-ish extra voice
    // rather than piling on sources (keeps CPU + audio sane).
    if (this.activeVoices >= this.maxVoices) return false;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    // Velocity shaping: map strike speed to a sensible gain window.
    const v = Math.min(Math.max(velocity, 0.15), 2.5);
    const gain = this.ctx.createGain();
    gain.gain.value = Math.min(0.35 + 0.5 * (v / 1.5), 1.0);

    src.connect(gain);
    gain.connect(this.master);

    this.activeVoices++;
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      try { gain.disconnect(); } catch { /* already gone */ }
    };

    src.start();
    return true;
  }

  setVolume(v) {
    this.volume = Math.min(Math.max(v, 0), 1);
    if (this.master) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.01
      );
    }
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.01
      );
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Current AudioContext clock (seconds) — used by the recorder. */
  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Release everything (called when audio is torn down). */
  async dispose() {
    this.ready = false;
    this.buffers.clear();
    this.failed.clear();
    if (this.ctx) {
      try { await this.ctx.close(); } catch { /* ignore */ }
      this.ctx = null;
      this.master = null;
      this.limiter = null;
    }
  }
}
