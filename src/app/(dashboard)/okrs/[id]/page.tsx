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
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ArrowLeft, AlertTriangle, Target, Calendar, Clock, Sparkles,
  ChevronRight, Building2, Users, User as UserIcon, Activity,
} from "lucide-react";
import { OkrCheckInForm } from "./okr-checkin-form";
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
  COMPANY:    { Icon: Building2, color: "var(--os-c-purple)", label: "Company" },
  TEAM:       { Icon: Users,     color: "var(--os-c-blue)",   label: "Team" },
  INDIVIDUAL: { Icon: UserIcon,  color: "var(--os-c-teal)",   label: "Individual" },
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

export const dynamic = "force-dynamic";

export default async function OkrDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const orgId = (session.user as { organizationId: string }).organizationId;

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
        },
      },
      children: { select: { id: true, title: true, progress: true, level: true, status: true } },
    },
  });
  if (!okr) notFound();

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

  const [parent, owner] = await Promise.all([
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
  ]);

  const lastCheckIn = okr.keyResults
    .flatMap((kr) => kr.checkIns.map((c) => c.createdAt))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const cadenceDays = CADENCE_DAYS[okr.checkInCadence] ?? 7;
  const isStale =
    okr.status !== "COMPLETED" &&
    (!lastCheckIn || Date.now() - lastCheckIn.getTime() > cadenceDays * DAY_MS);
  const daysSinceLastCheckin = lastCheckIn
    ? Math.floor((Date.now() - lastCheckIn.getTime()) / DAY_MS)
    : null;

  const ownerName = owner ? `${owner.firstName} ${owner.lastName}`.trim() : "Unassigned";
  const statusColor = STATUS_COLOR[okr.status] ?? "var(--os-c-indigo)";
  const statusLabel = STATUS_LABEL[okr.status] ?? okr.status;
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
        </div>
        <div className="okrd__progress">
          <div className="okrd__progress-ring">
            <ProgressRing value={okr.progress} color={statusColor} />
          </div>
          <div className="okrd__progress-label">overall progress</div>
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
            <header><h2><Sparkles /> Key results</h2><span>{okr.keyResults.length}</span></header>
            {okr.keyResults.length === 0 ? (
              <div className="okrd-card__empty">No key results defined. Add KRs to track measurable progress.</div>
            ) : (
              <ol className="okrd-krs">
                {okr.keyResults.map((kr, i) => {
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
                {okr.children.map((c) => (
                  <li key={c.id}>
                    <Link href={`/okrs/${c.id}`}>
                      <span className="okrd-child__level">{c.level}</span>
                      <span className="okrd-child__title">{c.title}</span>
                      <div className="okrd-child__bar">
                        <div className="okrd-child__bar-track">
                          <div className="okrd-child__bar-fill" style={{ width: `${c.progress}%`, background: STATUS_COLOR[c.status] ?? "var(--os-c-indigo)" }} />
                        </div>
                        <span>{c.progress}%</span>
                      </div>
                    </Link>
                  </li>
                ))}
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
 * stroke-dasharray. Color comes from prop. */
function ProgressRing({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 26;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - pct / 100);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--os-line)" strokeWidth="6" />
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
      <text x="32" y="38" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--os-ink)">{pct}%</text>
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
