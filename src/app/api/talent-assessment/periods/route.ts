// GET /api/talent-assessment/periods -> { periods: [{ key, count }], current }
// The bounded period list the /talent views row and the Place person modal
// pick from (never free text): this fiscal year's quarters, every period a
// placement exists for, and every completed review cycle's name. Counts are
// of the placements the viewer may see.

import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { talentCtx, talentPeriods } from "@/lib/performance/talent.server";

export async function GET() {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await talentCtx();
  if (!ctx || !ctx.allowed) return jsonError("Forbidden", 403);
  return jsonSuccess(await talentPeriods(ctx));
}
