// PATCH /api/weekly-reviews/[id]/manager-review
//   Body: { decision: "APPROVED" | "CHANGES_REQUESTED" | "REOPEN", notes }
//   (the retired { action: "approve" | "request_changes" } is read for one
//   release; src/lib/people/weekly-decision.ts)
//
// The ONE route both entry points write through (spec-teams-performance
// section 0 "PO-1 reconciled"): the Alignment board's inline Approve and
// Request changes, and the /team/reviews queue. A request for changes
// needs a note. REOPEN is the toast's Undo.
//
// Who may decide: anyone above the subject in the CURRENT reporting tree,
// solid or dotted (the Alignment board lists the recursive tree, so a
// skip-level Approve used to 403); the People team; Owner and Admin; and
// the recorded manager only while the subject has no manager today. A
// manager a report has moved away from no longer decides their reviews:
// the review moves to the new manager's queue (managerQueueWhere). Never
// the subject themself.
//
// On a decision the employee gets an Inbox row, both the employee and the
// deciding manager get the `review.decided` event so both badges and both
// surfaces refetch, and the actor is recorded in the activity log (the
// recorded manager is no longer overwritten with the actor).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { actOnReview, WeeklyDecisionConflict } from "@/lib/weekly-review";
import { isInReportTree } from "@/lib/reporting-line";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { isSeededPeopleTeam } from "@/lib/access/org-role";
import { parseWeeklyDecision, weeklyDecisionBlocked, weeklyReopenBlocked } from "@/lib/people/weekly-decision";
import { publishToUser } from "@/lib/realtime-bus";
import { parseAccessSettings } from "@/lib/access/settings";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = parseWeeklyDecision(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const row = await prisma.weeklyReview.findUnique({
    where: { id },
    select: {
      id: true, organizationId: true, managerId: true, status: true, userId: true,
      managerStatus: true, managerNotes: true, reviewedAt: true,
    },
  });
  if (!row || row.organizationId !== u.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (row.userId === u.id) {
    // A person can't decide their own review even if they happen to be admin.
    return NextResponse.json({ error: "Cannot act on your own review" }, { status: 400 });
  }

  const isOrgAdmin = legacyIsAdminLevel(u.accessLevel);
  const org = await prisma.organization.findUnique({ where: { id: u.organizationId }, select: { settings: true } });
  // The People team list is stored as access.peopleTeamUserIds; read it the
  // way the access engine does (src/lib/access/facts.ts) so a configured
  // member who is not HR-level is not refused here.
  const settings = (org?.settings ?? {}) as { access?: unknown };
  const peopleTeamOrAdmin =
    isOrgAdmin ||
    parseAccessSettings(settings.access).peopleTeamUserIds.includes(u.id) ||
    isSeededPeopleTeam(u.accessLevel);
  let allowed = peopleTeamOrAdmin || (await isInReportTree(u.id, row.userId));
  if (!allowed && row.managerId === u.id) {
    const subject = await prisma.user.findUnique({ where: { id: row.userId }, select: { managerId: true } });
    allowed = !subject?.managerId;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const blocked = weeklyDecisionBlocked(row.status, parsed.decision);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

  if (parsed.decision === "REOPEN") {
    // Who made the decision being undone: the latest decision in the log.
    const last = await prisma.activityLog.findFirst({
      where: { organizationId: u.organizationId, type: "weekly_review_decided", targetId: row.id },
      orderBy: { createdAt: "desc" },
      select: { actorId: true, metadata: true },
    });
    const lastDecision = (last?.metadata as { decision?: string } | null)?.decision;
    // No log row at all (a decision from before the log, or a log write that
    // failed): the recorded manager stands in as the decider, so the Undo
    // is never refused to the person who most likely made it.
    const deciderId = last ? (lastDecision !== "REOPEN" ? last.actorId : null) : row.managerId;
    const reopenBlocked = weeklyReopenBlocked({ actorId: u.id, deciderId, peopleTeamOrAdmin, reviewedAt: row.reviewedAt });
    if (reopenBlocked) return NextResponse.json({ error: reopenBlocked }, { status: 403 });
  }

  // The decision's activity row is written AWAITED, never fire-and-forget:
  // it is who may Undo, and for a REOPEN it is the only copy of the note the
  // Undo withdraws (the row's managerNotes is cleared). So a REOPEN writes
  // it FIRST and refuses to reopen when it cannot be written: the note is
  // never lost.
  const decisionLog = {
    type: "weekly_review_decided",
    actorId: u.id,
    organizationId: u.organizationId,
    description:
      parsed.decision === "REOPEN"
        ? "Reopened a weekly review"
        : parsed.decision === "APPROVED"
          ? "Approved a weekly review"
          : "Asked for changes to a weekly review",
    targetId: row.id,
    targetType: "weekly_review",
    severity: "info",
    metadata: {
      decision: parsed.decision,
      subjectId: row.userId,
      recordedManagerId: row.managerId,
      notes: parsed.decision === "REOPEN" ? null : parsed.notes,
      ...(parsed.decision === "REOPEN"
        ? { previousDecision: row.managerStatus, previousNotes: row.managerNotes, previousReviewedAt: row.reviewedAt?.toISOString() ?? null }
        : {}),
    },
  };
  const writeLog = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await prisma.activityLog.create({ data: decisionLog });
        return true;
      } catch (e) {
        console.error("weekly review decision log", e);
      }
    }
    return false;
  };
  if (parsed.decision === "REOPEN" && !(await writeLog())) {
    return NextResponse.json({ error: "Couldn't reopen right now, nothing changed. Try again." }, { status: 503 });
  }

  let review;
  try {
    review = await actOnReview(id, { decision: parsed.decision, notes: parsed.notes, actorId: u.id });
  } catch (e) {
    if (e instanceof WeeklyDecisionConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  // One Inbox row per review decision, addressed by the review, so an Undo
  // can rewrite the row it belongs to instead of leaving "approved" standing.
  // /me/weekly-review resolves ?review= to that review's own week, so
  // "asked for changes" on an earlier week opens that week, not this one.
  const inboxLink = `/me/weekly-review?review=${row.id}`;

  const actor = await prisma.user.findUnique({ where: { id: u.id }, select: { firstName: true, lastName: true } });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Your manager";
  if (parsed.decision !== "REOPEN") {
    await prisma.notification
      .create({
        data: {
          userId: row.userId,
          type: "weekly_review_decided",
          title:
            parsed.decision === "APPROVED"
              ? `${actorName} approved your weekly review`
              : `${actorName} asked for changes to your weekly review`,
          message: parsed.decision === "APPROVED" ? "Nothing more to do this week." : parsed.notes ?? "",
          link: inboxLink,
        },
      })
      .catch((e: unknown) => console.error("weekly review notification", e));
  } else {
    // The Undo: the decision's Inbox row now says it was withdrawn (never a
    // silent "approved" left behind). A row from before this release has no
    // review in its link; then a new row says so instead.
    const since = row.reviewedAt ? new Date(new Date(row.reviewedAt).getTime() - 60_000) : new Date(0);
    const rewritten = await prisma.notification
      .updateMany({
        where: { userId: row.userId, type: "weekly_review_decided", link: inboxLink, createdAt: { gte: since } },
        data: {
          title: `${actorName} reopened your weekly review`,
          message: "The earlier decision was withdrawn. A new one will follow.",
          read: false,
        },
      })
      .catch((e: unknown) => { console.error("weekly review notification", e); return { count: -1 }; });
    if (rewritten.count === 0) {
      await prisma.notification
        .create({
          data: {
            userId: row.userId,
            type: "weekly_review_decided",
            title: `${actorName} reopened your weekly review`,
            message: "The earlier decision was withdrawn. A new one will follow.",
            link: inboxLink,
          },
        })
        .catch((e: unknown) => console.error("weekly review notification", e));
    }
  }

  // A decision's log row (a REOPEN wrote its own before the change). The
  // decision itself already stands on the row; a log that still fails after
  // retries is reported, and the Undo falls back to the recorded manager.
  if (parsed.decision !== "REOPEN") await writeLog();

  // Both sidebars' Weekly reviews badge and both surfaces refetch.
  for (const uid of new Set([row.userId, u.id, row.managerId].filter((x): x is string => !!x))) {
    publishToUser(uid, { type: "review.decided", reviewId: row.id });
  }

  return NextResponse.json({ review });
}
