import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isSOPContentEmpty, isSOPTitleEmpty } from "@/lib/sop-content";

// GET: List all versions of an SOP
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const sop = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, version: true },
  });
  if (!sop) return jsonError("SOP not found", 404);

  const versions = await prisma.sOPVersion.findMany({
    where: { sopId: id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, title: true, description: true, createdAt: true, publishedBy: true },
  });

  return jsonSuccess({ currentVersion: sop.version, versions });
}

// POST: Rollback to a specific version
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const { versionId } = await req.json();

  if (!versionId) return jsonError("versionId is required");

  const sop = await prisma.sOP.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!sop) return jsonError("SOP not found", 404);

  const version = await prisma.sOPVersion.findFirst({
    where: { id: versionId, sopId: id },
  });
  if (!version) return jsonError("Version not found", 404);

  // Refuse rollback to an empty snapshot. The recovery scripts found
  // SOPs whose v1 was good and v2 was empty; if the only saved
  // versions for an SOP are empty (because the publish-blanks bug
  // ran more than once), rollback would propagate the bug instead of
  // recovering from it.
  if (isSOPTitleEmpty(version.title) || isSOPContentEmpty(version.content)) {
    return jsonError("That version is empty — pick a different one to roll back to.");
  }

  // Save current as a version snapshot before rollback
  await prisma.sOPVersion.create({
    data: {
      sopId: id,
      version: sop.version,
      title: sop.title,
      description: sop.description,
      content: sop.content as any,
      publishedBy: getUserId(session),
    },
  });

  // Rollback
  const updated = await prisma.sOP.update({
    where: { id },
    data: {
      title: version.title,
      description: version.description,
      content: version.content as any,
      version: sop.version + 1,
    },
  });

  return jsonSuccess({ message: `Rolled back to v${version.version}`, sop: updated });
}
