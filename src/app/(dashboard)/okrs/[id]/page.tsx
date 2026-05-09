// OKR detail page. Server-rendered so the first paint already has
// the OKR + key results + recent check-ins. Cascading parent/child
// references give the user a sense of where this OKR sits in the
// org-wide tree, and a "stale" warning surfaces when no check-in
// has happened within the configured cadence.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, AlertTriangle, Crosshair, Calendar, Clock } from "lucide-react";
import { OkrCheckInForm } from "./okr-checkin-form";

const DAY_MS = 24 * 60 * 60 * 1000;

const CADENCE_DAYS: Record<string, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 31,
};

function statusColor(status: string): string {
  switch (status) {
    case "COMPLETED": return "text-green-400 border-green-400/30";
    case "ON_TRACK": return "text-[color:var(--accent-strong)] border-[#d4ff2e]/30";
    case "AT_RISK": return "text-amber-400 border-amber-400/30";
    case "BEHIND": return "text-red-400 border-red-400/30";
    default: return "text-muted border-white/20";
  }
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString();
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

  // KRCheckIn has a userId but no user relation, so we look up the
  // names in one batch and join in JS.
  const checkinUserIds = Array.from(
    new Set(
      okr.keyResults.flatMap((kr) => kr.checkIns.map((c) => c.userId)),
    ),
  );
  const checkinUsers = checkinUserIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: checkinUserIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const userById = new Map(checkinUsers.map((u) => [u.id, u]));

  // Pull parent + owner separately so we don't bloat the API response.
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

  // Most recent check-in across all KRs determines staleness.
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

  // Flatten check-ins across all KRs for the activity feed.
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
    .slice(0, 15);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/okrs"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg transition-colors mb-3"
        >
          <ChevronLeft size={12} /> Back to OKRs
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Crosshair size={20} />
              <h1 className="text-2xl font-bold tracking-tight">{okr.title}</h1>
              <span className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${statusColor(okr.status)}`}>
                {okr.status.replace("_", " ")}
              </span>
            </div>
            {okr.description && (
              <p className="text-sm text-muted mt-1">{okr.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted mt-2">
              <span>{okr.level}</span>
              {okr.quarter && <span>{okr.quarter}</span>}
              <span className="flex items-center gap-1">
                <Calendar size={11} /> {fmtDate(okr.startDate)} → {fmtDate(okr.endDate)}
              </span>
              <span>Owner: {ownerName}</span>
              <span className="flex items-center gap-1">
                <Clock size={11} /> Check in {okr.checkInCadence.toLowerCase()}
              </span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-3xl font-bold">{okr.progress}%</div>
            <div className="text-xs text-muted">overall progress</div>
          </div>
        </div>
      </div>

      {isStale && (
        <Card>
          <CardContent className="p-4 flex items-center gap-3 border border-amber-400/30 bg-amber-400/5 rounded-lg">
            <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-medium text-amber-400">Check-in overdue.</span>
              <span className="text-muted ml-1">
                {daysSinceLastCheckin === null
                  ? "No check-ins yet."
                  : `Last check-in was ${daysSinceLastCheckin} day${daysSinceLastCheckin === 1 ? "" : "s"} ago.`}
                {" "}Cadence is {okr.checkInCadence.toLowerCase()}.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {parent && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted">Cascades from</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={`/okrs/${parent.id}`}
              className="text-sm font-medium hover:underline"
            >
              {parent.title} <span className="text-xs text-muted">({parent.level})</span>
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Key results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {okr.keyResults.length === 0 && (
            <p className="text-sm text-muted">No key results defined.</p>
          )}
          {okr.keyResults.map((kr) => {
            const last = kr.checkIns[0];
            return (
              <div key={kr.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{kr.title}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {kr.currentValue}{kr.unit ?? ""} of {kr.targetValue}{kr.unit ?? ""}
                      {" · "}
                      from {kr.startValue}{kr.unit ?? ""}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-base font-semibold">{kr.progress}%</div>
                    {last && (
                      <div className="text-[10px] text-muted">
                        last: {last.createdAt.toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
                <Progress value={kr.progress} className="h-1.5" />
                <OkrCheckInForm
                  okrId={okr.id}
                  keyResultId={kr.id}
                  unit={kr.unit ?? ""}
                  current={kr.currentValue}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {allCheckIns.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent check-ins</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {allCheckIns.map((c) => (
                <li key={c.id} className="flex items-start gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#d4ff2e] mt-2 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        <span className="font-medium">{c.userName}</span>
                        <span className="text-muted"> updated </span>
                        <span>{c.krTitle}</span>
                        <span className="text-muted"> to </span>
                        <span className="font-mono">{c.value}{c.unit ?? ""}</span>
                      </span>
                      <span className="text-xs text-muted flex-shrink-0">
                        {c.createdAt.toLocaleDateString()}
                      </span>
                    </div>
                    {c.note && (
                      <p className="text-xs text-muted mt-1 italic">"{c.note}"</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {okr.children.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Cascading children ({okr.children.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {okr.children.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <Link
                    href={`/okrs/${c.id}`}
                    className="hover:underline flex items-center gap-2 min-w-0"
                  >
                    <span className="text-xs text-muted">{c.level}</span>
                    <span className="truncate">{c.title}</span>
                  </Link>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Progress value={c.progress} className="h-1.5 w-20" />
                    <span className="text-xs text-muted w-9 font-mono">{c.progress}%</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
