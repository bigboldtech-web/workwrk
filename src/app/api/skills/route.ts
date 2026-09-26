// GET /api/skills
//
// Aggregates the org's UserSkill rows into a taxonomy view: every
// distinct skill name with the count of holders, average self/manager
// rating, and a list of the top holders. This is the read-only feed
// for /people · Skills (taxonomy view). Writes still go via the
// per-user skill endpoint.
//
// RATINGS ARE PEOPLE DATA (Phase 6, spec-teams-people section 1 Access:
// "ratings only for people the viewer holds person VIEW on"). Skills opened
// to every Member, so the names and holder counts stay org-wide, while the
// averages and the top-holders list are computed only over the ratings the
// caller may read: their own and their reporting tree's, or everyone's for
// an org-wide level. The manager average is divided by the rows that carry
// a manager rating (it was divided by every holder, so it read low).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonSuccess,
} from "@/lib/api-helpers";
import { isOrgWideAlignment } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";

export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  // null = every rating is readable (org-wide levels).
  const readable: Set<string> | null = isOrgWideAlignment(session)
    ? null
    : new Set(await getTeamUserIds(orgId, getUserId(session)));

  // Pull every UserSkill scoped to the org (via user relation). Limit
  // by joining on user.organizationId.
  const rows = await prisma.userSkill.findMany({
    where: { user: { organizationId: orgId, deletedAt: null } },
    select: {
      name: true,
      selfRating: true,
      managerRating: true,
      user: {
        select: {
          id: true, firstName: true, lastName: true, avatar: true,
          department: { select: { name: true } },
        },
      },
    },
  });

  const m = new Map<string, {
    name: string;
    holders: number;
    rated: number;
    managerRated: number;
    avgSelf: number;
    avgManager: number;
    topHolders: { id: string; firstName: string; lastName: string; rating: number; department?: string | null }[];
  }>();
  for (const r of rows) {
    const key = r.name.trim();
    if (!m.has(key)) {
      m.set(key, { name: key, holders: 0, rated: 0, managerRated: 0, avgSelf: 0, avgManager: 0, topHolders: [] });
    }
    const e = m.get(key)!;
    e.holders += 1;
    if (readable && !readable.has(r.user.id)) continue;
    e.rated += 1;
    e.avgSelf += r.selfRating;
    if (r.managerRating != null) {
      e.avgManager += r.managerRating;
      e.managerRated += 1;
    }
    e.topHolders.push({
      id: r.user.id,
      firstName: r.user.firstName,
      lastName: r.user.lastName,
      rating: r.managerRating ?? r.selfRating,
      department: r.user.department?.name ?? null,
    });
  }

  const out = Array.from(m.values()).map((e) => ({
    name: e.name,
    holders: e.holders,
    avgSelf: e.rated > 0 ? e.avgSelf / e.rated : 0,
    avgManager: e.managerRated > 0 ? e.avgManager / e.managerRated : 0,
    topHolders: e.topHolders.sort((a, b) => b.rating - a.rating).slice(0, 8),
  })).sort((a, b) => b.holders - a.holders || a.name.localeCompare(b.name));

  return jsonSuccess(out);
}
