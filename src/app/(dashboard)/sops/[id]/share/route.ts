import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  requirePermission,
} from "@/lib/api-helpers";
import { canWriteToFolder } from "@/lib/sop-access";

/**
 * /api/? no — this is a colocated route handler under the (dashboard)
 * `/sops/[id]/share` segment. It mints (POST) or revokes (DELETE) the
 * public share token for a SOP so the read-only viewer at
 * `/(public)/share/sop/[token]` can resolve it.
 *
 * Guard rails (mirror the SOP edit permission):
 *   · authenticated + org-scoped
 *   · `sops`/`edit` capability
 *   · author OR folder Editor/Owner OR org admin (canWriteToFolder)
 *   · only PUBLISHED SOPs are shareable — a public link should never
 *     expose a draft.
 *
 * This never touches SOP content — only the `shareToken` column.
 */

async function loadEditableSop(orgId: string, id: string) {
  return prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, shareToken: true, folderId: true, createdById: true },
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "sops", "edit");
  if (denied) return denied;

  const { id } = await params;
  const orgId = getOrgId(session);

  const sop = await loadEditableSop(orgId, id);
  if (!sop) return jsonError("SOP not found", 404);

  const isAuthor = sop.createdById === getUserId(session);
  if (!isAuthor && !(await canWriteToFolder(session, sop.folderId))) {
    return jsonError("You can only share SOPs you authored or have edit access to.", 403);
  }

  if (sop.status !== "PUBLISHED") {
    return jsonError("Only published SOPs can be shared with a public link.", 409);
  }

  // Idempotent: reuse the existing token if one is already minted.
  let shareToken = sop.shareToken;
  if (!shareToken) {
    shareToken = crypto.randomBytes(16).toString("hex");
    await prisma.sOP.update({ where: { id }, data: { shareToken } });
  }

  return jsonSuccess({ shareToken });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "sops", "edit");
  if (denied) return denied;

  const { id } = await params;
  const orgId = getOrgId(session);

  const sop = await loadEditableSop(orgId, id);
  if (!sop) return jsonError("SOP not found", 404);

  const isAuthor = sop.createdById === getUserId(session);
  if (!isAuthor && !(await canWriteToFolder(session, sop.folderId))) {
    return jsonError("You can only manage sharing for SOPs you authored or have edit access to.", 403);
  }

  if (sop.shareToken) {
    await prisma.sOP.update({ where: { id }, data: { shareToken: null } });
  }

  return jsonSuccess({ disabled: true });
}
