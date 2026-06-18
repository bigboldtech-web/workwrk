import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonSuccess } from "@/lib/api-helpers";
import { getRequestContext } from "@/lib/request-context";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: policyId } = await params;
  const userId = getUserId(session);
  const { ipAddress } = getRequestContext(req);

  await prisma.policyAcknowledgment.upsert({
    where: { policyId_userId: { policyId, userId } },
    create: { policyId, userId, ipAddress },
    update: {},
  });

  // If this policy was assigned to the user, mark the assignment complete so
  // tracking + /today reflect the acknowledgement.
  await prisma.policyAssignment.updateMany({
    where: { policyId, userId, status: { not: "COMPLETED" } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  return jsonSuccess({ acknowledged: true });
}
