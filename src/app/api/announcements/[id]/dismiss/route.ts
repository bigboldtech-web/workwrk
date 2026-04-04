import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonSuccess } from "@/lib/api-helpers";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: announcementId } = await params;
  const userId = getUserId(session);

  await prisma.announcementDismissal.upsert({
    where: { announcementId_userId: { announcementId, userId } },
    create: { announcementId, userId },
    update: {},
  });

  return jsonSuccess({ dismissed: true });
}
