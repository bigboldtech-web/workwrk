// GET /api/recruiting/interviews
//
// Returns this org's scheduled interviews with candidate + job + interviewer
// joined. Default window: -7d through +30d so the /recruiting/interviews
// view has data on both sides of "today". Manager+ only (PII).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");

  const MS_DAY = 86_400_000;
  const start = from ? new Date(from) : new Date(Date.now() - 7 * MS_DAY);
  const end = to ? new Date(to) : new Date(Date.now() + 30 * MS_DAY);

  const interviews = await prisma.interview.findMany({
    where: {
      organizationId: orgId,
      scheduledAt: { gte: start, lte: end },
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
    select: {
      id: true,
      scheduledAt: true,
      durationMinutes: true,
      type: true,
      location: true,
      status: true,
      score: true,
      notes: true,
      interviewer: { select: { id: true, firstName: true, lastName: true } },
      application: {
        select: {
          id: true,
          stage: true,
          candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
          job: { select: { id: true, title: true } },
        },
      },
    },
  });

  return jsonSuccess(interviews);
}
