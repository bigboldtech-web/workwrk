// GET /api/people/[id]/alignment, one person's live alignment picture
// (see src/lib/person-alignment.ts for what the payload derives).
//
// A person's readings are theirs: visible to themselves, their reporting
// line, the People team and org-wide levels. Peers get a 404, not a peek.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { buildPersonAlignment } from "@/lib/person-alignment";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  // The one people-data rule (person-access.server.ts): self, the chain
  // (solid or dotted, any depth), the People team, the org-wide levels and
  // Admins. A dotted-line manager used to get a 404 here while the person
  // page showed them the manage view.
  const ctx = await peopleCtx();
  if (!ctx || relationTo(ctx, id) === "none") {
    return jsonError("Not found", 404);
  }

  const person = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
      // The JD, Role.description is the mission the career home renders
      // under "My role"; level + department frame it.
      role: {
        select: {
          id: true,
          title: true,
          description: true,
          level: true,
          department: { select: { id: true, name: true } },
        },
      },
      manager: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!person) return jsonError("User not found", 404);

  const quarter = new URL(req.url).searchParams.get("quarter");
  const alignment = await buildPersonAlignment(orgId, id, { quarter });

  return jsonSuccess({ user: person, ...alignment });
}
