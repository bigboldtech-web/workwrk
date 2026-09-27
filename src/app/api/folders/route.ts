// GET  /api/folders?spaceId=...: list folders in a Space (flat), only the
//      ones the viewer can open (the one resolver, one world for the list).
// POST /api/folders: create a folder. The placement rule (node-rules P1, P3):
//      Can edit or higher on the parent Folder, or on the Space at its root
//      (a Folder grant never reads the Space); the Space is the parent's, and
//      a parent in another Space, another org or Trash is refused.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { createFolder, listFoldersInSpace } from "@/lib/folder";
import { getSpaceForReader } from "@/lib/space";
import { nodeCtxFromLevel, nodeRoleMap } from "@/lib/access/node-access";
import { resolveCreate } from "@/lib/access/node-placement";
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
  // Where it lands (P3: the parent Folder settles the Space) and whether the
  // viewer may make a Folder there (P1: Can edit or higher, or, in a Folder
  // under the legacy Private rule, today's canEditSpace on its Space, P7).
  const placed = await resolveCreate(
    nodeCtxFromLevel(c.userId, c.organizationId, c.accessLevel),
    { spaceId: parsed.data.spaceId, folderId: parsed.data.parentFolderId ?? null },
    "folder",
  );
  if (!placed.ok) return NextResponse.json({ error: placed.error }, { status: placed.status });
  try {
    const folder = await createFolder({
      organizationId: c.organizationId,
      spaceId: placed.spaceId as string,
      parentFolderId: placed.folderId ?? undefined,
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
