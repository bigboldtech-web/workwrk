// /api/entity-links — list + create polymorphic edges between entities.
//
// GET  ?sourceType=...&sourceId=...      — links FROM that source
// GET  ?targetType=...&targetId=...      — links TO that target
//      Optional ?relationKind=LINKED|EMBEDDED|REQUIRED_READING|REFERENCES
//      Optional ?targetType=NOTE (when listing FROM) to filter the type
//      of the other side.
//      Response is hydrated with the target's title/name + kind so the
//      caller doesn't need a second roundtrip per link.
//
// POST { source: {type,id}, target: {type,id}, relationKind?, context?, position? }
//      Idempotent — upserts on (source, target, relation).

import { NextResponse } from "next/server";
import { withFreshFileUrls } from "@/lib/file-urls";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createEntityLink,
  listLinksFrom,
  listLinksTo,
} from "@/lib/entity-link";
import { canMutateLinkFromSource, linkWriteRefusalFor } from "@/lib/entity-link-authz";
import { logActivity } from "@/lib/item-thread";
import { nodeCtxFromLevel, nodeRoles } from "@/lib/access/node-access";
import { roleAtLeast, type NodeKind } from "@/lib/access/node-rules";
import { readableFileIds } from "@/lib/file-access";
import { loadReadableLinkEnds } from "@/lib/access/link-end-readable";
import { LINK_NODE_KIND, LINK_TASK_TYPES, linkVisible, type LinkEndFacts } from "@/lib/entity-link-ends";
import type { EntityLinkType, EntityLinkRelation } from "@/generated/prisma";
import { filledRowCounts } from "@/lib/table-counts";

const ENTITY_TYPES = [
  "TASK", "BOARD", "BOARD_ITEM", "SPACE", "FOLDER", "KRA", "KPI", "KPI_PROMPT",
  "SOP", "OKR", "KEY_RESULT", "REVIEW", "REVIEW_CYCLE", "WEEKLY_REVIEW", "NOTE",
  "DOC", "WHITEBOARD", "FILE", "FORM", "TABLE", "USER", "DEPARTMENT", "ROLE",
  "ANNOUNCEMENT", "KUDOS", "CANDOR", "SURVEY", "CONTRACT", "CANDIDATE", "JOB",
] as const;

// BLOCKS and WAITING_ON are Phase 2's task-dependency kinds (spec-task-detail
// section 2, Related). They are accepted here from the day the enum has them,
// so the Related section can write a dependency; the "Waiting on" / "Blocking"
// groups render only where a reader knows about them, and every reader that
// does not simply lists the link like any other.
const RELATION_KINDS = [
  "LINKED",
  "EMBEDDED",
  "REQUIRED_READING",
  "REFERENCES",
  "BLOCKS",
  "WAITING_ON",
] as const;

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session, userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

interface HydratedLink {
  id: string;
  sourceType: EntityLinkType;
  sourceId: string;
  targetType: EntityLinkType;
  targetId: string;
  relationKind: EntityLinkRelation;
  position: number;
  context: string | null;
  createdAt: string;
  target?: { title: string | null; subtitle?: string | null; href?: string | null };
}

