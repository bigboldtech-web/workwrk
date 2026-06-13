import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isOrgAdmin, jsonError, jsonSuccess } from "@/lib/api-helpers";

/**
 * Manage who can see / contribute to a specific folder.
 *
 * GET   → list users with access (admin only — no reason for a non-admin
 *         to see who else can access their folder).
 * PATCH → set the full access list in one shot:
 *         body: { userIds: string[] }
 *         The call replaces the current access list atomically — simpler
 *         to reason about than incremental add/remove for the UI.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);
  const { id } = await params;

  const folder = await prisma.sOPFolder.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!folder) return jsonError("Folder not found", 404);

  const rows = await prisma.sOPFolderAccess.findMany({
    where: { folderId: id },
    include: {
      user: {
        select: {
          id: true, firstName: true, lastName: true, email: true, avatar: true,
          role: { select: { title: true } },
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { grantedAt: "asc" },
  });

  return jsonSuccess(rows.map((r) => ({ user: r.user, role: r.role, grantedAt: r.grantedAt })));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);
  const { id } = await params;

  const folder = await prisma.sOPFolder.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!folder) return jsonError("Folder not found", 404);

  const body = await req.json();
  // Accept either the role-aware shape { grants: [{userId, role}] } or the
  // legacy { userIds: [...] } (which defaults everyone to EDITOR).
  const ROLES = new Set(["VIEWER", "EDITOR", "OWNER"]);
  const rawGrants: { userId: string; role: "VIEWER" | "EDITOR" | "OWNER" }[] = Array.isArray(body?.grants)
    ? body.grants
        .filter((g: unknown): g is { userId: string; role?: string } => !!g && typeof (g as any).userId === "string")
        .map((g: { userId: string; role?: string }) => ({
          userId: g.userId,
          role: (ROLES.has(g.role ?? "") ? g.role : "EDITOR") as "VIEWER" | "EDITOR" | "OWNER",
        }))
    : Array.isArray(body?.userIds)
      ? body.userIds
          .filter((x: unknown) => typeof x === "string")
          .map((userId: string) => ({ userId, role: "EDITOR" as const }))
      : [];

  // Dedupe by userId (last role wins).
  const byUser = new Map(rawGrants.map((g) => [g.userId, g.role] as const));
  const grants = Array.from(byUser, ([userId, role]) => ({ userId, role }));

  // Validate the provided user IDs belong to this org (prevents an admin
  // from one org granting access to users in another).
  if (grants.length > 0) {
    const valid = await prisma.user.findMany({
      where: { id: { in: grants.map((g) => g.userId) }, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (valid.length !== grants.length) return jsonError("One or more users invalid");
  }

  // Replace the access list atomically: drop all, insert new (with roles).
  await prisma.$transaction([
    prisma.sOPFolderAccess.deleteMany({ where: { folderId: id } }),
    ...(grants.length > 0
      ? [prisma.sOPFolderAccess.createMany({
          data: grants.map((g) => ({ folderId: id, userId: g.userId, role: g.role })),
        })]
      : []),
  ]);

  return jsonSuccess({ granted: grants.length });
}
