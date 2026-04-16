import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const body = await req.json();
  const { answers } = body;

  if (!Array.isArray(answers) || answers.length === 0) {
    return jsonError("At least one answer is required");
  }

  const candor = await prisma.candorSession.findFirst({
    where: { id, organizationId: orgId, status: "ACTIVE" },
  });
  if (!candor) return jsonError("Session not found or not active", 404);

  // Create anonymous response — NO userId stored, ever
  const response = await prisma.candorResponse.create({
    data: {
      sessionId: id,
      answers,
    },
  });

  return jsonSuccess({ message: "Thank you for your honest feedback!" }, 201);
}
