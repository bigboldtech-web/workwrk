// GET  /api/folders?spaceId=...: list folders in a Space (flat), only the
//      ones the viewer can open (the one resolver, one world for the list).
// POST /api/folders: create a folder, with Full access on the parent Folder or
//      on the Space at its root (a Folder grant never reads the Space).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { createFolder, listFoldersInSpace } from "@/lib/folder";
import { getSpaceForReader } from "@/lib/space";
import { prisma } from "@/lib/prisma";
import { containerGate, nodeCtxFromLevel, nodeRoleMap } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";

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
  const all = await listFoldersInSpace(spaceId, { includeArchived });
  // One world for every row: a PRIVATE folder the viewer cannot open is never
  // listed, named or counted here, exactly as the tree prunes it.
  const roles = await nodeRoleMap(nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel), "folder", all.map((f) => f.id));
  const folders = all.filter((f) => roleAtLeast(roles.get(f.id) ?? "none", "VIEW"));
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
  const space = await prisma.space.findFirst({ where: { id: parsed.data.spaceId, organizationId: c.organizationId }, select: { id: true } });
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The container the Folder is made in: the parent Folder (in the same
  // Space and org), or the Space root. Full access on it, and only on it.
  const parentId = parsed.data.parentFolderId ?? null;
  if (parentId) {
    const parent = await prisma.folder.findFirst({ where: { id: parentId, organizationId: c.organizationId, spaceId: parsed.data.spaceId }, select: { id: true } });
    if (!parent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const container = parentId ? { kind: "folder" as const, id: parentId } : { kind: "space" as const, id: parsed.data.spaceId };
  // Full access on it, or (a Folder, under the legacy Private rule) today's
  // canEditSpace on its Space (containerGate has the rule).
  const gate = await containerGate(nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel), container);
  if (gate === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (gate === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
