// Inbox presets (decided addition c, the ClickUp pattern): Default, Focused,
// Custom, over the task and people keys in home.notifications.inbox
// (src/lib/notify-prefs.ts). A preset is not a stored key of its own: it is
// read back from the switches, so the preset and the switches can never
// disagree, and choosing one writes them all. Pure; tested.
//
// The task-level rows (decided addition c): assigned, mentioned, status change
// and comment on MY task, status change and comment on a task I FOLLOW (a
// watcher or a past commenter) and due soon (the day it is due). Overdue is
// held back (HELD_INBOX_KEYS below). The split-out keys read their parent key
// while they have never been stored, so a person who turned "Status changes
// on my tasks" off before the split never starts hearing about followed tasks
// either. The page, the presets and the senders all read through inboxKeyOn,
// so the switch shown is exactly what the sender does (settings-architecture
// 9.1).

import { zonedInputToIso, zonedInputValue } from "@/lib/zoned-input";

export const TASK_INBOX_KEYS = [
  "task_assigned",
  "status_changes",
  "followed_status",
  "due_reminders",
  "mentions",
  "comments",
  "followed_comments",
  "kudos",
] as const;
export type TaskInboxKey = (typeof TASK_INBOX_KEYS)[number];
export type InboxPreset = "default" | "focused" | "custom";

/**
 * Inbox keys a person may already have stored but that no sender reads yet,
 * so no switch shows them and no preset writes or reads them. A switch with
 * nothing behind it tells a person they will hear about something they never
 * will, so it waits behind "Show upcoming features" as a Coming soon row.
 *
 * "overdue": nothing writes a task_overdue notification. The producer is
 * written (notifyItemsDueToday in src/lib/notify-item.ts) but no cron calls
 * it. To turn the switch back on: call it once a day from a registered job
 * (the tasks-due-today run of /api/email/send-reminders is the natural home)
 * with a cap per person, so someone with a backlog of old overdue tasks is
 * not handed one row per task every morning; then move "overdue" back into
 * TASK_INBOX_KEYS (and FOCUSED_ON) and put its row back in WORK_ROWS on
 * /account/notifications. A choice already stored under the key is never
 * touched meanwhile, so it holds when the sender lands.
 *
 * WHEN OVERDUE REJOINS FOCUSED_ON, write it for the people who picked Focused
 * meanwhile. Their Focused never stored "overdue", so it reads its parent,
 * due_reminders, which Focused turned off: presetOf would then read them as
 * Custom, and they would hear nothing about overdue work although Focused
 * promises it. Before the release that moves the key back, set
 * inbox.overdue = true on every stored inbox whose switches match Focused
 * (presetOf(inbox) === "focused" under the old lists), so they keep reading
 * as Focused and get what Focused gives.
 */
export const HELD_INBOX_KEYS = ["overdue"] as const;

/** A split-out key reads its parent until it is stored itself. */
export const INBOX_KEY_FALLBACK: Readonly<Partial<Record<string, string>>> = {
  followed_status: "status_changes",
  followed_comments: "comments",
  // Held (HELD_INBOX_KEYS); kept so the stored choice reads the same once a sender exists.
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

/**
 * Focused: of the work and people switches, only a task handed to you and a
 * mention stay on (kudos goes off too). It never writes the Talk and
 * announcement switches (inbox-notify-keys.ts), which keep their own values,
 * and the page's sentence says exactly that. Overdue rejoins it with its
 * sender (see HELD_INBOX_KEYS).
 */
const FOCUSED_ON: ReadonlySet<TaskInboxKey> = new Set<TaskInboxKey>(["task_assigned", "mentions"]);

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

/**
 * The instant a mute preset ends. "Until tomorrow, 9:00 am" is 9:00 tomorrow
 * on the WorkwrK clock (home.locale.timezone, `timeZone`), the clock every
 * time on the page is shown in, never the device's: on a London laptop in a
 * Kolkata workspace it ended at 9:00 London, which is 1:30 pm in Kolkata,
 * and near midnight it could even pick the wrong day (settings-cleanup
 * Phase 3 review, follow-up to M2). With no zone set it is the device's
 * 9:00, as before. An hour and "until I turn it back on" are lengths of
 * time, the same on every clock.
 */
export function mutedUntilFor(choice: Exclude<MuteChoice, "off" | "custom">, now: Date = new Date(), timeZone?: string | null): string {
  if (choice === "1h") return new Date(now.getTime() + 60 * 60_000).toISOString();
  if (choice === "tomorrow") {
    // Today's date on that clock, the day after it, then 9:00 on that clock.
    const [y, m, d] = zonedInputValue(now, timeZone).slice(0, 10).split("-").map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    const iso = zonedInputToIso(`${tomorrow}T09:00`, timeZone);
    if (iso) return iso;
    const local = new Date(now.getTime());
    local.setDate(local.getDate() + 1);
    local.setHours(9, 0, 0, 0);
    return local.toISOString();
  }
  const d = new Date(now.getTime());
  d.setFullYear(d.getFullYear() + 100);
  return d.toISOString();
}

/**
 * "Pick a time...": the instant the picked "YYYY-MM-DDTHH:mm" names, as ISO,
 * when it is still in the future, else null (the Mute button stays off).
 *
 * The DateTimeField's value is a WALL CLOCK in the WorkwrK time zone
 * (home.locale.timezone), the zone every time on the page is shown in, so it
 * is read in that zone through zoned-input.ts, as Meetings reads its When
 * field. Date.parse read it in the device's zone instead: on a London laptop
 * in a Kolkata workspace, 3:00 PM meant 3:00 PM London, five and a half
 * hours late (settings-cleanup Phase 3 review, M2). With no zone set it
 * falls back to the device's, as zoned-input does.
 */
export function customMuteUntil(value: string, timeZone: string | null | undefined, now: number): string | null {
  const iso = zonedInputToIso(value, timeZone);
  if (!iso) return null;
  return Date.parse(iso) > now ? iso : null;
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
