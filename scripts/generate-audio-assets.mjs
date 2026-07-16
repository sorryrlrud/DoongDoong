import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SAMPLE_RATE = 22_050;
const OUTPUT_DIRECTORY = resolve("public/assets/audio");

const clamp = (value) => Math.max(-1, Math.min(1, value));

const writeWave = (name, duration, sampleAt) => {
  const sampleCount = Math.ceil(duration * SAMPLE_RATE);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(Math.round(clamp(sampleAt(index / SAMPLE_RATE, duration, index, sampleCount)) * 32_767), 44 + index * 2);
  }

  const path = resolve(OUTPUT_DIRECTORY, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
};

const seededNoise = (index, seed) => {
  let value = index + seed * 7_919;
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  value ^= value >>> 15;
  return ((value >>> 0) / 4_294_967_295) * 2 - 1;
};

const filteredNoise = (index, sampleCount, seed = 1, width = 16) => {
  let value = 0;
  for (let offset = 0; offset < width; offset += 1) {
    value += seededNoise((index - offset + sampleCount) % sampleCount, seed);
  }
  return value / Math.sqrt(width * 3.2);
};

writeWave("ocean-ambience.wav", 12, (time, duration, index, sampleCount) => {
  const swell = 0.38 + 0.15 * Math.sin(2 * Math.PI * time / duration) + 0.08 * Math.sin(4 * Math.PI * time / duration);
  const wash = filteredNoise(index, sampleCount, 1, 48) * 0.52 + filteredNoise(index, sampleCount, 4, 9) * 0.22;
  return wash * swell;
});

writeWave("seagull.wav", 1.25, (time) => {
  const call = (start, length, high, low) => {
    if (time < start || time > start + length) return 0;
    const progress = (time - start) / length;
    const envelope = Math.sin(Math.PI * progress) ** 1.4;
    const frequency = high + (low - high) * Math.sin(Math.PI * progress);
    return Math.sin(2 * Math.PI * frequency * (time - start) + 2.8 * Math.sin(progress * Math.PI * 5)) * envelope;
  };
  return call(0.04, 0.43, 1_480, 760) * 0.62 + call(0.57, 0.48, 1_260, 690) * 0.52;
});

writeWave("incoming-wave.wav", 2.6, (time, duration, index, sampleCount) => {
  const progress = time / duration;
  const envelope = Math.sin(Math.PI * progress) ** 0.8;
  const foam = filteredNoise(index, sampleCount, 7, 12) + filteredNoise(index, sampleCount, 10, 3) * 0.45;
  return foam * envelope * (0.34 + progress * 0.18);
});

writeWave("splash.wav", 1.15, (time, duration, index, sampleCount) => {
  const progress = time / duration;
  const impact = Math.exp(-progress * 8) * Math.sin(2 * Math.PI * (155 - 90 * progress) * time);
  const spray = filteredNoise(index, sampleCount, 13, 4) * Math.exp(-progress * 4.2);
  return impact * 0.55 + spray * 0.7;
});
