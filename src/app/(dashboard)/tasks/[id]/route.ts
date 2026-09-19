// /tasks/<legacy task id>: the forwarding address for every old task link.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/tasks/[id]) and
// section 4, W4.
//
// WHAT THIS REPLACED. A 485-line bespoke detail page on the legacy `Task`
// model that could not load a task by id at all: it fetched a DATE RANGE from
// GET /api/tasks and filtered the response client-side, because there has
// never been a GET /api/tasks/[id]. Every task now lives on the Item model and
// has one detail surface, /item/[id], so this file's whole job is to send a
// person there.
//
// WHY A ROUTE HANDLER, having briefly been a page. The spec asked for a page
// so that a MISS could render the in-shell 404 with the rail, sidebar and bar
// intact. A page cannot do the redirect half of the job:
//
//   1. `redirect()` inside a streaming server component paints the shell
//      first and delivers the redirect as an RSC instruction, so the response
//      is HTTP 200 with NO Location header. Only a JS-executing browser
//      follows it. curl -L, a Slack or email link unfurler, an integration and
//      a crawler all get a 200 that tells them nothing — and the verification
//      step in scripts/MIGRATIONS.md is a browser check, so it hid this.
//   2. Worse in a browser: an RSC redirect is a SOFT navigation, so the
//      @drawer intercepting route at (dashboard)/@drawer/(.)item/[id] matched
//      and the task rendered as a drawer floating over a blank white page —
//      the `children` slot was still parked on this segment, which had
//      rendered nothing. Every old task link in an email, a doc block or a
//      bookmark arrived that way.
//
// A route handler answers a real 308 before anything paints, which is a HARD
// navigation, so the drawer never intercepts and /item/[id] renders its full
// page with the BackButton crumb.
//
// A MISS IS NOT AN ERROR, and still renders the in-shell 404. Three things
// land here with no forwarding row:
//   1. a task in an org whose migration has not run yet;
//   2. a task id that never existed;
//   3. a task whose row is real but belongs to another workspace.
// All three are sent to /item/<the same id>, which is a real page inside the
// same shell and says the same thing for all three, so a stranger's id and an
// id that never existed are indistinguishable (access 5.5 rule 2). That page
// now says "We couldn't find that task" for EVERY 404, not only for this
// marker, because the three states above are three states it cannot tell
// apart either. `?from=legacy-task` therefore no longer changes a word the
// reader sees; it stays as the trail that says how someone arrived, which is
// the difference between a support answer and a guess.
//
// THE MISS IS 307 AND THE HIT IS 308, on purpose. A hit is a permanent fact:
// that task IS this Item, forever, so the bookmark and the unfurler should
// learn it once. A miss is a temporary one: a task whose org has not migrated
// yet WILL resolve as soon as the founder runs the script, and a permanent
// redirect to a dead end is exactly the thing browsers and crawlers cache and
// keep serving afterwards.
//
// The lookup is scoped to the viewer's org so a stranger's task id cannot be
// confirmed: every id outside the viewer's workspace takes the miss path,
// exactly like an id that never existed.
//
// The `Task` table is NOT read. It stays readable for at least one release
// (scripts/MIGRATIONS.md rule 6) but this file deliberately does not consult
// it: an un-migrated row has no Item to open, so finding it would only let the
// product render a task nobody can act on.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LEGACY_REDIRECT_KINDS } from "@/lib/work/legacy-task-map";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const miss = NextResponse.redirect(new URL(`/item/${encodeURIComponent(id)}?from=legacy-task`, req.url), 307);

  const session = await getServerSession(authOptions);
  const organizationId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!organizationId) return miss;

  // The table may be absent for one release on an instance that has not had
  // prisma/sql/2026-09-18-task-detail-phase2.sql applied. A missing table
  // degrades this to the miss path; it never 500s an old link.
  const row = await prisma.legacyRedirect
    .findUnique({
      where: {
        organizationId_kind_legacyId: {
          organizationId,
          kind: LEGACY_REDIRECT_KINDS.task,
          legacyId: id,
        },
      },
      select: { target: true },
    })
    .catch(() => null);

  // Only ever an in-app path this migration wrote, and checked rather than
  // trusted: a stored value is still data, and a redirect takes whatever it is
  // given, including an absolute URL to somewhere else.
  if (row?.target && row.target.startsWith("/item/")) {
    return NextResponse.redirect(new URL(row.target, req.url), 308);
  }
  return miss;
}
