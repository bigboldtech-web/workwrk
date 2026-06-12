// GET  /api/item-types  — list the org's task types (built-ins ensured)
//        also returns the recommended library + categories for the UI.
// POST /api/item-types  — create a custom type { singular, plural?, icon?, description?, category? }

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { listItemTypes, RECOMMENDED_ITEM_TYPES, ITEM_TYPE_CATEGORIES, ITEM_TYPE_LIMIT } from "@/lib/item-types";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const types = await listItemTypes(orgId);
  const customCount = types.filter((t) => !t.builtIn).length;
  return jsonSuccess({
    types,
    recommended: RECOMMENDED_ITEM_TYPES,
    categories: ITEM_TYPE_CATEGORIES,
    usage: { used: customCount, limit: ITEM_TYPE_LIMIT },
  });
}

const createSchema = z.object({
  singular: z.string().min(1).max(16),
  plural: z.string().min(1).max(16).optional(),
  icon: z.string().min(1).max(40).optional(),
  description: z.string().max(100).optional(),
  category: z.string().max(60).optional(),
});

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid body", 400);
  const d = parsed.data;

  // Enforce the per-org custom-type ceiling.
  const customCount = await prisma.itemType.count({ where: { organizationId: orgId, builtIn: false } });
  if (customCount >= ITEM_TYPE_LIMIT) {
    return jsonError(`Task type limit reached (${ITEM_TYPE_LIMIT}).`, 400);
  }

  const singular = d.singular.trim();
  const type = await prisma.itemType.create({
    data: {
      organizationId: orgId,
      createdById: getUserId(session),
      singular,
      plural: (d.plural?.trim() || `${singular}s`).slice(0, 16),
      icon: d.icon ?? "CircleDot",
      description: d.description ?? null,
      category: d.category ?? null,
      isDefault: false,
      builtIn: false,
    },
  });
  return jsonSuccess({ type }, 201);
}
