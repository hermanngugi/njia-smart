const MUTE_KEY = "njia_sound_muted";

let ctx: AudioContext | null = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function isSoundMuted() {
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setSoundMuted(muted: boolean) {
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

/** Short two-tone chime for an incoming notification/chat message. */
export function playNotificationSound() {
  if (isSoundMuted()) return;
  try {
    const c = getCtx();
    const now = c.currentTime;
    [[880, now, 0.09], [660, now + 0.09, 0.12]].forEach(([freq, start, dur]) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq as number;
      gain.gain.setValueAtTime(0.001, start as number);
      gain.gain.exponentialRampToValueAtTime(0.15, (start as number) + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, (start as number) + (dur as number));
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(start as number);
      osc.stop((start as number) + (dur as number) + 0.02);
    });
  } catch {
    // Audio can fail before any user gesture has unlocked it — non-fatal.
  }
}

/** Distinct, attention-grabbing alarm for a newly raised ICT Service Desk request. */
export function playIctRequestSound(critical = false) {
  if (isSoundMuted()) return;
  try {
    const c = getCtx();
    const now = c.currentTime;
    // A recognisably different three-pulse rising alarm; critical requests repeat once more.
    const pulses: Array<[number, number, number]> = critical
      ? [[740, 0, 0.13], [990, 0.16, 0.13], [740, 0.32, 0.13], [990, 0.48, 0.18], [740, 0.78, 0.13], [990, 0.94, 0.13], [740, 1.10, 0.13], [990, 1.26, 0.18]]
      : [[740, 0, 0.13], [990, 0.16, 0.13], [740, 0.32, 0.13], [990, 0.48, 0.18]];

    for (const [frequency, offset, duration] of pulses) {
      const start = now + offset;
      const oscillator = c.createOscillator();
      const gain = c.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(critical ? 0.22 : 0.16, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain);
      gain.connect(c.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    }
  } catch {
    // Audio can be blocked until the user interacts with the page; notifications still appear.
  }
}
