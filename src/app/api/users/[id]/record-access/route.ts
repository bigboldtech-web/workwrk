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

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { peopleCtx } from "@/lib/people/person-access.server";

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
  const subject = await prisma.user.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { ...PERSON, managerId: true },
  });
  if (!subject) return err(404, "Not found");

  // Managers up the solid line (the legacy walker has no depth cap; the
  // loop guard stops a reporting cycle).
  const chain: P[] = [];
  const seen = new Set<string>([subject.id]);
  let next = subject.managerId;
  while (next && !seen.has(next) && chain.length < 200) {
    seen.add(next);
    const m = await prisma.user.findFirst({ where: { id: next, organizationId: ctx.organizationId }, select: { ...PERSON, managerId: true, deletedAt: true } });
    if (!m || m.deletedAt) break;
    chain.push({ id: m.id, firstName: m.firstName, lastName: m.lastName, avatar: m.avatar });
    next = m.managerId;
  }
  const dotted = await prisma.userDottedLine.findMany({
    where: { userId: subject.id, manager: { deletedAt: null, organizationId: ctx.organizationId } },
    select: { manager: { select: PERSON } },
  });

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
        { key: "chain", label: "Their managers, up the reporting line", people: chain, total: chain.length },
        { key: "dotted", label: "Dotted-line managers", people: dotted.map((d) => d.manager), total: dotted.length },
        { key: "people-team", label: "People team", ...peopleTeam },
        { key: "org-wide", label: "C-level, VPs and Directors", ...orgWide },
        { key: "admin", label: "Owner and Admins", ...admins },
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
