import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getRequestContext } from "@/lib/request-context";

// POST: record a version-pinned, attested acknowledgement — the legal evidence
// row. Captures which version was acked, a sha256 of the exact content, the
// attestation statement the user agreed to, plus IP + user-agent.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: policyId } = await params;
  const userId = getUserId(session);
  const { ipAddress, userAgent } = getRequestContext(req);

  const body = await req.json().catch(() => ({}));
  const attestation: string | undefined = typeof body.attestation === "string" ? body.attestation.trim() : undefined;
  if (!attestation) return jsonError("Acknowledgement requires an attestation statement.", 400);

  const policy = await prisma.policy.findUnique({
    where: { id: policyId },
    select: { id: true, version: true, content: true },
  });
  if (!policy) return jsonError("Policy not found", 404);

  const contentHash = createHash("sha256").update(policy.content ?? "").digest("hex");
  // Link to the PolicyVersion row for this version if one exists (snapshots are
  // created for prior states on republish; the current published state may not
  // have a row — version + contentHash stand alone as evidence regardless).
  const versionRow = await prisma.policyVersion.findFirst({
    where: { policyId, version: policy.version },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  // One row per (policy, user, version). Same-version re-ack refreshes the
  // evidence (time/IP/UA/hash) without creating duplicates.
  await prisma.policyAcknowledgment.upsert({
    where: { policyId_userId_version: { policyId, userId, version: policy.version } },
    create: {
      policyId, userId, version: policy.version, policyVersionId: versionRow?.id ?? null,
      ipAddress, userAgent, contentHash, attestation,
    },
    update: { ipAddress, userAgent, contentHash, attestation, acknowledgedAt: new Date() },
  });

  // If this policy was assigned to the user, mark the assignment complete so
  // tracking + /today reflect the acknowledgement of the current version.
  await prisma.policyAssignment.updateMany({
    where: { policyId, userId, status: { not: "COMPLETED" } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  return jsonSuccess({ acknowledged: true, version: policy.version });
}
