#!/usr/bin/env python3
"""
AirDrum AI — drum sample generator.

Why this script exists
----------------------
The project ships five *distinct* drum one-shots as local WAV files so the app
works fully offline. Rather than redistributing copyrighted sample packs, we
synthesise each drum voice from scratch with numpy. The output is therefore
original work released under CC0 / public domain (see public/sounds/LICENSE.txt).

Every instrument uses a genuinely different synthesis recipe:
  kick   - pitch-swept sine body + transient click
  snare  - tuned tone body + filtered noise burst
  hihat  - very short, hard high-passed noise
  tom    - pitch-swept sine with a longer body and noise transient
  crash  - long, bright, metallic-filtered noise

Run:  python3 tools/generate_samples.py
Writes: public/sounds/{kick,snare,hihat,tom,crash}.wav
"""

import os
import wave
import struct
import numpy as np

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "sounds")
rng = np.random.default_rng(20240517)  # deterministic output


# ----------------------------------------------------------------------------
# Small DSP helpers
# ----------------------------------------------------------------------------
def t_axis(dur):
    return np.linspace(0.0, dur, int(SR * dur), endpoint=False)


def exp_env(t, decay, attack=0.001):
    """Exponential decay envelope with a tiny linear attack to avoid a click."""
    env = np.exp(-t / decay)
    a = max(int(SR * attack), 1)
    if a < env.size:
        env[:a] *= np.linspace(0.0, 1.0, a)
    return env


def biquad(x, kind, f0, q=0.707):
    """Apply a simple RBJ biquad filter. kind in {'lp','hp'}."""
    w0 = 2.0 * np.pi * f0 / SR
    alpha = np.sin(w0) / (2.0 * q)
    cw = np.cos(w0)
    if kind == "lp":
        b0, b1, b2 = (1 - cw) / 2, 1 - cw, (1 - cw) / 2
        a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    elif kind == "hp":
        b0, b1, b2 = (1 + cw) / 2, -(1 + cw), (1 + cw) / 2
        a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    else:
        raise ValueError(kind)
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(x.size):
        xi = x[i]
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        y[i] = yi
        x2, x1 = x1, xi
        y2, y1 = y1, yi
    return y


def pitch_sweep(t, f_start, f_end, tau):
    """Exponentially decaying instantaneous frequency -> phase integral."""
    f = f_end + (f_start - f_end) * np.exp(-t / tau)
    phase = 2.0 * np.pi * np.cumsum(f) / SR
    return phase


def noise(n):
    return rng.uniform(-1.0, 1.0, n)


def normalize(x, peak=0.95):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def fade_out(x, ms=8):
    n = min(int(SR * ms / 1000.0), x.size)
    x[-n:] *= np.linspace(1.0, 0.0, n)
    return x


def write_wav(name, x):
    x = np.clip(fade_out(normalize(x)), -1.0, 1.0)
    pcm = (x * 32767.0).astype("<i2")
    path = os.path.join(OUT_DIR, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"wrote {name:11s} {x.size/SR:5.3f}s  peak={np.max(np.abs(x)):.3f}")


# ----------------------------------------------------------------------------
# Instrument recipes
# ----------------------------------------------------------------------------
def make_kick():
    dur = 0.55
    t = t_axis(dur)
    body = np.sin(pitch_sweep(t, 160.0, 45.0, 0.045))
    body *= exp_env(t, 0.14)
    click = noise(t.size) * exp_env(t, 0.006) * 0.5
    click = biquad(click, "hp", 1200)
    x = body * 1.0 + click * 0.35
    return biquad(x, "lp", 4000)


def make_snare():
    dur = 0.35
    t = t_axis(dur)
    tone = (0.7 * np.sin(2 * np.pi * 185 * t) + 0.4 * np.sin(2 * np.pi * 330 * t))
    tone *= exp_env(t, 0.075)
    n = noise(t.size)
    body_noise = biquad(n, "hp", 900) * exp_env(t, 0.10)
    bright = biquad(n, "hp", 4000) * exp_env(t, 0.045)
    x = tone * 0.6 + body_noise * 0.75 + bright * 0.35
    return biquad(x, "hp", 200)


def make_hihat():
    dur = 0.12
    t = t_axis(dur)
    n = noise(t.size)
    # stack of high-pass stages -> thin, metallic "tss"
    x = biquad(n, "hp", 7000)
    x = biquad(x, "hp", 7000)
    x = biquad(x, "hp", 9000)
    x *= exp_env(t, 0.022)
    # a touch of metallic ring
    ring = (np.sin(2 * np.pi * 8200 * t) + np.sin(2 * np.pi * 11700 * t)) * 0.05
    x += ring * exp_env(t, 0.015)
    return x


def make_tom():
    dur = 0.45
    t = t_axis(dur)
    body = np.sin(pitch_sweep(t, 260.0, 110.0, 0.09))
    body *= exp_env(t, 0.22)
    transient = biquad(noise(t.size), "hp", 800) * exp_env(t, 0.02) * 0.3
    x = body + transient
    return biquad(x, "lp", 5000)


def make_crash():
    dur = 1.4
    t = t_axis(dur)
    n = noise(t.size)
    bright = biquad(n, "hp", 5000)
    shimmer = biquad(biquad(n, "hp", 3000), "lp", 11000)
    x = bright * 0.9 + shimmer * 0.5
    # slow-ish swell then long tail
    swell = np.minimum(t / 0.01, 1.0)
    x *= swell * exp_env(t, 0.55)
    # inharmonic metallic partials for a cymbal-like character
    for f, a in [(5200, 0.06), (6700, 0.05), (9100, 0.04), (12400, 0.03)]:
        x += a * np.sin(2 * np.pi * f * t) * exp_env(t, 0.35)
    return x


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    write_wav("kick.wav", make_kick())
    write_wav("snare.wav", make_snare())
    write_wav("hihat.wav", make_hihat())
    write_wav("tom.wav", make_tom())
    write_wav("crash.wav", make_crash())


if __name__ == "__main__":
    main()
