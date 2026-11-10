"""The film's soundtrack: the licensed track cut as cinetic's track.py planned it (work/audio/music/*.edit.json),
a click on every click the picture shows and a short swish on the two big scene changes (earshot's sound bank),
the sub trimmed, mastered to about -14 LUFS with the true peak under -1.5 dB.
  <python with numpy, soundfile, pyloudnorm> demo/sound.py <work dir> <track file> <out.wav>
The picture's cue times come from work/cues.json, which demo/film.mjs writes."""
import glob, json, os, subprocess, sys
import numpy as np, soundfile as sf, pyloudnorm as pyln

work, track, out = sys.argv[1:4]
SR = 48000
def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
edit = json.load(open(glob.glob(os.path.join(work, "audio/music/*.edit.json"))[0]))
cues = json.load(open(os.path.join(work, "cues.json")))
src, n = decode(track), int(cues["length"] * SR)
music = np.zeros((n, 2))
segs = edit["segments"]
for i, seg in enumerate(segs):
    join = seg.get("join") or {}
    pre = join.get("pre_ms", 0) / 1000 if i else seg["film_s"]          # the first piece also plays the pickup before bar 1
    a = int((seg["src_from"] - pre) * SR)
    last = i == len(segs) - 1
    tail = (segs[i + 1].get("join") or {}).get("tail_ms", 0) / 1000 if not last else 0
    b = len(src) if last else int((seg["src_to"] + tail) * SR)
    piece = src[a:b].copy()
    if i: piece[: int(pre * SR)] *= np.linspace(0, 1, int(pre * SR))[:, None]
    if tail: piece[-int(tail * SR):] *= np.linspace(1, 0, int(tail * SR))[:, None] ** 2
    at = int((seg["film_s"] - pre) * SR)
    piece = piece[: max(0, n - at)]
    music[at : at + len(piece)] += piece
music[: int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))[:, None]
# One stop-down: the music drops out for a third of a second before the page goes dark and is back on the click.
if cues.get("stop"):
    t1 = int(cues["stop"] * SR); t0 = t1 - int(0.34 * SR); ramp = int(0.05 * SR); back = int(0.006 * SR)
    env = np.ones(n); low = 10 ** (-14 / 20)
    env[t0 : t0 + ramp] = np.linspace(1, low, ramp); env[t0 + ramp : t1 - back] = low; env[t1 - back : t1] = np.linspace(low, 1, back)
    music *= env[:, None]
fade = int(0.6 * SR)
music[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2                    # the track's own ring-out, let go with the picture

def place(mix, sound, t, gain_db, lead=0.0):
    at = int((t - lead) * SR)
    if at < 0 or at >= len(mix): return
    s = sound[: len(mix) - at] * 10 ** (gain_db / 20)
    mix[at : at + len(s)] += s
def load(name):
    x, sr = sf.read(os.path.join(work, "audio/sfx", name), always_2d=True)
    assert sr == SR, (name, sr)
    return np.repeat(x, 2, axis=1) if x.shape[1] == 1 else x
fx = np.zeros((n, 2))
click, swish = load("click.wav"), load("swish.wav")
peak = lambda x: 20 * np.log10(np.max(np.abs(x)) + 1e-12)
# A click rides a few dB over the music around it, so it reads in the loud bars without poking out of the quiet ones.
for t in cues["clicks"]:
    bed = music[max(0, int((t - 0.3) * SR)) : int(t * SR)]
    bed_db = 20 * np.log10(np.sqrt(np.mean(bed ** 2)) + 1e-9)
    place(fx, click, t, min(-3.0, bed_db + 13.0) - peak(click), lead=0.004)
swish_peak = int(np.argmax(np.abs(swish).max(axis=1))) / SR
for t in (cues["open"], cues["close"]): place(fx, swish, t, -9.0 - peak(swish), lead=swish_peak)
mix = music + fx
meter = pyln.Meter(SR)
mix *= 10 ** ((-14.0 - meter.integrated_loudness(mix)) / 20)
# The loud bars sit above the -14 target's headroom: a limiter holds the true peak under -1.5 dB.
raw = out.replace(".wav", ".raw.wav")
sf.write(raw, mix, SR, subtype="FLOAT")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-af", "highpass=f=36,bass=g=-4:f=52:width_type=q:w=0.8,alimiter=limit=0.78:attack=4:release=60:level=false", "-c:a", "pcm_s24le", out], check=True)
os.remove(raw)
mix, _ = sf.read(out, always_2d=True)
print(f"music {len(segs)} pieces, {len(cues['clicks'])} clicks, 2 swishes -> {out}: {meter.integrated_loudness(mix):.1f} LUFS, sample peak {peak(mix):.1f} dBFS")
