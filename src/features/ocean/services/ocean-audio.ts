type BrowserAudioContext = AudioContext;

let audioContext: BrowserAudioContext | null = null;
let ambientSource: AudioBufferSourceNode | null = null;
let ambientStart: Promise<void> | null = null;

const getAudioContext = (): BrowserAudioContext | null => {
  if (typeof window === "undefined") return null;

  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return null;

  audioContext ??= new AudioContextConstructor();
  return audioContext;
};

const createOceanBuffer = (context: BrowserAudioContext) => {
  const duration = 12;
  const frameCount = context.sampleRate * duration;
  const buffer = context.createBuffer(2, frameCount, context.sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let rollingNoise = 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / context.sampleRate;
      const swell = 0.28
        + 0.22 * Math.sin((Math.PI * 2 * time) / 5.8 + channel * 0.7)
        + 0.12 * Math.sin((Math.PI * 2 * time) / 2.9);
      rollingNoise = rollingNoise * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[frame] = rollingNoise * Math.max(0.08, swell);
    }
  }

  return buffer;
};

const resumeContext = async () => {
  const context = getAudioContext();
  if (!context) return null;
  if (context.state === "suspended") await context.resume();
  return context.state === "running" ? context : null;
};

export const startOceanAmbience = () => {
  if (ambientSource) return Promise.resolve();
  if (ambientStart) return ambientStart;

  ambientStart = (async () => {
    const context = await resumeContext();
    if (!context || ambientSource) return;

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = createOceanBuffer(context);
    source.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 780;
    filter.Q.value = 0.45;
    gain.gain.value = 0.42;

    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    ambientSource = source;
  })().finally(() => {
    ambientStart = null;
  });

  return ambientStart;
};

const withRunningContext = (play: (context: BrowserAudioContext, now: number) => void) => {
  void startOceanAmbience().then(() => {
    const context = getAudioContext();
    if (context?.state === "running") play(context, context.currentTime);
  });
};

export const playSeagullCall = () => {
  withRunningContext((context, now) => {
    [0, 0.19].forEach((delay, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + delay;

      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(index === 0 ? 1_450 : 1_220, start);
      oscillator.frequency.exponentialRampToValueAtTime(index === 0 ? 820 : 710, start + 0.16);
      oscillator.frequency.exponentialRampToValueAtTime(index === 0 ? 1_080 : 900, start + 0.31);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.36);
    });
  });
};

const playNoiseEffect = (
  context: BrowserAudioContext,
  now: number,
  options: { duration: number; frequency: number; volume: number; rise: number },
) => {
  const frameCount = Math.ceil(context.sampleRate * options.duration);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let frame = 0; frame < frameCount; frame += 1) {
    data[frame] = Math.random() * 2 - 1;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(options.frequency, now);
  filter.frequency.exponentialRampToValueAtTime(180, now + options.duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(options.volume, now + options.rise);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(now);
  source.stop(now + options.duration);
};

export const playIncomingWave = () => {
  withRunningContext((context, now) => {
    playNoiseEffect(context, now, { duration: 2.4, frequency: 1_100, volume: 0.28, rise: 0.65 });
  });
};

export const playSplash = () => {
  withRunningContext((context, now) => {
    playNoiseEffect(context, now, { duration: 0.95, frequency: 2_400, volume: 0.34, rise: 0.045 });

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(170, now);
    oscillator.frequency.exponentialRampToValueAtTime(58, now + 0.5);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.58);
  });
};
