import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const candor = await prisma.candorSession.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!candor) return jsonError("Session not found", 404);

  const responses = await prisma.candorResponse.findMany({
    where: { sessionId: id },
    select: { answers: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Aggregate results per prompt
  const prompts = (candor.prompts as any[]) || [];
  const aggregated = prompts.map((prompt: any) => {
    const promptAnswers = responses
      .map((r) => {
        const ans = (r.answers as any[]).find((a: any) => a.promptId === prompt.id);
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
