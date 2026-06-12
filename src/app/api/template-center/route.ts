// Template Center API.
// GET  /api/template-center  — list templates available to the org
//        ?kind= ?complexity= ?category= ?q= ?tag= ?useCase=
//        Returns org-owned + built-in (global) rows.
// POST /api/template-center  — save a new template (save-as-template)
//        { kind, name, description?, complexity?, category?, useCases?, tags?, payload }
// (Distinct from the legacy product-catalog `/api/templates`.)

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import type { Prisma } from "@/generated/prisma";

const KINDS = ["TASK", "LIST", "SPACE", "FOLDER", "DOC", "VIEW", "WHITEBOARD"] as const;
const COMPLEXITY = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

export async function GET(req: NextRequest) {
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

  const templates = await prisma.template.findMany({
    where,
    orderBy: [{ builtIn: "asc" }, { usedCount: "desc" }, { updatedAt: "desc" }],
    take: 500,
    select: {
      id: true, kind: true, name: true, description: true, complexity: true,
      category: true, useCases: true, tags: true, builtIn: true, usedCount: true,
      organizationId: true, createdById: true, createdAt: true, updatedAt: true,
    },
  });
  return jsonSuccess({ templates });
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
