let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export function playBeep(frequency = 800, duration = 150) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = frequency;
  gain.gain.value = 0.3;
  osc.start();
  osc.stop(ctx.currentTime + duration / 1000);
}

export function playSuccess() { playBeep(800, 150); }
export function playError() { playBeep(300, 400); }
export function playWarning() { playBeep(500, 250); }
