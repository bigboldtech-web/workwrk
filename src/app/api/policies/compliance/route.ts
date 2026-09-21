import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { personScope } from "@/lib/process-scope";
import { buildPolicyCompliance } from "@/lib/policy-compliance";
import { parsePeriod } from "@/lib/policy-compliance-view";

/**
 * GET /api/policies/compliance?q=&departmentId=&policyId=&period=
 * (spec-process section 2 `/policies/compliance`): acknowledgement evidence
 * across every published policy, version-aware, scoped to the people the
 * viewer may see. "Acked" means acked the CURRENT required version.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const scope = await personScope(session);
  if (!scope.canView) return jsonError("Forbidden", 403);
  const sp = new URL(req.url).searchParams;
  const data = await buildPolicyCompliance(getOrgId(session), scope.orgWide ? null : scope.userIds, {
    q: sp.get("q"),
    departmentId: sp.get("departmentId"),
    policyId: sp.get("policyId"),
    period: parsePeriod(sp.get("period")),
  });
  return jsonSuccess(data);
}
