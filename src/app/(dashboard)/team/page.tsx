// Teams > My team: how the viewer's people are doing at a glance, what needs
// the viewer (review and KPI approvals, people missing KRAs), and a shortcut
// into every section. Server component; all read-only counts.
//
// Gate (Phase 6): the `team` APP_RULES row, anyone with reports (solid or
// dotted), the People team, Owner, Admin. A Member with nobody reporting to
// them gets the sanctioned LockedPage without Request access
// (src/lib/people/team-gate.ts). Scoping is unchanged: a manager sees their
// recursive report tree; org-wide levels keep org counts.

import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  Users, Briefcase, Target, Gauge, ClipboardCheck, Award, BarChart3, Building2,
  Star, ArrowRight, CheckCircle2, type LucideIcon,
} from "lucide-react";
import { TeamStatTile, TeamCard } from "@/components/team/ui";
import { TeamPulse } from "@/components/team/team-pulse";
import { TAUPE } from "@/components/ui/accent";
import { teamAppGate, TEAM_LOCKED_SENTENCE } from "@/lib/people/team-gate";
import { LockedPage } from "@/components/access";
import { ORG_WIDE_ALIGNMENT_LEVELS } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";
import { countKpiReviewsForManager } from "@/lib/kpi-record";
import { countReviewsAwaitingManager } from "@/lib/weekly-review";

export const dynamic = "force-dynamic";

