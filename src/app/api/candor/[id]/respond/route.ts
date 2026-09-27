import { randomUUID } from "node:crypto";
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
  // The organiser never answers their own session: their answer would count
  // toward the four-answer floor and unlock results they know three people
  // wrote (the page and the boot count already leave them out).
  if (candor.createdBy === userId) return jsonError("You run this session, so you can't answer it", 403);

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
  //
  // Phase 6: WHO answered is recorded separately in CandorRespondent (one row
  // per session and person), which replaces the browser-only "already
  // responded" flag, stops one person answering many times, and drives the
  // sidebar's Candor count. It carries no answer, a random (not
  // time-ordered) id and only the DAY of the answer, so it cannot be lined
  // up with the response row by id or by timestamp. Both rows are written in
  // one transaction: a failed answer never marks the person as answered.
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  try {
    const already = await prisma.candorRespondent.findUnique({
      where: { sessionId_userId: { sessionId: id, userId } },
      select: { id: true },
    });
    if (already) return jsonError("You've already answered this session", 409);
    await prisma.$transaction([
      prisma.candorRespondent.create({ data: { id: randomUUID(), sessionId: id, userId, respondedAt: day } }),
      prisma.candorResponse.create({ data: { sessionId: id, answers } }),
    ]);
  } catch (e) {
    // A duplicate that raced past the check above.
    if ((e as { code?: string })?.code === "P2002") return jsonError("You've already answered this session", 409);
    // The table is absent for one release on a database that has not had
    // prisma/sql/2026-09-26-phase6-people.sql yet: answer as before.
    if ((e as { code?: string })?.code === "P2021") {
      await prisma.candorResponse.create({ data: { sessionId: id, answers } });
    } else {
      throw e;
    }
  }

  return jsonSuccess({ message: "Thank you for your honest feedback!" }, 201);
}
