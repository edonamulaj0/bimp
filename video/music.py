"""Original soundtrack for the bimp demo video: 120 bpm, 32 bars (64 s), numpy only."""
import numpy as np, wave

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
TOTAL = 66.0
N = int(TOTAL * SR)
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)


def hz(m): return 440.0 * 2 ** ((m - 69) / 12)


def fft_filter(x, lo=None, hi=None, slope=4):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); g = np.ones_like(f)
    if hi: g *= 1 / np.sqrt(1 + (f / hi) ** (2 * slope))
    if lo: g *= 1 - 1 / np.sqrt(1 + (f / lo) ** (2 * slope))
    return np.fft.irfft(X * g, len(x))


def add(buf, t, sig, gain=1.0):
    i = int(t * SR)
    if i >= N or i < 0: return
    n = min(len(sig), N - i)
    buf[i:i + n] += sig[:n] * gain


def env(n, a, d, s=0.0, r=0.02):
    t = np.arange(n) / SR
    e = np.minimum(t / max(a, 1e-4), 1) * (s + (1 - s) * np.exp(-t / d))
    rel = int(r * SR)
    if rel < n: e[-rel:] *= np.linspace(1, 0, rel)
    return e


def pluck(m, dur=0.5, bright=1.0):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    sig = np.zeros(n)
    for k in range(1, 9):
        sig += np.sin(2 * np.pi * f * k * t + k) / k ** (1.9 - 0.7 * bright) * np.exp(-t * (3 + k * 3.5 / bright))
    sig += 0.25 * np.sin(2 * np.pi * f * 2.003 * t) * np.exp(-t * 9)
    return sig * env(n, 0.003, 0.22)


def pad(notes, dur):
    n = int(dur * SR); t = np.arange(n) / SR; sig = np.zeros(n)
    for m in notes:
        for det in (-0.07, 0.0, 0.08):
            f = hz(m + det)
            for k in (1, 2, 3, 4, 5):
                sig += np.sin(2 * np.pi * f * k * t + rng.uniform(0, 6.28)) / k ** 1.6
    a = np.minimum(t / 0.5, 1) * np.minimum((dur - t) / 0.5, 1)
    return sig * a / (len(notes) * 3)


def bass(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    sig = np.sin(2 * np.pi * f * t) + 0.45 * np.sin(4 * np.pi * f * t) * np.exp(-t * 6) + 0.2 * np.sin(6 * np.pi * f * t) * np.exp(-t * 10)
    return np.tanh(sig * 1.4) * env(n, 0.005, 0.5, 0.5, 0.03)


def kick():
    n = int(0.42 * SR); t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * np.exp(-t * 8.5) + 0.3 * rng.standard_normal(n) * np.exp(-t * 300)) * 1.0


def hat(open_=False):
    n = int((0.22 if open_ else 0.06) * SR); t = np.arange(n) / SR
    x = fft_filter(rng.standard_normal(n), lo=7000)
    return x * np.exp(-t * (16 if open_ else 70))


def clap():
    n = int(0.25 * SR); t = np.arange(n) / SR
    x = fft_filter(rng.standard_normal(n), lo=900, hi=5000, slope=2)
    e = np.exp(-t * 22) + sum(np.exp(-np.abs(t - d) * 400) for d in (0.0, 0.011, 0.023)) * 0.6
    return x * e


def riser(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n); seg = 2048
    for i in range(0, n, seg):
        p = i / n
        chunk = x[i:i + seg]
        if len(chunk) < 64: break
        out[i:i + len(chunk)] = fft_filter(chunk, lo=300 + 5000 * p ** 2, hi=1500 + 10000 * p ** 2, slope=2)
    return out * (t / dur) ** 2.2


# Fmaj7 | G6 | Am7 | Em7  — hopeful, forward-moving
CH = [
    dict(root=41, pad=[53, 57, 60, 64], arp=[65, 69, 72, 76, 72, 69, 77, 72]),
    dict(root=43, pad=[55, 59, 62, 64], arp=[67, 71, 74, 76, 74, 71, 79, 74]),
    dict(root=45, pad=[57, 60, 64, 67], arp=[69, 72, 76, 79, 76, 72, 81, 76]),
    dict(root=40, pad=[52, 55, 59, 62], arp=[64, 67, 71, 74, 71, 67, 76, 71]),
]
LEAD = [  # (beat offset in the 4-bar phrase, midi, beats)
    (0, 84, 1.5), (1.5, 81, 0.5), (2, 79, 2), (4, 83, 1.5), (5.5, 79, 0.5), (6, 76, 2),
    (8, 84, 1), (9, 88, 1), (10, 86, 1.5), (11.5, 84, 0.5), (12, 83, 3),
]

drums = np.zeros(N); music_l = np.zeros(N); music_r = np.zeros(N); duck = np.ones(N)
K, H, HO, C = kick(), hat(), hat(True), clap()

