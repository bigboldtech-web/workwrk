// Notification preference gate — server-side helpers that decide whether a
// user wants a given notification type, read from the per-user notification
// settings saved at /account/notifications.
//
// Storage: UserPreference.home JSON column under the "notifications" key
// (deliberately reusing an existing JSON column — no schema migration):
//   home.notifications = {
//     inbox: { task_assigned: bool, comments: bool, due_reminders: bool, kudos: bool, ... },
//     email: { master: bool, task_assigned: bool, kudos: bool, ... },
//   }
// Missing row / missing key = default TRUE (notify). Reads fail OPEN so a
// prefs hiccup can never silently drop a notification.

import { prisma } from "@/lib/prisma";
import { activeMute, inboxKeyOn } from "@/lib/account/notification-presets";

/** Keys shared with the settings page rows — keep in sync with
 *  src/app/(dashboard)/account/notifications/page.tsx. */
export type NotifyType =
  | "task_assigned"
  | "mentions"
  | "comments"
  | "followed_comments"
  | "status_changes"
  | "followed_status"
  | "due_reminders"
  | "overdue"
  | "kudos";

interface NotifPrefs {
  inbox?: Record<string, boolean>;
  email?: Record<string, boolean>;
  /** My settings > Notifications > Mute everything until (ISO), or null. */
  mutedUntil?: string | null;
}

function prefsOf(home: unknown): NotifPrefs {
  if (home && typeof home === "object" && "notifications" in (home as Record<string, unknown>)) {
    const n = (home as Record<string, unknown>).notifications;
    if (n && typeof n === "object") return n as NotifPrefs;
  }
  return {};
}

async function loadPrefs(userId: string): Promise<NotifPrefs> {
  const row = await prisma.userPreference.findUnique({
    where: { userId },
    select: { home: true },
  });
  return prefsOf(row?.home);
}

/** Should an in-app (Inbox) notification of this type be created for the user? */
export async function shouldNotify(userId: string, type: NotifyType): Promise<boolean> {
  try {
    const p = await loadPrefs(userId);
    return inboxKeyOn(p.inbox, type); // default true; split keys read their parent
  } catch {
    return true; // fail open
  }
}

/** Should a notification email of this type be sent to the user?
 *  Honors the master email switch, then the per-type toggle. */
export async function shouldEmail(userId: string, type: NotifyType): Promise<boolean> {
  try {
    const p = await loadPrefs(userId);
    // "Mute everything until" holds the emails too, not only the pings the
    // shell draws: nothing new reaches the person while the mute runs.
    if (activeMute(typeof p.mutedUntil === "string" ? p.mutedUntil : null)) return false;
    const e = p.email;
    if (e?.master === false) return false;
    return e?.[type] !== false; // default true
  } catch {
    return true; // fail open
  }
}

/** Batch variant for fan-out sites (e.g. the due-today cron): returns the
 *  subset of userIds that still want this inbox notification type. */
export async function filterNotifyUsers(userIds: string[], type: NotifyType): Promise<Set<string>> {
  const unique = [...new Set(userIds)];
  const allowed = new Set(unique);
  if (unique.length === 0) return allowed;
  try {
    const rows = await prisma.userPreference.findMany({
      where: { userId: { in: unique } },
      select: { userId: true, home: true },
    });
    for (const r of rows) {
      if (!inboxKeyOn(prefsOf(r.home).inbox, type)) allowed.delete(r.userId);
    }
  } catch {
    // fail open — keep everyone
  }
  return allowed;
}

// ── Per-object mute (home.notifications.muted[]) ─────────────────────
//
// The "..." menu on a Space, Folder or List writes "space:<id>",
// "folder:<id>" or "list:<id>" into home.notifications.muted[]
// (container-menu.tsx), and My settings > Notifications lists them. Muting
// silences the UPDATES about work in that place: status changes, comments
// and due-date reminders. What is aimed at the person themself (a task
// assigned to them, a mention) still arrives, because the worst case of
// muting a noisy Space must never be missing work handed to you.

/** The notification kinds a per-object mute silences. */
export const MUTABLE_NOTIFY_TYPES: ReadonlySet<NotifyType> = new Set<NotifyType>(["status_changes", "followed_status", "comments", "followed_comments", "due_reminders", "overdue"]);

/** The muted object keys stored on a preference row (pure; tested). */
export function mutedObjectKeys(home: unknown): string[] {
  const n = prefsOf(home) as { muted?: unknown };
  return Array.isArray(n.muted) ? n.muted.filter((k): k is string => typeof k === "string") : [];
}

/** The keys an item's place answers to: its List, its Folder, its Space (pure; tested). */
export function placeMuteKeys(place: { boardId?: string | null; folderId?: string | null; spaceId?: string | null }): string[] {
  const keys: string[] = [];
  if (place.boardId) keys.push(`list:${place.boardId}`, `board:${place.boardId}`);
  if (place.folderId) keys.push(`folder:${place.folderId}`);
  if (place.spaceId) keys.push(`space:${place.spaceId}`);
  return keys;
}

/** The subset of userIds who have NOT muted any of these places. Fails open. */
export async function filterUnmutedUsers(userIds: string[], placeKeys: string[], type: NotifyType): Promise<Set<string>> {
  const allowed = new Set(userIds);
  if (!MUTABLE_NOTIFY_TYPES.has(type) || placeKeys.length === 0 || userIds.length === 0) return allowed;
  try {
    const rows = await prisma.userPreference.findMany({ where: { userId: { in: userIds } }, select: { userId: true, home: true } });
    for (const r of rows) {
      const muted = mutedObjectKeys(r.home);
      if (muted.some((k) => placeKeys.includes(k))) allowed.delete(r.userId);
    }
  } catch {
    // fail open: a notification arriving is better than one silently lost
  }
  return allowed;
}
