// GET /api/skills (spec-teams-people /people/skills).
//
// Every distinct skill name in the org with its holder count over everyone,
// and averages, the Gap and Expert chips and the holder ratings computed only
// over the people whose ratings the viewer may read (self, the reporting
// chain, the People team, the org-wide levels, Admins): ratings are people
// data. `people` lists every holder for the drawer, ratings blank where not
// visible. ?names=1 returns the names alone (the Add skill typeahead).
// Guests get the 404: the Teams hub is never theirs.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { peopleCtx, readsPeopleDataOf } from "@/lib/people/person-access.server";
import { summariseSkills } from "@/lib/people/skills-aggregate";

export async function GET(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.orgRole === "GUEST") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await prisma.userSkill.findMany({
    where: { user: { organizationId: ctx.organizationId, deletedAt: null } },
    select: {
      id: true,
      name: true,
      selfRating: true,
      managerRating: true,
      user: {
        select: {
          id: true, firstName: true, lastName: true, avatar: true,
          department: { select: { id: true, name: true } },
        },
      },
    },
  });

  const summaries = summariseSkills(
    rows.map((r) => ({ id: r.id, name: r.name, userId: r.user.id, selfRating: r.selfRating, managerRating: r.managerRating })),
    (userId) => readsPeopleDataOf(ctx, userId),
  );

  if (new URL(req.url).searchParams.get("names") === "1") {
    return NextResponse.json({ names: summaries.map((s) => s.name) }, { headers: { "Cache-Control": "no-store" } });
  }

  const people = new Map(rows.map((r) => [r.user.id, r.user]));
  const data = summaries.map((s) => ({
    name: s.name,
    holders: s.holders,
    visibleRated: s.visibleRated,
    avgSelf: s.avgSelf,
    avgManager: s.avgManager,
    gap: s.gap,
    expert: s.expert,
    people: s.people.map((h) => {
      const u = people.get(h.userId);
      return {
        ...h,
        firstName: u?.firstName ?? "",
        lastName: u?.lastName ?? "",
        avatar: u?.avatar ?? null,
        department: u?.department ?? null,
        // The drawer's Rate row: the chain, the People team and Admins, never self.
        canRate: h.userId !== ctx.userId && readsPeopleDataOf(ctx, h.userId),
      };
    }),
  }));
  return NextResponse.json(
    { data, total: data.length, viewer: { id: ctx.userId, canExport: ctx.isAdmin && !ctx.isAgent } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
