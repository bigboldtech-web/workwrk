import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isPeopleTeamOrAdmin } from "@/lib/people/review-cycle-access";
import { ANONYMITY_FLOOR, shuffled } from "@/lib/people/anonymity";

type Prompt = { id: string; text: string; type: string };
type Answer = { promptId: string; value: unknown };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  // Org-scoped: a session id from another org can never be resolved here.
  const candor = await prisma.candorSession.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!candor) return jsonError("Session not found", 404);

  // Authz (spec-teams-performance /candor/[id] Results): the session's
  // owner, the People team, Owner and Admin. Never another manager in the
  // org, never a respondent.
  const isOwner = candor.createdBy === getUserId(session);
  if (!isOwner && !(await isPeopleTeamOrAdmin(session))) return jsonError("Forbidden", 403);

  // Anonymity: we read ONLY the answers + timestamp. CandorResponse has no user
  // column, so there is nothing here that could identify a respondent.
  const responses = await prisma.candorResponse.findMany({
    where: { sessionId: id },
    select: { answers: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // The anonymity floor (DECIDED: four answers): under it, nothing but the
  // count leaves the server, so a small team cannot be read by arithmetic.
  if (responses.length < ANONYMITY_FLOOR) {
    return jsonSuccess({
      session: { id: candor.id, title: candor.title, description: candor.description, status: candor.status, launchedAt: candor.launchedAt, closedAt: candor.closedAt },
      totalResponses: responses.length,
      belowFloor: true,
      floor: ANONYMITY_FLOOR,
      results: [],
    });
  }

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
    // Shuffled, so the order can never be read as who answered first.
    return { prompt, type: "text", responses: shuffled(promptAnswers), count: promptAnswers.length };
  });

  return jsonSuccess({
    session: { id: candor.id, title: candor.title, description: candor.description, status: candor.status, launchedAt: candor.launchedAt, closedAt: candor.closedAt },
    totalResponses: responses.length,
    belowFloor: false,
    floor: ANONYMITY_FLOOR,
    results: aggregated,
  });
}
