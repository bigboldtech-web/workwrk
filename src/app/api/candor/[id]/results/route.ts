import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

type Prompt = { id: string; text: string; type: string };
type Answer = { promptId: string; value: unknown };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // Authz: results are for managers/admins only — never a rank-and-file peer.
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  // Org-scoped: a session id from another org can never be resolved here.
  const candor = await prisma.candorSession.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!candor) return jsonError("Session not found", 404);

  // Anonymity: we read ONLY the answers + timestamp. CandorResponse has no user
  // column, so there is nothing here that could identify a respondent.
  const responses = await prisma.candorResponse.findMany({
    where: { sessionId: id },
    select: { answers: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Aggregate results per prompt
  const prompts: Prompt[] = Array.isArray(candor.prompts) ? (candor.prompts as unknown as Prompt[]) : [];
  const aggregated = prompts.map((prompt) => {
    const promptAnswers = responses
      .map((r) => {
        const arr: Answer[] = Array.isArray(r.answers) ? (r.answers as unknown as Answer[]) : [];
        const ans = arr.find((a) => a.promptId === prompt.id);
        return ans?.value;
      })
      .filter((v) => v !== undefined && v !== null && v !== "");

    if (prompt.type === "rating") {
      const nums = promptAnswers.map(Number).filter((n) => !isNaN(n));
      const avg = nums.length > 0 ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : null;
      const distribution = [1, 2, 3, 4, 5].map((n) => ({ value: n, count: nums.filter((v) => v === n).length }));
      return { prompt, type: "rating", average: avg, distribution, count: nums.length };
    }

    // Text responses (including start_stop_continue)
    return { prompt, type: "text", responses: promptAnswers, count: promptAnswers.length };
  });

  return jsonSuccess({
    session: { id: candor.id, title: candor.title, description: candor.description, status: candor.status, launchedAt: candor.launchedAt, closedAt: candor.closedAt },
    totalResponses: responses.length,
    results: aggregated,
  });
}
