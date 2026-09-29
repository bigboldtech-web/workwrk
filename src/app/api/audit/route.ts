// Org-scoped audit trail. Manager+ to read; admin can export.
// Indexed on (organizationId, type, actorId, severity, createdAt)
// so the common filter combinations stay sub-second even at
// Fortune-500 row counts.
//
// Cursor pagination by id (DESC) — newest first; fetch `limit + 1`
// to detect "more" without a separate count query.
//
// An access row (a grant, a role change, a removal, a general access change)
// keeps who and what in metadata as ids, never in its description. Here, and
// only here, they become the `summary` line Settings > Audit prints: the
// person's name, and the node's name when the auditor can open that node
// (otherwise its noun alone, so the audit never names what the reader of the
// audit cannot open).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAccessActivityType, accessAuditSentence } from "@/lib/access/access-activity";
import { nodeCtxFromLevel, nodeRoles } from "@/lib/access/node-access";
import { roleAtLeast, type NodeRef } from "@/lib/access/node-rules";
import type { AccessNodeKind } from "@/lib/access/access-panel";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";

const VALID_SEVERITY = new Set(["info", "warning", "critical"]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  const actorId = sp.get("actorId");
  const targetType = sp.get("targetType");
  const targetId = sp.get("targetId");
  const severity = sp.get("severity");
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const cursor = sp.get("cursor");
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 100)), 500);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (type) where.type = type;
  if (actorId) where.actorId = actorId;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;
  if (severity) {
    if (!VALID_SEVERITY.has(severity)) return jsonError("Invalid severity");
    where.severity = severity;
  }
  if (startDate || endDate) {
    const created: Record<string, Date> = {};
    if (startDate) created.gte = new Date(startDate);
    if (endDate) created.lte = new Date(endDate);
    where.createdAt = created;
  }

  const items = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      type: true,
      description: true,
      targetType: true,
      targetId: true,
      severity: true,
      oldValue: true,
      newValue: true,
      metadata: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      actor: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  const hasMore = items.length > limit;
  const rows = hasMore ? items.slice(0, limit) : items;
  const user = session.user as { id?: string; accessLevel?: string };
  const summaries = await accessSummaries(orgId, user.id ?? "", user.accessLevel ?? null, rows).catch(() => new Map<string, string>());
  // metadata stays on the server: the summary is what the audit shows of it.
  const page = rows.map(({ metadata: _metadata, ...r }) => ({ ...r, summary: summaries.get(r.id) ?? null }));

  return jsonSuccess({
    items: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}

const NODE_KINDS: ReadonlySet<string> = new Set(["space", "folder", "list", "doc", "table", "canvas", "form"]);

type AuditMeta = { nodeKind?: unknown; nodeId?: unknown; granteeId?: unknown; email?: unknown; role?: unknown; previousRole?: unknown };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** One line per access row: the grantee's name and, when the auditor can open it, the node's. */
async function accessSummaries(
  orgId: string,
  auditorId: string,
  auditorLevel: string | null,
  rows: Array<{ id: string; type: string; metadata: unknown }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const access = rows
    .filter((r) => isAccessActivityType(r.type))
    .map((r) => {
      const m = (r.metadata && typeof r.metadata === "object" ? r.metadata : {}) as AuditMeta;
      const kind = str(m.nodeKind);
      return {
        row: r,
        kind: kind && NODE_KINDS.has(kind) ? (kind as AccessNodeKind) : null,
        nodeId: str(m.nodeId),
        granteeId: str(m.granteeId),
        // An email invitation names an address: the invitee has no account yet.
        email: str(m.email),
        role: str(m.role),
        previousRole: str(m.previousRole),
      };
    });
  if (access.length === 0) return out;

  const refs: NodeRef[] = [];
  for (const a of access) if (a.kind && a.nodeId) refs.push({ kind: a.kind, id: a.nodeId });
  const granteeIds = [...new Set(access.map((a) => a.granteeId).filter((v): v is string => !!v))];
  const [decisions, people] = await Promise.all([
    refs.length && auditorId ? nodeRoles(nodeCtxFromLevel(auditorId, orgId, auditorLevel), refs) : Promise.resolve(new Map()),
    granteeIds.length
      ? prisma.user.findMany({ where: { id: { in: granteeIds }, organizationId: orgId }, select: { id: true, firstName: true, lastName: true, email: true } })
      : Promise.resolve([]),
  ]);
  const readable = refs.filter((r) => roleAtLeast(decisions.get(`${r.kind}:${r.id}`)?.role ?? "none", "VIEW"));
  const names = await nodeNames(orgId, readable);
  const personName = new Map(people.map((p) => [p.id, [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.email || "Someone"]));

  for (const a of access) {
    if (!isAccessActivityType(a.row.type)) continue;
    out.set(a.row.id, accessAuditSentence(a.row.type, {
      kind: a.kind,
      nodeName: a.kind && a.nodeId ? names.get(`${a.kind}:${a.nodeId}`) ?? null : null,
      granteeName: a.granteeId ? personName.get(a.granteeId) ?? "a former member" : a.email,
      role: a.role,
      previousRole: a.previousRole,
    }));
  }
  return out;
}

/** The names of nodes the auditor can open, one query per kind, org scoped. */
async function nodeNames(orgId: string, refs: NodeRef[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = (kind: AccessNodeKind) => [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))];
  const put = (kind: AccessNodeKind, rows: Array<{ id: string; name: string }>) => {
    for (const r of rows) out.set(`${kind}:${r.id}`, r.name);
  };
  const where = (kind: AccessNodeKind) => ({ id: { in: ids(kind) }, organizationId: orgId });
  const tasks: Array<Promise<void>> = [];
  if (ids("space").length) tasks.push(prisma.space.findMany({ where: where("space"), select: { id: true, name: true } }).then((r) => put("space", r)));
  if (ids("folder").length) tasks.push(prisma.folder.findMany({ where: where("folder"), select: { id: true, name: true } }).then((r) => put("folder", r)));
  if (ids("list").length) tasks.push(prisma.board.findMany({ where: where("list"), select: { id: true, name: true } }).then((r) => put("list", r)));
  if (ids("doc").length) tasks.push(prisma.doc.findMany({ where: where("doc"), select: { id: true, title: true } }).then((r) => put("doc", r.map((d) => ({ id: d.id, name: d.title })))));
  if (ids("table").length) tasks.push(prisma.dataTable.findMany({ where: where("table"), select: { id: true, name: true } }).then((r) => put("table", r)));
  if (ids("canvas").length) tasks.push(prisma.whiteboard.findMany({ where: where("canvas"), select: { id: true, name: true } }).then((r) => put("canvas", r)));
  if (ids("form").length) tasks.push(prisma.formDefinition.findMany({ where: where("form"), select: { id: true, name: true } }).then((r) => put("form", r)));
  await Promise.all(tasks);
  return out;
}
