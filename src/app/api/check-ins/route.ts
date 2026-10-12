// GET /api/check-ins: daily check-ins (mood, what went well, challenges,
// tomorrow's plan), newest first, 50 at most. POST: the signed-in person's
// own check-in.
//
// Docs-found fixes batch 5: GET listed ANY member's check-ins to anyone
// signed in, and `?userId=` picked any person. Now it lists the caller's own
// and the check-ins of people whose people data they read in this workspace
// (src/lib/check-in-access.server.ts, the ladder every people route asks). A
// `?userId=` the caller may not read answers 404, the same as a person who
// does not exist, never someone else's rows. POST writes only the caller's
// own (the body names no one), refuses a mood that is not a whole number
// from 1 to 5, and bounds each text.
//
// Docs-found fixes batch 6: a check-in names the workspace it was written in
// (POST writes the session's workspace), and GET reads only this workspace's
// rows, a person's own included: a check-in written in one workspace never
// reaches another's Admins or People team. Batch 7: a row from before the
// column was given its workspace once, at deploy, where its person worked in
// one workspace alone; a row still naming none is read only by its person
// (check-in-access.server.ts, SETTLED ONCE).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrgId, getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { peopleCtx } from "@/lib/people/person-access.server";
import { mayReadCheckInsOf, parseCheckIn, readableCheckInsWhere } from "@/lib/check-in-access.server";

export async function GET(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return jsonError("Unauthorized", 401);

  const userId = new URL(req.url).searchParams.get("userId");
  if (userId && !(await mayReadCheckInsOf(ctx, userId))) return jsonError("Not found", 404);

  const checkIns = await prisma.checkIn.findMany({
    where: userId ? { AND: [readableCheckInsWhere(ctx), { userId }] } : readableCheckInsWhere(ctx),
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
  const parsed = parseCheckIn(await req.json().catch(() => null));
  if (!parsed.ok) return jsonError(parsed.error);

  // The workspace this session acts in: the one whose reads it belongs to.
  const checkIn = await prisma.checkIn.create({
    data: { userId, organizationId: getOrgId(session), ...parsed.value },
  });

  return jsonSuccess(checkIn, 201);
}
