"""Synthesises the promo soundtrack (pad, plucks, a soft beat and UI sounds) to promo/out/audio.wav.
Everything is generated here with numpy: no samples, no licences. 96 bpm, so a beat is 0.625 s and the
picture's scene cuts sit on beats. Run from the repo root: python3 promo/audio.py"""
import wave
import numpy as np

SR = 44100
DUR = 73.4
N = int(SR * DUR)
L = np.zeros(N + SR * 4)
R = np.zeros(N + SR * 4)
rng = np.random.default_rng(7)
BEAT = 0.625


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i < 0 or i >= len(L):
        return
    sig = sig[: len(L) - i]
    L[i:i + len(sig)] += sig * gain * (1 - max(0, pan))
    R[i:i + len(sig)] += sig * gain * (1 + min(0, pan))


def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na) ** 2
    e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e


def pad(freq, dur, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h in range(1, 7):
        out += np.sin(2 * np.pi * freq * h * t + rng.uniform(0, 6.28)) / h ** (2.4 - bright)
    return out * (1 + 0.12 * np.sin(2 * np.pi * 0.23 * t + rng.uniform(0, 6.28)))


def pluck(freq, dur=0.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) + 0.12 * np.sin(6 * np.pi * freq * t)
    return s * np.exp(-t * 6.5) * np.minimum(1, t * 400)


def kick():
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    f = 46 + 70 * np.exp(-t * 34)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 13)


def hat():
    n = int(0.05 * SR)
    x = np.diff(rng.standard_normal(n + 1))
    return x * np.exp(-np.arange(n) / SR * 90)


def tick():
    n = int(0.012 * SR)
    return np.diff(rng.standard_normal(n + 1)) * np.exp(-np.arange(n) / SR * 420)


def pop(f0=820):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    f = f0 * (1 - 0.25 * t / 0.16)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 30) * np.minimum(1, t * 800)


def bell(notes, dur=2.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes:
        f = midi(m)
        out += np.sin(2 * np.pi * f * t) * np.exp(-t * 2.6) + 0.3 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t * 5)
    return out * np.minimum(1, t * 300)


def whoosh(dur=0.5, up=True):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    k = 24
    x = np.convolve(x, np.ones(k) / k, mode='same')
    e = np.linspace(0, 1, n) ** 2 if up else np.linspace(1, 0, n) ** 2
    return x * e * np.sin(np.linspace(0, np.pi, n)) ** 0.5


def thump():
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * (38 + 40 * np.exp(-t * 20)) * t) * np.exp(-t * 6) + 0.25 * np.convolve(rng.standard_normal(n), np.ones(60) / 60, 'same') * np.exp(-t * 18)


# chords: (start, end, bass, voices, brightness, level)
D = (38, [50, 57, 62, 66, 69, 76])
Bm = (35, [47, 54, 59, 62, 66, 73])
G = (31, [43, 50, 55, 59, 66, 71])
A = (33, [45, 52, 57, 61, 64, 71])
Asus = (33, [45, 52, 57, 62, 64])
PROG = [(0, 6.25, Bm, 0.5, 0.5), (6.25, 11.875, G, 0.55, 0.55), (11.875, 13.75, Asus, 0.7, 0.6),
        (13.75, 20, D, 1.0, 1.0), (20, 25, G, 0.9, 0.85), (25, 30, D, 1.0, 0.95), (30, 35, Bm, 1.0, 0.95), (35, 40, G, 1.0, 0.95), (40, 45, A, 1.0, 0.95),
        (45, 50, D, 1.0, 0.95), (50, 55, Bm, 1.0, 0.95), (55, 60, G, 1.0, 0.95), (60, 65.625, A, 1.05, 1.0), (65.625, 73.4, D, 0.9, 1.0)]
for a, b, (bass, notes), bright, lvl in PROG:
    d = b - a + 1.6
    e = env(int(d * SR), 0.9 if a > 0 else 2.5, 1.8)
    for i, m in enumerate(notes):
        for det, pan in ((-0.0035, -0.6), (0.0035, 0.6)):
            add(pad(midi(m) * (1 + det), d, bright) * e, a - 0.3 if a > 0 else 0, 0.035 * lvl, pan * (0.4 + 0.1 * i))
    add(pad(midi(bass), d, 0.3) * e, a - 0.3 if a > 0 else 0, 0.11 * lvl)

