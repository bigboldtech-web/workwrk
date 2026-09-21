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
import { parseAccessSettings } from "@/lib/access/settings";
import { publicLinkRole } from "@/lib/access/guards";

/**
 * POST / DELETE /api/sops/[id]/share — mint or revoke the public share token
 * for a SOP, so the read-only viewer at `/(public)/share/sop/[token]` can
 * resolve it.
 *
 * WHERE IT LIVES, AND WHEN IT GOT HERE. This path is what the SOP page calls
 * (`/api/sops/${id}/share`), and the handler answers it. It was moved to /api
 * in Phase 2 (commit 8c44aa14, `R100` from `(dashboard)/sops/[id]/share`,
 * which served the PAGE path and so answered nothing the client asked for).
 * Phase 3 changed no handler code here: this header is the only edit, and it
 * exists because the earlier version of it claimed the move as Phase 3 work
 * and claimed a bug fix that had already shipped. Nothing about minting or
 * revoking a link changed in Phase 3, and nobody should read a release note
 * saying it did.
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
    // Toggle 10 (spec-process section 2 `/share/sop/[token]`): a NEW link is
    // refused while the workspace's Public links are Off. Revoking (DELETE)
    // never reads the toggle, so an admin can always switch a link off.
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const access = parseAccessSettings((org?.settings as { access?: unknown } | null)?.access);
    if (!publicLinkRole(access)) {
      return jsonError("Public links are turned off for this workspace. An admin can turn them on in Settings > Access (Public links).", 409);
    }
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
