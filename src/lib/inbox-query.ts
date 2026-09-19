// inbox-query.ts: the SQL shape of an Inbox tab.
//
// It lives beside `inbox-kinds.ts` rather than inside the route because three
// callers need the SAME where clause and any drift between them is a count
// that disagrees with the list it counts:
//
//   GET  /api/notifications   the tab's rows and the tab's total
//   GET  /api/inbox/count     the ONE unread number (sidebar badge, bell, Home)
//   PATCH /api/notifications  tab-scoped "Mark all read"
//
// A Next route module may only export its handlers and a small set of config
// keys, so a shared helper cannot live in one of them anyway.
//
// READ AND CLEARED ARE TWO DIFFERENT STATES. This file used to define Primary
// and Other as `read = false` and Cleared as `read = true`, which made those
// two words one word: selecting a row marked it read, the tab re-queried, and
// the row you were reading left the list and took the detail pane with it.
// "Mark read" was a silent "Clear" and "Mark all read" emptied Primary.
//
// Now a tab is "not cleared" and READ IS A WEIGHT, not a filing decision:
//
//   Primary / Other   not cleared, not snoozed, in / not in the Primary kinds
//   Mentions          not cleared, a mention kind
//   Snoozed           snoozedUntil in the future
//   Cleared           clearedAt is set
//
// The counts on the tab pills stay counts of UNREAD rows (spec: "Primary
// (count of unread)"), which is why every caller that wants a number adds
// `read: false` on top of the tab clause rather than reading the tab's total.
//
// ONE RELEASE OF TOLERANCE. `Notification.clearedAt` ships as an additive
// column (prisma/sql/2026-09-18-notification-cleared-at.sql) and the code may
// run for one release against a database that does not have it yet. Every
// clause is therefore built through `hasClearedAt`, and the routes call
// `withClearedAtFallback` so a "column does not exist" error downgrades the
// whole request to the old semantics once, for the process, instead of showing
// a 500 to somebody opening their Inbox.

import {
  mentionTypes,
  typesForFilterGroup,
  typesForTab,
  type InboxFilterGroup,
  type InboxTab,
} from "./inbox-kinds";
import type { Prisma } from "@/generated/prisma";

/**
 * Whether the running database has `Notification.clearedAt`.
 *
 * Starts optimistic. The first query that fails with Postgres' "column does
 * not exist" (Prisma P2022) flips it for the life of the process and the
 * caller retries on the legacy clauses. It is deliberately one-way: a column
 * does not come back mid-process, and a flag that could flip back would make
 * two requests in the same second disagree about what "cleared" means.
 */
let clearedAtAvailable = true;

/** Test seam, and the one way to put the flag back. */
export function setClearedAtAvailable(value: boolean): void {
  clearedAtAvailable = value;
}

export function hasClearedAt(): boolean {
  return clearedAtAvailable;
}

/**
 * True when a query failed because `clearedAt` is not there.
 *
 * "Not there" has two shapes, and a reader has to tolerate both for one
 * release, because a deploy is two steps and either can land first:
 *
 *   the DATABASE does not have the column yet    Prisma P2022 (Postgres 42703)
 *   the running CLIENT does not know the field   PrismaClientValidationError
 *
 * The second is the one a restart fixes and the first is the one the SQL file
 * fixes, and to somebody opening their Inbox they are the same thing: the
 * older behaviour, working, rather than a 500. Both are matched narrowly on
 * the field NAME, so a genuine mistake in some other clause still throws.
 */
export function isMissingClearedAtError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown; meta?: { column?: unknown } };
  const text = `${typeof e.message === "string" ? e.message : ""} ${String(e.meta?.column ?? "")}`;
  if (!text.includes("clearedAt")) return false;
  // P2022 is Prisma's "column does not exist"; 42703 is the Postgres code it
  // wraps, which surfaces directly on a raw query.
  if (e.code === "P2022" || e.code === "42703" || text.includes("does not exist")) return true;
  return e.name === "PrismaClientValidationError";
}