for bar in range(32):
    t0 = bar * BAR; ch = CH[bar % 4]
    intro = bar < 5; main = 5 <= bar < 28; big = 16 <= bar < 28; huge = 21 <= bar < 28; outro = bar >= 28
    # pad
    if bar < 31:
        p = fft_filter(pad(ch['pad'], BAR + 0.5), hi=1400 if intro else 2600, slope=2)
        pg = 0.75 if (intro or outro) else 0.34
        add(music_l, t0, p, pg); add(music_r, t0, np.roll(p, 180), pg)
    # arp, sixteenth notes, ping-pong
    if bar < 30:
        bright = 0.45 + 0.1 * bar if intro else (1.25 if huge else 1.0)
        for i in range(16):
            if intro and bar < 1 and i % 2: continue
            m = ch['arp'][i % 8] + (12 if huge and i % 4 == 3 else 0)
            s = pluck(m, 0.45, bright); g = (0.5 if intro else 0.26) * (1.0 if i % 4 == 0 else 0.72) * (1.5 if outro else 1)
            tt = t0 + i * BEAT / 4
            pan = 0.3 if i % 2 else 0.7
            add(music_l, tt, s, g * pan); add(music_r, tt, s, g * (1 - pan))
            for k, dg in ((1, 0.38), (2, 0.18)):  # dotted-eighth echoes
                add(music_l if (i + k) % 2 else music_r, tt + k * BEAT * 0.75, s, g * dg)
    # bass
    if main:
        pat = [0.5, 1.5, 2.5, 3.5] if bar < 9 else [0, 0.5, 1.5, 2.5, 3, 3.5]
        for b in pat:
            s = bass(ch['root'] - (0 if ch['root'] >= 41 else -12) , BEAT * 0.45)
            add(music_l, t0 + b * BEAT, s, 0.42); add(music_r, t0 + b * BEAT, s, 0.42)
    if outro and bar < 31:
        s = bass(ch['root'], BAR * 0.9); add(music_l, t0, s, 0.3); add(music_r, t0, s, 0.3)
    # drums
    if main:
        for b in range(4):
            add(drums, t0 + b * BEAT, K, 0.95)
            i = int((t0 + b * BEAT) * SR); n = int(0.3 * SR)
            if i + n < N: duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.62 * np.exp(-np.arange(n) / SR * 11))
            add(drums, t0 + (b + 0.5) * BEAT, HO if (big and b == 3) else H, 0.3)
            if bar >= 9:
                add(drums, t0 + (b + 0.25) * BEAT, H, 0.1); add(drums, t0 + (b + 0.75) * BEAT, H, 0.14)
        if bar >= 7:
            add(drums, t0 + 1 * BEAT, C, 0.42); add(drums, t0 + 3 * BEAT, C, 0.42)
        if bar % 4 == 3 and bar < 27:  # little fill
            for q in (3.5, 3.75): add(drums, t0 + q * BEAT, C, 0.25)
    # lead
    if big and bar % 4 == 0:
        for b, m, d in LEAD:
            n = int(d * BEAT * SR * 1.1); t = np.arange(n) / SR; f = hz(m)
            vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(t / 0.3, 1)
            ph = 2 * np.pi * np.cumsum(f * vib) / SR
            s = (np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.18 * np.sin(3 * ph)) * env(n, 0.02, 0.9, 0.5, 0.08)
            g = 0.13 if huge else 0.1
            add(music_l, t0 + b * BEAT, s, g); add(music_r, t0 + b * BEAT, s, g)
            add(music_r, t0 + b * BEAT + 0.375, s, g * 0.35); add(music_l, t0 + b * BEAT + 0.75, s, g * 0.2)

# transitions
for t_hit, dur in ((10.0, 2.4), (32.0, 1.6), (42.0, 1.6), (56.0, 2.0)):
    r = riser(dur); add(music_l, t_hit - dur, r, 0.16); add(music_r, t_hit - dur, np.roll(r, 90), 0.16)
for t_hit in (10.0, 32.0, 42.0, 56.0):  # downbeat impact: sub + airy crash
    n = int(2.2 * SR); t = np.arange(n) / SR
    cr = fft_filter(rng.standard_normal(n), lo=4000, slope=2) * np.exp(-t * 2.4)
    sub = np.sin(2 * np.pi * (38 + 30 * np.exp(-t * 8)) * t) * np.exp(-t * 3)
    add(music_l, t_hit, cr, 0.13); add(music_r, t_hit, np.roll(cr, 250), 0.13)
    add(drums, t_hit, sub, 0.5)
# final chord at bar 31 (62 s): Fmaj9 ringing out
for m in (41, 53, 60, 64, 67, 72, 76):
    s = pluck(m, 3.5, 1.3) * np.exp(-np.arange(int(3.5 * SR)) / SR * 0.2)
    add(music_l, 62.0, s, 0.3); add(music_r, 62.0 + 0.012, s, 0.3)
fp = fft_filter(pad([53, 57, 60, 64, 67], 4.0), hi=2200, slope=2)
add(music_l, 62.0, fp, 0.3); add(music_r, 62.0, np.roll(fp, 200), 0.3)

L = music_l * duck + drums; R = music_r * duck + drums
# simple room: a few diffuse taps
for d, g in ((0.031, 0.12), (0.053, 0.1), (0.089, 0.08), (0.137, 0.06)):
    k = int(d * SR)
    L[k:] += g * music_r[:-k]; R[k:] += g * music_l[:-k]
mix = np.stack([L, R], 1)
t = np.arange(N) / SR
mix *= (np.minimum(t / 0.6, 1) * np.clip((TOTAL - 0.2 - t) / 2.5, 0, 1))[:, None]
mix = np.tanh(mix / np.percentile(np.abs(mix), 99.9) * 1.15)
mix *= 0.89 / np.abs(mix).max()
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', TOTAL)
