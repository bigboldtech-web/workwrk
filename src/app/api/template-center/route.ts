// Template Center API.
// GET  /api/template-center: list templates available to the org
//        ?kind= ?complexity= ?category= ?q= ?tag= ?useCase=
//        Returns org-owned + built-in (global) rows.
// POST /api/template-center: save a new template (save-as-template)
//        { kind, name, description?, complexity?, category?, useCases?, tags?, payload }
// (Distinct from the legacy product-catalog `/api/templates`.)

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import type { Prisma } from "@/generated/prisma";
import { templatesAppGate } from "@/lib/templates/gate";

const KINDS = ["TASK", "LIST", "SPACE", "FOLDER", "DOC", "VIEW", "WHITEBOARD"] as const;
const COMPLEXITY = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

export async function GET(req: NextRequest) {
  const denied = await templatesAppGate();
  if (denied) return denied;
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;

  const where: Prisma.TemplateWhereInput = {
    OR: [{ organizationId: orgId }, { builtIn: true }],
  };
  const kind = sp.get("kind");
  if (kind && (KINDS as readonly string[]).includes(kind)) where.kind = kind as (typeof KINDS)[number];
  const complexity = sp.get("complexity");
  if (complexity && (COMPLEXITY as readonly string[]).includes(complexity)) {
    where.complexity = complexity as (typeof COMPLEXITY)[number];
  }
  const category = sp.get("category");
  if (category) where.category = category;
  const q = sp.get("q")?.trim();
  if (q) {
    where.AND = [{ OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] }];
  }
  const tag = sp.get("tag");
  if (tag) where.tags = { has: tag };
  const useCase = sp.get("useCase");
  if (useCase) where.useCases = { has: useCase };
  // ?source=builtin | made-here. The page's Filter panel calls the second one
  // "Made here", which is exactly "this org saved it".
  const source = sp.get("source");
  if (source === "builtin") where.builtIn = true;
  else if (source === "made-here") where.organizationId = orgId;

  // Cursor paging (spec: "gains paging and source"). The order is stable and
  // ends in id, so a cursor never skips or repeats a row.
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "60", 10) || 60));
  const cursor = sp.get("cursor");

  const rows = await prisma.template.findMany({
    where,
    orderBy: [{ builtIn: "asc" }, { usedCount: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, kind: true, name: true, description: true, complexity: true,
      category: true, useCases: true, tags: true, builtIn: true, usedCount: true,
      organizationId: true, createdById: true, createdAt: true, updatedAt: true,
    },
  });
  const hasMore = rows.length > limit;
  const templates = hasMore ? rows.slice(0, limit) : rows;
  // The kind pills stay stable whatever the filters say, so the count beside
  // each pill is over the whole readable library, not over this page.
  const byKind = await prisma.template.groupBy({
    by: ["kind"],
    where: { OR: [{ organizationId: orgId }, { builtIn: true }] },
    _count: { _all: true },
  });

  // Who saved the org's "Made here" templates. Two things need it: the card
  // carries the creator's 20px avatar (spec section 2) instead of the literal
  // words "Made here", and the Filter panel's "Created by" group had no data
  // to render at all.
  const byCreator = await prisma.template.groupBy({
    by: ["createdById"],
    where: { organizationId: orgId, builtIn: false, createdById: { not: null } },
    _count: { _all: true },
  });
  const creatorIds = byCreator.map((r) => r.createdById).filter((v): v is string => Boolean(v));
  const creatorRows = creatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds }, organizationId: orgId },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const creatorById = new Map(creatorRows.map((u) => [u.id, u]));
  const creators = byCreator
    .map((r) => {
      const u = r.createdById ? creatorById.get(r.createdById) : null;
      if (!u) return null;
      return {
        id: u.id,
        name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Someone",
        firstName: u.firstName,
        lastName: u.lastName,
        avatar: u.avatar,
        count: r._count._all,
      };
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
    .sort((a, b) => b.count - a.count);

  return jsonSuccess({
    templates,
    nextCursor: hasMore ? templates[templates.length - 1]?.id ?? null : null,
    hasMore,
    counts: Object.fromEntries(byKind.map((r) => [r.kind, r._count._all])),
    creators,
  });
}

const createSchema = z.object({
  kind: z.enum(KINDS),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  complexity: z.enum(COMPLEXITY).optional(),
  category: z.string().max(120).optional(),
  useCases: z.array(z.string().max(80)).max(20).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: NextRequest) {
  const denied = await templatesAppGate();
  if (denied) return denied;
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid body", 400);
  const d = parsed.data;
  const template = await prisma.template.create({
    data: {
      organizationId: getOrgId(session),
      createdById: getUserId(session),
      kind: d.kind,
      name: d.name.trim(),
      description: d.description ?? null,
      complexity: d.complexity ?? null,
      category: d.category ?? null,
      useCases: d.useCases ?? [],
      tags: d.tags ?? [],
      builtIn: false,
      payload: d.payload as object,
    },
  });
  return jsonSuccess({ template }, 201);
}
