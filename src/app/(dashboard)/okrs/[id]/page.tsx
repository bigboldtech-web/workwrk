/* Goal detail — server-rendered for fast first paint, mirroring ClickUp's
 * goal page translated to the house design system (brand blue #0073EA,
 * flat Monday-clean, zinc neutrals — no purple):
 *
 *   Neutral hero band: "All Goals" crumb, LARGE progress ring left (the
 *   one rollup number, "—" when nothing is measured), title + inline "…"
 *   menu, description, meta chips; hero right: due date, owner,
 *   contributors stack.
 *   Below, white cards: Targets (key results as rows + "+ Add", inline
 *   check-ins — GoalTargets), Timeline (check-in history), cascade
 *   context (parent / children), linked work, custom fields.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireGoalPage } from "@/lib/page-gates";
import { canDeleteGoal, canEditOkrOwner } from "@/lib/alignment-scope";
import { listGoalAssigneeEntries, resolveGoalMembersBatch, canSeeGoal } from "@/lib/goal-audience";
import { computeGoalRollups, enrichKeyResults, goalRollupFor, KR_KPI_SELECT } from "@/lib/alignment";
import {
  ArrowLeft, AlertTriangle, Calendar, Clock,
  ChevronRight, Building2, Users, User as UserIcon,
} from "lucide-react";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import { OkrLinkedWork } from "./okr-linked-work";
import { GoalDetailMenu } from "./goal-detail-menu";
import { GoalTargets, type TargetRowData } from "./goal-targets";
import { OkrAudience } from "@/components/okrs/okr-audience";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Brand blue — the ONE accent; ClickUp's purple translates to this. */
const BRAND = "#0073EA";

const CADENCE_DAYS: Record<string, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 31,
};

const STATUS_META: Record<string, { color: string; label: string }> = {
  ON_TRACK: { color: "#16a34a", label: "On track" },
  AT_RISK: { color: "#f59e0b", label: "At risk" },
  BEHIND: { color: "#E2445C", label: "Behind" },
  COMPLETED: { color: BRAND, label: "Completed" },
};

const LEVEL_ICON: Record<string, { Icon: typeof Building2; label: string }> = {
  COMPANY:    { Icon: Building2, label: "Company" },
  DEPARTMENT: { Icon: Users,     label: "Department" },
  INDIVIDUAL: { Icon: UserIcon,  label: "Individual" },
};

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function relDays(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / DAY_MS);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return fmtShort(d);
}
// Staleness math lives here (not in the component body) so the impure
// Date.now() stays out of render — this is a server page, so
// per-request "now" is the correct reference point.
function checkinRecency(lastCheckIn: Date | null, cadenceDays: number, completed: boolean) {
  const now = Date.now();
  return {
    isStale:
      !completed && (!lastCheckIn || now - lastCheckIn.getTime() > cadenceDays * DAY_MS),
    daysSinceLastCheckin: lastCheckIn
      ? Math.floor((now - lastCheckIn.getTime()) / DAY_MS)
      : null,
  };
}

export const dynamic = "force-dynamic";

