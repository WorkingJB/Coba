// Every sound is synthesized, so the game ships no audio files. The context
// is created on the first call, which always follows a click or key press.
let context: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem("coba.muted") === "1";
} catch {
  // Storage can be unavailable; sound simply starts on.
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}
function tone(
  from: number,
  to: number,
  seconds: number,
  type: OscillatorType = "sine",
  level = 0.06,
  delay = 0,
) {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + seconds);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + seconds + 0.02);
}
function burst(seconds: number, level = 0.08, cutoff = 900) {
  const ctx = audio();
  if (!ctx) return;
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++)
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.value = level;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
}

const SOUNDS = {
  pick: () => tone(660, 720, 0.05, "triangle", 0.04),
  place: () => tone(300, 180, 0.09, "square", 0.035),
  remove: () => tone(240, 320, 0.06, "triangle", 0.03),
  deny: () => tone(140, 110, 0.14, "sawtooth", 0.03),
  lock: () => {
    tone(220, 220, 0.08, "square", 0.04);
    tone(440, 440, 0.12, "square", 0.04, 0.09);
  },
  reveal: () => tone(180, 520, 0.35, "sine", 0.05),
  deploy: () => {
    tone(90, 55, 0.3, "sine", 0.12);
    burst(0.12, 0.04, 500);
  },
  amplify: () => {
    tone(330, 660, 0.22, "triangle", 0.05);
    tone(495, 990, 0.22, "triangle", 0.035, 0.08);
  },
  strike: () => {
    burst(0.4, 0.11, 1400);
    tone(160, 40, 0.35, "sawtooth", 0.05);
  },
  control: () => tone(520, 780, 0.14, "sine", 0.05),
  secure: () =>
    [392, 494, 587, 784].forEach((f, i) =>
      tone(f, f, 0.3, "triangle", 0.05, i * 0.07),
    ),
  win: () =>
    [392, 523, 659, 784, 1047].forEach((f, i) =>
      tone(f, f, 0.4, "triangle", 0.06, i * 0.11),
    ),
  lose: () =>
    [330, 262, 208, 165].forEach((f, i) =>
      tone(f, f * 0.97, 0.5, "sine", 0.06, i * 0.16),
    ),
} satisfies Record<string, () => void>;
export type SoundName = keyof typeof SOUNDS;

export function play(name: SoundName) {
  SOUNDS[name]();
}
export function isMuted() {
  return muted;
}
export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem("coba.muted", value ? "1" : "0");
  } catch {
    // Not persisted; still applies for this visit.
  }
}
