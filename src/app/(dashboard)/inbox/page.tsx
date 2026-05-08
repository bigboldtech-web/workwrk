// Unified inbox — Workday's defining workflow pattern adapted to our
// data. Aggregates "what needs me right now" across SOP assignments,
// upcoming/overdue tasks, and pending reviews. Server-component so the
// first paint already has the data — no skeleton flicker.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, CheckSquare, Star, Inbox as InboxIcon, AlertTriangle, Crosshair, Receipt, DollarSign, CalendarOff, Clock, ShoppingCart, FileText } from "lucide-react";

const DAY_MS = 24 * 60 * 60 * 1000;
const TASK_HORIZON_DAYS = 7;
const OKR_CADENCE_DAYS: Record<string, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 31,
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtRelative(date: Date | null | undefined): string {
  if (!date) return "no due date";
  const diff = date.getTime() - Date.now();
  const days = Math.round(diff / DAY_MS);
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days <= 7) return `due in ${days} days`;
  return date.toLocaleDateString();
}

function isOverdue(date: Date | null | undefined): boolean {
  if (!date) return false;
  return date.getTime() < Date.now() - DAY_MS; // strictly before yesterday
}

export default async function InboxPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = (session.user as { id: string }).id;
  const orgId = (session.user as { organizationId: string }).organizationId;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const isOrgAdmin = accessLevel === "SUPER_ADMIN" || accessLevel === "COMPANY_ADMIN";

  const horizonEnd = new Date(Date.now() + TASK_HORIZON_DAYS * DAY_MS);

  // Ten queries in parallel. Each is bounded by the user/org pair.
  // Comp decisions are HR-only (filtered server-side); we fetch
  // unconditionally and the empty result hides the section for non-HR.
  const [
    sopAssignments,
    tasks,
    reviews,
    myOkrs,
    expensesToApprove,
    compToApprove,
    timeOffToApprove,
    timesheetsToApprove,
    posToApprove,
    invoicesToApprove,
  ] = await Promise.all([
    prisma.sOPAssignment.findMany({
      where: {
        userId,
        completedAt: null,
        sop: { organizationId: orgId, status: "PUBLISHED" },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: 50,
      select: {
        id: true,
        sopId: true,
        dueDate: true,
        mandatory: true,
        sop: { select: { title: true } },
      },
    }),
    prisma.task.findMany({
      where: {
        organizationId: orgId,
        assigneeId: userId,
        status: { not: "COMPLETED" },
        // Tasks with an end date in the past or within the horizon, OR
        // tasks with no endAt but a `date` anchor within window.
        OR: [
          { endAt: { lte: horizonEnd } },
          { AND: [{ endAt: null }, { date: { lte: horizonEnd } }] },
        ],
      },
      orderBy: [{ endAt: "asc" }, { date: "asc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        endAt: true,
        date: true,
        priority: true,
        status: true,
      },
    }),
    prisma.review.findMany({
      where: {
        reviewerId: userId,
        overallScore: null,
        cycle: { organizationId: orgId },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        subject: { select: { firstName: true, lastName: true } },
        cycle: { select: { name: true, endDate: true } },
      },
    }),
    // OKRs I own that haven't seen a check-in within their cadence.
    // Fetched broadly then filtered in JS so we can apply the cadence
    // rule against the most recent KRCheckIn timestamp.
    prisma.oKR.findMany({
      where: {
        organizationId: orgId,
        ownerId: userId,
        status: { not: "COMPLETED" },
      },
      take: 50,
      select: {
        id: true,
        title: true,
        progress: true,
        checkInCadence: true,
        keyResults: {
          select: {
            checkIns: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    }),
    // Expenses where I'm the named approver (or the open queue if I'm
    // a manager). Bounded; managers in big orgs may have lots of these
    // so we cap and link to the full Approval queue tab if exceeded.
    prisma.expense.findMany({
      where: {
        organizationId: orgId,
        status: "SUBMITTED",
        approverId: userId,
      },
      orderBy: { submittedAt: "asc" },
      take: 25,
      select: {
        id: true,
        description: true,
        amount: true,
        currency: true,
        submittedAt: true,
        reporter: { select: { firstName: true, lastName: true } },
      },
    }),
    // Comp decisions awaiting an HR call. Only org admins / HR see
    // these — for everyone else the role check returns 0 rows.
    isOrgAdmin
      ? prisma.compensationDecision.findMany({
          where: {
            organizationId: orgId,
            status: "PROPOSED",
            cycle: { status: { not: "CLOSED" } },
          },
          orderBy: { updatedAt: "asc" },
          take: 25,
          select: {
            id: true,
            cycleId: true,
            currentSalary: true,
            proposedSalary: true,
            currency: true,
            subject: { select: { firstName: true, lastName: true } },
            cycle: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    // Time-off requests pinned to me as approver (or open queue when
    // approverId is null). Skip rows the user submitted themselves.
    prisma.timeOffRequest.findMany({
      where: {
        organizationId: orgId,
        status: "PENDING",
        OR: [{ approverId: userId }, { approverId: null }],
        userId: { not: userId },
      },
      orderBy: { startDate: "asc" },
      take: 25,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        hours: true,
        user: { select: { firstName: true, lastName: true } },
        policy: { select: { name: true } },
      },
    }),
    // Submitted timesheets I'm assigned to approve (or open queue).
    prisma.timesheet.findMany({
      where: {
        organizationId: orgId,
        status: "SUBMITTED",
        OR: [{ approverId: userId }, { approverId: null }],
        userId: { not: userId },
      },
      orderBy: { submittedAt: "asc" },
      take: 25,
      select: {
        id: true,
        weekStartDate: true,
        submittedAt: true,
        user: { select: { firstName: true, lastName: true } },
        _count: { select: { entries: true } },
      },
    }),
    // Submitted POs assigned to me as approver (or open queue).
    prisma.purchaseOrder.findMany({
      where: {
        organizationId: orgId,
        status: "SUBMITTED",
        OR: [{ approverId: userId }, { approverId: null }],
        requesterId: { not: userId },
      },
      orderBy: { submittedAt: "asc" },
      take: 25,
      select: {
        id: true,
        number: true,
        amount: true,
        currency: true,
        description: true,
        vendor: { select: { name: true } },
        requester: { select: { firstName: true, lastName: true } },
      },
    }),
    // PENDING invoices org-wide (manager+ approves; finance pays).
    prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: "PENDING",
      },
      orderBy: { dueDate: "asc" },
      take: 25,
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        dueDate: true,
        vendor: { select: { name: true } },
      },
    }),
  ]);

  // Compute "stale" OKRs: latest check-in across all KRs is older than
  // the cadence allows (or no check-ins at all).
  const staleOkrs = myOkrs
    .map((okr) => {
      const latest = okr.keyResults
        .flatMap((kr) => kr.checkIns)
        .map((c) => c.createdAt)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const cadenceDays = OKR_CADENCE_DAYS[okr.checkInCadence] ?? 7;
      const isStale = !latest || Date.now() - latest.getTime() > cadenceDays * DAY_MS;
      const lastDays = latest
        ? Math.floor((Date.now() - latest.getTime()) / DAY_MS)
        : null;
      return isStale ? { id: okr.id, title: okr.title, progress: okr.progress, lastDays } : null;
    })
    .filter((x): x is { id: string; title: string; progress: number; lastDays: number | null } => x !== null);

  const total =
    sopAssignments.length +
    tasks.length +
    reviews.length +
    staleOkrs.length +
    expensesToApprove.length +
    compToApprove.length +
    timeOffToApprove.length +
    timesheetsToApprove.length +
    posToApprove.length +
    invoicesToApprove.length;
  const overdueCount =
    sopAssignments.filter((a) => isOverdue(a.dueDate)).length +
    tasks.filter((t) => isOverdue(t.endAt ?? t.date)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <InboxIcon size={22} /> Inbox
          </h1>
          <p className="text-muted text-sm mt-1">
            {total === 0
              ? "Nothing needs you right now."
              : `${total} item${total === 1 ? "" : "s"} need you`}
            {overdueCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-red-400">
                <AlertTriangle size={12} /> {overdueCount} overdue
              </span>
            )}
          </p>
        </div>
      </div>

      {total === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted text-sm">
            You're all clear. New items show up here when SOPs are assigned to you,
            tasks come due, or reviews need your input.
          </CardContent>
        </Card>
      )}

      {sopAssignments.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen size={16} /> SOPs assigned to you
              <span className="text-xs text-muted font-normal">({sopAssignments.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {sopAssignments.map((a) => {
                const overdue = isOverdue(a.dueDate);
                return (
                  <li key={a.id}>
                    <Link
                      href={`/sops/${a.sopId}`}
                      className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-medium truncate">{a.sop.title}</span>
                        {a.mandatory && (
                          <span className="text-[10px] uppercase tracking-wide text-orange-400 border border-orange-400/30 rounded px-1.5 py-0.5 flex-shrink-0">
                            Mandatory
                          </span>
                        )}
                      </div>
                      <span className={`text-xs flex-shrink-0 ml-3 ${overdue ? "text-red-400" : "text-muted"}`}>
                        {fmtRelative(a.dueDate)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {tasks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckSquare size={16} /> Tasks
              <span className="text-xs text-muted font-normal">({tasks.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {tasks.map((t) => {
                const due = t.endAt ?? t.date;
                const overdue = isOverdue(due);
                return (
                  <li key={t.id}>
                    <Link
                      href={`/tasks?taskId=${t.id}`}
                      className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-medium truncate">{t.title}</span>
                        {t.priority === "HIGH" && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-400 border border-amber-400/30 rounded px-1.5 py-0.5 flex-shrink-0">
                            High
                          </span>
                        )}
                        {t.priority === "URGENT" && (
                          <span className="text-[10px] uppercase tracking-wide text-red-400 border border-red-400/30 rounded px-1.5 py-0.5 flex-shrink-0">
                            Urgent
                          </span>
                        )}
                      </div>
                      <span className={`text-xs flex-shrink-0 ml-3 ${overdue ? "text-red-400" : "text-muted"}`}>
                        {fmtRelative(due)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {posToApprove.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingCart size={16} /> Purchase orders waiting on you
              <span className="text-xs text-muted font-normal">({posToApprove.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {posToApprove.map((p) => {
                const amount = Number(p.amount);
                let amountLabel: string;
                try {
                  amountLabel = new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency }).format(amount);
                } catch {
                  amountLabel = `${p.currency} ${amount.toFixed(2)}`;
                }
                return (
                  <li key={p.id}>
                    <Link
                      href="/procurement"
                      className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="font-mono text-xs text-muted">{p.number}</span>
                        <span className="text-sm font-medium truncate">{p.vendor.name}</span>
                        <span className="text-xs text-muted truncate">{p.description}</span>
                      </div>
                      <span className="text-xs font-mono flex-shrink-0 ml-3">{amountLabel}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {invoicesToApprove.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText size={16} /> Invoices waiting on you
              <span className="text-xs text-muted font-normal">({invoicesToApprove.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {invoicesToApprove.map((inv) => {
                const amount = Number(inv.amount);
                const overdue = inv.dueDate < new Date();
                let amountLabel: string;
                try {
                  amountLabel = new Intl.NumberFormat(undefined, { style: "currency", currency: inv.currency }).format(amount);
                } catch {
                  amountLabel = `${inv.currency} ${amount.toFixed(2)}`;
                }
                return (
                  <li key={inv.id}>
                    <Link
                      href="/procurement"
                      className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="font-mono text-xs text-muted">{inv.invoiceNumber}</span>
                        <span className="text-sm font-medium truncate">{inv.vendor.name}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                        <span className={`text-xs ${overdue ? "text-red-400" : "text-muted"}`}>
                          due {inv.dueDate.toLocaleDateString()}
                          {overdue && " · overdue"}
                        </span>
                        <span className="text-xs font-mono">{amountLabel}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {timesheetsToApprove.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock size={16} /> Timesheets waiting on you
              <span className="text-xs text-muted font-normal">({timesheetsToApprove.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {timesheetsToApprove.map((t) => (
                <li key={t.id}>
                  <Link
                    href="/timesheets"
                    className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">
                        {t.user ? `${t.user.firstName} ${t.user.lastName}` : "—"}
                      </span>
                      <span className="text-xs text-muted">
                        Week of {t.weekStartDate.toLocaleDateString()}
                      </span>
                    </div>
                    <span className="text-xs text-muted flex-shrink-0 ml-3">
                      {t._count.entries} {t._count.entries === 1 ? "entry" : "entries"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {timeOffToApprove.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarOff size={16} /> Time off waiting on you
              <span className="text-xs text-muted font-normal">({timeOffToApprove.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {timeOffToApprove.map((r) => {
                const days = Math.floor((r.endDate.getTime() - r.startDate.getTime()) / DAY_MS) + 1;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/time-off`}
                      className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-sm font-medium truncate">
                          {r.user ? `${r.user.firstName} ${r.user.lastName}` : "—"}
                        </span>
                        <span className="text-xs text-muted truncate">{r.policy.name}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                        <span className="text-xs text-muted">
                          {r.startDate.toLocaleDateString()}{days > 1 ? ` · ${days}d` : ""}
                        </span>
                        <span className="text-xs font-mono">{Number(r.hours).toFixed(0)}h</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {compToApprove.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign size={16} /> Comp decisions waiting on you
              <span className="text-xs text-muted font-normal">({compToApprove.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {compToApprove.map((c) => {
                const cur = c.currentSalary === null ? null : Number(c.currentSalary);
                const prop = c.proposedSalary === null ? null : Number(c.proposedSalary);
                const pct = cur && prop && cur > 0 ? ((prop - cur) / cur) * 100 : null;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/compensation/${c.cycleId}`}
                      className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-sm font-medium truncate">
                          {c.subject.firstName} {c.subject.lastName}
                        </span>
                        <span className="text-xs text-muted truncate">{c.cycle.name}</span>
                      </div>
                      <span className="text-xs font-mono flex-shrink-0 ml-3">
                        {pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {expensesToApprove.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt size={16} /> Expenses waiting on you
              <span className="text-xs text-muted font-normal">({expensesToApprove.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {expensesToApprove.map((e) => {
                const amount = Number(e.amount);
                const submittedAgo = e.submittedAt
                  ? Math.floor((Date.now() - e.submittedAt.getTime()) / DAY_MS)
                  : null;
                let amountLabel: string;
                try {
                  amountLabel = new Intl.NumberFormat(undefined, { style: "currency", currency: e.currency }).format(amount);
                } catch {
                  amountLabel = `${e.currency} ${amount.toFixed(2)}`;
                }
                return (
                  <li key={e.id}>
                    <Link
                      href={`/expenses/${e.id}`}
                      className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-sm font-medium truncate">{e.description}</span>
                        <span className="text-xs text-muted truncate">
                          {e.reporter ? `${e.reporter.firstName} ${e.reporter.lastName}` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                        <span className="text-xs font-mono">{amountLabel}</span>
                        <span className="text-xs text-muted">
                          {submittedAgo === null
                            ? ""
                            : submittedAgo === 0
                            ? "today"
                            : `${submittedAgo}d ago`}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {staleOkrs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Crosshair size={16} /> OKRs needing a check-in
              <span className="text-xs text-muted font-normal">({staleOkrs.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {staleOkrs.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/okrs/${o.id}`}
                    className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">{o.title}</span>
                      <span className="text-xs text-muted font-mono flex-shrink-0">{o.progress}%</span>
                    </div>
                    <span className="text-xs flex-shrink-0 ml-3 text-amber-400">
                      {o.lastDays === null ? "no check-ins yet" : `${o.lastDays} days since last`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {reviews.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Star size={16} /> Reviews waiting on you
              <span className="text-xs text-muted font-normal">({reviews.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-white/5">
              {reviews.map((r) => {
                const subject = `${r.subject.firstName} ${r.subject.lastName}`.trim();
                return (
                  <li key={r.id}>
                    <Link
                      href={`/reviews/${r.id}`}
                      className="flex items-center justify-between py-3 hover:bg-white/5 -mx-3 px-3 rounded transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-medium truncate">
                          Review for {subject}
                        </span>
                        <span className="text-xs text-muted truncate">
                          {r.cycle.name}
                        </span>
                      </div>
                      <span className={`text-xs flex-shrink-0 ml-3 ${isOverdue(r.cycle.endDate) ? "text-red-400" : "text-muted"}`}>
                        {fmtRelative(r.cycle.endDate)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
