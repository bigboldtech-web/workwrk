// Inbox presets (decided addition c, the ClickUp pattern): Default, Focused,
// Custom, over the task and people keys in home.notifications.inbox
// (src/lib/notify-prefs.ts). A preset is not a stored key of its own: it is
// read back from the switches, so the preset and the switches can never
// disagree, and choosing one writes them all. Pure; tested.
//
// The task-level rows (decided addition c): assigned, mentioned, status change
// and comment on MY task, status change and comment on a task I FOLLOW (a
// watcher or a past commenter), due soon (the day it is due) and overdue.
// The three split-out keys read their parent key while they have never been
// stored, so a person who turned "Status changes on my tasks" off before the
// split never starts hearing about followed tasks either. The page, the
// presets and the senders all read through inboxKeyOn, so the switch shown
// is exactly what the sender does (settings-architecture 9.1).

export const TASK_INBOX_KEYS = [
  "task_assigned",
  "status_changes",
  "followed_status",
  "due_reminders",
  "overdue",
  "mentions",
  "comments",
  "followed_comments",
  "kudos",
] as const;
export type TaskInboxKey = (typeof TASK_INBOX_KEYS)[number];
export type InboxPreset = "default" | "focused" | "custom";

/** A split-out key reads its parent until it is stored itself. */
export const INBOX_KEY_FALLBACK: Readonly<Partial<Record<string, string>>> = {
  followed_status: "status_changes",
  followed_comments: "comments",
  overdue: "due_reminders",
};

/** Is this inbox key on? Absent means on, as every reader has always treated it. */
export function inboxKeyOn(inbox: Record<string, boolean> | null | undefined, key: string): boolean {
  const own = inbox?.[key];
  if (typeof own === "boolean") return own;
  const parent = INBOX_KEY_FALLBACK[key];
  if (parent && typeof inbox?.[parent] === "boolean") return inbox[parent] as boolean;
  return true;
}

/** Focused: only what is aimed at you (a task handed to you, a mention, your own task running late). */
const FOCUSED_ON: ReadonlySet<TaskInboxKey> = new Set<TaskInboxKey>(["task_assigned", "mentions", "overdue"]);

export function presetValues(preset: Exclude<InboxPreset, "custom">): Record<TaskInboxKey, boolean> {
  const out = {} as Record<TaskInboxKey, boolean>;
  for (const k of TASK_INBOX_KEYS) out[k] = preset === "default" ? true : FOCUSED_ON.has(k);
  return out;
}

/** Which preset the stored switches match. */
export function presetOf(inbox: Record<string, boolean> | null | undefined): InboxPreset {
  const on = (k: TaskInboxKey) => inboxKeyOn(inbox, k);
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
