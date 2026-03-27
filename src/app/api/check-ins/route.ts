import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");

  const checkIns = await prisma.checkIn.findMany({
    where: {
      user: { organizationId: orgId },
      ...(userId ? { userId } : {}),
    },
    include: { user: { select: { firstName: true, lastName: true, avatar: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return jsonSuccess(checkIns);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const body = await req.json();
  const { mood, wentWell, challenges, tomorrow } = body;

  if (mood == null || mood < 1 || mood > 5) {
    return jsonError("Mood must be between 1 and 5");
  }

  const checkIn = await prisma.checkIn.create({
    data: { userId, mood, wentWell, challenges, tomorrow },
  });

  return jsonSuccess(checkIn, 201);
}
