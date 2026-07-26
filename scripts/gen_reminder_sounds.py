import wave
import math
import struct
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "assets", "sounds")
os.makedirs(ROOT, exist_ok=True)


def synth(path, notes, gap=0.08, sr=44100, vol=0.38):
    samples = []
    for i, (freq, dur) in enumerate(notes):
        n = int(sr * dur)
        for t in range(n):
            x = t / sr
            attack = min(1.0, x / 0.02)
            release = min(1.0, (dur - x) / 0.08)
            env = attack * release
            s = math.sin(2 * math.pi * freq * x)
            s += 0.25 * math.sin(2 * math.pi * freq * 2 * x)
            s += 0.08 * math.sin(2 * math.pi * freq * 3 * x)
            samples.append(s * env * vol)
        if i < len(notes) - 1:
            samples.extend([0.0] * int(sr * gap))
    samples.extend([0.0] * int(sr * 0.12))
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = b"".join(
            struct.pack("<h", max(-32767, min(32767, int(v * 32767))))
            for v in samples
        )
        w.writeframes(frames)
    print(path, os.path.getsize(path))


# Warm soft chime: G4 -> C5
synth(
    os.path.join(ROOT, "chime.wav"),
    [(392.0, 0.32), (523.25, 0.42)],
)

# Milder alert, mid tones
synth(
    os.path.join(ROOT, "alert.wav"),
    [(440.0, 0.22), (349.23, 0.22), (440.0, 0.35)],
    vol=0.42,
)

print("ok")
