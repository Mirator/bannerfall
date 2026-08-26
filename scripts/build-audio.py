"""Build the shipped audio set in assets/audio/ from CC0 sources plus local synthesis.

Two kinds of file come out of this script:

  * conversions  — a CC0 source file (Kenney pack, OpenGameArt upload) decoded to
                   mono/stereo 44.1 kHz, silence-trimmed, peak-normalised and re-encoded
                   to Vorbis. The source packs are NOT vendored; download them yourself
                   (see assets/audio/SOURCES.md) and point --sources at the folder holding
                   the extracted files, keeping their original names.
  * synthesis    — horns, bow release, hoof fall and the victory/defeat stingers, rendered
                   here from scratch. No CC0 pack had a war horn or a bowstring that fit,
                   and anything generated in this file is original work placed in the
                   public domain along with the rest of the repository's assets.

Every SFX file is normalised to the same peak (SFX_PEAK_DB) on purpose: the mix balance
between events lives in the gain table in src/audio.js, where it is readable and tunable,
not baked invisibly into the files.

Requires: python 3, numpy, ffmpeg on PATH. Nothing here runs at build or play time — the
repository ships the rendered .ogg files and has no build step.

Usage:
    python scripts/build-audio.py --sources /path/to/downloaded-cc0-files
    python scripts/build-audio.py --synth-only
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

SR = 44100
SFX_PEAK_DB = -3.0
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "audio")

# ---------------------------------------------------------------- conversions
# out name -> (source file name, channels, vorbis quality, kind)
# kind is "sfx" (hard trim, peak to SFX_PEAK_DB) or "music" (loose trim, peak to -1 dB).
CONVERSIONS = {
    # combat — Kenney "Impact Sounds" and "RPG Audio", both CC0
    "swing.ogg": ("knifeSlice2.ogg", 1, 4, "sfx"),
    "hit-1.ogg": ("impactPlate_medium_000.ogg", 1, 4, "sfx"),
    "hit-2.ogg": ("impactPlate_medium_002.ogg", 1, 4, "sfx"),
    "hit-3.ogg": ("impactMetal_light_001.ogg", 1, 4, "sfx"),
    "kill-1.ogg": ("impactSoft_heavy_000.ogg", 1, 4, "sfx"),
    "kill-2.ogg": ("impactSoft_heavy_003.ogg", 1, 4, "sfx"),
    "hurt.ogg": ("impactPunch_heavy_001.ogg", 1, 4, "sfx"),
    "brute.ogg": ("impactWood_heavy_002.ogg", 1, 4, "sfx"),
    "dash.ogg": ("cloth3.ogg", 1, 4, "sfx"),
    # world / UI
    "coin.ogg": ("handleCoins.ogg", 1, 4, "sfx"),
    "ui-move.ogg": ("rollover2.ogg", 1, 4, "sfx"),
    "ui-select.ogg": ("switch2.ogg", 1, 4, "sfx"),
    # music — OpenGameArt, RandomMind, CC0. Stereo, lower quality setting: these are
    # by far the largest files in the game and 96 kbps Vorbis is transparent enough
    # for a background loop. Neither source is authored as a gapless loop — both carry
    # a second of dead air at one end — so the music trim removes that silence and the
    # loop seam becomes the composer's own fade-out meeting the fade-in, which reads as
    # a breath between repeats rather than a click.
    "music-campaign.ogg": ("Exploration.wav", 2, 2, "music"),
    "music-battle.ogg": ("battle_1.wav", 2, 2, "music"),
}


def run(cmd):
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr.decode("utf8", "replace"))
        raise SystemExit(f"command failed: {' '.join(cmd)}")
    return result


def decode(path, channels):
    """Decode any ffmpeg-readable file to a float32 array shaped (frames, channels)."""
    result = run([
        "ffmpeg", "-v", "error", "-i", path,
        "-f", "f32le", "-acodec", "pcm_f32le",
        "-ac", str(channels), "-ar", str(SR), "-",
    ])
    data = np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)
    return data.reshape(-1, channels)


def encode(samples, path, quality):
    """Encode a (frames, channels) float array to Vorbis."""
    channels = samples.shape[1]
    clipped = np.clip(samples, -1.0, 1.0).astype("<f4")
    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as handle:
        handle.write(clipped.tobytes())
        raw = handle.name
    try:
        run([
            "ffmpeg", "-v", "error", "-y",
            "-f", "f32le", "-ar", str(SR), "-ac", str(channels), "-i", raw,
            "-c:a", "libvorbis", "-q:a", str(quality), path,
        ])
    finally:
        os.unlink(raw)


def trim_silence(samples, floor_db=-55.0, pad=0.004):
    """Drop leading/trailing near-silence so a one-shot fires the instant it is triggered."""
    level = np.max(np.abs(samples), axis=1)
    threshold = 10 ** (floor_db / 20.0)
    loud = np.flatnonzero(level > threshold)
    if loud.size == 0:
        return samples
    pad_n = int(pad * SR)
    start = max(0, loud[0] - pad_n)
    end = min(samples.shape[0], loud[-1] + pad_n)
    return samples[start:end]


def normalize(samples, peak_db=SFX_PEAK_DB):
    peak = float(np.max(np.abs(samples)))
    if peak <= 0:
        return samples
    return samples * (10 ** (peak_db / 20.0) / peak)


def fade_edges(samples, ms=3.0):
    """A few ms of fade at both ends: a hard edge on a trimmed one-shot clicks."""
    n = min(int(ms * SR / 1000.0), samples.shape[0] // 2)
    if n <= 1:
        return samples
    ramp = np.linspace(0.0, 1.0, n)[:, None]
    samples[:n] *= ramp
    samples[-n:] *= ramp[::-1]
    return samples


# ---------------------------------------------------------------- synthesis helpers
def rng(seed):
    return np.random.default_rng(seed)


def adsr(n, attack, decay, sustain_level=0.0, release=0.0):
    """Simple linear attack into an exponential decay, sample count `n`."""
    env = np.zeros(n)
    a = min(n, int(attack * SR))
    if a > 0:
        env[:a] = np.linspace(0.0, 1.0, a)
    tail = n - a
    if tail > 0:
        t = np.arange(tail) / SR
        env[a:] = np.exp(-t / max(decay, 1e-4)) * (1 - sustain_level) + sustain_level
    if release > 0:
        r = min(n, int(release * SR))
        env[-r:] *= np.linspace(1.0, 0.0, r)
    return env


def onepole_lowpass(x, cutoff):
    """Cheap one-pole low pass; cutoff may be a scalar or a per-sample array."""
    alpha = np.atleast_1d(1.0 - np.exp(-2.0 * np.pi * np.asarray(cutoff, dtype=float) / SR))
    if alpha.size == 1:
        alpha = np.full(x.shape[0], alpha[0])
    out = np.empty_like(x)
    acc = 0.0
    for i in range(x.shape[0]):
        acc += alpha[i] * (x[i] - acc)
        out[i] = acc
    return out


def highpass(x, cutoff):
    return x - onepole_lowpass(x, cutoff)


def fft_convolve(x, ir):
    n = 1 << int(np.ceil(np.log2(x.size + ir.size - 1)))
    out = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)
    return out[: x.size + ir.size - 1]


def reverb(x, seconds=1.1, mix=0.28, seed=7):
    """Small stone-hall tail: exponentially decaying noise as an impulse response."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng(seed).normal(0, 1, n) * np.exp(-t * (5.5 / seconds))
    ir[: int(0.006 * SR)] = 0.0  # pre-delay, so the dry transient stays in front
    ir = onepole_lowpass(ir, 2600.0)
    ir /= np.max(np.abs(ir)) or 1.0
    wet = fft_convolve(x, ir)
    out = np.zeros(wet.size)
    out[: x.size] += x * (1 - mix)
    out += wet * mix * 0.35
    return out


