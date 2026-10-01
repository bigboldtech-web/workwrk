// The loader half of the task connection trail (src/lib/task-trail.ts holds
// the rules and the pure assembly). Server only: prisma. The caller has
// already gated the task (gateItem "view").

import { prisma } from "@/lib/prisma";
import { sopVisibilityWhere } from "@/lib/sop-access";
import { goalVisibilityOr } from "@/lib/goal-audience";
import { readableFileIds } from "@/lib/file-access";
import { idsWithRole, type NodeCtx } from "@/lib/access/node-access";
import type { Viewer } from "@/lib/access/types";
import { readSopStepOrigin, runnableSteps } from "@/lib/sop-step-owner";
import { assembleTrail, formatLogged, ownerNoticeFor, type TrailCandidate, type TrailEntry, type TrailKind } from "@/lib/task-trail";

/** The session as the SOP and goal rules read it, passed through untouched. */
type SessionLike = Parameters<typeof sopVisibilityWhere>[0] & Parameters<typeof goalVisibilityOr>[0];

/**
 * Who is reading: the session (for the SOP and goal rules, which take it
 * whole), the engine's Viewer (Member or Guest, the manager tier), the node
 * context (docs, canvases, tables, Lists) and the request context the file
 * rule takes whole.
 */
export interface TrailReader {
  session: SessionLike;
  viewer: Viewer;
  nodeCtx: NodeCtx;
  fileViewer: Parameters<typeof readableFileIds>[0]["viewer"];
}

export interface TrailTask {
  id: string;
  organizationId: string;
  boardId: string;
  metadata: unknown;
  /** Who the task is assigned to NOW (the notice is only true while this is empty). */
  assigneeIds: string[];
  ownerId: string | null;
  board: { spaceId: string | null };
}

export interface TaskTrail {
  entries: TrailEntry[];
  /** Why an SOP-spawned task has nobody on it, while it still has nobody (shown on the task). */
  ownerNotice: string | null;
}

/** May this viewer give people a job title (People, the role pages)? */
function managesJobTitles(viewer: Viewer): boolean {
  return viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN" || viewer.peopleTeam === true;
}

const TASK_TYPES = ["BOARD_ITEM", "TASK"] as const;
const NODE_OF: Partial<Record<string, { kind: TrailKind; node: "doc" | "canvas" | "table" | "list" }>> = {
  DOC: { kind: "doc", node: "doc" },
  NOTE: { kind: "doc", node: "doc" },
  WHITEBOARD: { kind: "canvas", node: "canvas" },
  TABLE: { kind: "table", node: "table" },
  BOARD: { kind: "list", node: "list" },
};

