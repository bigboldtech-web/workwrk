import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { buildSopCompliance } from "@/lib/sop-compliance";

/**
 * GET: the SOP compliance dashboard's data, scoped to the people the viewer
 * may see (spec-process section 1: hasReports over their chain; the People
 * team, Owner and Admin over everyone). The same builder feeds the CSV
 * export beside this file.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const data = await buildSopCompliance(session, req);
  if (!data) return jsonError("Forbidden", 403);
  return jsonSuccess(data);
}

