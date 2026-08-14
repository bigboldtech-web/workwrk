import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const { answers } = body;

  if (!Array.isArray(answers) || answers.length === 0) {
    return jsonError("At least one answer is required");
  }

  // Org-scoped: never resolve a session id from another org.
  const candor = await prisma.candorSession.findFirst({
    where: { id, organizationId: orgId, status: "ACTIVE" },
  });
  if (!candor) return jsonError("Session not found or not active", 404);

  // Authz: a department-scoped session only accepts responses from members of
  // that department (mirrors the list-visibility gate in /api/candor GET).
  // The current user's department is read for AUTHORIZATION ONLY — it is never
  // written to the response, so anonymity is preserved.
  if (candor.departmentId) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true },
    });
    if (me?.departmentId !== candor.departmentId) {
      return jsonError("This session isn't open to you", 403);
    }
  }

  // Create anonymous response — NO userId, IP, or device is stored, ever.
  // The row has only { sessionId, answers } (see CandorResponse model — it has
  // no user column), so a response can never be traced back to a person.
  await prisma.candorResponse.create({
    data: {
      sessionId: id,
      answers,
    },
  });

  return jsonSuccess({ message: "Thank you for your honest feedback!" }, 201);
}
