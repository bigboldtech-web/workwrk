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
// (check-in-access.server.ts, SETTLED ONCE). Batch 8: POST writes only while
// the person holds a level in the session's workspace (writeCheckIn: a token
// can act for minutes after its person's membership ended), and GET orders
// and limits each part of what the caller reads in the database, so an
// Admin's read takes the 50 newest by the workspace's index instead of
// sorting every check-in of the workspace. Batch 9: POST is limited per
// person, as the app's other personal posts are (CHECK_IN_RATE: 10 in 15
// minutes, a 429 with Retry-After), and a deadlock answers the busy 503.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrgId, getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { peopleCtx } from "@/lib/people/person-access.server";
import { CHECK_IN_BUSY, CHECK_IN_NOT_HERE, CHECK_IN_RATE, checkInTooManyWords, mayReadCheckInsOf, parseCheckIn, readableCheckInsParts, writeCheckIn } from "@/lib/check-in-access.server";
import { rateLimit } from "@/lib/rate-limit-memory";

/** The most check-ins one read answers. */
const LIST_MAX = 50;

export async function GET(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return jsonError("Unauthorized", 401);

  const userId = new URL(req.url).searchParams.get("userId");
  if (userId && !(await mayReadCheckInsOf(ctx, userId))) return jsonError("Not found", 404);

  // Each part the newest LIST_MAX by its own index (the parts share no
  // row), then the newest LIST_MAX of them all.
  const lists = await Promise.all(
    readableCheckInsParts(ctx).map((part) =>
      prisma.checkIn.findMany({
        where: userId ? { AND: [part, { userId }] } : part,
        include: { user: { select: { firstName: true, lastName: true, avatar: true } } },
        orderBy: { createdAt: "desc" },
        take: LIST_MAX,
      }),
    ),
  );
  const checkIns = lists
    .flat()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, LIST_MAX);

  return jsonSuccess(checkIns);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  // Per person, every post counted, as change-password counts them.
  const limited = rateLimit(`check-in:${userId}`, CHECK_IN_RATE);
  if (!limited.ok) {
    return NextResponse.json({ error: checkInTooManyWords(limited.retryAfter) }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  }
  const parsed = parseCheckIn(await req.json().catch(() => null));
  if (!parsed.ok) return jsonError(parsed.error);

  // The workspace this session acts in: the one whose reads it belongs to,
  // and only while the person still holds a level there (THE WRITE).
  const out = await writeCheckIn(userId, getOrgId(session), parsed.value);
  if (!out.ok) return out.reason === "busy" ? jsonError(CHECK_IN_BUSY, 503) : jsonError(CHECK_IN_NOT_HERE, 403);

  return jsonSuccess(out.checkIn, 201);
}
