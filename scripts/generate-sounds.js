const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 22050;
const OUT_DIR = path.join(__dirname, '..', 'assets', 'sounds');

function writeWav(filePath, samples) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    buffer.writeInt16LE(v, 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function generateTone(freq, durationSec, amplitude, envelope) {
  const n = Math.floor(durationSec * SAMPLE_RATE);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const env = envelope ? envelope(i, n, t) : 1;
    out[i] = Math.sin(2 * Math.PI * freq * t) * amplitude * env;
  }
  return out;
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Float64Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function silence(durationSec) {
  return new Float64Array(Math.floor(durationSec * SAMPLE_RATE));
}

function softEnvelope(i, n) {
  const attack = Math.min(1, i / (n * 0.08));
  const release = Math.min(1, (n - i) / (n * 0.25));
  return attack * release;
}

const chime = concat(
  generateTone(880, 0.28, 0.12, (i, n) => softEnvelope(i, n)),
  silence(0.04),
  generateTone(1175, 0.28, 0.12, (i, n) => softEnvelope(i, n))
);

function beepEnv(i, n) {
  const attack = Math.min(1, i / (n * 0.05));
  const release = Math.min(1, (n - i) / (n * 0.2));
  return attack * release;
}
const beep = generateTone(1000, 0.12, 0.35, beepEnv);
const alert = concat(beep, silence(0.08), beep, silence(0.08), beep);

fs.mkdirSync(OUT_DIR, { recursive: true });
const chimePath = path.join(OUT_DIR, 'chime.wav');
const alertPath = path.join(OUT_DIR, 'alert.wav');
writeWav(chimePath, chime);
writeWav(alertPath, alert);

for (const fp of [chimePath, alertPath]) {
  const st = fs.statSync(fp);
  console.log(fp + ': ' + st.size + ' bytes');
  if (st.size <= 1000) {
    console.error('FAIL: file too small: ' + fp);
    process.exit(1);
  }
}
console.log('OK: both files exist and > 1000 bytes');