// Inbox presets (decided addition c, the ClickUp pattern): Default, Focused,
// Custom, over the six task and people keys in home.notifications.inbox
// (src/lib/notify-prefs.ts). A preset is not a stored key of its own: it is
// read back from the six switches, so the preset and the switches can never
// disagree, and choosing one writes the six. Pure; tested.

export const TASK_INBOX_KEYS = ["task_assigned", "status_changes", "due_reminders", "mentions", "comments", "kudos"] as const;
export type TaskInboxKey = (typeof TASK_INBOX_KEYS)[number];
export type InboxPreset = "default" | "focused" | "custom";

/** Focused: only what is aimed at you (a task handed to you, a mention). */
const FOCUSED_ON: ReadonlySet<TaskInboxKey> = new Set<TaskInboxKey>(["task_assigned", "mentions"]);

export function presetValues(preset: Exclude<InboxPreset, "custom">): Record<TaskInboxKey, boolean> {
  const out = {} as Record<TaskInboxKey, boolean>;
  for (const k of TASK_INBOX_KEYS) out[k] = preset === "default" ? true : FOCUSED_ON.has(k);
  return out;
}

/** Which preset the stored switches match (absent means on, as every reader treats it). */
export function presetOf(inbox: Record<string, boolean> | null | undefined): InboxPreset {
  const on = (k: TaskInboxKey) => inbox?.[k] !== false;
  if (TASK_INBOX_KEYS.every((k) => on(k))) return "default";
  if (TASK_INBOX_KEYS.every((k) => on(k) === FOCUSED_ON.has(k))) return "focused";
  return "custom";
}

/** The mute-everything choices (the avatar menu writes the same key). */
export type MuteChoice = "off" | "1h" | "tomorrow" | "forever" | "custom";

export function mutedUntilFor(choice: Exclude<MuteChoice, "off" | "custom">, now: Date = new Date()): string {
  if (choice === "1h") return new Date(now.getTime() + 60 * 60_000).toISOString();
  if (choice === "tomorrow") {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date(now.getTime());
  d.setFullYear(d.getFullYear() + 100);
  return d.toISOString();
}

/** A stored mutedUntil that is still in the future, else null. */
export function activeMute(mutedUntil: string | null | undefined, now: Date = new Date()): Date | null {
  if (!mutedUntil) return null;
  const t = Date.parse(mutedUntil);
  return Number.isFinite(t) && t > now.getTime() ? new Date(t) : null;
}

/** "Until I turn it back on" is stored as a date decades out. */
export function isMuteForever(until: Date, now: Date = new Date()): boolean {
  return until.getTime() - now.getTime() > 50 * 365 * 24 * 60 * 60_000;
}