def horn_voice(freq, seconds, brightness=1.0, seed=1):
    """A buisine/war-horn tone: additive harmonics, breath noise, slow brassy bloom."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    vibrato = 1.0 + 0.004 * np.sin(2 * np.pi * 4.7 * t) * np.clip((t - 0.25) * 3, 0, 1)
    phase_base = 2 * np.pi * freq * np.cumsum(vibrato) / SR
    body = np.zeros(n)
    for h in range(1, 15):
        if freq * h > 9000:
            break
        amp = brightness ** (h - 1) / (h ** 1.25)
        # higher partials bloom in later — that late brightness is what reads as brass
        bloom = np.clip((t - 0.02 * (h - 1)) * 14, 0, 1)
        body += amp * np.sin(phase_base * h + h * 0.7) * bloom
    # a bell-mouth roll-off: without it the additive stack keeps far too much energy above
    # 4 kHz and the horn reads as a buzzy saw rather than a wound brass tube
    body = onepole_lowpass(body, 3600.0)
    body /= np.max(np.abs(body)) or 1.0
    breath = highpass(rng(seed).normal(0, 1, n), 1200.0) * 0.022
    env = adsr(n, attack=0.045, decay=seconds * 0.55, release=0.12)
    return (body + breath) * env


def drum_hit(seconds=0.9, tone=78.0, seed=3):
    """Frame drum: a pitched membrane thump plus a skin-noise transient."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    pitch = tone * (1.0 + 0.9 * np.exp(-t * 45))
    body = np.sin(2 * np.pi * np.cumsum(pitch) / SR) * np.exp(-t * 7.5)
    skin = onepole_lowpass(rng(seed).normal(0, 1, n), 1800.0) * np.exp(-t * 30) * 0.6
    return body + skin


