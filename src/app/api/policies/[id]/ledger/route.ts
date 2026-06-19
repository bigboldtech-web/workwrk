import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { buildPolicyLedger } from "@/lib/policy-ledger";

// GET: per-policy audit ledger — one row per expected person with their
// acknowledgement evidence (version, time, IP, user-agent, attestation, hash).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const ledger = await buildPolicyLedger(id, getOrgId(session));
  if (!ledger) return jsonError("Policy not found", 404);
  return jsonSuccess(ledger);
}
