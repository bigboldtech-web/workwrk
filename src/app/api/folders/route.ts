// GET  /api/folders?spaceId=... — list folders in a Space (flat).
// POST /api/folders — create a folder. Must have edit access on the Space.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { createFolder, listFoldersInSpace } from "@/lib/folder";
import { canEditSpace, getSpaceForReader } from "@/lib/space";

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

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const spaceId = url.searchParams.get("spaceId");
  if (!spaceId) return NextResponse.json({ error: "spaceId query param required" }, { status: 400 });
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const space = await getSpaceForReader(spaceId, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const folders = await listFoldersInSpace(spaceId, { includeArchived });
  return NextResponse.json({ folders });
}

const createSchema = z.object({
  spaceId: z.string().min(1),
  parentFolderId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(20).optional(),
  private: z.boolean().optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const space = await getSpaceForReader(parsed.data.spaceId, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditSpace(parsed.data.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const folder = await createFolder({
      organizationId: c.organizationId,
      spaceId: parsed.data.spaceId,
      parentFolderId: parsed.data.parentFolderId ?? undefined,
      name: parsed.data.name,
      description: parsed.data.description,
      icon: parsed.data.icon,
      color: parsed.data.color,
      visibility: parsed.data.private ? "PRIVATE" : "WORKSPACE",
      userId: c.userId,
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create folder" },
      { status: 400 },
    );
  }
}