export default async function TeamOverviewPage() {
  const gate = await teamAppGate("team", "/team");
  if (gate.status === "locked") {
    return <LockedPage name="My team" sentence={TEAM_LOCKED_SENTENCE} back={{ fallbackHref: "/people", label: "Directory" }} />;
  }
  const u = gate.user;
  const orgId = u.organizationId;
  const me = u.id;

  // Door 3 sees the org; door 2 sees their recursive report tree.
  const orgWide = ORG_WIDE_ALIGNMENT_LEVELS.has(u.accessLevel);
  const teamIds = orgWide ? null : await getTeamUserIds(orgId, me);
  // ONE person predicate, shared with the Directory: not soft-deleted.
  // (UserStatus has no TERMINATED value — offboarding IS the soft delete —
  // so "deletedAt null" is the whole predicate.) Anything narrower, like
  // the old "status ACTIVE only", makes this tile disagree with the
  // Directory headcount.
  const peopleWhere = {
    organizationId: orgId,
    deletedAt: null,
    ...(teamIds ? { id: { in: teamIds } } : {}),
  };

  const [people, roles, kras, kpis, reviewsToApprove, kpiReviewQueue, missingKras] = await Promise.all([
    prisma.user.count({ where: peopleWhere }),
    prisma.role.count({ where: { organizationId: orgId } }),
    teamIds
      ? prisma.kRA.count({ where: { organizationId: orgId, assignments: { some: { userId: { in: teamIds }, status: "ACTIVE" } } } })
      : prisma.kRA.count({ where: { organizationId: orgId } }),
    teamIds
      ? prisma.kPI.count({ where: { organizationId: orgId, kra: { assignments: { some: { userId: { in: teamIds }, status: "ACTIVE" } } } } })
      : prisma.kPI.count({ where: { organizationId: orgId } }),
    // The sidebar badges' own counts (weekly-review.ts managerQueueWhere and
    // the recursive effective tree), uncapped, so this page, the badges and
    // the queues they link to always name the same number.
    countReviewsAwaitingManager(me),
    countKpiReviewsForManager(me, orgId),
    prisma.user.count({ where: { ...peopleWhere, kraAssignments: { none: {} } } }),
  ]);
  const kpiToApprove = kpiReviewQueue;

  // Sub-teams (/team/rollup, the second view of Alignment) only when at
  // least one of the viewer's people manages people of their own, so the
  // shortcut never lands on the "none of your reports manage people" state.
  const canRollup =
    (await prisma.user.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        manager: { deletedAt: null, ...(teamIds ? { id: { in: teamIds.filter((id) => id !== me) } } : {}) },
      },
    })) > 0;

  const queue = [
    { n: reviewsToApprove, label: "weekly review", plural: "weekly reviews", verb: "awaiting your approval", href: "/team/reviews", icon: ClipboardCheck, accent: "#dc2626" },
    { n: kpiToApprove, label: "KPI record", plural: "KPI records", verb: "to sign off", href: "/team/kpi-reviews", icon: Award, accent: "#f59e0b" },
    { n: missingKras, label: "person", plural: "people", verb: "have no KRAs yet", href: "/kra-kpi", icon: Target, accent: "#0073EA" },
  ].filter((q) => q.n > 0);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 pt-4 pb-3">
        <div className="text-xs text-zinc-500 mb-2">Teams</div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#0073EA]/10 shrink-0">
            <Users className="h-5 w-5 text-[#0073EA]" />
          </span>
          <h1 className="text-base font-semibold text-zinc-900">My team</h1>
          <span className="text-xs text-zinc-400">{people} people · {roles} job titles</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 max-w-[1280px]">
        {/* Headline stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TeamStatTile icon={Users} label="People" value={people} sub={orgWide ? "in the org" : "in your reporting tree"} accent="#0073EA" href="/people" />
          <TeamStatTile icon={Briefcase} label="Job titles" value={roles} sub="definitions" accent="#F59E0B" href="/people/roles" />
          <TeamStatTile icon={Star} label="KRAs" value={kras} sub="result areas" accent={TAUPE.soft} href="/kra-kpi" />
          <TeamStatTile icon={Gauge} label="KPIs" value={kpis} sub="metrics" accent="#16a34a" href="/kra-kpi" />
        </div>

        {/* What needs me */}
        <TeamCard title="Needs your attention">
          {queue.length === 0 ? (
            <div className="flex items-center gap-2 text-base text-zinc-500 py-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> You&rsquo;re all caught up.
            </div>
          ) : (
            <ul className="space-y-1">
              {queue.map((q) => (
                <li key={q.href}>
                  <Link href={q.href} className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-zinc-50">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg shrink-0" style={{ background: `${q.accent}1a` }}>
                      <q.icon className="h-4 w-4" style={{ color: q.accent }} />
                    </span>
                    <span className="text-base text-zinc-800 flex-1">
                      <span className="font-semibold tabular-nums">{q.n}</span> {q.n === 1 ? q.label : q.plural} {q.verb}
                    </span>
                    <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-zinc-500" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TeamCard>

        {/* Team pulse — people cards with current work */}
        <TeamCard title="Team pulse" subtitle="Who's working on what right now">
          <TeamPulse />
        </TeamCard>

        {/* Section shortcuts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ShortcutCard title="People" links={[
            { label: "Directory", href: "/people", icon: Users },
            { label: "Org chart", href: "/organization", icon: Building2 },
            { label: "Job titles", href: "/people/roles", icon: Briefcase },
          ]} />
          <ShortcutCard title="Alignment" links={[
            { label: "KRAs & KPIs", href: "/kra-kpi", icon: Star },
            { label: "Alignment", href: "/team/alignment", icon: Target },
          ]} />
          <ShortcutCard title="Performance" links={[
            { label: "Weekly reviews", href: "/team/reviews", icon: ClipboardCheck },
            { label: "KPI reviews", href: "/team/kpi-reviews", icon: Award },
            { label: "Workload", href: "/team/workload", icon: Gauge },
            ...(canRollup ? [{ label: "Sub-teams", href: "/team/rollup", icon: BarChart3 }] : []),
          ]} />
        </div>
      </div>
    </div>
  );
}

function ShortcutCard({ title, links }: { title: string; links: { label: string; href: string; icon: LucideIcon }[] }) {
  return (
    <TeamCard title={title}>
      <ul className="-mx-1">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 text-base text-zinc-700">
              <l.icon className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span className="flex-1">{l.label}</span>
              <ArrowRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-zinc-500" />
            </Link>
          </li>
        ))}
      </ul>
    </TeamCard>
  );
}
