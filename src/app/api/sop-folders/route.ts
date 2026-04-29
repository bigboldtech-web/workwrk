import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isOrgAdmin, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

/**
 * SOP folders — primary taxonomy + access-scoping unit.
 *
 * Folders form a tree (parentId → parent folder). The GET returns a
 * flat list with parentId so the client can build the tree, plus a
 * descendant-aware sopCount for each folder (i.e. picking "HR" rolls
 * up SOPs in "HR / Hiring" and "HR / Onboarding" too). The client is
 * free to display either rolled-up or own counts.
 *
 * Visibility:
 *   · Org admins → every folder in their org.
 *   · Everyone else → folders they have access to, plus all
 *     descendants of those folders (access cascades down).
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const folders = await prisma.sOPFolder.findMany({
    where: { organizationId: orgId },
    select: {
      id: true, name: true, color: true, icon: true, description: true,
      parentId: true, createdAt: true, updatedAt: true,
      _count: { select: { sops: true, access: true } },
    },
    orderBy: [{ parentId: "asc" }, { name: "asc" }],
  });

  // Roll counts up the tree so a parent shows the total of its own
  // SOPs + every descendant's SOPs. Cheap O(n) walk.
  const byId = new Map<string, typeof folders[number] & { sopCountDeep: number }>();
  for (const f of folders) byId.set(f.id, { ...f, sopCountDeep: f._count.sops });

  // Build child index, then DFS-roll-up counts.
  const childrenOf = new Map<string | null, string[]>();
  for (const f of folders) {
    const arr = childrenOf.get(f.parentId) || [];
    arr.push(f.id);
    childrenOf.set(f.parentId, arr);
  }
  function rollup(id: string): number {
    const node = byId.get(id)!;
    let total = node._count.sops;
    for (const childId of childrenOf.get(id) || []) total += rollup(childId);
    node.sopCountDeep = total;
    return total;
  }
  for (const rootId of childrenOf.get(null) || []) rollup(rootId);

  // Filter to what the caller can see.
  let visible = Array.from(byId.values());
  if (!isOrgAdmin(session)) {
    const userId = (session.user as any).id as string;
    const grants = await prisma.sOPFolderAccess.findMany({
      where: { userId },
      select: { folderId: true },
    });
    const seedIds = new Set(grants.map((g) => g.folderId));
    // Mark every descendant of a seed as accessible.
    const accessible = new Set<string>();
    function mark(id: string) {
      if (accessible.has(id)) return;
      accessible.add(id);
      for (const childId of childrenOf.get(id) || []) mark(childId);
    }
    for (const id of seedIds) mark(id);
    visible = visible.filter((f) => accessible.has(f.id));
  }

  return jsonSuccess(visible, 200, LOOKUP_CACHE_HEADERS);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only org admins can create folders", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("Folder name is required");
  if (name.length > 60) return jsonError("Folder name too long (max 60 chars)");

  const color = typeof body?.color === "string" && body.color.startsWith("#") ? body.color : null;
  const icon = typeof body?.icon === "string" ? body.icon.slice(0, 32) : null;
  const description = typeof body?.description === "string" ? body.description.slice(0, 500) : null;
  const parentId = typeof body?.parentId === "string" && body.parentId ? body.parentId : null;

  // If a parent is specified, make sure it belongs to the same org.
  if (parentId) {
    const parent = await prisma.sOPFolder.findFirst({
      where: { id: parentId, organizationId: orgId },
      select: { id: true },
    });
    if (!parent) return jsonError("Parent folder not found", 404);
  }

  try {
    const folder = await prisma.sOPFolder.create({
      data: { name, color, icon, description, parentId, organizationId: orgId },
    });
    return jsonSuccess(folder, 201);
  } catch (err: any) {
    if (err.code === "P2002") return jsonError("A folder with that name already exists at this level");
    return jsonError(err.message || "Failed to create folder", 500);
  }
}