async function hydrate(
  rows: Awaited<ReturnType<typeof listLinksFrom>>,
  orgId: string,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<HydratedLink[]> {
  // Every SOP, goal, key result, KRA and KPI end, source or target, read once
  // under its own read rule (src/lib/access/link-end-readable.ts, the same
  // rules the task Connection trail reads): the titles below are hydrated
  // only for these, and the filter at the end drops every link with any
  // other such end. A SOP filed in a folder the viewer holds no grant on, a
  // private goal, a KRA to a Guest: none is named, counted or quoted.
  const readableEnds = await loadReadableLinkEnds(
    { user: { id: userId, organizationId: orgId, accessLevel: accessLevel ?? "EMPLOYEE" } },
    orgId,
    rows.flatMap((r) => [{ type: r.sourceType as string, id: r.sourceId }, { type: r.targetType as string, id: r.targetId }]),
  );
  const { readableSops } = readableEnds;

  const byType = new Map<string, string[]>();
  for (const r of rows) {
    const list = byType.get(r.targetType) ?? [];
    list.push(r.targetId);
    byType.set(r.targetType, list);
  }

  const titleByKey = new Map<string, { title: string | null; subtitle?: string | null; href?: string | null }>();

  await Promise.all(
    Array.from(byType.entries()).map(async ([type, ids]) => {
      if (type === "NOTE" || type === "DOC") {
        const docs = await prisma.doc.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, title: true, excerpt: true, entityType: true, entityId: true },
        });
        for (const d of docs) {
          titleByKey.set(`${type}:${d.id}`, { title: d.title, subtitle: d.excerpt, href: `/docs/${d.id}` });
        }
      } else if (type === "WHITEBOARD") {
        const wbs = await prisma.whiteboard.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, name: true, description: true, spaceId: true },
        });
        for (const w of wbs) {
          titleByKey.set(`${type}:${w.id}`, { title: w.name, subtitle: w.description, href: `/canvas/${w.id}` });
        }
      } else if (type === "SOP") {
        const readable = ids.filter((id) => readableSops.has(id));
        const sops = readable.length === 0 ? [] : await prisma.sOP.findMany({
          where: { organizationId: orgId, id: { in: readable } },
          select: { id: true, title: true, category: true, status: true },
        });
        for (const s of sops) {
          titleByKey.set(`${type}:${s.id}`, {
            title: s.title,
            subtitle: s.category ?? s.status,
            href: `/sops/${s.id}`,
          });
        }
      } else if (type === "KRA") {
        const readable = ids.filter((id) => readableEnds.readableKras.has(`KRA:${id}`));
        const kras = readable.length === 0 ? [] : await prisma.kRA.findMany({
          where: { organizationId: orgId, id: { in: readable } },
          select: { id: true, name: true, category: true },
        });
        for (const k of kras) titleByKey.set(`${type}:${k.id}`, { title: k.name, subtitle: k.category });
      } else if (type === "BOARD") {
        const boards = await prisma.board.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, name: true, slug: true, spaceId: true },
        });
        for (const b of boards) {
          titleByKey.set(`${type}:${b.id}`, { title: b.name, subtitle: "Board", href: `/boards/${b.slug}` });
        }
      } else if (type === "SPACE") {
        const spaces = await prisma.space.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, name: true, slug: true },
        });
        for (const s of spaces) {
          titleByKey.set(`${type}:${s.id}`, { title: s.name, subtitle: "Space", href: `/spaces/${s.slug}` });
        }
      } else if (type === "OKR") {
        const readable = ids.filter((id) => readableEnds.readableGoals.has(id));
        const okrs = readable.length === 0 ? [] : await prisma.oKR.findMany({
          where: { organizationId: orgId, id: { in: readable } },
          select: { id: true, title: true, level: true, status: true },
        });
        for (const o of okrs) {
          titleByKey.set(`${type}:${o.id}`, {
            title: o.title,
            subtitle: `${o.level} · ${o.status}`,
            href: `/okrs/${o.id}`,
          });
        }
      } else if (type === "KEY_RESULT") {
        const readable = ids.filter((id) => readableEnds.readableKeyResults.has(id));
        const krs = readable.length === 0 ? [] : await prisma.keyResult.findMany({
          where: { okr: { organizationId: orgId }, id: { in: readable } },
          select: { id: true, title: true, progress: true, okrId: true },
        });
        for (const kr of krs) {
          titleByKey.set(`${type}:${kr.id}`, {
            title: kr.title,
            subtitle: `${Math.round(kr.progress)}% complete`,
            href: `/okrs/${kr.okrId}`,
          });
        }
      } else if (type === "FILE") {
        const files = await prisma.fileEntry.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, name: true, mimeType: true, size: true, url: true, s3Key: true, spaceId: true },
        });
        const freshFiles = await withFreshFileUrls(files);
        for (const f of freshFiles) {
          titleByKey.set(`${type}:${f.id}`, {
            title: f.name,
            subtitle: `${f.mimeType} · ${Math.max(1, Math.round(f.size / 1024))} KB`,
            href: f.url,
          });
        }
      } else if (type === "TABLE") {
        const tables = await prisma.dataTable.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, name: true, description: true, spaceId: true },
        });
        // Filled rows only: a new table's 1,000 seeded blank rows are not
        // rows anyone wrote (data.md 3.14, lib/table-counts).
        const filled = await filledRowCounts(tables.map((t) => t.id));
        for (const t of tables) {
          const rowCount = filled.get(t.id) ?? 0;
          titleByKey.set(`${type}:${t.id}`, {
            title: t.name,
            subtitle: t.description ?? `${rowCount} ${rowCount === 1 ? "row" : "rows"}`,
            href: `/tables/${t.id}`,
          });
        }
      }
      // Other types pass through without hydration — the client can request more specifically if needed.
    }),
  );

  // Drop every link with an end the viewer cannot open: the SOURCE as well as
  // the target, because a link carries the other end's type, id and its free
  // text context, and the anchor queried by is itself an end of every row.
  // One world from the one resolver for every node end (a doc with its parent
  // pages and restriction, a canvas with its Folder, a Folder, a List, a
  // Space, a table, a form), tasks through their List or their assignment,
  // the file read rule for files, and their own rules for SOPs, goals, key
  // results, KRAs and KPIs (a task an SOP run made links back to its SOP, and
  // that SOP may sit in a folder the task's reader has no grant on). Ends of
  // other kinds (a person, a review) are not nodes and pass through.
  const ends = rows.flatMap((r) => [{ type: r.sourceType as string, id: r.sourceId }, { type: r.targetType as string, id: r.targetId }]);
  const taskIds = [...new Set(ends.filter((e) => LINK_TASK_TYPES.has(e.type)).map((e) => e.id))];
  const tasks = taskIds.length
    ? await prisma.item.findMany({ where: { organizationId: orgId, id: { in: taskIds } }, select: { id: true, boardId: true, ownerId: true, assigneeIds: true } })
    : [];
  const nodeRefs = [
    ...ends.flatMap((e) => (LINK_NODE_KIND[e.type] ? [{ kind: LINK_NODE_KIND[e.type] as NodeKind, id: e.id }] : [])),
    ...tasks.map((t) => ({ kind: "list" as NodeKind, id: t.boardId })),
  ];
  const fileIds = [...new Set(ends.filter((e) => e.type === "FILE").map((e) => e.id))];
  const [decisions, readableFiles] = await Promise.all([
    nodeRefs.length ? nodeRoles(nodeCtxFromLevel(userId, orgId, accessLevel), nodeRefs) : Promise.resolve(new Map()),
    fileIds.length ? readableFileIds({ ids: fileIds, viewer: { organizationId: orgId, userId, accessLevel } }) : Promise.resolve([] as string[]),
  ]);
  const facts: LinkEndFacts = {
    userId,
    nodeOpens: (kind, id) => roleAtLeast(decisions.get(`${kind}:${id}`)?.role ?? "none", "VIEW"),
    readableFiles: new Set(readableFiles),
    ...readableEnds,
    tasks: new Map(tasks.map((t) => [t.id, t])),
  };

  return rows
    .filter((r) => linkVisible(r, facts))
    .map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      targetType: r.targetType,
      targetId: r.targetId,
      relationKind: r.relationKind,
      position: r.position,
      context: r.context,
      createdAt: r.createdAt.toISOString(),
      target: titleByKey.get(`${r.targetType}:${r.targetId}`),
    }));
}

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;

  const url = new URL(req.url);
  const sourceType = url.searchParams.get("sourceType") as EntityLinkType | null;
  const sourceId = url.searchParams.get("sourceId");
  const targetType = url.searchParams.get("targetType") as EntityLinkType | null;
  const targetId = url.searchParams.get("targetId");
  const relationKindParam = url.searchParams.get("relationKind") as EntityLinkRelation | null;
  const filterTargetType = url.searchParams.get("filterTargetType") as EntityLinkType | null;
  const filterSourceType = url.searchParams.get("filterSourceType") as EntityLinkType | null;

  const relationKind = relationKindParam && RELATION_KINDS.includes(relationKindParam) ? relationKindParam : undefined;

  if (sourceType && sourceId && ENTITY_TYPES.includes(sourceType)) {
    const links = await listLinksFrom({
      organizationId: c.organizationId,
      source: { type: sourceType, id: sourceId },
      relationKind,
      targetType: filterTargetType && ENTITY_TYPES.includes(filterTargetType) ? filterTargetType : undefined,
    });
    const hydrated = await hydrate(links, c.organizationId, c.userId, c.accessLevel);
    return NextResponse.json({ links: hydrated });
  }

  if (targetType && targetId && ENTITY_TYPES.includes(targetType)) {
    const links = await listLinksTo({
      organizationId: c.organizationId,
      target: { type: targetType, id: targetId },
      relationKind,
      sourceType: filterSourceType && ENTITY_TYPES.includes(filterSourceType) ? filterSourceType : undefined,
    });
    const hydrated = await hydrate(links, c.organizationId, c.userId, c.accessLevel);
    return NextResponse.json({ links: hydrated });
  }

  return NextResponse.json({ error: "Provide either sourceType+sourceId or targetType+targetId" }, { status: 400 });
}

