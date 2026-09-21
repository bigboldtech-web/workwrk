import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import {
  defaultSortDir,
  needsMyAck,
  parsePoliciesSort,
  resolvePolicyView,
  statusesForView,
  type PolicyStatus,
} from "@/lib/policies-list";

/**
 * GET /api/policies?view=&status=&category=&q=&sort=&dir=&page=&pageSize=
 *   &effFrom=&effTo=&acked=1 (spec-process section 2 `/policies`).
 *
 * Every Member reads the PUBLISHED rows; a FULL viewer (today's manager tier,
 * the same rule PATCH /api/policies/[id] enforces) also reads DRAFT and
 * ARCHIVED through the Drafts and Archived views. A view the viewer cannot
 * hold falls back to All server-side too, so a hand-built URL cannot leak an
 * unpublished row. `q` matches the title and the category. Every Filter
 * panel facet is server-side (section 1: "never a client filter over a
 * truncated page"): the effective date range narrows the query, and
 * `acked=1` keeps the rows the viewer has acknowledged at the current
 * version. The response carries the real total and the per-view counts.
 *
 * ONE AUDIENCE, ONE COUNT. The Acknowledged column ("1 of 26") divides by the
 * policy's audience: the named assignees when any assignment exists,
 * otherwise everyone at the org; the numerator is the people in that
 * audience acknowledged at the current ackVersion. The Audience panel, the
 * ledger and the compliance dashboard use the same rule (lib/policy-ledger,
 * lib/policy-compliance), so the same policy never shows four figures.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const canManage = isManager(session);
  const sp = new URL(req.url).searchParams;
  const { view } = resolvePolicyView(sp.get("view"), canManage);
  const q = (sp.get("q") ?? "").trim();
  const category = sp.get("category");
  const statusParam = sp.get("status");
  const effFrom = parseDay(sp.get("effFrom"));
  const effTo = parseDay(sp.get("effTo"), true);
  const ackedByMe = sp.get("acked") === "1";
  const sort = parsePoliciesSort(sp.get("sort"));
  const dir: "asc" | "desc" = sp.get("dir") === "asc" || sp.get("dir") === "desc" ? (sp.get("dir") as "asc" | "desc") : defaultSortDir(sort);
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(200, Number(sp.get("pageSize")) || 40));

  let statuses: PolicyStatus[] = statusesForView(view, canManage);
  if (statusParam && ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(statusParam)) {
    statuses = statuses.filter((s) => s === statusParam);
    if (statuses.length === 0) statuses = canManage ? [statusParam as PolicyStatus] : ["PUBLISHED"];
  }

  const where: Record<string, unknown> = { organizationId: orgId, status: { in: statuses } };
  if (category) where.category = category === "__none__" ? null : category;
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }];
  if (effFrom || effTo) where.effectiveDate = { ...(effFrom ? { gte: effFrom } : {}), ...(effTo ? { lte: effTo } : {}) };

  const orderBy = sort === "name" ? { title: dir } : sort === "effective" ? { effectiveDate: dir } : { updatedAt: dir };

  const [rows, totalUsers, currentUser, countsRaw] = await Promise.all([
    prisma.policy.findMany({
      where: where as never,
      include: {
        acknowledgments: { where: { userId }, select: { version: true, acknowledgedAt: true, ipAddress: true } },
        assignments: { where: { userId }, select: { id: true, status: true, dueDate: true, mandatory: true } },
        _count: { select: { assignments: true } },
      },
      orderBy,
    }),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null } }),
    prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }),
    prisma.policy.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: { _all: true } }),
  ]);

  // The org figures, for the people who can open the ledger: the audience
  // and the people in it acknowledged at the current version.
  const orgFigures = new Map<string, { audience: number; acked: number }>();
  if (canManage && rows.length) {
    const ids = rows.map((r) => r.id);
    const [assignRows, ackRows, activeUsers] = await Promise.all([
      prisma.policyAssignment.findMany({ where: { policyId: { in: ids } }, select: { policyId: true, userId: true } }),
      prisma.policyAcknowledgment.findMany({ where: { policyId: { in: ids } }, select: { policyId: true, userId: true, version: true } }),
      prisma.user.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { id: true } }),
    ]);
    const active = new Set(activeUsers.map((u) => u.id));
    const assignees = new Map<string, Set<string>>();
    for (const a of assignRows) { if (active.has(a.userId)) (assignees.get(a.policyId) ?? assignees.set(a.policyId, new Set()).get(a.policyId)!).add(a.userId); }
    const acks = new Map<string, Map<string, number>>();
    for (const a of ackRows) {
      const m = acks.get(a.policyId) ?? acks.set(a.policyId, new Map()).get(a.policyId)!;
      m.set(a.userId, Math.max(m.get(a.userId) ?? 0, a.version ?? 0));
    }
    for (const p of rows) {
      const named = assignees.get(p.id);
      const audienceIds = named && named.size ? named : active;
      let acked = 0;
      for (const [uid, v] of acks.get(p.id) ?? []) if (audienceIds.has(uid) && v >= p.ackVersion) acked++;
      orgFigures.set(p.id, { audience: audienceIds.size, acked });
    }
  }

  const mapped = rows.map((p) => {
    const myAcks = p.acknowledgments;
    const acknowledged = myAcks.some((a) => (a.version ?? 0) >= p.ackVersion);
    const latest = myAcks.slice().sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
    const assignment = p.assignments[0] ?? null;
    const hasAudience = p._count.assignments > 0;
    const facts = { requiresAck: p.requiresAck, status: p.status as PolicyStatus, assigned: !!assignment, acknowledged, hasAudience };
    const fig = orgFigures.get(p.id) ?? null;
    return {
      id: p.id,
      title: p.title,
      category: p.category,
      version: p.version,
      ackVersion: p.ackVersion,
      status: p.status as PolicyStatus,
      requiresAck: p.requiresAck,
      effectiveDate: p.effectiveDate,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      acknowledged,
      hasAudience,
      needsMyAck: needsMyAck(facts),
      acknowledgedAt: acknowledged ? latest?.acknowledgedAt ?? null : null,
      acknowledgedBy: acknowledged && currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : null,
      acknowledgedEmail: acknowledged ? currentUser?.email ?? null : null,
      acknowledgedIp: acknowledged ? latest?.ipAddress ?? null : null,
      myAssignment: assignment ? { id: assignment.id, status: assignment.status, dueDate: assignment.dueDate, mandatory: assignment.mandatory } : null,
      ackRate: fig && fig.audience > 0 ? Math.round((fig.acked / fig.audience) * 100) : null,
      totalAcks: fig ? fig.acked : null,
      // The audience the figure is over (named assignees, or everyone).
      totalUsers: fig ? fig.audience : null,
      assignedCount: canManage ? p._count.assignments : null,
    };
  });

  // The Needs my acknowledgement view and the Acknowledged-by-me facet are
  // per-viewer filters over PUBLISHED, applied before the page is cut.
  let filtered = view === "needs-ack" ? mapped.filter((p) => p.needsMyAck) : mapped;
  if (ackedByMe) filtered = filtered.filter((p) => p.acknowledged);
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  const byStatus: Record<string, number> = {};
  for (const c of countsRaw) byStatus[c.status] = c._count._all;
  const needsAck = mapped.filter((p) => p.needsMyAck && p.status === "PUBLISHED").length;
  const counts = {
    all: canManage ? (byStatus.DRAFT ?? 0) + (byStatus.PUBLISHED ?? 0) + (byStatus.ARCHIVED ?? 0) : byStatus.PUBLISHED ?? 0,
    published: byStatus.PUBLISHED ?? 0,
    drafts: byStatus.DRAFT ?? 0,
    archived: byStatus.ARCHIVED ?? 0,
    needsAck,
  };

  return jsonSuccess({ data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, counts, canManage, view, totalUsers });
}

/** "YYYY-MM-DD" to a Date at the start (or end) of that day; anything else is ignored. */
function parseDay(raw: string | null, endOfDay = false): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * POST /api/policies { title, category?, effectiveDate?, requiresAck?, content?, status? }
 * The New policy modal supplies the title; content is optional so a draft can
 * start empty and be written on the policy page (the old route required
 * non-empty content, which is why "New policy" 400ed for everyone).
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "policies", "create");
  if (denied) return denied;

  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const { title, content, category, requiresAck, effectiveDate, status } = body as Record<string, unknown>;

  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle) return jsonError("Title is required");
  const finalStatus: PolicyStatus = status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";
  const cleanContent = typeof content === "string" ? content.trim() : "";
  if (finalStatus === "PUBLISHED" && !cleanContent) return jsonError("Write the policy before publishing it");

  const policy = await prisma.policy.create({
    data: {
      title: cleanTitle,
      content: cleanContent,
      category: typeof category === "string" && category.trim() ? category.trim() : null,
      requiresAck: requiresAck !== false,
      effectiveDate: typeof effectiveDate === "string" && effectiveDate ? new Date(effectiveDate) : null,
      status: finalStatus,
      organizationId: orgId,
    },
  });

  if (finalStatus === "PUBLISHED") {
    const users = await prisma.user.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { id: true } });
    if (users.length > 0) {
      await prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          type: "policy_published",
          title: policy.requiresAck ? "New policy to acknowledge" : "New policy published",
          message: `${policy.title}${policy.category ? ` (${policy.category})` : ""}`,
          link: `/policies/${policy.id}`,
        })),
      });
    }
  }

  logAuditEvent({
    type: `policy.${finalStatus === "PUBLISHED" ? "publish" : "draft"}`,
    actorId: getUserId(session),
    organizationId: orgId,
    description: `${finalStatus === "PUBLISHED" ? "Published" : "Drafted"} policy: ${policy.title}`,
    targetId: policy.id,
    targetType: "Policy",
    metadata: { title: policy.title, category: policy.category, requiresAck: policy.requiresAck, status: finalStatus },
  });

  return jsonSuccess(policy, 201);
}
