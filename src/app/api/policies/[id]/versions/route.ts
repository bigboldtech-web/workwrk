import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// GET: list a policy's version history (manager-gated).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const policy = await prisma.policy.findFirst({
    where: { id, organizationId: getOrgId(session) },
    select: { id: true, version: true },
  });
  if (!policy) return jsonError("Policy not found", 404);

  const versions = await prisma.policyVersion.findMany({
    where: { policyId: id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, title: true, createdAt: true, publishedBy: true },
  });

  return jsonSuccess({ currentVersion: policy.version, versions });
}

// POST: restore a prior version (manager-only). Snapshots current first.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const { versionId } = await req.json();
  if (!versionId) return jsonError("versionId is required");

  const policy = await prisma.policy.findFirst({ where: { id, organizationId: orgId } });
  if (!policy) return jsonError("Policy not found", 404);

  const version = await prisma.policyVersion.findFirst({ where: { id: versionId, policyId: id } });
  if (!version) return jsonError("Version not found", 404);
  if (!version.title?.trim()) return jsonError("That version is empty — pick a different one to restore.");

  // Snapshot the current state, then restore the chosen version + bump.
  await prisma.policyVersion.create({
    data: {
      policyId: id,
      version: policy.version,
      title: policy.title,
      content: policy.content,
      status: policy.status,
      publishedBy: getUserId(session),
    },
  });

  const updated = await prisma.policy.update({
    where: { id },
    data: { title: version.title, content: version.content, version: policy.version + 1 },
  });

  return jsonSuccess({ message: `Restored v${version.version}`, policy: updated });
}