/**
 * Run a read that uses `clearedAt`, and fall back once if the column is not
 * there. `build` is called again after the flag flips, so the retry uses the
 * legacy clauses rather than re-sending the failing one.
 */
export async function withClearedAtFallback<T>(build: () => Promise<T>): Promise<T> {
  try {
    return await build();
  } catch (err) {
    if (!clearedAtAvailable || !isMissingClearedAtError(err)) throw err;
    clearedAtAvailable = false;
    return build();
  }
}

/**
 * The where clause for a tab, over the caller's own rows only.
 *
 * "Other" is `NOT IN` the Primary list rather than `IN` the Other list, on
 * purpose. An automation author can put any string in `Notification.type`
 * (lib/workflows/runtime.ts forwards `cfg.notificationType` untouched), and an
 * `IN` on both tabs would drop such a row out of every tab in the product
 * while still counting toward the badge. Nothing a person receives may be
 * unreachable.
 */
export function tabWhere(
  tab: InboxTab,
  userId: string,
  now: Date,
  /**
   * The viewer's "Show everything in Other" switch. When it is on, Other also
   * lists the Primary rows, which is the honest name for what the old page
   * called an "All" tab that showed neither everything nor only the rest.
   */
  showAllInOther = false,
): Prisma.NotificationWhereInput {
  const notSnoozed: Prisma.NotificationWhereInput = {
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
  };
  // On a database without the column, "not cleared" is the old "not read" and
  // "cleared" is the old "read". The product is then exactly what it was
  // before this change, which is the correct behaviour for one release.
  const notCleared: Prisma.NotificationWhereInput = clearedAtAvailable ? { clearedAt: null } : { read: false };
  switch (tab) {
    case "primary":
      return { userId, ...notCleared, ...notSnoozed, type: { in: typesForTab("primary") } };
    case "other":
      return showAllInOther
        ? { userId, ...notCleared, ...notSnoozed }
        : { userId, ...notCleared, ...notSnoozed, type: { notIn: typesForTab("primary") } };
    case "mentions":
      // Mentions is a kind filter, not a state filter. Without the column
      // there is no way to say "not cleared" that does not also say "unread",
      // and Mentions has always listed read rows too, so the fallback keeps
      // the whole history rather than silently hiding half of it.
      return clearedAtAvailable
        ? { userId, clearedAt: null, type: { in: mentionTypes() } }
        : { userId, type: { in: mentionTypes() } };
    case "snoozed":
      return { userId, snoozedUntil: { gt: now } };
    case "cleared":
      return clearedAtAvailable ? { userId, clearedAt: { not: null } } : { userId, read: true };
  }
}

/**
 * The same tab, counted the way a tab PILL counts: unread rows only. Primary
 * showing "12" next to a list of forty rows is correct: twelve of them are
 * new, and it is the number the sidebar badge adds up.
 */
export function tabUnreadWhere(
  tab: InboxTab,
  userId: string,
  now: Date,
  showAllInOther = false,
): Prisma.NotificationWhereInput {
  return { AND: [tabWhere(tab, userId, now, showAllInOther), { read: false }] };
}

/**
 * "Unread", once and for all: a row that is unread, not cleared, not currently
 * snoozed. That is exactly what Primary + Other hold between them, which is why
 * one COUNT can serve the badge, the bell and the Home widget, and why it is
 * counted directly here rather than summed from two tabs, which double-counted
 * every Primary row whenever "Show everything in Other" was on.
 */
export function unreadWhere(userId: string, now: Date): Prisma.NotificationWhereInput {
  return {
    userId,
    read: false,
    ...(clearedAtAvailable ? { clearedAt: null } : {}),
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
  };
}

/** The `type IN (…)` list for a set of Filter-panel checkbox rows. */
export function typesForGroups(groups: readonly InboxFilterGroup[]): string[] {
  return Array.from(new Set(groups.flatMap((g) => typesForFilterGroup(g))));
}
