"""Soundtrack for the bimp demo video, v2: moody and atmospheric. D minor, 120 bpm with a half-time
beat (feels like 60), low-register keys and plucks, deep bass, long reverb. numpy only.
Usage: python3 music.py [seconds [lift1 lift2 outro]]   (default 64 s; cues in seconds, snapped to the 2 s bar)"""
import sys, wave
import numpy as np

SR = 44100
BEAT = 0.5
BAR = 4 * BEAT
BARS = int(round((float(sys.argv[1]) if len(sys.argv) > 1 else 64) / BAR))
TOTAL = BARS * BAR + 3.0
N = int(TOTAL * SR)
rng = np.random.default_rng(11)


def hz(m): return 440.0 * 2 ** ((m - 69) / 12)


def filt(x, lo=None, hi=None, slope=2):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); g = np.ones_like(f)
    if hi: g *= 1 / np.sqrt(1 + (f / hi) ** (2 * slope))
    if lo: g *= 1 - 1 / np.sqrt(1 + (f / lo) ** (2 * slope))
    return np.fft.irfft(X * g, len(x))


def add(buf, t, sig, gain=1.0):
    i = int(t * SR)
    if i >= N or i < 0: return
    n = min(len(sig), N - i)
    buf[i:i + n] += sig[:n] * gain


def keys(m, dur, vel=1.0):
    """Soft electric-piano tone: a few low partials, a quick bark, slow decay."""
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t + 1.2 * vel * np.exp(-t * 5) * np.sin(2 * np.pi * f * 2 * t))
    s += 0.35 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 4) + 0.12 * np.sin(2 * np.pi * f * 3 * t) * np.exp(-t * 7)
    e = np.minimum(t / 0.008, 1) * np.exp(-t * 1.3) * np.minimum((dur - t) / 0.08, 1)
    return s * e * vel


def pluck(m, dur, cutoff):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m); s = np.zeros(n)
    for k in range(1, 7):
        if f * k > cutoff * 2.5: break
        s += np.sin(2 * np.pi * f * k * t + k) / k ** 1.3 * np.exp(-t * (4 + k * 2.5)) / (1 + (f * k / cutoff) ** 2)
    return s * np.minimum(t / 0.004, 1)


def pad(notes, dur):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for m in notes:
        for det in (-0.09, 0.0, 0.1):
            f = hz(m + det); ph = rng.uniform(0, 6.28)
            s += np.sin(2 * np.pi * f * t + ph) + 0.4 * np.sin(4 * np.pi * f * t + ph) + 0.15 * np.sin(6 * np.pi * f * t)
    a = np.minimum(t / 0.9, 1) * np.minimum((dur - t) / 0.9, 1)
    return s * a / (len(notes) * 3)


def bass(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(4 * np.pi * f * t) * np.exp(-t * 3) + 0.22 * np.sin(6 * np.pi * f * t) * np.exp(-t * 5)
    return np.tanh(s * 1.3) * np.minimum(t / 0.01, 1) * np.exp(-t * 0.9) * np.minimum((dur - t) / 0.06, 1)


def kick():
    n = int(0.5 * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(42 + 90 * np.exp(-t * 26)) / SR
    return np.sin(ph) * np.exp(-t * 6.5) + 0.15 * filt(rng.standard_normal(n), hi=3000) * np.exp(-t * 200)


def snare():
    n = int(0.35 * SR); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 22)
    nz = filt(rng.standard_normal(n), lo=1200, hi=6500) * np.exp(-t * 15)
    return 0.5 * body + nz


def hat(decay=60):
    n = int(0.12 * SR); t = np.arange(n) / SR
    return filt(rng.standard_normal(n), lo=5500, hi=11000) * np.exp(-t * decay)


def rim():
    n = int(0.06 * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 820 * t) + 0.5 * np.sin(2 * np.pi * 1730 * t)) * np.exp(-t * 90)


def swell(dur, lo, hi):
    n = int(dur * SR); t = np.arange(n) / SR; x = rng.standard_normal(n); out = np.zeros(n); seg = 4096
    for i in range(0, n - 64, seg):
        p = i / n; out[i:i + seg] = filt(x[i:i + seg], lo=lo * (1 + 3 * p), hi=hi * (0.4 + 1.6 * p * p))
    return out * (t / dur) ** 2.5


