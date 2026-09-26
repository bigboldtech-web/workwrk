// POST /api/folders/[id]/move: put a Folder under another Space or Folder.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 (Folder "…" row
// 13) and section 2 (`/folders/[id]` Data): "`POST /api/folders/[id]/move`
// (new)". audit spaces-boards Medium #18: the Folder menu had no Move row and
// `MoveTargetDialog` had no folder kind, so a Folder created in the wrong Space
// stayed there for good.
//
// The placement rule (node-rules P1 to P7) through its one move helper
// (node-placement moveFolder): Full access on the Folder and on the place it
// leaves (and on its Space when it leaves every Space), Can edit where it goes,
// the Space taken from the destination parent (a Space that disagrees is a
// 400), and the whole subtree (sub-folders at any depth, their Lists, canvases
// and files) moved in one transaction, or nothing is written. A refusal is a
// 403 with one sentence naming what is needed. The Move dialog lists only the
// destinations this accepts (GET /api/move/destinations).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { nodeCtxFromLevel, nodeRole } from "@/lib/access/node-access";
import { moveFolder } from "@/lib/access/node-placement";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  spaceId: z.string().min(1).optional(),
  parentFolderId: z.string().min(1).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const { id } = await params;

  const folder = await prisma.folder.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true } });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = nodeCtxFromLevel(u.id, u.organizationId, accessLevel);
  if ((await nodeRole(ctx, { kind: "folder", id })).role === "none") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const result = await moveFolder(ctx, id, { spaceId: parsed.data.spaceId, parentFolderId: parsed.data.parentFolderId ?? null });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    folder: { id: result.folder.id, name: result.folder.name, spaceId: result.folder.spaceId, parentFolderId: result.folder.parentFolderId },
    movedFolders: result.movedFolders,
  });
}
