// The Estimate field's text format, pure.
//
// One task field accepts free text ("2h 30m", "2h", "90m", "1.5h", a bare
// number of minutes) and stores an integer number of minutes in
// `Item.metadata.timeEstimate`. It was inline in board-item-detail.tsx with no
// test, and the create-task modal parsed the same strings a second way, so
// "1.5h" was 90 minutes on the task and rejected in the modal.
//
// Pure module: no imports, so vitest loads it in the node environment.

/** Minutes to the canonical display string: "2h 30m", "2h", "45m". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h > 0) return rest > 0 ? `${h}h ${rest}m` : `${h}h`;
  return `${rest}m`;
}

/**
 * Parse an estimate. Returns minutes, or null when the text carries no usable
 * number (including "0", which means "no estimate" rather than "zero long").
 */
export function parseEstimate(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hours = t.match(/(\d+(?:\.\d+)?)\s*h/);
  const mins = t.match(/(\d+(?:\.\d+)?)\s*m/);
  let total = 0;
  if (hours) total += parseFloat(hours[1]) * 60;
  if (mins) total += parseFloat(mins[1]);
  if (!hours && !mins) {
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return null;
    total = n;
  }
  const rounded = Math.round(total);
  return rounded > 0 ? rounded : null;
}

/** Milliseconds tracked to a short label: "1h 20m", "45m", "12s". */
export function formatTracked(ms: number): string {
  if (ms < 1000) return "0m";
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** A running timer's clock: "1:04:09" or "4:09". */
export function formatClock(elapsedMs: number): string {
  const secs = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
