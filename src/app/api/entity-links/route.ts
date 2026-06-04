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
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createEntityLink,
  listLinksFrom,
  listLinksTo,
} from "@/lib/entity-link";
import type { EntityLinkType, EntityLinkRelation } from "@/generated/prisma";

const ENTITY_TYPES = [
  "TASK", "BOARD", "BOARD_ITEM", "SPACE", "FOLDER", "KRA", "KPI", "KPI_PROMPT",
  "SOP", "REVIEW", "REVIEW_CYCLE", "WEEKLY_REVIEW", "NOTE", "DOC", "WHITEBOARD",
  "FILE", "FORM", "TABLE", "USER", "DEPARTMENT", "ROLE", "ANNOUNCEMENT",
  "KUDOS", "CANDOR", "SURVEY", "CONTRACT", "CANDIDATE", "JOB",
] as const;

const RELATION_KINDS = ["LINKED", "EMBEDDED", "REQUIRED_READING", "REFERENCES"] as const;

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, organizationId: u.organizationId };
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

async function hydrate(rows: Awaited<ReturnType<typeof listLinksFrom>>, orgId: string): Promise<HydratedLink[]> {
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
          select: { id: true, title: true, excerpt: true },
        });
        for (const d of docs) titleByKey.set(`${type}:${d.id}`, { title: d.title, subtitle: d.excerpt, href: `/docs/${d.id}` });
      } else if (type === "WHITEBOARD") {
        const wbs = await prisma.whiteboard.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, name: true, description: true },
        });
        for (const w of wbs) titleByKey.set(`${type}:${w.id}`, { title: w.name, subtitle: w.description, href: `/whiteboards/${w.id}` });
      } else if (type === "KRA") {
        const kras = await prisma.kRA.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, name: true, category: true },
        });
        for (const k of kras) titleByKey.set(`${type}:${k.id}`, { title: k.name, subtitle: k.category });
      } else if (type === "FILE") {
        const files = await prisma.fileEntry.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, name: true, mimeType: true, size: true, url: true },
        });
        for (const f of files) {
          titleByKey.set(`${type}:${f.id}`, {
            title: f.name,
            subtitle: `${f.mimeType} · ${Math.max(1, Math.round(f.size / 1024))} KB`,
            href: f.url,
          });
        }
      }
      // Other types pass through without hydration — the client can request more specifically if needed.
    }),
  );

  return rows.map((r) => ({
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
    const hydrated = await hydrate(links, c.organizationId);
    return NextResponse.json({ links: hydrated });
  }

  if (targetType && targetId && ENTITY_TYPES.includes(targetType)) {
    const links = await listLinksTo({
      organizationId: c.organizationId,
      target: { type: targetType, id: targetId },
      relationKind,
      sourceType: filterSourceType && ENTITY_TYPES.includes(filterSourceType) ? filterSourceType : undefined,
    });
    const hydrated = await hydrate(links, c.organizationId);
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

  const link = await createEntityLink({
    organizationId: c.organizationId,
    source: parsed.data.source,
    target: parsed.data.target,
    relationKind: parsed.data.relationKind,
    position: parsed.data.position,
    context: parsed.data.context,
    createdById: c.userId,
  });

  return NextResponse.json({ link }, { status: 201 });
}
