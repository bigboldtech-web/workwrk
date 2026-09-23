// The Inbox notification switches: one key, one default, one reader.
//
// Spec: docs/plans/ui-refresh/spec-talk.md section 4 step 10, which asks for
// four rows on My settings > Notifications > Inbox ("Direct messages",
// "Channel messages", "Calls", "Announcements") and names their store as
// `home.notifications.inbox.{dm, channel, calls, announcements}`.
//
// WHY A MODULE AND NOT FOUR STRING LITERALS. `home.notifications.inbox` is a
// loose boolean record in the preferences schema, which is what lets the six
// older rows (task_assigned, mentions, comments, ...) live beside these four
// without a migration. A loose record has no defaults and no completeness
// test, so four new keys typed as bare strings in three files would drift the
// first time somebody wrote "dms" in one of them and nobody noticed, because
// the miss reads as "absent" and absent means ON. The keys are declared here,
// the default is declared here, and every reader goes through one function.
//
// WHAT IS WIRED TODAY, and what is not. The two fan-outs read these keys:
// src/app/api/conversations/[id]/messages/route.ts and
// src/app/api/announcements/route.ts both call inboxRecordOf + inboxRowEnabled
// before they write an Inbox row. The WRITER is still missing: nothing renders
// a switch for dm, channel, calls or announcements, so no person has yet
// written one of these keys and both fan-outs currently keep everybody.
// Nothing regressed, these four rows never existed before this module, but the
// feature is not finished until the control ships.
//
// WHERE THE CONTROL LANDS: the Inbox section of
// src/app/(dashboard)/settings/notifications/page.tsx, as four more entries in
// its INBOX_ROWS list. That page already round-trips arbitrary keys through the
// same loose `inbox` record its six older rows use, so the rows need no schema
// change and no migration: map TALK_INBOX_KEYS through TALK_INBOX_LABELS and
// mark all four live, since both fan-outs honour them the moment a false is
// written. TALK_INBOX_DEFAULTS is there for that page to paint an unwritten
// switch in its ON position without inventing a default of its own.
//
// DEFAULT ON, and the reason matters: a person who has never opened the
// notifications page must not lose a notification. Only an explicit `false`
// turns a row off, so a missing preference row, a failed read and an unknown
// key all keep the notification.
//
// NO IMPORTS, on purpose: the API routes read it server-side, the settings
// page reads it in the browser, and vitest's node environment does not
// resolve "@/".

/** The four Talk and announcements rows, in the order the settings page lists them. */
export const TALK_INBOX_KEYS = ["dm", "channel", "calls", "announcements"] as const;
export type TalkInboxKey = (typeof TALK_INBOX_KEYS)[number];

export const TALK_INBOX_LABELS: Record<TalkInboxKey, { label: string; sub: string }> = {
  dm: {
    label: "Direct messages",
    sub: "When somebody messages you directly",
  },
  channel: {
    label: "Channel messages",
    sub: "Only where you chose All messages for that channel",
  },
  calls: {
    label: "Calls",
    sub: "When somebody starts a call in one of your conversations",
  },
  announcements: {
    label: "Announcements",
    sub: "New announcements you are in the audience for",
  },
};

/** Every one of the four is on until the person turns it off. */
export const TALK_INBOX_DEFAULTS: Record<TalkInboxKey, boolean> = {
  dm: true,
  channel: true,
  calls: true,
  announcements: true,
};

/**
 * "Ring for incoming calls" on the Desktop tab. A sibling of `desktop`, default on.
 *
 * This one is a step behind the four above: it has neither a writer nor a
 * reader yet. The schema accepts it (src/lib/preferences-schema.ts, a sibling
 * of `desktop` on purpose) and the default is declared here, but the switch is
 * not on the Desktop section of
 * src/app/(dashboard)/settings/notifications/page.tsx and
 * src/components/calls/incoming-call-watcher.tsx does not consult it, so a
 * person who turned the ring off would still be rung. Both halves land
 * together or neither does: shipping the switch alone would be a control with
 * no handler. Keep the default here so the two sides cannot disagree about
 * what an unwritten preference means.
 */
export const DESKTOP_RING_CALLS_DEFAULT = true;

type InboxRecord = Record<string, boolean> | null | undefined;

/**
 * Is this Inbox row on for the person whose preferences these are?
 *
 * Only an explicit `false` is off. Anything else, including a missing
 * preferences row and a malformed value, is on.
 */
export function inboxRowEnabled(inbox: InboxRecord, key: string): boolean {
  return inbox?.[key] !== false;
}

/** The shape `home` has when it is read straight off `UserPreference.home`. */
export interface HomeNotificationsShape {
  notifications?: {
    inbox?: Record<string, boolean>;
    desktop?: boolean;
    desktopRingCalls?: boolean;
  } | null;
}

/** The Inbox record inside an untyped `UserPreference.home` blob, or undefined. */
export function inboxRecordOf(home: unknown): Record<string, boolean> | undefined {
  if (!home || typeof home !== "object") return undefined;
  const n = (home as HomeNotificationsShape).notifications;
  if (!n || typeof n !== "object") return undefined;
  const inbox = n.inbox;
  return inbox && typeof inbox === "object" ? inbox : undefined;
}

/**
 * One call for a fan-out: the subset of these userIds who still want this row.
 *
 * The two fan-outs that exist today walk their preference rows themselves,
 * because each also needs the rows for something else on the same pass. This
 * is the shape a fan-out that only needs the filter should use, and it is what
 * keeps "absent means on" from being retyped a third time.
 */
export function userIdsWantingRow(
  rows: Array<{ userId: string; home: unknown }>,
  key: string,
  allUserIds: string[],
): Set<string> {
  const keep = new Set(allUserIds);
  for (const r of rows) {
    if (!inboxRowEnabled(inboxRecordOf(r.home), key)) keep.delete(r.userId);
  }
  return keep;
}

/** Which Inbox row a Talk message belongs to. A call card is "calls", never "channel". */
export function inboxKeyForMessage(
  conversationType: "DM" | "GROUP" | "CHANNEL",
  isCallCard: boolean,
): TalkInboxKey {
  if (isCallCard) return "calls";
  return conversationType === "DM" ? "dm" : "channel";
}