# i – VI – III – VII in D minor, voiced low
CH = [
    dict(root=38, chord=[50, 53, 57, 60, 64], arp=[62, 65, 69, 64, 65, 69, 72, 69]),   # Dm9
    dict(root=34, chord=[46, 53, 57, 62], arp=[58, 62, 65, 69, 62, 65, 70, 65]),       # Bbmaj7
    dict(root=41, chord=[45, 52, 55, 60], arp=[60, 64, 65, 69, 64, 65, 72, 67]),       # Fmaj9
    dict(root=36, chord=[48, 52, 55, 57, 62], arp=[60, 62, 64, 67, 62, 64, 69, 64]),   # C6/9
]
# sparse motif, mid register; (beat in the 4-bar phrase, midi, beats)
MOTIF_A = [(0, 69, 3), (3, 65, 1), (4, 67, 2.5), (6.5, 65, 1.5), (8, 64, 3), (11, 60, 1), (12, 62, 4)]
MOTIF_B = [(0, 74, 1.5), (1.5, 72, 1.5), (3, 69, 1), (4, 70, 3), (7, 69, 1), (8, 72, 1.5), (9.5, 69, 1.5), (11, 67, 1), (12, 69, 4)]

dry_l = np.zeros(N); dry_r = np.zeros(N); wet = np.zeros(N); wet2 = np.zeros(N); drums = np.zeros(N); sub = np.zeros(N)
duck = np.ones(N)
K, S, H, HO, RM = kick(), snare(), hat(), hat(18), rim()
_cue = [float(x) for x in sys.argv[2:5]]   # optional: seconds of the first lift, second lift and outro
B0 = 5                         # beat comes in (10 s, when the app appears)
B1 = round(_cue[0] / BAR) if len(_cue) > 0 else round(BARS * 16 / 32)     # first lift
B2 = round(_cue[1] / BAR) if len(_cue) > 1 else round(BARS * 21 / 32)     # second lift
B3 = round(_cue[2] / BAR) if len(_cue) > 2 else round(BARS * 28 / 32)     # breakdown / outro
LAST = BARS - 1

for bar in range(BARS):
    t0 = bar * BAR; ch = CH[bar % 4]
    intro = bar < B0; main = B0 <= bar < B3; lift = B1 <= bar < B3; full = B2 <= bar < B3; outro = bar >= B3
    # pad bed
    p = filt(pad(ch['chord'][:4], BAR + 1.2), hi=900 if intro else 1500)
    g = 0.5 if (intro or outro) else 0.3
    add(dry_l, t0 - 0.3, p, g); add(dry_r, t0 - 0.3, np.roll(p, 260), g); add(wet, t0 - 0.3, p, g * 0.6)
    # keys: chord stab on 1 and a ghost on the and-of-2
    if bar >= 2 and bar < LAST:
        for b, v in ((0, 1.0), (2.5, 0.55)) if not intro else ((0, 0.8),):
            for j, m in enumerate(ch['chord']):
                s = keys(m, 2.4, v); tt = t0 + b * BEAT + j * 0.012
                add(dry_l, tt, s, 0.085 * (1.1 if j % 2 else 0.8)); add(dry_r, tt, s, 0.085 * (0.8 if j % 2 else 1.1)); add(wet, tt, s, 0.06)
    # low arpeggio in eighths, filter opens through the piece
    if bar >= 1 and bar < LAST:
        cut = 500 + 2300 * min(1, bar / max(B2, 1)) if not outro else 900
        for i in range(8):
            if intro and i in (3, 7): continue
            m = ch['arp'][i] - 12; s = pluck(m, 0.7, cut)
            sw = 0.03 if i % 2 else 0
            tt = t0 + i * BEAT / 2 + sw; g = (0.2 if i % 4 == 0 else 0.13) * (0.75 if intro else 1)
            add(dry_l, tt, s, g * (0.75 if i % 2 else 0.4)); add(dry_r, tt, s, g * (0.4 if i % 2 else 0.75))
            add(wet2, tt, s, g * 0.8)
    # bass: long root, pickup, octave touch
    if main:
        for b, d, m in ((0, 1.6, 0), (1.75, 0.3, 0), (2.5, 1.0, 0), (3.5, 0.4, 12 if bar % 2 else 7)):
            add(sub, t0 + b * BEAT, bass(ch['root'] + m, d * BEAT * 1.9 if d > 1 else d * BEAT * 2), 0.4)
    elif outro and bar < LAST:
        add(sub, t0, bass(ch['root'], BAR * 0.95), 0.3)
    # half-time drums
    if main:
        for b in ((0, 2.5) if bar % 4 != 3 else (0, 1.5, 2.5)):
            add(drums, t0 + b * BEAT, K, 0.9 if b == 0 else 0.7)
            i = int((t0 + b * BEAT) * SR); n = int(0.35 * SR)
            if i + n < N: duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.5 * np.exp(-np.arange(n) / SR * 9))
        add(drums, t0 + 2 * BEAT, S, 0.36); add(wet, t0 + 2 * BEAT, S, 0.1)
        for i in range(8):
            add(drums, t0 + i * BEAT / 2 + (0.03 if i % 2 else 0), HO if (lift and i == 7) else H, 0.11 if i % 2 else 0.06)
        if lift:
            for q in (0.75, 1.75, 3.25): add(drums, t0 + q * BEAT, RM, 0.14); add(wet, t0 + q * BEAT, RM, 0.05)
        if full:
            for i in range(16): add(drums, t0 + i * BEAT / 4, H, 0.035 + 0.02 * (i % 4 == 2))
        if bar % 4 == 3:
            add(drums, t0 + 3.5 * BEAT, S, 0.2); add(drums, t0 + 3.75 * BEAT, S, 0.26)
    # motif
    mot = MOTIF_B if full else MOTIF_A
    if bar % 4 == 0 and (bar >= 4 or bar == 0) and bar + 3 <= LAST and (bar < B0 or bar >= B0 + 4 or True):
        for b, m, d in mot:
            if intro and b >= 8 and bar == 0: continue
            n = int(d * BEAT * SR * 1.6); t = np.arange(n) / SR; f = hz(m)
            s = (np.sin(2 * np.pi * f * t) + 0.28 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 3) + 0.1 * np.sin(2 * np.pi * f * 4.01 * t) * np.exp(-t * 8))
            s *= np.minimum(t / 0.012, 1) * np.exp(-t * 1.6)
            g = 0.1 if not lift else 0.13
            add(dry_l, t0 + b * BEAT, s, g * 0.7); add(dry_r, t0 + b * BEAT, s, g * 0.7); add(wet, t0 + b * BEAT, s, g * 1.1)

