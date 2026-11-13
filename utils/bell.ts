// A synthesised bell (no audio file needed). The schedule is pure so it can be
// unit tested; playBell turns it into Web Audio calls.

export type BellNote = {
  /** Seconds from the start of the sound. */
  start: number;
  freq: number;
  gain: number;
  /** Seconds the note takes to fade out. */
  duration: number;
};

// A struck bell is a few inharmonic partials that die away at different rates.
const PARTIALS = [
  { freq: 880, gain: 0.5, duration: 2.2 },
  { freq: 2217, gain: 0.25, duration: 1.4 },
  { freq: 3520, gain: 0.12, duration: 0.9 },
];

/** Notes for `strikes` bell strikes, `gap` seconds apart. */
export function bellSchedule(strikes = 3, gap = 1.2): BellNote[] {
  const notes: BellNote[] = [];
  for (let s = 0; s < strikes; s++) {
    for (const p of PARTIALS) notes.push({ start: s * gap, ...p });
  }
  return notes;
}

/** Total length of the sound in seconds. */
export function bellLength(notes: BellNote[]): number {
  return Math.max(0, ...notes.map((n) => n.start + n.duration));
}

/** Play the bell on an AudioContext. Returns how many seconds it lasts. */
export function playBell(ctx: AudioContext, notes: BellNote[] = bellSchedule()): number {
  const t0 = ctx.currentTime + 0.05;
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = n.freq;
    const at = t0 + n.start;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(n.gain, at + 0.01); // sharp strike
    amp.gain.exponentialRampToValueAtTime(0.0001, at + n.duration); // ring out
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + n.duration + 0.05);
  }
  return bellLength(notes) + 0.1;
}