export async function loadTaskTrail(reader: TrailReader, task: TrailTask): Promise<TaskTrail> {
  const { session, viewer } = reader;
  const orgId = task.organizationId;
  const userId = viewer.userId;
  const member = viewer.orgRole !== "GUEST";
  const meta = (task.metadata && typeof task.metadata === "object" ? task.metadata : {}) as Record<string, unknown>;
  // The stored origin is only a pointer: the step must still be a step of
  // that SOP in this workspace, and its number and text are read from the
  // SOP itself, so a hand-written metadata.sopStep can name nothing made up.
  const stored = readSopStepOrigin(meta);
  const originSop = stored
    ? await prisma.sOP.findFirst({ where: { id: stored.sopId, organizationId: orgId }, select: { content: true } })
    : null;
  const realStep = stored && originSop ? runnableSteps(originSop.content).find((st) => st.stepId === stored.stepId) ?? null : null;
  // The job title it was routed by must be the step's own job title too;
  // otherwise the task shows the step but no owner line and no notice.
  const origin = stored && realStep
    ? { ...stored, n: realStep.n, stepTitle: realStep.title, jobTitle: stored.jobTitle && realStep.jobTitle?.roleId === stored.jobTitle.roleId ? stored.jobTitle : null }
    : null;
  const kraIds = new Set<string>();
  const kpiIds = new Set<string>();
  if (typeof meta.kraId === "string" && meta.kraId) kraIds.add(meta.kraId);
  if (typeof meta.kpiId === "string" && meta.kpiId) kpiIds.add(meta.kpiId);

  // Every link with the task at either end.
  const links = await prisma.entityLink.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { sourceType: { in: [...TASK_TYPES] }, sourceId: task.id },
        { targetType: { in: [...TASK_TYPES] }, targetId: task.id },
      ],
    },
    select: { sourceType: true, sourceId: true, targetType: true, targetId: true, context: true },
    take: 200,
  });
  const ends: Array<{ type: string; id: string; context: string | null }> = links.map((l) =>
    (TASK_TYPES as readonly string[]).includes(l.sourceType) && l.sourceId === task.id
      ? { type: l.targetType, id: l.targetId, context: l.context }
      : { type: l.sourceType, id: l.sourceId, context: l.context },
  );
  for (const e of ends) {
    if (e.type === "KRA") kraIds.add(e.id);
    if (e.type === "KPI") kpiIds.add(e.id);
  }
  const of = (t: string) => [...new Set(ends.filter((e) => e.type === t).map((e) => e.id))];
  const sopIds = new Set(of("SOP"));
  if (origin) sopIds.add(origin.sopId);

  // Goals: linked to the task, its List, its Space or its KRA; or tracking its KPI.
  const goalTargets: Array<{ targetType: "BOARD_ITEM" | "BOARD" | "SPACE" | "KRA"; targetId: { in: string[] } }> = [
    { targetType: "BOARD_ITEM", targetId: { in: [task.id] } },
    { targetType: "BOARD", targetId: { in: [task.boardId] } },
  ];
  if (task.board.spaceId) goalTargets.push({ targetType: "SPACE", targetId: { in: [task.board.spaceId] } });
  if (kraIds.size) goalTargets.push({ targetType: "KRA", targetId: { in: [...kraIds] } });
  const [goalLinks, krGoals] = await Promise.all([
    prisma.entityLink.findMany({ where: { organizationId: orgId, sourceType: "OKR", OR: goalTargets }, select: { sourceId: true }, take: 100 }),
    kpiIds.size ? prisma.keyResult.findMany({ where: { kpiId: { in: [...kpiIds] }, okr: { organizationId: orgId } }, select: { okrId: true }, take: 100 }) : Promise.resolve([] as Array<{ okrId: string }>),
  ]);
  const goalIds = new Set<string>([...of("OKR"), ...goalLinks.map((g) => g.sourceId), ...krGoals.map((k) => k.okrId)]);

  // Titles, each read under its own access rule.
  const sopWhere = sopIds.size ? await sopVisibilityWhere(session) : null;
  const goalOr = goalIds.size ? await goalVisibilityOr(session) : null;
  const [sops, kras, kpis, goals] = await Promise.all([
    sopIds.size ? prisma.sOP.findMany({ where: { AND: [{ id: { in: [...sopIds] }, organizationId: orgId }, sopWhere ?? {}] }, select: { id: true, title: true } }) : [],
    member && kraIds.size ? prisma.kRA.findMany({ where: { id: { in: [...kraIds] }, organizationId: orgId }, select: { id: true, name: true, roleId: true } }) : [],
    member && kpiIds.size ? prisma.kPI.findMany({ where: { id: { in: [...kpiIds] }, organizationId: orgId }, select: { id: true, name: true, kra: { select: { roleId: true } } } }) : [],
    goalIds.size ? prisma.oKR.findMany({ where: { id: { in: [...goalIds] }, organizationId: orgId, ...(goalOr ? { OR: goalOr } : {}) }, select: { id: true, title: true, progress: true } }) : [],
  ]);

  const cands: TrailCandidate[] = [];
  const allowed = new Set<string>();
  const allow = (kind: TrailKind, id: string) => allowed.add(`${kind}:${id}`);

  const sopTitle = new Map(sops.map((s) => [s.id, s.title]));
  for (const s of sops) allow("sop", s.id);
  if (origin) {
    cands.push({ kind: "sop-step", id: origin.sopId, title: `${sopTitle.get(origin.sopId) ?? origin.sopTitle}, step ${origin.n}`, href: `/sops/${origin.sopId}`, detail: origin.stepTitle || null });
    if (origin.jobTitle && member) {
      const role = await prisma.role.findFirst({ where: { id: origin.jobTitle.roleId, organizationId: orgId }, select: { id: true, title: true } });
      if (role) {
        allow("job-title", role.id);
        // "Assigned by" only while the person the rule picked is still on it.
        const pickedStillOn = origin.assignedBy === "job-title"
          && (origin.assigneeId ? task.assigneeIds.includes(origin.assigneeId) || task.ownerId === origin.assigneeId : task.assigneeIds.length > 0 || !!task.ownerId);
        cands.push({ kind: "job-title", id: role.id, title: role.title, href: `/people/roles/${role.id}`, detail: pickedStillOn ? "Assigned by the soonest available holder" : null });
      }
    }
  }
  for (const s of sops) {
    const ctx = ends.find((e) => e.type === "SOP" && e.id === s.id)?.context ?? null;
    cands.push({ kind: "sop", id: s.id, title: s.title, href: `/sops/${s.id}`, detail: ctx });
  }
  for (const k of kras) { allow("kra", k.id); cands.push({ kind: "kra", id: k.id, title: k.name, href: k.roleId ? `/people/roles/${k.roleId}` : "/kra-kpi" }); }
  for (const k of kpis) { allow("kpi", k.id); cands.push({ kind: "kpi", id: k.id, title: k.name, href: k.kra?.roleId ? `/people/roles/${k.kra.roleId}` : "/kra-kpi" }); }
  for (const g of goals) { allow("goal", g.id); cands.push({ kind: "goal", id: g.id, title: g.title, href: `/okrs/${g.id}`, detail: `${g.progress}% done` }); }

  // Nodes: docs, canvases, tables and Lists, through the one node resolver.
  const ctxNode = reader.nodeCtx;
  const nodeIds: Record<"doc" | "canvas" | "table" | "list", string[]> = { doc: [], canvas: [], table: [], list: [] };
  for (const e of ends) { const n = NODE_OF[e.type]; if (n) nodeIds[n.node].push(e.id); }
  const [docOk, canvasOk, tableOk, listOk] = await Promise.all([
    nodeIds.doc.length ? idsWithRole(ctxNode, "doc", nodeIds.doc) : new Set<string>(),
    nodeIds.canvas.length ? idsWithRole(ctxNode, "canvas", nodeIds.canvas) : new Set<string>(),
    nodeIds.table.length ? idsWithRole(ctxNode, "table", nodeIds.table) : new Set<string>(),
    nodeIds.list.length ? idsWithRole(ctxNode, "list", nodeIds.list) : new Set<string>(),
  ]);
  const [docs, canvases, tables, lists] = await Promise.all([
    docOk.size ? prisma.doc.findMany({ where: { id: { in: [...docOk] }, organizationId: orgId }, select: { id: true, title: true } }) : [],
    canvasOk.size ? prisma.whiteboard.findMany({ where: { id: { in: [...canvasOk] }, organizationId: orgId }, select: { id: true, name: true } }) : [],
    tableOk.size ? prisma.dataTable.findMany({ where: { id: { in: [...tableOk] }, organizationId: orgId }, select: { id: true, name: true } }) : [],
    listOk.size ? prisma.board.findMany({ where: { id: { in: [...listOk] }, organizationId: orgId }, select: { id: true, name: true, slug: true } }) : [],
  ]);
  for (const d of docs) { allow("doc", d.id); cands.push({ kind: "doc", id: d.id, title: d.title || "Untitled doc", href: `/docs/${d.id}` }); }
  for (const w of canvases) { allow("canvas", w.id); cands.push({ kind: "canvas", id: w.id, title: w.name || "Untitled canvas", href: `/canvas/${w.id}` }); }
  for (const t of tables) { allow("table", t.id); cands.push({ kind: "table", id: t.id, title: t.name || "Untitled table", href: `/tables/${t.id}` }); }
  for (const b of lists) { allow("list", b.id); cands.push({ kind: "list", id: b.id, title: b.name, href: `/boards/${b.slug}` }); }

  // Files, through the file read rule.
  const fileIds = of("FILE");
  if (fileIds.length) {
    const ok = await readableFileIds({ ids: fileIds, viewer: reader.fileViewer });
    if (ok.length) {
      const files = await prisma.fileEntry.findMany({ where: { id: { in: ok } }, select: { id: true, name: true } });
      for (const f of files) { allow("file", f.id); cands.push({ kind: "file", id: f.id, title: f.name || "File", href: "/files" }); }
    }
  }

  // Contracts (Agreement): the Owner, an Admin or the People team (the
  // Agreement rule's FULL tier), or a party to it.
  const contractIds = of("CONTRACT");
  if (contractIds.length) {
    const full = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN" || viewer.peopleTeam === true;
    const me = full ? null : await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const rows = await prisma.agreement.findMany({
      where: {
        id: { in: contractIds }, organizationId: orgId, archivedAt: null,
        ...(full ? {} : { parties: { some: { OR: [{ userId }, ...(me?.email ? [{ email: { equals: me.email, mode: "insensitive" as const } }] : [])] } } }),
      },
      select: { id: true, title: true },
    });
    for (const a of rows) { allow("contract", a.id); cands.push({ kind: "contract", id: a.id, title: a.title, href: `/agreements/${a.id}` }); }
  }

  // Kudos: the kudos wall is every Member's.
  const kudosIds = of("KUDOS");
  if (kudosIds.length && member) {
    const rows = await prisma.kudos.findMany({ where: { id: { in: kudosIds }, organizationId: orgId }, select: { id: true, message: true, companyValue: true } });
    for (const k of rows) { allow("kudos", k.id); cands.push({ kind: "kudos", id: k.id, title: k.companyValue ? `${k.companyValue}: ${k.message}`.slice(0, 120) : k.message.slice(0, 120), href: "/kudos" }); }
  }

  // Time logged by the timer on this task (the task is already readable).
  const sessions = await prisma.timerSession.findMany({
    where: { organizationId: orgId, entityType: "BOARD_ITEM", entityId: task.id },
    select: { durationMs: true, startedAt: true, stoppedAt: true },
    take: 500,
  });
  if (sessions.length) {
    const now = Date.now();
    const ms = sessions.reduce((sum, s) => sum + (s.stoppedAt ? s.durationMs : Math.max(0, now - s.startedAt.getTime())), 0);
    if (ms > 0) {
      allow("timer", task.id);
      const running = sessions.some((s) => !s.stoppedAt);
      cands.push({ kind: "timer", id: task.id, title: formatLogged(ms), href: null, detail: running ? "A timer is running" : `${sessions.length} session${sessions.length === 1 ? "" : "s"}` });
    }
  }

  const entries = assembleTrail(cands, (kind, id) => allowed.has(`${kind}:${id}`));
  let titleNow: string | null = null;
  if (member && origin?.jobTitle && origin.assignedBy === "none" && task.assigneeIds.length === 0 && !task.ownerId) {
    const role = await prisma.role.findFirst({ where: { id: origin.jobTitle.roleId, organizationId: orgId }, select: { title: true } });
    titleNow = role?.title ?? origin.jobTitle.title;
  }
  return { entries, ownerNotice: member ? ownerNoticeFor(origin, titleNow, task, managesJobTitles(viewer)) : null };
}