const createSchema = z.object({
  source: z.object({
    type: z.enum(ENTITY_TYPES),
    id: z.string().min(1),
  }),
  target: z.object({
    type: z.enum(ENTITY_TYPES),
    id: z.string().min(1),
  }),
  relationKind: z.enum(RELATION_KINDS).optional(),
  position: z.number().int().optional(),
  context: z.string().max(280).optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Governance sources (goals) gate edit rights below their read rights —
  // enforce the same check the UI hides its buttons behind.
  const session = { user: { id: c.userId, organizationId: c.organizationId, accessLevel: c.accessLevel } };
  if (!(await canMutateLinkFromSource(session, c.organizationId, parsed.data.source))) {
    return NextResponse.json({ error: "You can't edit links on this item." }, { status: 403 });
  }
  // The placement rule (node-rules P1): a link on a node is content added to
  // it, so Can edit on the source and Can view on the target. It checked
  // nothing here, and a Can view grantee attached files to tasks.
  const refused = await linkWriteRefusalFor(c, {
    sourceType: parsed.data.source.type, sourceId: parsed.data.source.id,
    targetType: parsed.data.target.type, targetId: parsed.data.target.id,
  });
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });

  const link = await createEntityLink({
    organizationId: c.organizationId,
    source: parsed.data.source,
    target: parsed.data.target,
    relationKind: parsed.data.relationKind,
    position: parsed.data.position,
    context: parsed.data.context,
    createdById: c.userId,
  });

  // A link on a task is a change to the task, so the Activity tab records it.
  // ATTACHMENT_ADDED and LINK_ADDED were both declared in the action
  // vocabulary and written by nothing, which made `?kind=attachments` a filter
  // that could only ever return an empty list.
  if (parsed.data.source.type === "BOARD_ITEM") {
    await logActivity({
      organizationId: c.organizationId,
      itemId: parsed.data.source.id,
      actorId: c.userId,
      action: parsed.data.target.type === "FILE" ? "ATTACHMENT_ADDED" : "LINK_ADDED",
      meta: {
        targetType: parsed.data.target.type,
        targetId: parsed.data.target.id,
        relationKind: parsed.data.relationKind ?? "LINKED",
      },
    });
  }

  return NextResponse.json({ link }, { status: 201 });
}
