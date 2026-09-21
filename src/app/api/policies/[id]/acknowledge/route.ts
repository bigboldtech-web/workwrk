import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getRequestContext } from "@/lib/request-context";
import { parseProcessSettings } from "@/lib/process-settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsBlob = Record<string, any>;

/**
 * POST /api/policies/[id]/acknowledge { attestation?, version? }: the
 * version-pinned, attested evidence row (version, sha256 of the exact
 * content, the statement agreed to, IP and user agent).
 *
 * SCOPED TO THE VIEWER'S ORG. The old route looked the policy up by id alone,
 * so any signed-in user in any org could write a legally framed row against
 * any policy in the database. The policy must belong to the caller's org and
 * be PUBLISHED (or assigned to them) before anything is written. When the
 * body carries no attestation the org's default statement is used, so the
 * evidence always names a sentence.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: policyId } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const { ipAddress, userAgent } = getRequestContext(req);

  const [policy, org] = await Promise.all([
    prisma.policy.findFirst({
      where: { id: policyId, organizationId: orgId },
      select: { id: true, version: true, content: true, status: true, ackStatement: true, requiresAck: true, assignments: { where: { userId }, select: { id: true } } },
    }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
  ]);
  if (!policy) return jsonError("Policy not found", 404);
  if (policy.status !== "PUBLISHED" && policy.assignments.length === 0 && !isManager(session)) return jsonError("Policy not found", 404);
  if (policy.status !== "PUBLISHED") return jsonError("This policy is not published yet.", 409);

  const body = await req.json().catch(() => ({}));
  const settings = (org?.settings as SettingsBlob | null) || {};
  const fallback = policy.ackStatement?.trim() || parseProcessSettings(settings.process).value.ackStatement;
  const attestation: string = typeof body.attestation === "string" && body.attestation.trim() ? body.attestation.trim() : fallback;
  if (!attestation) return jsonError("Acknowledgement requires an attestation statement.", 400);
  if (typeof body.version === "number" && body.version !== policy.version) return jsonError("This policy changed since you opened it. Reload and read the new version.", 409);

  const contentHash = createHash("sha256").update(policy.content ?? "").digest("hex");
  const versionRow = await prisma.policyVersion.findFirst({ where: { policyId, version: policy.version }, select: { id: true }, orderBy: { createdAt: "desc" } });

  // CREATE-ONLY PER VERSION. A second acknowledgement of the same version is
  // answered with the first row untouched: the moment, the statement, the IP
  // and the hash of the FIRST acknowledgement are the evidence, and an
  // upsert's update branch used to overwrite all four. A new version gets
  // its own row (the unique key is policy + person + version), so the
  // history the ledger promises to keep is every version's first evidence.
  const row = await prisma.policyAcknowledgment.upsert({
    where: { policyId_userId_version: { policyId, userId, version: policy.version } },
    create: { policyId, userId, version: policy.version, policyVersionId: versionRow?.id ?? null, ipAddress, userAgent, contentHash, attestation },
    update: {},
    select: { acknowledgedAt: true },
  });

  await prisma.policyAssignment.updateMany({
    where: { policyId, userId, status: { not: "COMPLETED" } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  return jsonSuccess({ acknowledged: true, version: policy.version, acknowledgedAt: row.acknowledgedAt.toISOString() });
}
