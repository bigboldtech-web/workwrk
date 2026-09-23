import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { orgRoleOf } from "@/lib/access/org-role";

// GET /api/people/pick?q=, "who can I pick", for every people picker that
// needs the WHOLE company rather than a management tree.
//
// WHY THIS EXISTS RATHER THAN ANOTHER ?scope= ON /api/users.
//
// /api/users team-scopes anybody below the org-wide alignment levels
// (route.ts: "Non-org-wide callers can never escape team scope"), and that is
// right for what it is: the Teams directory, which answers "who do I manage".
// It is wrong for a DM picker, and it showed: New message listed exactly one
// person, the person using it. A Member could not start a conversation with
// anybody, and the same endpoint is why the task assignee picker showed only
// the viewer. Widening /api/users would widen the Teams directory with it,
// which is a different decision belonging to a different unit.
//
// So this is the narrow read the access spec names (step 3, `GET
// /api/people/pick`): active people in MY organization, and the four fields a
// picker row renders. No manager tree, no salary, no access level, no email
// beyond what a picker needs to disambiguate two people with one name.
//
// A GUEST gets only people they already share a conversation with. A Guest is
// somebody outside the company holding one or two objects, and handing them
// the staff list would be the leak that "Guests see only what is shared with
// them" exists to prevent. This is the honest approximation of the access
// engine's `accessibleUsers` until step 3 lands, and it is deliberately the
// narrow side of the question.

const LIMIT = 20;

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  if (!orgId) return jsonError("No organization", 400);
  const userId = getUserId(session);
  const accessLevel = (session.user as { accessLevel?: string } | undefined)?.accessLevel ?? "EMPLOYEE";

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? searchParams.get("search") ?? "").trim().slice(0, 80);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || LIMIT));
  // A picker that already holds somebody does not want to offer them again.
  const exclude = (searchParams.get("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const includeSelf = searchParams.get("includeSelf") === "1";

  let visibleIds: string[] | null = null;
  if (orgRoleOf({ accessLevel }) === "GUEST") {
    const shared = await prisma.conversationMember.findMany({
      where: { conversation: { organizationId: orgId, members: { some: { userId } } } },
      select: { userId: true },
      take: 500,
    });
    visibleIds = [...new Set(shared.map((r) => r.userId))];
    if (visibleIds.length === 0) return jsonSuccess({ people: [] });
  }

  const people = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      status: "ACTIVE",
      ...(visibleIds ? { id: { in: visibleIds } } : {}),
      ...(includeSelf ? {} : { id: { not: userId } }),
      ...(exclude.length > 0 ? { NOT: { id: { in: exclude } } } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" as const } },
              { lastName: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
      email: true,
      role: { select: { title: true } },
    },
  });

  return jsonSuccess({ people });
}
