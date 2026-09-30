// Org-scoped audit trail (Settings > Audit log). Owner and Admin only, the
// page's own rule (it used to be the whole manager tier, while the only page
// that reads it was admin-only). Indexed on (organizationId, type, actorId,
// severity, createdAt).
//
// Every filter is SERVER-SIDE, so no list is ever searched in memory:
//   ?family=all|access|security|data|settings   the page's tabs
//   ?q=           words in the sentence or the event key
//   ?type=a,b     exact types (the Type filter, from /api/audit/types)
//   ?actor=id     one person;  ?severity=info|warning|critical
//   ?range=today|7d|30d|90d, or ?from= and ?to= (ISO)
//   ?cursor=      id of the last row (newest first); ?limit up to 200
//   ?format=csv   the same filtered set as a CSV download, up to 50,000 rows,
//                 logged as data.exported (decided addition e)
//
// An access row keeps who and what in metadata as ids; here they become the
// `summary` sentence, naming the node only when the auditor can open it.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { isAccessActivityType, accessAuditSentence } from "@/lib/access/access-activity";
import { nodeCtxFromLevel, nodeRoles } from "@/lib/access/node-access";
import { roleAtLeast, type NodeRef } from "@/lib/access/node-rules";
import type { AccessNodeKind } from "@/lib/access/access-panel";
import { sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { actorLabelOf, familyWhere, humanizeAuditSentence, isAuditFamily, rangeStart } from "@/lib/audit-families";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

const VALID_SEVERITY = new Set(["info", "warning", "critical"]);
const CSV_CAP = 50_000;

function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!sessionIsWorkspaceAdmin(session)) return jsonError("Only workspace Owners and Admins can read the audit log", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const family = sp.get("family") ?? "all";
  if (!isAuditFamily(family)) return jsonError("Unknown tab");
  const q = (sp.get("q") ?? "").trim().slice(0, 120);
  const types = (sp.get("type") ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 50);
  const actor = sp.get("actor") ?? sp.get("actorId");
  const targetType = sp.get("targetType");
  const targetId = sp.get("targetId");
  const severity = sp.get("severity");
  const from = sp.get("from") ?? sp.get("startDate");
  const to = sp.get("to") ?? sp.get("endDate");
  const range = sp.get("range");
  const cursor = sp.get("cursor");
  const csv = sp.get("format") === "csv";
  const dir: "asc" | "desc" = sp.get("order") === "asc" ? "asc" : "desc";
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 50) || 50), 200);

  const and: Prisma.ActivityLogWhereInput[] = [{ organizationId: orgId }];
  const fam = familyWhere(family);
  if (fam) and.push(fam);
  if (types.length) and.push({ type: { in: types } });
  if (actor) and.push({ actorId: actor });
  if (targetType) and.push({ targetType });
  if (targetId) and.push({ targetId });
  if (severity) {
    if (!VALID_SEVERITY.has(severity)) return jsonError("Invalid severity");
    and.push({ severity });
  }
  const created: { gte?: Date; lte?: Date } = {};
  const start = range ? rangeStart(range) : null;
  if (start) created.gte = start;
  if (from) { const d = new Date(from); if (!Number.isNaN(d.getTime())) created.gte = d; }
  if (to) { const d = new Date(to); if (!Number.isNaN(d.getTime())) created.lte = d; }
  if (created.gte || created.lte) and.push({ createdAt: created });
  if (q) {
    for (const word of q.split(/\s+/).slice(0, 6)) {
      and.push({ OR: [{ description: { contains: word, mode: "insensitive" } }, { type: { contains: word, mode: "insensitive" } }, { actorLabel: { contains: word, mode: "insensitive" } }] });
    }
  }
  const where: Prisma.ActivityLogWhereInput = { AND: and };

  const select = {
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
    actorType: true,
    actorLabel: true,
    actingForId: true,
    actor: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
  } as const;

  if (csv) {
    const rows = await prisma.activityLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CSV_CAP, select });
    const header = ["When", "Actor", "Actor type", "Event", "Type", "Severity", "Target type", "Target ID", "IP"];
    const lines = [header.map(csvCell).join(",")];
    for (const r of rows) {
      lines.push([r.createdAt.toISOString(), actorLabelOf(r), r.actorType, humanizeAuditSentence(r.description), r.type, r.severity, r.targetType ?? "", r.targetId ?? "", r.ipAddress ?? ""].map(csvCell).join(","));
    }
    logActivity({
      type: "data.exported",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Exported the audit log (${rows.length} events${rows.length >= CSV_CAP ? `, the newest ${CSV_CAP}` : ""})`,
      targetType: "export",
      severity: "warning",
      metadata: { kind: "audit", rows: rows.length, family, q: q || undefined, actor: actor || undefined, severity: severity || undefined },
    });
    return new Response(lines.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: [{ createdAt: dir }, { id: dir }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select,
    }),
    cursor ? Promise.resolve(null) : prisma.activityLog.count({ where }),
  ]);

  const hasMore = items.length > limit;
  const rows = hasMore ? items.slice(0, limit) : items;
  const user = session.user as { id?: string; accessLevel?: string };
  const summaries = await accessSummaries(orgId, user.id ?? "", user.accessLevel ?? null, rows).catch(() => new Map<string, string>());
  // metadata stays on the server: the summary is what the audit shows of it.
  const page = rows.map(({ metadata: _metadata, ...r }) => ({ ...r, description: humanizeAuditSentence(r.description), actorName: actorLabelOf(r), summary: summaries.get(r.id) ?? null }));

  return jsonSuccess({
    items: page,
    total,
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
