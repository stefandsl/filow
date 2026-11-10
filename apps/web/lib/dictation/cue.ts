// A short, quiet tone when dictation starts (higher) and stops (lower): an audible cue for people who
// use a screen reader or are not looking at the screen. Off unless the Dictation setting turns it on.
let ctx: AudioContext | null = null;

export function playCue(start: boolean): void {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = start ? 660 : 440;
    // Soft attack and release, no click; about a tenth of a second, at a low volume.
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.06, t + 0.015);
    gain.gain.linearRampToValueAtTime(0, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  } catch {
    /* no audio output: the cue is only a help */
  }
}
