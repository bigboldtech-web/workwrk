// Cron: sweep CLEARED notifications for the people who asked for it.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox, Data):
// "`DELETE /api/notifications { allRead: true, olderThanDays }` for auto-clear
// (a daily cron row reads `inboxView.autoClearDays`; documented in
// `scripts/CRON-SETUP.md`)".
//
// THIS ROUTE DELETES USER DATA, so every line of it is a narrowing:
//
//   0. It is FAIL-CLOSED. No `CRON_SECRET` in the environment means the route
//      refuses to run at all (503), and a wrong secret is a 403. It used to
//      skip the check entirely when the variable was empty or unset, which is
//      how it ships in .env, so an anonymous POST ran the sweep across every
//      org. Every other cron here inherits the same guard, but they send mail;
//      this is the first one that destroys rows, so inheriting is not enough.
//   1. It is OPT-IN, per person. The default for `autoClearDays` is null,
//      which means Never, and a person with no stored value is never swept.
//      Nothing is deleted because a cron ran; it is deleted because somebody
//      picked "After 30 days" in their own Inbox options.
//   2. It only ever touches rows the person CLEARED (`clearedAt IS NOT NULL`).
//      Read is not cleared: a notification you have read still sits in your
//      Primary tab, and a cron may not delete something you can still see. On
//      a database that predates the `clearedAt` column this sweep DOES
//      NOTHING and says so (`columnMissing` in the response). It does NOT fall
//      back to `read = true` the way every READ in this codebase does: that
//      clause selects a strictly larger set, so a fallback here would widen a
//      DELETE to rows the person can still see, which is rule 2 itself.
//   3. It only touches rows OLDER than the number of days they chose.
//   4. It never touches anybody else's rows: the delete is scoped to the one
//      userId whose preference asked for it, one statement per person.
//   5. `?dry=1` reports exactly what it WOULD delete and deletes nothing, so
//      the founder can run it once before installing the crontab row.
//
// It also reports what it did per person, so a surprise is visible in the cron
// log rather than only in the absence of something.
//
// NOT INSTALLED. scripts/CRON-SETUP.md carries the row; adding it to the
// crontab is the founder's step, exactly like every other cron here.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasClearedAt, isMissingClearedAtError, setClearedAtAvailable } from "@/lib/inbox-query";
// `Prisma` is imported as a VALUE here, not a type: `Prisma.DbNull` is the
// only way to say "the JSON column is SQL NULL" in a filter.
import { Prisma } from "@/generated/prisma";

export const dynamic = "force-dynamic";

/** The values the Inbox options popover offers. Anything else is ignored. */
const ALLOWED_DAYS = new Set([7, 14, 30]);

/** Preference rows are read in pages: a nightly job may not load a whole table. */
const PAGE = 500;

export async function POST(req: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  if (!cronSecret) {
    // Refusing is the safe answer. A delete sweep that runs for anybody who
    // can reach the URL is worse than a sweep that never runs.
    return Response.json(
      { error: "CRON_SECRET is not set; this route deletes rows and will not run without it." },
      { status: 503 },
    );
  }
  const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
  const provided = header?.replace(/^Bearer\s+/i, "");
  if (provided !== cronSecret) return Response.json({ error: "Forbidden" }, { status: 403 });

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const now = Date.now();
  const swept: Array<{ userId: string; days: number; deleted: number }> = [];
  let seen = 0;
  let skipped = 0;
  let columnMissing = false;
  let cursor: string | undefined;

  // Paged, and only rows that actually HAVE a home blob. `{ home: { not:
  // undefined } }` was an inert filter: Prisma drops `undefined`, so the
  // query selected the entire UserPreference table and the comment above it
  // claimed the opposite.
  for (;;) {
    const prefs: Array<{ userId: string; home: Prisma.JsonValue }> = await prisma.userPreference.findMany({
      where: { NOT: { home: { equals: Prisma.DbNull } } },
      select: { userId: true, home: true },
      orderBy: { userId: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { userId: cursor }, skip: 1 } : {}),
    });
    if (prefs.length === 0) break;
    seen += prefs.length;
    cursor = prefs[prefs.length - 1].userId;

    for (const row of prefs) {
      const home = row.home as { notifications?: { inboxView?: { autoClearDays?: unknown } } } | null;
      const raw = home?.notifications?.inboxView?.autoClearDays;
      const days = typeof raw === "number" ? Math.trunc(raw) : null;
      // null, 0, a negative, or a number nobody could have chosen: not swept.
      if (days === null || !ALLOWED_DAYS.has(days)) {
        skipped += 1;
        continue;
      }
      const cutoff = new Date(now - days * 86_400_000);
      // NO FALLBACK ON THE DELETE, and that is the whole point of writing it
      // out rather than wrapping it in withClearedAtFallback like every read
      // in this codebase does. The fallback clause, `read: true`, is a
      // STRICTLY LARGER set than `clearedAt IS NOT NULL`: under the new
      // semantics a read row is not a cleared row, it is still sitting in the
      // person's Primary tab where they can see it. A fallback that widens a
      // DELETE would have this cron delete rows the person can still see,
      // which this route's own header forbids. If the column is not there the
      // feature does nothing until prisma/sql/2026-09-18-notification-cleared-at.sql
      // has been applied, and the response says so.
      if (!hasClearedAt()) {
        skipped += 1;
        columnMissing = true;
        continue;
      }
      const where: Prisma.NotificationWhereInput = {
        userId: row.userId,
        clearedAt: { not: null, lt: cutoff },
      };
      let count = 0;
      try {
        count = dryRun
          ? await prisma.notification.count({ where })
          : await prisma.notification.deleteMany({ where }).then((r) => r.count);
      } catch (err) {
        // The flag starts optimistic, so the FIRST statement of the process is
        // what discovers a missing column. Flip the shared flag so the rest of
        // this run and every reader after it stops asking, and skip this
        // person. No retry on a narrower or wider clause: see rule 2.
        if (!isMissingClearedAtError(err)) throw err;
        setClearedAtAvailable(false);
        skipped += 1;
        columnMissing = true;
        continue;
      }
      if (count > 0) swept.push({ userId: row.userId, days, deleted: count });
    }

    if (prefs.length < PAGE) break;
  }

  return Response.json({
    ran: true,
    dryRun,
    at: new Date().toISOString(),
    // True when Notification.clearedAt is not in this database yet: the sweep
    // is a no-op until prisma/sql/2026-09-18-notification-cleared-at.sql has
    // been applied, and this says so rather than reporting a quiet success.
    columnMissing,
    peopleWithPreference: seen,
    peopleSkipped: skipped,
    peopleSwept: swept.length,
    deleted: swept.reduce((n, s) => n + s.deleted, 0),
    detail: swept,
  });
}
