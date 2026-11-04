import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";
import { sendEmail } from "@/lib/email";
import { sopAssignedTemplate } from "@/lib/email-templates";
import { employedAmong } from "@/lib/people/employed.server";
import { idsPlacedHere, placedHere } from "@/lib/access/profile-here";
import { ALIGNMENT_NOT_HERE } from "@/lib/people/person-fields";

// Roles that may assign org-wide; everyone else is scoped to their own
// report tree. Mirrors the scope logic on GET /api/kras.
const ORG_WIDE_ASSIGNERS = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);

// GET: Get SOP assignments — by userId (my assignments) or by sopId (who's assigned)
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const sopId = searchParams.get("sopId");
  const userId = searchParams.get("userId");
  const status = searchParams.get("status");
  const orgId = getOrgId(session);

  const where: any = {
    sop: { organizationId: orgId },
  };

  if (sopId) where.sopId = sopId;

  // Visibility: assignment rows expose who has / hasn't completed
  // mandatory training. Non-managers only ever see their own rows —
  // userId / sopId params can't widen that. Managers without an
  // org-wide role are scoped to their report tree (self included),
  // mirroring the assignment governance on POST below.
  const callerId = getUserId(session);
  if (!isManager(session)) {
    // Refuse, never substitute: silently returning the caller's own rows
    // under someone else's userId would mislabel the data client-side.
    if (userId && userId !== callerId) {
      return jsonError("You can only view your own assignments.", 403);
    }
    where.userId = callerId;
  } else {
    const orgWide = ORG_WIDE_ASSIGNERS.has((session.user as any).accessLevel as string);
    const teamIds = orgWide ? null : new Set(await getTeamUserIds(orgId, callerId));
    if (userId) {
      if (teamIds && !teamIds.has(userId)) {
        return jsonError("You can only view assignments for people who report to you.", 403);
      }
      where.userId = userId;
    } else if (sopId) {
      // "Who's assigned this SOP" — org-wide roles see everyone,
      // team-scoped managers see their report tree.
      if (teamIds) where.userId = { in: [...teamIds] };
    } else {
      // Default: show current user's assignments
      where.userId = callerId;
    }
  }
  if (status) where.status = status;

  const assignments = await prisma.sOPAssignment.findMany({
    where,
    include: {
      sop: {
        select: {
          id: true, title: true, category: true, status: true,
          content: true, version: true, sopType: true,
        },
      },
      user: {
        select: {
          id: true, firstName: true, lastName: true, email: true,
          // With its workspace: named only when this one's (D18; the final review, security M1).
          department: { select: { id: true, name: true, organizationId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return jsonSuccess(assignments.map((a) => ({ ...a, user: placedHere(a.user, orgId) })));
}

// POST: Assign SOP to person(s) — bulk assign with userIds[]
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { sopId, userIds, departmentId, all, dueDate, mandatory } = body;

  if (!sopId) return jsonError("sopId is required");

  // Verify SOP belongs to org
  const sop = await prisma.sOP.findFirst({
    where: { id: sopId, organizationId: orgId },
  });
  if (!sop) return jsonError("SOP not found", 404);

  // Reference SOPs (WRITTEN / RECORDED) are guides, not trackable work —
  // leave stepsTotal at 0 so they never show a completion percentage or
  // graduate into a "Completed" bucket. Only CHECKLIST SOPs accumulate
  // step progress, because those are the ones users actually run.
  const content = sop.content as any;
  let stepsTotal = 0;
  if (sop.sopType === "CHECKLIST") {
    const sections = (content?.sections as any[]) || [];
    stepsTotal = sections.reduce((sum, s) => sum + (s?.steps?.length || 0), 0);
  }

  // Resolve user IDs — either from userIds array or from departmentId. The
  // people named are kept only while they can still be given work here:
  // never someone deactivated or removed, never an id from another workspace.
  let resolvedUserIds: string[] = Array.isArray(userIds) ? await employedAmong(orgId, userIds) : [];
  // Someone here through a membership is never given an SOP here
  // (docs/plans/workspace-status-2.md, the step 5 review M1): an SOP
  // assignment names no workspace, so it showed and counted in the workspace
  // their account is in (My SOPs, the open count), and its notice and email
  // went there. Refused in words, nothing written, so the person picking
  // knows rather than seeing one fewer assigned.
  if (resolvedUserIds.length > 0) {
    const elsewhere = (await prisma.user.findMany({ where: { id: { in: resolvedUserIds } }, select: { id: true, organizationId: true } }))
      .filter((u) => u.organizationId !== orgId)
      .map((u) => u.id);
    if (elsewhere.length > 0) return NextResponse.json({ error: ALIGNMENT_NOT_HERE, code: "alignment_elsewhere", userIds: elsewhere }, { status: 400 });
  }

  // By department or everyone: the people ANCHORED here only, by their
  // account's department, never someone here through a membership, whatever
  // department their membership holds (docs/plans/workspace-status-2.md E15,
  // step 8, kept anchored by the step 5 review M1): an SOP assignment names
  // no workspace, so one made here for them would show and count in the
  // workspace their account is in. A known limit, until SOP assignments are
  // per workspace.
  if (departmentId) {
    const deptUsers = await prisma.user.findMany({
      // Everyone in it who can sign in (on leave or on probation included), never someone removed.
      where: { departmentId, organizationId: orgId, status: { not: "INACTIVE" }, deletedAt: null },
      select: { id: true },
    });
    resolvedUserIds = [...new Set([...resolvedUserIds, ...deptUsers.map((u) => u.id)])];
  }

  // Everyone, resolved here rather than by the dialog, so it is never cut at
  // the dialog's page of people (the governance rule below still narrows a
  // manager to their reports).
  if (all === true) {
    const everyone = await prisma.user.findMany({
      where: { organizationId: orgId, status: { not: "INACTIVE" }, deletedAt: null },
      select: { id: true },
    });
    resolvedUserIds = [...new Set([...resolvedUserIds, ...everyone.map((u) => u.id)])];
  }

  // Said plainly (the step 8 review L5): the people placed there here
  // through a membership whom the department or everyone would have reached
  // (the same live seats), so the answer never reads "1 assigned" under a
  // department the lists count as 3. A manager's reach narrows them as it
  // narrows everyone else.
  const callerLevel = (session.user as any).accessLevel as string;
  const teamIds = ORG_WIDE_ASSIGNERS.has(callerLevel) ? null : new Set(await getTeamUserIds(orgId, getUserId(session)));
  const notAssignedElsewhere = departmentId || all === true
    ? (await idsPlacedHere(orgId, all === true ? "everyone" : { departmentIds: [departmentId] }, "live", { only: "membership" })).filter((uid) => !teamIds || teamIds.has(uid)).length
    : 0;
  const elsewhereNote: { notAssignedElsewhere?: number; alignmentNote?: string } = notAssignedElsewhere > 0
    ? { notAssignedElsewhere, alignmentNote: `${notAssignedElsewhere} ${notAssignedElsewhere === 1 ? "person" : "people"} here from another workspace's account ${notAssignedElsewhere === 1 ? "was" : "were"} not assigned. ${ALIGNMENT_NOT_HERE}` }
    : {};

  if (resolvedUserIds.length === 0) {
    if (Array.isArray(userIds) && userIds.length > 0 && !departmentId && all !== true) {
      return jsonError("No one you chose can be given work here: they were deactivated or are not in this workspace.");
    }
    if (elsewhereNote.alignmentNote) return NextResponse.json({ error: elsewhereNote.alignmentNote, code: "alignment_elsewhere", ...elsewhereNote }, { status: 400 });
    return jsonError("No users specified. Provide userIds[], departmentId or all:true");
  }

  // Governance: managers may only assign SOPs to people in their own
  // report tree. Org-wide roles (admin / exec / HR) assign anywhere. For a
  // department-wide assign, a manager's reach is the intersection with
  // their reports.
  if (teamIds) {
    resolvedUserIds = resolvedUserIds.filter((uid) => teamIds.has(uid));
    if (resolvedUserIds.length === 0) {
      return jsonError("You can only assign SOPs to people who report to you.", 403);
    }
  }

  // People who already hold this SOP keep their assignment as it is and are
  // not told again.
  const already = new Set(
    (await prisma.sOPAssignment.findMany({ where: { sopId, userId: { in: resolvedUserIds } }, select: { userId: true } })).map((a) => a.userId),
  );
  resolvedUserIds = resolvedUserIds.filter((uid) => !already.has(uid));
  if (resolvedUserIds.length === 0) return jsonSuccess({ message: "Everyone chosen already has this SOP", count: 0, ...elsewhereNote }, 200);

  const assignerId = getUserId(session);
  const data = resolvedUserIds.map((uid: string) => ({
    sopId,
    userId: uid,
    mandatory: mandatory ?? true,
    dueDate: dueDate ? new Date(dueDate) : null,
    stepsTotal,
    assignedBy: assignerId,
  }));

  const result = await prisma.sOPAssignment.createMany({
    data,
    skipDuplicates: true,
  });

  // Notify assigned users
  const notifications = resolvedUserIds.map((uid: string) => ({
    title: "SOP Assigned",
    message: `You have been assigned "${sop.title}". ${dueDate ? `Due by ${new Date(dueDate).toLocaleDateString()}.` : ""}`,
    type: "sop",
    link: `/sops/my-sops`,
    userId: uid,
  }));

  await prisma.notification.createMany({ data: notifications });

  // Send SOP assignment emails
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const assignedUsers = await prisma.user.findMany({
    where: { id: { in: resolvedUserIds } },
    select: { id: true, email: true },
  });

  for (const user of assignedUsers) {
    const { subject, html } = sopAssignedTemplate({
      sopTitle: sop.title,
      dueDate: dueDate ? new Date(dueDate).toLocaleDateString() : undefined,
      sopLink: `${baseUrl}/sops/my-sops`,
    });

    try {
      await sendEmail({
        to: user.email,
        subject,
        html,
        template: "sop-assigned",
        variables: { sopTitle: sop.title, dueDate },
        organizationId: orgId,
        userId: user.id,
        category: "sop",
      });
    } catch (emailErr) {
      console.error("[SOPAssignment] Email send failed:", emailErr);
    }
  }

  return jsonSuccess({ message: `${result.count} assignments created`, count: result.count, ...elsewhereNote }, 201);
}
