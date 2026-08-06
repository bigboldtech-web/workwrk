// Notification preference gate — server-side helpers that decide whether a
// user wants a given notification type, read from the per-user notification
// settings saved at /settings/notifications.
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

/** Keys shared with the settings page rows — keep in sync with
 *  src/app/(dashboard)/settings/notifications/page.tsx. */
export type NotifyType =
  | "task_assigned"
  | "mentions"
  | "comments"
  | "status_changes"
  | "due_reminders"
  | "kudos";

interface NotifPrefs {
  inbox?: Record<string, boolean>;
  email?: Record<string, boolean>;
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
    return p.inbox?.[type] !== false; // default true
  } catch {
    return true; // fail open
  }
}

/** Should a notification email of this type be sent to the user?
 *  Honors the master email switch, then the per-type toggle. */
export async function shouldEmail(userId: string, type: NotifyType): Promise<boolean> {
  try {
    const e = (await loadPrefs(userId)).email;
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
      if (prefsOf(r.home).inbox?.[type] === false) allowed.delete(r.userId);
    }
  } catch {
    // fail open — keep everyone
  }
  return allowed;
}