# ---------------------------------------------------------------- synthesised sounds
def synth_horn(freq, seed):
    x = horn_voice(freq, 1.15, brightness=0.86, seed=seed)
    return reverb(x, seconds=1.0, mix=0.3, seed=seed + 20)


def synth_bow():
    """Bowstring release: string snap, then the shaft leaving the bow."""
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    snap_pitch = 320 * np.exp(-t * 26) + 130
    snap = np.sin(2 * np.pi * np.cumsum(snap_pitch) / SR) * np.exp(-t * 32)
    creak = highpass(rng(11).normal(0, 1, n), 2400.0) * np.exp(-t * 45) * 0.8
    # the arrow: a band of noise sweeping down as it leaves, i.e. a short doppler tail
    whoosh_cut = 5200 * np.exp(-t * 5.5) + 700
    whoosh = onepole_lowpass(rng(12).normal(0, 1, n), whoosh_cut)
    whoosh = highpass(whoosh, 500.0) * np.exp(-t * 7.5) * 0.55
    return snap * 0.9 + creak + whoosh


def synth_hoof(seed):
    """One hoof fall on packed earth: a hard click over a short, damped body."""
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    click = highpass(rng(seed).normal(0, 1, n), 2600.0) * np.exp(-t * 220)
    body_pitch = 260 * np.exp(-t * 60) + 96
    body = np.sin(2 * np.pi * np.cumsum(body_pitch) / SR) * np.exp(-t * 42) * 0.7
    earth = onepole_lowpass(rng(seed + 5).normal(0, 1, n), 900.0) * np.exp(-t * 55) * 0.5
    return click + body + earth