export default async function OkrDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Three-door gate, server-side, BEFORE any data renders: notFound()
  // unless canSeeGoal says yes (COMPANY → everyone; own/audience → you;
  // report tree → managers; org-wide levels → all). A guessed URL to
  // another team's goal 404s here.
  const viewer = await requireGoalPage(id);
  const orgId = viewer.organizationId;

  const okr = await prisma.oKR.findFirst({
    where: { id, organizationId: orgId },
    include: {
      keyResults: {
        orderBy: { createdAt: "asc" },
        include: {
          checkIns: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
          kpi: { select: KR_KPI_SELECT },
        },
      },
      children: { select: { id: true, title: true, progress: true, level: true, status: true } },
    },
  });
  if (!okr) notFound();

  // The same derived numbers every other surface shows: KPI-linked KRs
  // report the gauge's latest reading, and the goal's progress/status
  // roll up from live KRs + measured children (org-wide context, so a
  // parent is right even when the viewer can't see every child).
  const [keyResults, rollupCtx] = await Promise.all([
    enrichKeyResults(okr.keyResults, { userId: okr.ownerId }),
    computeGoalRollups(orgId),
  ]);
  const rollup = goalRollupFor(rollupCtx, okr);
  const measured = rollup.source !== "NONE";

  const checkinUserIds = Array.from(
    new Set(okr.keyResults.flatMap((kr) => kr.checkIns.map((c) => c.userId))),
  );
  const checkinUsers = checkinUserIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: checkinUserIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const userById = new Map(checkinUsers.map((u) => [u.id, u]));

  const [parent, owner, audienceEntries, membersByOkr] = await Promise.all([
    okr.parentId
      ? prisma.oKR.findUnique({
          where: { id: okr.parentId },
          select: { id: true, title: true, level: true, ownerId: true, departmentId: true },
        })
      : Promise.resolve(null),
    okr.ownerId
      ? prisma.user.findUnique({
          where: { id: okr.ownerId },
          select: { id: true, firstName: true, lastName: true, avatar: true, email: true },
        })
      : Promise.resolve(null),
    // Audience: labeled entries feed the edit picker; resolved members
    // (owner + direct + dept members + role holders, ACTIVE only,
    // resolved NOW) feed the avatar stack.
    listGoalAssigneeEntries(okr.id),
    resolveGoalMembersBatch(orgId, [{ id: okr.id, ownerId: okr.ownerId }]),
  ]);
  const audienceMembers = membersByOkr.get(okr.id) ?? [];

  // The cascade crumb links up to the parent goal — but only show it if the
  // viewer is actually allowed to see that parent. Otherwise a private goal
  // nested above one you can see would leak its title through the crumb.
  const sessionLike = {
    user: { id: viewer.id, organizationId: viewer.organizationId, accessLevel: viewer.accessLevel },
  };
  const parentCrumb = parent && (await canSeeGoal(sessionLike, parent)) ? parent : null;
  // Same predicates the APIs enforce — the header's "…"/right-click menu
  // only shows Delete when DELETE /api/okrs/[id] will honor it, and
  // Edit / Assign owner when PATCH /api/okrs will. canEditGoal also gates
  // Targets writes (add / delete / check-in — the key-results routes'
  // exact rule).
  const [canDelete, canEditGoal] = await Promise.all([
    canDeleteGoal(sessionLike, okr.ownerId),
    canEditOkrOwner(sessionLike, okr.ownerId),
  ]);

  const lastCheckIn = okr.keyResults
    .flatMap((kr) => kr.checkIns.map((c) => c.createdAt))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  // NONE = the owner opted this goal out of check-in reminders. Treat it
  // like COMPLETED for staleness — never nag (mirrors the okr-reminders
  // cron, which skips NONE goals), so the detail page and the cron agree.
  const cadenceOff = okr.checkInCadence === "NONE";
  const cadenceDays = CADENCE_DAYS[okr.checkInCadence] ?? 7;
  const { isStale, daysSinceLastCheckin } = checkinRecency(
    lastCheckIn,
    cadenceDays,
    okr.status === "COMPLETED" || cadenceOff,
  );

  // Contributors + linked-work edits go through the assignees / entity-links
  // APIs, both of which enforce canEditOkrOwner. Gate the affordance on the
  // SAME predicate (canEditGoal) so a manager outside the owner's report line
  // isn't shown a picker that then 403s on every add/remove.
  const canEditLinks = canEditGoal;
  const ownerName = owner ? `${owner.firstName} ${owner.lastName}`.trim() : "Unassigned";
  // Status follows the rollup: derived thresholds while the goal is
  // measured, the stored value otherwise — same rule as the APIs.
  const status = STATUS_META[rollup.status] ?? { color: BRAND, label: rollup.status };
  const level = LEVEL_ICON[okr.level] ?? LEVEL_ICON.INDIVIDUAL;

  // Targets card rows — everything serializable, relative times formatted
  // on the server clock so the client island never disagrees with SSR.
  const targetRows: TargetRowData[] = keyResults.map((kr) => ({
    id: kr.id,
    title: kr.title,
    unit: kr.unit,
    startValue: kr.startValue,
    targetValue: kr.targetValue,
    currentValue: kr.currentValue,
    progress: kr.progress,
    isDerived: Boolean(kr.isDerived),
    kpiName: kr.kpi?.name ?? null,
    lastCheckIn: kr.checkIns[0] ? relDays(kr.checkIns[0].createdAt) : null,
  }));

  type FlatCheckIn = {
    id: string;
    krId: string;
    krTitle: string;
    value: number;
    unit: string | null;
    note: string | null;
    userName: string;
    createdAt: Date;
  };
  const allCheckIns: FlatCheckIn[] = okr.keyResults
    .flatMap((kr) =>
      kr.checkIns.map((c) => {
        const u = userById.get(c.userId);
        return {
          id: c.id,
          krId: kr.id,
          krTitle: kr.title,
          value: c.value,
          unit: kr.unit,
          note: c.note,
          userName: u ? `${u.firstName} ${u.lastName}`.trim() : "Someone",
          createdAt: c.createdAt,
        };
      }),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 12);

  return (
    <div className="okrd">
      {/* Neutral hero band */}
      <header className="okrd__hero">
        <div className="okrd__hero-in">
          <div className="okrd__crumbs">
            <Link href="/okrs" className="okrd__back">
              <ArrowLeft /> All Goals
            </Link>
          </div>
          <div className="okrd__hero-grid">
            <div className="okrd__ring">
              <ProgressRing value={rollup.progress} measured={measured} />
            </div>
            <div className="okrd__hero-main">
              <div className="okrd__title-row">
                <h1 className="okrd__title">{okr.title}</h1>
                <GoalDetailMenu
                  goal={{
                    id: okr.id,
                    title: okr.title,
                    description: okr.description,
                    level: okr.level,
                    ownerId: okr.ownerId,
                    owner: owner
                      ? { id: owner.id, firstName: owner.firstName, lastName: owner.lastName, avatar: owner.avatar, email: owner.email }
                      : null,
                    quarter: okr.quarter,
                    startDate: okr.startDate?.toISOString() ?? null,
                    endDate: okr.endDate?.toISOString() ?? null,
                    checkInCadence: okr.checkInCadence,
                  }}
                  canDelete={canDelete}
                  canEdit={canEditGoal}
                />
              </div>
              {okr.description && <p className="okrd__desc">{okr.description}</p>}
              <div className="okrd__meta">
                <span className="okrd__chip"><level.Icon /> {level.label}</span>
                <span
                  className="okrd__chip okrd__chip--status"
                  style={{ color: status.color, background: `color-mix(in srgb, ${status.color} 12%, transparent)` }}
                >
                  {status.label}
                </span>
                {okr.quarter && <span className="okrd__chip">{okr.quarter}</span>}
                <span className="okrd__chip"><Calendar /> {fmtDate(okr.startDate)} → {fmtDate(okr.endDate)}</span>
                <span className="okrd__chip">
                  <Clock /> {cadenceOff ? "No check-in reminders" : `${okr.checkInCadence.toLowerCase()} check-ins`}
                </span>
              </div>
            </div>
            <div className="okrd__hero-side">
              <div className="okrd__side-block">
                <span className="okrd__side-label">Due date</span>
                <span className="okrd__due">{okr.endDate ? fmtShort(okr.endDate) : "—"}</span>
              </div>
              <div className="okrd__side-block">
                <span className="okrd__side-label">Owner</span>
                {owner ? (
                  <span className="okrd__owner">
                    <PersonAvatar person={owner} size={24} /> {ownerName}
                  </span>
                ) : (
                  <span className="okrd__owner okrd__owner--none">Unassigned</span>
                )}
              </div>
              <div className="okrd__side-block">
                <span className="okrd__side-label">Contributors</span>
                {/* One shared goal, many contributors — resolved avatar
                    stack + (for editors) the mixed people/departments/
                    roles picker. */}
                <OkrAudience
                  okrId={okr.id}
                  canEdit={canEditLinks}
                  initialEntries={audienceEntries}
                  initialMembers={audienceMembers.slice(0, 5)}
                  initialTotal={audienceMembers.length}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="okrd__cards">
        {/* Stale warning */}
        {isStale && (
          <div className="okrd__stale">
            <AlertTriangle />
            <div>
              <strong>Check-in overdue.</strong>{" "}
              <span>
                {daysSinceLastCheckin === null
                  ? "No check-ins yet."
                  : `Last check-in was ${daysSinceLastCheckin} day${daysSinceLastCheckin === 1 ? "" : "s"} ago.`}
                {" "}Cadence is {okr.checkInCadence.toLowerCase()}.
              </span>
            </div>
          </div>
        )}

        {/* Targets (key results) */}
        <GoalTargets
          okrId={okr.id}
          canEdit={canEditGoal}
          owner={owner}
          targets={targetRows}
        />

        {/* Timeline — the goal's check-in history, newest first */}
        <section className="okrd-card">
          <header>
            <h2>Timeline</h2>
            {allCheckIns.length > 0 && <span className="okrd-card__count">{allCheckIns.length}</span>}
          </header>
          {allCheckIns.length === 0 ? (
            <div className="okrd-card__empty">No activity yet — target check-ins land here.</div>
          ) : (
            <ol className="okrd-tl">
              {allCheckIns.map((c) => (
                <li key={c.id}>
                  <div className="okrd-tl__main">
                    <div className="okrd-tl__line">
                      <span className="okrd-tl__title">{c.krTitle}</span>
                      <span className="okrd-tl__value">→ {c.value}{c.unit ?? ""}</span>
                    </div>
                    {c.note && (
                      <p className="okrd-tl__note"><span>Note</span>{c.note}</p>
                    )}
                  </div>
                  <span className="okrd-tl__when">{relDays(c.createdAt)}, by {c.userName}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Cascade context */}
        {parentCrumb && (
          <section className="okrd-card">
            <header><h2>Cascades from</h2></header>
            <Link href={`/okrs/${parentCrumb.id}`} className="okrd-parent">
              <span className="okrd-parent__level">{parentCrumb.level}</span>
              <span className="okrd-parent__title">{parentCrumb.title}</span>
              <ChevronRight />
            </Link>
          </section>
        )}

        {okr.children.length > 0 && (
          <section className="okrd-card">
            <header>
              <h2>Cascades to</h2>
              <span className="okrd-card__count">{okr.children.length}</span>
            </header>
            <ul className="okrd-children">
              {okr.children.map((c) => {
                // Children show their ROLLED-UP number — the same one
                // their own detail page shows, never the stale column.
                const childRoll = goalRollupFor(rollupCtx, c);
                const childMeasured = childRoll.source !== "NONE";
                return (
                  <li key={c.id}>
                    <Link href={`/okrs/${c.id}`}>
                      <span className="okrd-child__level">{c.level}</span>
                      <span className="okrd-child__title">{c.title}</span>
                      <div className="okrd-child__bar">
                        <div className="okrd-child__bar-track">
                          {/* Neutral empty track when nothing is measured. */}
                          {childMeasured && (
                            <div className="okrd-child__bar-fill" style={{ width: `${childRoll.progress}%` }} />
                          )}
                        </div>
                        <span>{childMeasured ? `${childRoll.progress}%` : "—"}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Linked work */}
        <section className="okrd-card">
          <header><h2>Linked work</h2></header>
          <div className="okrd-card__cf">
            <OkrLinkedWork okrId={okr.id} canEdit={canEditLinks} />
          </div>
        </section>

        {/* Custom fields intentionally omitted: the only way to DEFINE a field
            is Studio, which isn't built yet, so the panel's empty state would
            dead-end on /studio. Re-add this section once Studio ships. */}
      </div>
    </div>
  );
}

/* SVG ring (no extra deps) — the LARGE hero ring, ClickUp-style, in brand
 * blue. An unmeasured goal (no KRs, no children, nothing hand-set) shows
 * an honest "—" over a neutral track, never a 0% that reads as "behind". */
function ProgressRing({ value, measured = true }: { value: number; measured?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  const size = 108;
  const half = size / 2;
  const r = 46;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - pct / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={measured ? `${pct}% complete` : "Not measured yet"}>
      <circle cx={half} cy={half} r={r} fill="var(--os-canvas)" stroke="var(--os-line)" strokeWidth="7" />
      {measured && (
        <circle
          cx={half} cy={half} r={r}
          fill="none"
          stroke={BRAND}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${half} ${half})`}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      )}
      <text x={half} y={half + 8} textAnchor="middle" fontSize="23" fontWeight="700" fill="var(--os-ink)">
        {measured ? `${pct}%` : "—"}
      </text>
    </svg>
  );
}
