import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, isOrgAdmin, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { moveToTrash } from "@/lib/trash";
import { parseProcessSettings } from "@/lib/process-settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsBlob = Record<string, any>;

/**
 * GET /api/policies/[id] (spec-process section 2 `/policies/[id]`): the
 * policy with the viewer's own acknowledgement facts (`myAssignment`,
 * `myAcknowledgement`), the audience summary the Audience panel lists, the
 * org's acknowledgement defaults, and `access.role` (FULL for the people who
 * may write it, VIEW for everyone else). A Member reaches an unpublished
 * policy only when it is assigned to them; otherwise the answer is the same
 * 404 a missing id gets.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const full = isManager(session);

  const [policy, totalUsers, org] = await Promise.all([
    prisma.policy.findFirst({
      where: { id, organizationId: orgId },
      include: {
        acknowledgments: { select: { userId: true, version: true, acknowledgedAt: true } },
        assignments: { select: { id: true, userId: true, status: true, dueDate: true, mandatory: true, completedAt: true } },
      },
    }),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null } }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
  ]);
  if (!policy) return jsonError("Not found", 404);

  const mine = policy.assignments.find((a) => a.userId === userId) ?? null;
  if (!full && policy.status !== "PUBLISHED" && !mine) return jsonError("Not found", 404);

  const myAcks = policy.acknowledgments.filter((a) => a.userId === userId);
  const acknowledged = myAcks.some((a) => (a.version ?? 0) >= policy.ackVersion);
  const needsReack = !acknowledged && myAcks.length > 0;
  const latestAck = myAcks.slice().sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
  const currentAckUserIds = new Set(policy.acknowledgments.filter((a) => (a.version ?? 0) >= policy.ackVersion).map((a) => a.userId));

  // The Audience panel: everyone (no assignment rows) or the named people.
  const assigneeIds = policy.assignments.map((a) => a.userId);
  const people = assigneeIds.length
    ? await prisma.user.findMany({
        where: { id: { in: assigneeIds }, organizationId: orgId },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true, department: { select: { id: true, name: true } } },
      })
    : [];
  const byId = new Map(people.map((u) => [u.id, u]));
  const departments = new Map<string, { id: string; name: string; count: number }>();
  for (const u of people) {
    if (!u.department) continue;
    const d = departments.get(u.department.id) ?? { id: u.department.id, name: u.department.name, count: 0 };
    d.count++;
    departments.set(u.department.id, d);
  }
  const settings = (org?.settings as SettingsBlob | null) || {};
  const processSettings = parseProcessSettings(settings.process).value;

  return jsonSuccess({
    ...policy,
    acknowledgments: undefined,
    assignments: undefined,
    acknowledged,
    needsReack,
    totalAcks: currentAckUserIds.size,
    totalUsers,
    // Kept for older callers; the page reads access.role.
    canEdit: full,
    access: { role: full ? "FULL" : "VIEW" },
    myAssignment: mine ? { id: mine.id, status: mine.status, dueDate: mine.dueDate, mandatory: mine.mandatory, completedAt: mine.completedAt } : null,
    myAcknowledgement: latestAck ? { version: latestAck.version, acknowledgedAt: latestAck.acknowledgedAt, current: acknowledged } : null,
    audienceSummary: {
      everyone: policy.assignments.length === 0,
      count: policy.assignments.length === 0 ? totalUsers : policy.assignments.length,
      acknowledged: currentAckUserIds.size,
      departments: Array.from(departments.values()).sort((a, b) => b.count - a.count),
      people: full
        ? policy.assignments.map((a) => {
            const u = byId.get(a.userId);
            return { assignmentId: a.id, id: a.userId, firstName: u?.firstName ?? null, lastName: u?.lastName ?? null, email: u?.email ?? null, avatar: u?.avatar ?? null, status: a.status, dueDate: a.dueDate, mandatory: a.mandatory, department: u?.department?.name ?? null };
          })
        : [],
    },
    defaults: { ackStatement: processSettings.ackStatement, ackDueDays: processSettings.ackDueDays },
  });
}

/**
 * PATCH /api/policies/[id] { title, content, category, effectiveDate,
 * requiresAck, ackStatement, status, requireReack }. FULL only. A change to a
 * PUBLISHED policy's title or content snapshots the prior state and bumps
 * `version`; `ackVersion` moves only with `requireReack`, and the first
 * publish baselines it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (body.title !== undefined) data.title = String(body.title).trim() || "Untitled policy";
  if (body.content !== undefined) data.content = String(body.content ?? "");
  if (body.category !== undefined) data.category = body.category ? String(body.category).trim() || null : null;
  if (body.requiresAck !== undefined) data.requiresAck = !!body.requiresAck;
  if (body.ackStatement !== undefined) data.ackStatement = typeof body.ackStatement === "string" && body.ackStatement.trim() ? body.ackStatement.trim() : null;
  if (body.effectiveDate !== undefined) data.effectiveDate = body.effectiveDate ? new Date(body.effectiveDate) : null;
  if (body.status !== undefined) {
    if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(body.status)) return jsonError("Unknown status");
    data.status = body.status;
  }

  const existing = await prisma.policy.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!existing) return jsonError("Not found", 404);
  if (data.status === "PUBLISHED" && !(data.content ?? existing.content).trim()) return jsonError("Write the policy before publishing it");

  const touchesContent = body.content !== undefined && body.content !== existing.content;
  const touchesTitle = body.title !== undefined && data.title !== existing.title;
  const requireReack = body.requireReack === true;
  let versionBumped = false;
  if (existing.status === "PUBLISHED" && (touchesContent || touchesTitle)) {
    await prisma.policyVersion.create({
      data: { policyId: id, version: existing.version, title: existing.title, content: existing.content, status: existing.status, publishedBy: getUserId(session) },
    });
    data.version = existing.version + 1;
    versionBumped = true;
    if (requireReack) data.ackVersion = existing.version + 1;
  }
  // A republish that changes nothing but asks for re-acknowledgement is a
  // new round: the prior state is snapshotted and BOTH version and
  // ackVersion move, so every existing acknowledgement (pinned to the old
  // version) is invalidated and the new one can be recorded as its own
  // row. Setting ackVersion to the unchanged version, as this once did,
  // invalidated nothing while the assignments were reopened and everyone
  // was told to acknowledge again.
  if (!versionBumped && requireReack && existing.status === "PUBLISHED" && (data.status ?? existing.status) === "PUBLISHED") {
    await prisma.policyVersion.create({
      data: { policyId: id, version: existing.version, title: existing.title, content: existing.content, status: existing.status, publishedBy: getUserId(session) },
    });
    data.version = existing.version + 1;
    data.ackVersion = existing.version + 1;
    versionBumped = true;
  }
  if (data.status === "PUBLISHED" && existing.status !== "PUBLISHED") {
    data.ackVersion = data.version ?? existing.version;
  }

  const updated = await prisma.policy.update({ where: { id }, data });

  if (requireReack && versionBumped) {
    await prisma.policyAssignment.updateMany({ where: { policyId: id, status: "COMPLETED" }, data: { status: "ASSIGNED", completedAt: null } });
    const assignees = await prisma.policyAssignment.findMany({ where: { policyId: id }, select: { userId: true } });
    if (assignees.length) {
      await prisma.notification.createMany({
        data: assignees.map((a) => ({ userId: a.userId, type: "policy.reacknowledge", title: "Policy changed, acknowledge again", message: `"${updated.title}" is now version ${updated.version}.`, link: `/policies/${id}` })),
      });
    }
  }
  if (data.status === "PUBLISHED" && existing.status !== "PUBLISHED") {
    const orgId = getOrgId(session);
    const assignees = await prisma.policyAssignment.findMany({ where: { policyId: id }, select: { userId: true } });
    const targets = assignees.length ? assignees.map((a) => a.userId) : (await prisma.user.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { id: true } })).map((u) => u.id);
    if (targets.length) {
      await prisma.notification.createMany({
        data: targets.map((uid) => ({ userId: uid, type: "policy_published", title: updated.requiresAck ? "New policy to acknowledge" : "New policy published", message: updated.title, link: `/policies/${id}` })),
      });
    }
    logAuditEvent({ type: "policy.publish", actorId: getUserId(session), organizationId: orgId, description: `Published policy: ${updated.title}`, targetId: id, targetType: "Policy", metadata: { version: updated.version } });
  }

  return jsonSuccess(updated);
}

/** DELETE: Owner and Admin (spec-process section 1). Moves the policy to the one Trash. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session) && !isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const existing = await prisma.policy.findFirst({ where: { id, organizationId: getOrgId(session) }, select: { id: true } });
  if (!existing) return jsonError("Not found", 404);
  await moveToTrash("policy", id, { organizationId: getOrgId(session), userId: getUserId(session), userName: (session.user as { name?: string }).name ?? null });
  return jsonSuccess({ message: "Deleted" });
}
