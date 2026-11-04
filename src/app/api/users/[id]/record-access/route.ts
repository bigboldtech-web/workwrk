// GET /api/users/[id]/record-access: "Who can see this record" (access
// 6.1, the read-only Who has access view over { type: person }). Every
// Member may ask, about any record they can open, and the answer names the
// reason each person can read the people data (phone, birthday, KRAs and
// KPIs, goals, reviews, skill ratings). The card itself (name, photo, job
// title, department, office, manager, email) is everyone's.
//
// The groups mirror person-access.server.ts exactly: the person, their
// managers up the solid line, their dotted-line managers, the People team,
// the org-wide levels (C-level, VP, Director) and the Owner and Admins.
// Nothing here writes.
//
// The subject is anyone who holds a seat here (acting-workspace.ts
// personSeatIn, as GET /api/users/[id] reads them): someone anchored here,
// or someone who works here through a membership (docs/plans/workspace-status.md,
// the final review, product M3). Before, the record's menu item answered
// 404 for a membership person.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { peopleCtx } from "@/lib/people/person-access.server";
import { agentIdsIn } from "@/lib/access/manager-candidate";
import { inWorkspaceWhere, linesHereOf, personSeatIn } from "@/lib/access/acting-workspace";

const err = (status: number, error: string) => NextResponse.json({ error }, { status });

type P = { id: string; firstName: string; lastName: string; avatar: string | null };
const PERSON = { id: true, firstName: true, lastName: true, avatar: true } as const;
/** Names listed per org-wide group; the total is always the real count. */
const SHOW = 20;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (ctx.orgRole === "GUEST") return err(404, "Not found");
  const { id } = await params;
  // A seat here, of either kind (see the header), with the line it holds here.
  const seat = await personSeatIn(ctx.organizationId, id);
  if (!seat) return err(404, "Not found");
  const subject = await prisma.user.findUnique({ where: { id }, select: PERSON });
  if (!subject) return err(404, "Not found");

  // Managers up the solid line HERE (workspace-status-2.md E1, step 3): the
  // line each seat here holds (the account's for someone anchored here, the
  // membership's otherwise), as viewer.ts and the trees walk it. Before, the
  // walk climbed the account's line, so Pat's B record named her A manager,
  // to whom B's engine gives no reach, and left out Dana, who has it. (The
  // legacy walker has no depth cap; the loop guard stops a reporting cycle.)
  const chain: P[] = [];
  const seen = new Set<string>([subject.id]);
  let next = seat.managerId;
  while (next && !seen.has(next) && chain.length < 200) {
    seen.add(next);
    // Anyone on the line who works here, anchored here or through a
    // membership here (docs-found fixes batch 5), as the trees walk it.
    // inWorkspaceWhere is safe here (batch 6): the read is by id first.
    const m = await prisma.user.findFirst({ where: { id: next, ...inWorkspaceWhere(ctx.organizationId, { deactivatedToo: true }) }, select: { ...PERSON, deletedAt: true } });
    if (!m || m.deletedAt) break;
    chain.push({ id: m.id, firstName: m.firstName, lastName: m.lastName, avatar: m.avatar });
    // Their own line here, read at their seat (acting-workspace.ts linesHereOf).
    next = (await linesHereOf(ctx.organizationId, [m.id])).get(m.id) ?? null;
  }
  // This workspace's dotted lines only (E2), to managers whose seat here is
  // LIVE: a deactivated seat reads nothing (rule 1 refuses its session), and
  // a dotted line gives reach only from a live level (countedDottedManagerIds).
  // Narrowed by "UserDottedLine_organizationId_userId_idx" first, so
  // inWorkspaceWhere only filters this person's few dotted lines (batch 6).
  const dottedRows = await prisma.userDottedLine.findMany({
    where: { organizationId: ctx.organizationId, userId: subject.id, manager: { deletedAt: null, status: { not: "INACTIVE" }, ...inWorkspaceWhere(ctx.organizationId) } },
    select: { manager: { select: PERSON } },
  });
  // A manager deactivated here is walked through, so the people above still
  // read through the tree, but never listed as someone who can see the
  // record: their seat here (anchored here, or a membership here) or their
  // account is deactivated, so they cannot sign in to read it (the final
  // review of workspace-status-2, security L2; before, Rita, whom B
  // deactivated through her membership, was named here). One read by id.
  const liveHere = chain.length
    ? new Set((await prisma.user.findMany({ where: { id: { in: chain.map((p) => p.id) }, deletedAt: null, status: { not: "INACTIVE" }, ...inWorkspaceWhere(ctx.organizationId) }, select: { id: true } })).map((u) => u.id))
    : new Set<string>();
  // An Agent is nobody's manager (AGENT_TIER_BLURB): an Agent on the solid
  // line is passed over (the people above still read through the tree), and
  // an Agent's dotted line gives no reach (src/lib/access/manager-lines.ts).
  // So neither is listed as someone who can see the record.
  const agents = await agentIdsIn(ctx.organizationId, [...chain.map((p) => p.id), ...dottedRows.map((d) => d.manager.id)]);
  const managers = chain.filter((p) => !agents.has(p.id) && liveHere.has(p.id));
  const dotted = dottedRows.filter((d) => !agents.has(d.manager.id));

  const group = async (levels: string[]) => {
    // Reading OTHER people's stored level as data (who holds the People team,
    // org-wide and Admin doors), the same predicate person-access.server.ts
    // applies; nothing here decides the viewer's own access.
    // eslint-disable-next-line no-restricted-syntax
    const where = { organizationId: ctx.organizationId, deletedAt: null, accessLevel: { in: levels as never[] } };
    const [people, total] = await Promise.all([
      prisma.user.findMany({ where, select: PERSON, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], take: SHOW }),
      prisma.user.count({ where }),
    ]);
    return { people, total };
  };
  const [peopleTeam, orgWide, admins] = await Promise.all([
    group(["HR"]),
    group(["C_LEVEL", "VP", "DIRECTOR"]),
    group(["SUPER_ADMIN", "COMPANY_ADMIN"]),
  ]);

  return NextResponse.json(
    {
      subject: { id: subject.id, firstName: subject.firstName, lastName: subject.lastName, avatar: subject.avatar },
      groups: [
        { key: "chain", label: "Their managers, up the reporting line", people: managers, total: managers.length },
        { key: "dotted", label: "Dotted-line managers", people: dotted.map((d) => d.manager), total: dotted.length },
        { key: "people-team", label: "People team", ...peopleTeam },
        { key: "org-wide", label: "C-level, VPs and Directors", ...orgWide },
        { key: "admin", label: "Owner and Admins", ...admins },
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
