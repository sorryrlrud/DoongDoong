const AUDIO_PATHS = {
  ocean: `${import.meta.env.BASE_URL}assets/audio/ocean-ambience.wav`,
  seagull: `${import.meta.env.BASE_URL}assets/audio/seagull.wav`,
  incomingWave: `${import.meta.env.BASE_URL}assets/audio/incoming-wave.wav`,
  splash: `${import.meta.env.BASE_URL}assets/audio/splash.wav`,
} as const;

type SoundName = keyof typeof AUDIO_PATHS;

let audioContext: AudioContext | null = null;
let loadPromise: Promise<Map<SoundName, AudioBuffer>> | null = null;
let oceanSource: AudioBufferSourceNode | null = null;

const getAudioContext = () => {
  if (typeof window === "undefined") return null;
  audioContext ??= new window.AudioContext();
  return audioContext;
};

const loadSounds = (context: AudioContext) => {
  loadPromise ??= Promise.all(
    Object.entries(AUDIO_PATHS).map(async ([name, path]) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`음원 파일을 불러오지 못했습니다: ${path}`);
      return [name as SoundName, await context.decodeAudioData(await response.arrayBuffer())] as const;
    }),
  ).then((entries) => new Map(entries));
  return loadPromise;
};

const startOceanWhenReady = (context: AudioContext) => {
  if (oceanSource) return;
  void loadSounds(context).then((sounds) => {
    if (context.state !== "running" || oceanSource) return;
    const buffer = sounds.get("ocean");
    if (!buffer) return;

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0.48;
    source.connect(gain).connect(context.destination);
    source.start();
    oceanSource = source;
  }).catch(() => undefined);
};

export const unlockOceanAudio = () => {
  const context = getAudioContext();
  if (!context) return;

  // resume() must be invoked directly inside the user's touch/click handler on
  // mobile browsers. Do not move it behind an awaited promise.
  const resumed = context.state === "suspended" ? context.resume() : Promise.resolve();
  void loadSounds(context).catch(() => undefined);
  void resumed.then(() => startOceanWhenReady(context)).catch(() => undefined);
};

export const startOceanAmbience = () => {
  const context = getAudioContext();
  if (!context) return;
  void loadSounds(context).catch(() => undefined);
  if (context.state === "running") startOceanWhenReady(context);
  else unlockOceanAudio();
};

const playSound = (name: Exclude<SoundName, "ocean">, volume: number) => {
  const context = getAudioContext();
  if (!context) return;
  unlockOceanAudio();

  void loadSounds(context).then((sounds) => {
    if (context.state !== "running") return;
    const buffer = sounds.get(name);
    if (!buffer) return;

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(context.destination);
    source.start();
  }).catch(() => undefined);
};

export const playSeagullCall = () => playSound("seagull", 0.72);
export const playIncomingWave = () => playSound("incomingWave", 0.82);
export const playSplash = () => playSound("splash", 0.86);
