// GET /api/files/[id]/url -> { url, name, mimeType, size }
//
// The signed download URL for one file, minted only after the viewer can read
// it (spec-docs-knowledge section 2, /files: "Download (signed URL minted by
// GET /api/files/[id]/url only after can(view, file)"). Downloading one file
// someone shared with you is a personal read, so every viewer with Can view
// gets it, Agents and Guests included; there is no bulk download here.
// The same read gate as the /files list and GET /api/files/[id]
// (src/lib/file-access.ts), so a row the list shows never 404s here.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withFreshFileUrl } from "@/lib/file-urls";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canReadFile } from "@/lib/file-access";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const { id } = await params;

  const file = await prisma.fileEntry.findFirst({ where: { id, organizationId: orgId } });
  if (!file) return jsonError("not found", 404);
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  if (!(await canReadFile(file, getUserId(session), accessLevel))) return jsonError("not found", 404);
  const fresh = await withFreshFileUrl(file);
  return jsonSuccess({ url: fresh.url, name: file.name, mimeType: file.mimeType, size: file.size }, 200, { "Cache-Control": "no-store" });
}