# plucked arpeggio with an echo, from the logo on
ARP = [0, 2, 3, 4, 2, 3, 5, 3]
t = 14.375
while t < 65.6:
    ch = next(c for c in PROG if c[0] <= t < c[1])
    notes = ch[2][1]
    step = int(round(t / (BEAT / 2)))
    m = notes[ARP[step % 8] % len(notes)] + 12
    g = 0.05 if t < 25 else 0.085
    if 20 <= t or step % 2 == 0:
        for k, (dl, gg) in enumerate(((0, 1), (0.46875, 0.38), (0.9375, 0.15))):
            add(pluck(midi(m)), t + dl, g * gg, (-0.5 if step % 2 else 0.5) * (1 if k != 1 else -1))
    t += BEAT / 2

# beat: soft from "Ask", full under the answers, out for the end card
t = 20.0
while t < 65.6:
    add(kick(), t, 0.5 if t >= 25 else 0.3)
    if t >= 25:
        add(hat(), t + BEAT / 2, 0.05, 0.3)
        if t >= 30:
            add(hat(), t + BEAT * 0.75, 0.022, -0.3)
    t += BEAT

# picture cues
for i, tt in enumerate((9.375, 10.0, 10.625, 11.25)):
    add(thump(), tt, 0.36)
    add(pop(520 + i * 90), tt, 0.12)
add(whoosh(0.35), 11.875 - 0.35, 0.35)
add(thump(), 12.2, 0.5)
add(whoosh(0.5), 13.75 - 0.5, 0.3)
add(bell([62, 69, 74]), 14.55, 0.10)          # door swings
add(bell([78, 81]), 15.15, 0.07, 0.3)         # target spins in
add(bell([74, 81, 86]), 16.3, 0.08)           # wordmark complete
add(whoosh(0.4), 20 - 0.4, 0.25)
n_chars = 66
for i in range(0, n_chars, 2):
    add(tick(), 22.05 + 1.95 * i / n_chars, 0.10 + 0.04 * rng.random(), rng.uniform(-0.3, 0.3))
add(pop(980), 24.4, 0.3)
add(whoosh(0.4), 25 - 0.4, 0.3)
add(whoosh(1.6), 25.2, 0.07)                  # the plan drafts itself
add(pop(700), 27.8, 0.2)                      # room lights up
for i in range(4):
    add(pop(760 + 60 * i), 28.2 + i * 0.45, 0.13, 0.4)
add(bell([74, 78, 81, 86]), 31.3, 0.12)       # 189
for r0, rows in ((37.5, 4), (41.875, 3)):
    add(whoosh(0.3), r0 - 0.3, 0.2)
    add(pop(700), r0 + 0.35, 0.18)
    for i in range(rows):
        add(pop(760 + 60 * i), r0 + 0.7 + i * 0.2, 0.11, 0.4)
    add(bell([74, 81, 86]), r0 + 2.1, 0.10)
add(whoosh(0.5), 46.25 - 0.5, 0.3)
add(pop(880), 50.4, 0.2)
for tt in (52.5, 54.6875, 56.875, 59.0625):
    add(whoosh(0.3), tt - 0.3, 0.25)
    add(pop(640), tt + 0.02, 0.12)
for i in range(3):
    add(pop(700 + 90 * i), 59.0625 + i * 0.42, 0.2)
add(whoosh(0.35), 61.25 - 0.35, 0.25)
for i in range(3):
    add(pop(760 + 70 * i), 61.25 + 1.2 + i * 0.2, 0.15, 0.3 - 0.3 * i)
add(whoosh(0.6), 65.625 - 0.6, 0.35)
add(thump(), 65.625, 0.5)
add(bell([62, 69, 74, 78]), 66.3, 0.10)
add(bell([74, 81, 86, 90]), 67.9, 0.09)
add(pop(980), 69.45, 0.16)

mix = np.stack([L[:N], R[:N]], axis=1)
# gentle glue: soft clip, fades, normalise
mix = np.tanh(mix * 1.6) / 1.6
fade = np.ones(N)
fi, fo = int(0.6 * SR), int(3.2 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
mix *= fade[:, None]
mix *= 0.89 / np.max(np.abs(mix))
with wave.open('promo/out/audio.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote promo/out/audio.wav', round(DUR, 2), 's')
