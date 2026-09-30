import { NextResponse, type NextRequest } from "next/server";
import { ownerSplitOn, sessionIsWorkspaceOwner } from "@/lib/access/workspace-admin";
import { accessV2Tables } from "@/lib/access/flags";
import { listMembers, peopleTeamIdsFor, MEMBER_SORTS, type MemberQuery, type MemberSort } from "@/lib/access/members-list.server";
import { roleCountsFor } from "@/lib/access/role-counts";
import { peopleCtx } from "@/lib/people/person-access.server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { settingsDoorAllows } from "@/lib/access/settings-door";

// GET /api/settings/members: the Members list (settings spec `/settings/
// members`). Server search, filters, sort and pages of 50. The whole org for
// Owners, Admins and the People team; the rest of the manager tier (who may
// open the page read-only today) gets their own reporting chain, exactly
// what they saw before.
//
//   ?q= ?sort= ?page= ?filter=role:owner|role:admin|role:member|role:guest|
//   unlinked|peopleteam|inactive30  ?department= ?office= ?title= ?status=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await settingsDoorAllows("members", session))) return NextResponse.json({ error: "no_access", page: "members" }, { status: 403 });
  const ctx = await peopleCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const filters = (sp.get("filter") ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  const roleF = filters.find((f) => f.startsWith("role:"))?.slice(5).toUpperCase();
  const sort = sp.get("sort");
  // A status outside the list is the caller's mistake: a 400 that names it,
  // never a 500 from the database layer.
  const statusParam = sp.get("status");
  const STATUSES = ["ACTIVE", "INACTIVE", "ON_LEAVE", "PROBATION", "PIP", "NOTICE_PERIOD"];
  if (statusParam && !STATUSES.includes(statusParam)) {
    return NextResponse.json({ error: `Unknown status: ${statusParam.slice(0, 40)}`, field: "status" }, { status: 400 });
  }
  const query: MemberQuery = {
    q: (sp.get("q") ?? "").slice(0, 80) || undefined,
    sort: sort && (MEMBER_SORTS as readonly string[]).includes(sort) ? (sort as MemberSort) : "name_asc",
    role: roleF === "OWNER" || roleF === "ADMIN" || roleF === "MEMBER" ? roleF : roleF === "GUEST" ? "guest" : null,
    departmentId: sp.get("department"),
    officeId: sp.get("office"),
    roleId: sp.get("title"),
    status: statusParam,
    noManager: filters.includes("unlinked") || filters.includes("nomanager"),
    peopleTeam: filters.includes("peopleteam"),
    inactive30: filters.includes("inactive30"),
    page: Number(sp.get("page") ?? 0) || 0,
  };
  const orgWide = ctx.isAdmin || ctx.peopleTeam;
  const scope = { orgWide, ids: orgWide ? [] : [ctx.userId, ...ctx.chain] };
  const [list, counts, team, isOwner] = await Promise.all([listMembers(orgId, scope, query), roleCountsFor(orgId), peopleTeamIdsFor(orgId), sessionIsWorkspaceOwner(session)]);
  return NextResponse.json(
    {
      ...list,
      counts,
      scope: orgWide ? "org" : "team",
      viewer: { id: ctx.userId, isOwner, canEdit: ctx.isAdmin, canEditPeopleFields: ctx.isAdmin || ctx.peopleTeam },
      // Admin scopes open Billing, or Security and API keys, only while the
      // Owner split is on AND the scopes are read (ACCESS_V2_TABLES): the
      // drawer shows the control as live only then.
      scopesLive: ownerSplitOn() && accessV2Tables(),
      peopleTeam: { configured: team.configured, ids: [...team.ids] },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