# section changes: low swell into the bar, soft sub drop on it
for hb in (B0, B1, B2, B3):
    t_hit = hb * BAR; d = 2.4
    sw = swell(d, 120, 2400); add(dry_l, t_hit - d, sw, 0.12); add(dry_r, t_hit - d, np.roll(sw, 140), 0.12); add(wet, t_hit - d, sw, 0.08)
    n = int(2.5 * SR); t = np.arange(n) / SR
    add(sub, t_hit, np.sin(2 * np.pi * (36 + 26 * np.exp(-t * 6)) * t) * np.exp(-t * 2.2), 0.42)
    c = filt(rng.standard_normal(n), lo=2500, hi=7000) * np.exp(-t * 2.0); add(wet, t_hit, c, 0.07)
# vinyl-ish air for texture
air = filt(rng.standard_normal(N), lo=400, hi=5000) * 0.006
# last chord: Dm9 left ringing
tl = LAST * BAR
for j, m in enumerate((38, 50, 57, 60, 64, 69)):
    s = keys(m, 4.5, 0.9); add(dry_l, tl + j * 0.03, s, 0.13); add(dry_r, tl + j * 0.03, s, 0.13); add(wet, tl + j * 0.03, s, 0.14)
add(sub, tl, bass(38, 3.5), 0.35)


def reverb(x, secs, damp, seed):
    r = np.random.default_rng(seed); n = int(secs * SR); t = np.arange(n) / SR
    ir = filt(r.standard_normal(n), lo=180, hi=damp) * np.exp(-t * 6.9 / secs); ir[: int(0.012 * SR)] = 0
    m = len(x) + n; y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[: len(x)]
    return y / (np.sqrt(np.sum(ir ** 2)) + 1e-9)


# dotted-eighth feedback delay on the arpeggio send
dl = np.zeros(N); d = int(0.375 * SR); src = wet2.copy()
for k in range(1, 5): dl[k * d:] += src[: N - k * d] * 0.5 ** k
wl = reverb(wet + dl * 0.6, 3.4, 4200, 1); wr = reverb(wet + dl * 0.6, 3.4, 4200, 2)
L = (dry_l + dl * 0.5 + wl * 0.5) * duck + drums + sub + air
R = (dry_r + np.roll(dl, d // 2) * 0.5 + wr * 0.5) * duck + drums + sub + np.roll(air, 999)
mix = np.stack([L, R], 1)
t = np.arange(N) / SR
mix *= (np.minimum(t / 1.2, 1) * np.clip((TOTAL - 0.1 - t) / 3.0, 0, 1))[:, None]
mix = np.tanh(mix / np.percentile(np.abs(mix), 99.9) * 1.1)
mix *= 0.89 / np.abs(mix).max()
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', TOTAL, 'bars', BARS, 'sections', B0, B1, B2, B3)