def synth_victory():
    """Rising horn fanfare over two drum strokes — roughly two and a half seconds."""
    total = int(3.0 * SR)
    out = np.zeros(total)
    # G3 - C4 - E4 - G4, the last note held
    notes = [(196.00, 0.00, 0.45), (261.63, 0.30, 0.45), (329.63, 0.60, 0.5), (392.00, 0.92, 1.7)]
    for i, (freq, at, dur) in enumerate(notes):
        voice = horn_voice(freq, dur, brightness=0.9, seed=30 + i)
        # a fifth underneath the final note turns the fanfare into a chord, not a line
        if i == len(notes) - 1:
            voice = voice + 0.5 * horn_voice(freq * 0.6674, dur, brightness=0.85, seed=40)
        start = int(at * SR)
        end = min(total, start + voice.size)
        out[start:end] += voice[: end - start] * 0.8
    for at, level in [(0.0, 0.9), (0.92, 1.0)]:
        hit = drum_hit(1.2, tone=72.0, seed=int(at * 100) + 2)
        start = int(at * SR)
        end = min(total, start + hit.size)
        out[start:end] += hit[: end - start] * level * 0.55
    return reverb(out, seconds=1.4, mix=0.3, seed=99)


def synth_defeat():
    """Two low horns falling a semitone, under a single slack drum."""
    total = int(3.4 * SR)
    out = np.zeros(total)
    for i, (freq, at, dur) in enumerate([(146.83, 0.0, 1.5), (138.59, 0.85, 2.0)]):
        voice = horn_voice(freq, dur, brightness=0.78, seed=60 + i)
        voice = voice + 0.6 * horn_voice(freq * 0.5, dur, brightness=0.7, seed=70 + i)
        start = int(at * SR)
        end = min(total, start + voice.size)
        out[start:end] += voice[: end - start] * 0.75
    hit = drum_hit(1.6, tone=58.0, seed=8)
    out[: hit.size] += hit * 0.6
    return reverb(out, seconds=1.8, mix=0.34, seed=101)


SYNTHESISED = {
    "horn-low.ogg": lambda: synth_horn(98.0, 1),
    "horn-mid.ogg": lambda: synth_horn(174.61, 2),
    "horn-high.ogg": lambda: synth_horn(261.63, 3),
    "bow.ogg": synth_bow,
    "gallop-1.ogg": lambda: synth_hoof(21),
    "gallop-2.ogg": lambda: synth_hoof(22),
    "victory.ogg": synth_victory,
    "defeat.ogg": synth_defeat,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", help="folder holding the downloaded CC0 source files")
    parser.add_argument("--synth-only", action="store_true")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg is required and was not found on PATH")
    os.makedirs(OUT_DIR, exist_ok=True)

    if not args.synth_only:
        if not args.sources:
            raise SystemExit("--sources is required unless --synth-only is given")
        for out_name, (src_name, channels, quality, kind) in CONVERSIONS.items():
            src = os.path.join(args.sources, src_name)
            if not os.path.exists(src):
                raise SystemExit(f"missing source file {src} (see assets/audio/SOURCES.md)")
            samples = decode(src, channels)
            if kind == "music":
                samples = trim_silence(samples, floor_db=-50.0, pad=0.15)
                samples = normalize(fade_edges(samples, ms=40.0), peak_db=-1.0)
            else:
                samples = normalize(fade_edges(trim_silence(samples), ms=3.0))
            dest = os.path.join(OUT_DIR, out_name)
            encode(samples, dest, quality)
            print(f"{out_name:24s} {samples.shape[0] / SR:6.2f}s  {os.path.getsize(dest):8d} B  <- {src_name}")

    for out_name, make in SYNTHESISED.items():
        # normalise AFTER the edge fade, not before: a hoof fall or a bow snap peaks in its
        # first millisecond, so fading last would quietly scoop the loudest sample out of
        # the file and leave the sound several dB under everything else in the set.
        samples = normalize(fade_edges(np.asarray(make(), dtype=float)[:, None], ms=1.0))
        dest = os.path.join(OUT_DIR, out_name)
        encode(samples, dest, 4)
        print(f"{out_name:24s} {samples.shape[0] / SR:6.2f}s  {os.path.getsize(dest):8d} B  <- synthesised")


if __name__ == "__main__":
    main()
