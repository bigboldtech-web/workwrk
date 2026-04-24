"use client";

/**
 * Short two-tone notification "ding" synthesized via the Web Audio API.
 * Avoids shipping a binary asset — every modern browser can generate this
 * inline, and it stays aligned with the site's UI without needing a
 * round-trip to load a .mp3 file.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Plays a short, soft two-tone chime. Safe to call from click handlers
 * or polling cycles — no-op if audio is unavailable or blocked.
 */
export function playNotificationChime() {
  const ctx = getCtx();
  if (!ctx) return;

  // Some browsers suspend the context until after a user gesture.
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => { /* ignore */ });
  }

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.18; // keep it unobtrusive
  master.connect(ctx.destination);

  // Two overlapping notes: A5 → E6 = friendly, brand-neutral chime.
  playTone(ctx, master, 880, now, 0.18);
  playTone(ctx, master, 1318.5, now + 0.09, 0.22);
}

function playTone(
  ctx: AudioContext,
  dest: GainNode,
  freq: number,
  startAt: number,
  duration: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;

  // Quick fade-in + decay so it doesn't click.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(1, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(dest);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}
