// GET  /api/item-types  — list the org's task types (built-ins ensured)
//        also returns the recommended library + categories for the UI.
// POST /api/item-types  — create a custom type { singular, plural?, icon?, description?, category? }

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { listItemTypes, itemTypeNameTaken, RECOMMENDED_ITEM_TYPES, ITEM_TYPE_CATEGORIES, ITEM_TYPE_LIMIT } from "@/lib/item-types";

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
  // Task types are the whole workspace's (Settings > Task system): only an
  // Owner or Admin may change them, on that page's rule with the account
  // re-read (settings-write.ts), as tags are, so an Admin demoted a moment
  // ago, or a tab showing another workspace, is refused now.
  const writeGate = await settingsWriteGate(session, "tasks");
  if (!writeGate.ok) return writeGate.response;
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
  // One name, one type (settings-cleanup Phase 6 review, M1): a name already
  // in use, in any case, is refused in words, the way /api/tags refuses a tag
  // it already holds. The New type dialog checks against the list it read,
  // but a dialog opened before that read answered (or after it failed) knew
  // no names. There is no unique constraint behind this: rows stored twice
  // before it are still read as they are, and stay deletable.
  const clash = await prisma.itemType.findFirst({
    where: { organizationId: orgId, singular: { equals: singular, mode: "insensitive" } },
    select: { singular: true },
  });
  if (clash) return jsonError(itemTypeNameTaken(clash.singular), 409);

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
