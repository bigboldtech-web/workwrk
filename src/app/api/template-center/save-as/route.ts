// POST /api/template-center/save-as — snapshot a List or Space as a Template.
//   body { source: "LIST", boardId, name?, description?, complexity?, category?, useCases?, tags? }
//   body { source: "SPACE", spaceId, name?, ... }
// Read-gates the source via the same resolvers the apply route uses, then
// stores a Template(kind=LIST|SPACE) the org can re-apply.

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getBoardForReader } from "@/lib/board";
import { getSpaceForReader } from "@/lib/space";
import { snapshotBoard, snapshotSpace } from "@/lib/template-center";

const COMPLEXITY = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

const schema = z.object({
  source: z.enum(["LIST", "SPACE"]),
  boardId: z.string().optional(),
  spaceId: z.string().optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  complexity: z.enum(COMPLEXITY).optional(),
  category: z.string().max(120).optional(),
  useCases: z.array(z.string()).max(20).optional(),
  tags: z.array(z.string()).max(30).optional(),
});

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const accessLevel = (session.user as { accessLevel?: string })?.accessLevel ?? "EMPLOYEE";

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid body", 400);
  const input = parsed.data;

  let kind: "LIST" | "SPACE";
  let snap: { name: string; payload: object } | null;

  if (input.source === "LIST") {
    if (!input.boardId) return jsonError("boardId is required", 400);
    const board = await getBoardForReader(input.boardId, userId, accessLevel);
    if (!board) return jsonError("List not found", 404);
    kind = "LIST";
    snap = await snapshotBoard(input.boardId);
  } else {
    if (!input.spaceId) return jsonError("spaceId is required", 400);
    const space = await getSpaceForReader(input.spaceId, userId, accessLevel);
    if (!space) return jsonError("Space not found", 404);
    kind = "SPACE";
    snap = await snapshotSpace(input.spaceId);
  }

  if (!snap) return jsonError("Source not found", 404);

  const row = await prisma.template.create({
    data: {
      organizationId: orgId,
      createdById: userId,
      kind,
      name: input.name?.trim() || snap.name,
      description: input.description ?? null,
      complexity: input.complexity ?? null,
      category: input.category ?? null,
      useCases: input.useCases ?? [],
      tags: input.tags ?? [],
      payload: snap.payload as object,
    },
    select: { id: true, name: true, kind: true },
  });
  return jsonSuccess({ template: row }, 201);
}
