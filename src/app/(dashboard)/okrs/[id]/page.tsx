/* OKR detail — server-rendered for fast first paint.
 *
 * Layout
 *   Header band: back link + title + status chip + progress hero (big %).
 *   Stale warning callout (if no recent check-in).
 *   2-col body:
 *     left  (2/3): KR list with inline check-in forms + custom fields.
 *     right (1/3): cascade context (parent + children) + recent activity feed.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isManagerLevel, requireGoalPage } from "@/lib/page-gates";
import { listGoalAssigneeEntries, resolveGoalMembersBatch } from "@/lib/goal-audience";
import { computeGoalRollups, enrichKeyResults, goalRollupFor, KR_KPI_SELECT } from "@/lib/alignment";
import {
  ArrowLeft, AlertTriangle, Target, Calendar, Clock, Sparkles,
  ChevronRight, Building2, Users, User as UserIcon, Activity,
} from "lucide-react";
import { OkrCheckInForm } from "./okr-checkin-form";
import { OkrLinkedWork } from "./okr-linked-work";
import { OkrAudience } from "@/components/okrs/okr-audience";
import { CustomFieldsPanel } from "@/components/custom-fields/custom-fields-panel";

const DAY_MS = 24 * 60 * 60 * 1000;

const CADENCE_DAYS: Record<string, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 31,
};

const STATUS_COLOR: Record<string, string> = {
  ON_TRACK: "var(--os-c-green)",
  AT_RISK: "var(--os-c-yellow)",
  BEHIND: "var(--os-c-red)",
  COMPLETED: "var(--os-c-teal)",
};
const STATUS_LABEL: Record<string, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  BEHIND: "Behind",
  COMPLETED: "Completed",
};

const LEVEL_ICON: Record<string, { Icon: typeof Building2; color: string; label: string }> = {
  COMPANY:    { Icon: Building2, color: "var(--os-c-blue)", label: "Company" },
  DEPARTMENT: { Icon: Users,     color: "var(--os-c-blue)", label: "Department" },
  INDIVIDUAL: { Icon: UserIcon,  color: "var(--os-c-teal)", label: "Individual" },
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
          select: { id: true, title: true, level: true },
        })
      : Promise.resolve(null),
    okr.ownerId
      ? prisma.user.findUnique({
          where: { id: okr.ownerId },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve(null),
    // Audience: labeled entries feed the edit picker; resolved members
    // (owner + direct + dept members + role holders, ACTIVE only,
    // resolved NOW) feed the avatar stack.
    listGoalAssigneeEntries(okr.id),
    resolveGoalMembersBatch(orgId, [{ id: okr.id, ownerId: okr.ownerId }]),
  ]);
  const audienceMembers = membersByOkr.get(okr.id) ?? [];

  const lastCheckIn = okr.keyResults
    .flatMap((kr) => kr.checkIns.map((c) => c.createdAt))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const cadenceDays = CADENCE_DAYS[okr.checkInCadence] ?? 7;
  const { isStale, daysSinceLastCheckin } = checkinRecency(
    lastCheckIn,
    cadenceDays,
    okr.status === "COMPLETED",
  );

  const canEditLinks =
    okr.ownerId === viewer.id || isManagerLevel(viewer.accessLevel);
  const ownerName = owner ? `${owner.firstName} ${owner.lastName}`.trim() : "Unassigned";
  // Status follows the rollup: derived thresholds while the goal is
  // measured, the stored value otherwise — same rule as the APIs.
  const statusColor = STATUS_COLOR[rollup.status] ?? "var(--os-c-blue)";
  const statusLabel = STATUS_LABEL[rollup.status] ?? rollup.status;
  const level = LEVEL_ICON[okr.level] ?? LEVEL_ICON.INDIVIDUAL;

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
    <div className="okrd" style={{ ["--okrd-color" as string]: statusColor }}>
      {/* Header */}
      <header className="okrd__head">
        <Link href="/okrs" className="okrd__back" aria-label="Back to OKRs">
          <ArrowLeft />
        </Link>
        <div className="okrd__head-main">
          <div className="okrd__head-meta">
            <span className="okrd__level" style={{ color: level.color, background: `color-mix(in srgb, ${level.color} 12%, transparent)` }}>
              <level.Icon /> {level.label}
            </span>
            <span className="okrd__status">{statusLabel}</span>
            {okr.quarter && <span className="okrd__chip">{okr.quarter}</span>}
            <span className="okrd__chip"><Calendar /> {fmtDate(okr.startDate)} → {fmtDate(okr.endDate)}</span>
            <span className="okrd__chip"><Clock /> {okr.checkInCadence.toLowerCase()} check-ins</span>
            <span className="okrd__chip">Owner: <strong>{ownerName}</strong></span>
          </div>
          <h1 className="okrd__title"><Target /> {okr.title}</h1>
          {okr.description && <p className="okrd__desc">{okr.description}</p>}
          {/* One shared goal, many contributors — resolved avatar stack +
              (for editors) the mixed people/departments/roles picker. */}
          <div className="mt-2">
            <OkrAudience
              okrId={okr.id}
              canEdit={canEditLinks}
              initialEntries={audienceEntries}
              initialMembers={audienceMembers.slice(0, 5)}
              initialTotal={audienceMembers.length}
            />
          </div>
        </div>
        <div className="okrd__progress">
          <div className="okrd__progress-ring">
            <ProgressRing value={rollup.progress} color={statusColor} measured={measured} />
          </div>
          <div className="okrd__progress-label">
            {measured ? "overall progress" : "no key results yet"}
          </div>
        </div>
      </header>

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

      {/* Body 2-col */}
      <div className="okrd__body">
        {/* Left: KRs + custom fields */}
        <main className="okrd__main">
          <section className="okrd-card">
            <header><h2><Sparkles /> Key results</h2><span>{keyResults.length}</span></header>
            {keyResults.length === 0 ? (
              <div className="okrd-card__empty">No key results defined. Add KRs to track measurable progress.</div>
            ) : (
              <ol className="okrd-krs">
                {keyResults.map((kr, i) => {
                  const last = kr.checkIns[0];
                  return (
                    <li key={kr.id} className="okrd-kr">
                      <div className="okrd-kr__head">
                        <span className="okrd-kr__num">KR{i + 1}</span>
                        <div className="okrd-kr__title">
                          <p>{kr.title}</p>
                          <span className="okrd-kr__values">
                            {kr.currentValue}{kr.unit ?? ""} of {kr.targetValue}{kr.unit ?? ""}
                            <em> · from {kr.startValue}{kr.unit ?? ""}</em>
                          </span>
                        </div>
                        <div className="okrd-kr__pct">
                          <strong>{kr.progress}%</strong>
                          {last && <span>last {relDays(last.createdAt)}</span>}
                        </div>
                      </div>
                      <div className="okrd-kr__bar">
                        <div className="okrd-kr__bar-track">
                          <div className="okrd-kr__bar-fill" style={{ width: `${Math.max(0, Math.min(100, kr.progress))}%` }} />
                        </div>
                      </div>
                      {/* Mini sparkline of check-ins */}
                      {kr.checkIns.length > 1 && (
                        <CheckinSparkline points={kr.checkIns.slice().reverse().map((c) => c.value)} color={statusColor} />
                      )}
                      <OkrCheckInForm
                        okrId={okr.id}
                        keyResultId={kr.id}
                        unit={kr.unit ?? ""}
                        current={kr.currentValue}
                      />
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="okrd-card">
            <header><h2>Linked work</h2></header>
            <div className="okrd-card__cf">
              <OkrLinkedWork okrId={okr.id} canEdit={canEditLinks} />
            </div>
          </section>

          <section className="okrd-card">
            <header><h2>Custom fields</h2></header>
            <div className="okrd-card__cf">
              <CustomFieldsPanel entityType="OKR" entityId={okr.id} showEmptyState />
            </div>
          </section>
        </main>

        {/* Right: cascade + activity */}
        <aside className="okrd__side">
          {/* Parent */}
          {parent && (
            <section className="okrd-side-card">
              <header><h3>Cascades from</h3></header>
              <Link href={`/okrs/${parent.id}`} className="okrd-parent">
                <span className="okrd-parent__level">{parent.level}</span>
                <span className="okrd-parent__title">{parent.title}</span>
                <ChevronRight />
              </Link>
            </section>
          )}

          {/* Children */}
          {okr.children.length > 0 && (
            <section className="okrd-side-card">
              <header>
                <h3>Cascades to</h3>
                <span className="okrd-side-card__count">{okr.children.length}</span>
              </header>
              <ul className="okrd-children">
                {okr.children.map((c) => {
                  // Children show their ROLLED-UP number — the same one
                  // their own detail page shows, never the stale column.
                  const childRoll = goalRollupFor(rollupCtx, c);
                  return (
                    <li key={c.id}>
                      <Link href={`/okrs/${c.id}`}>
                        <span className="okrd-child__level">{c.level}</span>
                        <span className="okrd-child__title">{c.title}</span>
                        <div className="okrd-child__bar">
                          <div className="okrd-child__bar-track">
                            <div className="okrd-child__bar-fill" style={{ width: `${childRoll.progress}%`, background: STATUS_COLOR[childRoll.status] ?? "var(--os-c-blue)" }} />
                          </div>
                          <span>{childRoll.source === "NONE" ? "—" : `${childRoll.progress}%`}</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Activity */}
          <section className="okrd-side-card">
            <header>
              <h3><Activity /> Recent check-ins</h3>
              {allCheckIns.length > 0 && <span className="okrd-side-card__count">{allCheckIns.length}</span>}
            </header>
            {allCheckIns.length === 0 ? (
              <div className="okrd-card__empty okrd-card__empty--small">No check-ins yet.</div>
            ) : (
              <ol className="okrd-activity">
                {allCheckIns.map((c) => (
                  <li key={c.id}>
                    <span className="okrd-activity__dot" style={{ background: statusColor }} />
                    <div className="okrd-activity__body">
                      <div className="okrd-activity__line">
                        <strong>{c.userName}</strong> updated <em>{c.krTitle}</em> to <code>{c.value}{c.unit ?? ""}</code>
                      </div>
                      {c.note && <p className="okrd-activity__note">&ldquo;{c.note}&rdquo;</p>}
                      <span className="okrd-activity__time">{relDays(c.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/* SVG ring (no extra deps). 36px wide, the percentage fills the
 * stroke-dasharray. Color comes from prop. An unmeasured goal (no KRs,
 * no children, nothing hand-set) shows an honest "—", not a 0% that
 * reads as "behind". */
function ProgressRing({ value, color, measured = true }: { value: number; color: string; measured?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 26;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - pct / 100);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--os-line)" strokeWidth="6" />
      {measured && (
        <circle
          cx="32" cy="32" r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform="rotate(-90 32 32)"
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      )}
      <text x="32" y="38" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--os-ink)">
        {measured ? `${pct}%` : "—"}
      </text>
    </svg>
  );
}

/* Sparkline of KR check-in values. Inline SVG, scales to container. */
function CheckinSparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 220;
  const h = 28;
  const stepX = w / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="okrd-kr__spark" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((v, i) => {
        const x = i * stepX;
        const y = h - ((v - min) / range) * (h - 4) - 2;
        return <circle key={i} cx={x} cy={y} r="2" fill={color} />;
      })}
    </svg>
  );
}
