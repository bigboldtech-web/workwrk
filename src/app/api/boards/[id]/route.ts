// PATCH  /api/boards/[id] — rename / re-color / re-folder / re-visibility
// DELETE /api/boards/[id] — archive (soft)

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { archiveBoard, canEditBoard, getBoardForReader, updateBoard } from "@/lib/board";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

async function loadAndGate(boardId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  // Cross-tenant safety + read gate (composes Space + Board.visibility +
  // BoardMember per Phase 23). Returns null when the viewer can't see
  // the board OR when it's in a different org.
  const board = await getBoardForReader(boardId, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const canEdit = await canEditBoard(boardId, c.userId, c.accessLevel);
  if (!canEdit) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { board };
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  visibility: z.enum(["PRIVATE", "WORKSPACE", "ORG"]).optional(),
  folderId: z.string().min(1).nullable().optional(),
  // Per-List statuses (backbone #1). null resets to the default trio.
  // Values must be unique — they're the stored Item.status keys.
  statuses: z
    .array(
      z.object({
        value: z.string().min(1).max(60),
        label: z.string().min(1).max(60),
        color: z.string().min(1).max(20),
        group: z.enum(["ACTIVE", "DONE", "CLOSED"]),
      }),
    )
    .min(1)
    .max(30)
    .refine((arr) => new Set(arr.map((s) => s.value)).size === arr.length, {
      message: "status values must be unique",
    })
    .nullable()
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadAndGate(id, c);
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const updated = await updateBoard(id, parsed.data);
    return NextResponse.json({ board: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update board" },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadAndGate(id, c);
  if ("error" in gate) return gate.error;
  const archived = await archiveBoard(id);
  return NextResponse.json({ board: archived });
}
