import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { recalculateAllScores } from "@/services/performanceScoreService";

// POST: Recalculate all scores for the organization
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);

  await recalculateAllScores(orgId);

  return jsonSuccess({ message: "All performance scores recalculated" });
}
