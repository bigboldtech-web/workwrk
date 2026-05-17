// ClickUp-style home hero. Renders above the existing role-specific
// dashboard widgets so the multi-role logic stays intact while the
// landing experience matches the new white aesthetic.
//
// Server-component — fetches all "what needs me" counts in one
// parallel batch on first paint. No client hydration cost beyond
// the existing dashboard.

import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  CalendarOff,
  CheckSquare,
  Clock,
  Crosshair,
  DollarSign,
  GraduationCap,
  Inbox as InboxIcon,
  Plus,
  Receipt,
  Star,
  Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function ClickupHomeHero() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const userId = (session.user as { id: string; firstName?: string }).id;
  const firstName = (session.user as { firstName?: string; name?: string }).firstName
    ?? (session.user as { name?: string }).name?.split(" ")[0]
    ?? "there";
  const orgId = (session.user as { organizationId: string }).organizationId;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const isManager = !["EMPLOYEE", "AGENT"].includes(accessLevel);

  // Parallel count fetch — only the headline numbers, not the rows.
  // The `<Inbox>` page itself is one click away for full detail.
  const horizonEnd = new Date(Date.now() + 7 * DAY_MS);

  const [
    sopAssignmentCount,
    taskCount,
    timeOffPendingCount,
    expensesPendingCount,
    timesheetsPendingCount,
    posPendingCount,
    invoicesPendingCount,
    upcomingInterviewsCount,
    mandatoryCoursesCount,
    sopAssignments,
    todayTasks,
  ] = await Promise.all([
    prisma.sOPAssignment.count({
      where: {
        userId,
        completedAt: null,
        sop: { organizationId: orgId, status: "PUBLISHED" },
      },
    }),
    prisma.task.count({
      where: {
        organizationId: orgId,
        assigneeId: userId,
        status: { not: "COMPLETED" },
        OR: [
          { endAt: { lte: horizonEnd } },
          { AND: [{ endAt: null }, { date: { lte: horizonEnd } }] },
        ],
      },
    }),
    isManager
      ? prisma.timeOffRequest.count({
          where: {
            organizationId: orgId,
            status: "PENDING",
            OR: [{ approverId: userId }, { approverId: null }],
            userId: { not: userId },
          },
        })
      : Promise.resolve(0),
    isManager
      ? prisma.expense.count({
          where: {
            organizationId: orgId,
            status: "SUBMITTED",
            approverId: userId,
          },
        })
      : Promise.resolve(0),
    isManager
      ? prisma.timesheet.count({
          where: {
            organizationId: orgId,
            status: "SUBMITTED",
            OR: [{ approverId: userId }, { approverId: null }],
            userId: { not: userId },
          },
        })
      : Promise.resolve(0),
    isManager
      ? prisma.purchaseOrder.count({
          where: {
            organizationId: orgId,
            status: "SUBMITTED",
            OR: [{ approverId: userId }, { approverId: null }],
            requesterId: { not: userId },
          },
        })
      : Promise.resolve(0),
    isManager
      ? prisma.invoice.count({
          where: { organizationId: orgId, status: "PENDING" },
        })
      : Promise.resolve(0),
    isManager
      ? prisma.interview.count({
          where: {
            organizationId: orgId,
            interviewerId: userId,
            status: "SCHEDULED",
            scheduledAt: {
              gte: new Date(Date.now() - DAY_MS),
              lte: horizonEnd,
            },
          },
        })
      : Promise.resolve(0),
    prisma.courseEnrollment.count({
      where: {
        userId,
        completedAt: null,
        course: { organizationId: orgId, mandatory: true },
      },
    }),
    // Top-of-inbox preview (3 items). Mix from the most relevant
    // sources for this role.
    prisma.sOPAssignment.findMany({
      where: {
        userId,
        completedAt: null,
        sop: { organizationId: orgId, status: "PUBLISHED" },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: 3,
      select: {
        id: true,
        sopId: true,
        dueDate: true,
        sop: { select: { title: true } },
      },
    }),
    prisma.task.findMany({
      where: {
        organizationId: orgId,
        assigneeId: userId,
        status: { not: "COMPLETED" },
      },
      orderBy: [{ endAt: "asc" }, { date: "asc" }],
      take: 3,
      select: {
        id: true,
        title: true,
        endAt: true,
        date: true,
      },
    }),
  ]);

  const inboxTotal =
    sopAssignmentCount +
    taskCount +
    timeOffPendingCount +
    expensesPendingCount +
    timesheetsPendingCount +
    posPendingCount +
    invoicesPendingCount +
    upcomingInterviewsCount +
    mandatoryCoursesCount;

  const greeting = greetingFor(new Date());

  // Build a flat preview list of up to 5 most-pressing items so the
  // user can click straight through without opening /inbox first.
  type PreviewItem = {
    id: string;
    icon: LucideIcon;
    title: string;
    meta: string;
    href: string;
    accent: string;
  };
  const preview: PreviewItem[] = [];
  for (const a of sopAssignments) {
    preview.push({
      id: `sop-${a.id}`,
      icon: BookOpen,
      title: a.sop.title,
      meta: a.dueDate ? `due ${a.dueDate.toLocaleDateString()}` : "no due date",
      href: `/sops/${a.sopId}`,
      accent: "text-amber-600 bg-amber-50",
    });
  }
  for (const t of todayTasks) {
    const due = t.endAt ?? t.date;
    preview.push({
      id: `task-${t.id}`,
      icon: CheckSquare,
      title: t.title,
      meta: `due ${due.toLocaleDateString()}`,
      href: `/tasks?taskId=${t.id}`,
      accent: "text-blue-600 bg-blue-50",
    });
  }

  // Tiles — pick the 4 most relevant for this role.
  // ClickUp-style: solid colored icon chip on a clean white card,
  // rather than full-tile gradients that fight the rest of the page.
  const tiles: Array<{
    label: string;
    n: number;
    icon: LucideIcon;
    href: string;
    chipBg: string;
    chipFg: string;
  }> = [
    {
      label: "Tasks this week",
      n: taskCount,
      icon: CheckSquare,
      href: "/tasks",
      chipBg: "bg-blue-50",
      chipFg: "text-blue-600",
    },
    {
      label: "SOPs to acknowledge",
      n: sopAssignmentCount,
      icon: BookOpen,
      href: "/sops/my-sops",
      chipBg: "bg-amber-50",
      chipFg: "text-amber-600",
    },
  ];
  if (isManager) {
    tiles.push({
      label: "Approvals waiting",
      n:
        timeOffPendingCount +
        expensesPendingCount +
        timesheetsPendingCount +
        posPendingCount +
        invoicesPendingCount,
      icon: InboxIcon,
      href: "/inbox",
      chipBg: "bg-emerald-50",
      chipFg: "text-emerald-600",
    });
    tiles.push({
      label: "Interviews this week",
      n: upcomingInterviewsCount,
      icon: Briefcase,
      href: "/recruiting",
      chipBg: "bg-violet-50",
      chipFg: "text-violet-600",
    });
  } else {
    tiles.push({
      label: "Mandatory courses",
      n: mandatoryCoursesCount,
      icon: GraduationCap,
      href: "/learning",
      chipBg: "bg-orange-50",
      chipFg: "text-orange-600",
    });
    tiles.push({
      label: "Inbox total",
      n: inboxTotal,
      icon: InboxIcon,
      href: "/inbox",
      chipBg: "bg-emerald-50",
      chipFg: "text-emerald-600",
    });
  }

  // Quick actions — the 4 things people start most often.
  const quickActions: Array<{ label: string; icon: LucideIcon; href: string }> = [
    { label: "Submit expense", icon: Receipt, href: "/expenses?create=1" },
    { label: "Request time off", icon: CalendarOff, href: "/time-off?create=1" },
    { label: "Clock in / out", icon: Clock, href: "/timesheets" },
    { label: "Log OKR check-in", icon: Crosshair, href: "/okrs" },
  ];

  // Lead message — confident, conversational, single sentence. The
  // tone shifts based on what the user actually has waiting:
  //   0     "You're all clear. Here's the org pulse."
  //   1-3   "X things need your attention."
  //   4-10  "Busy morning — X items waiting."
  //   11+   "Heavy load — start with the most overdue."
  const lead =
    inboxTotal === 0
      ? "You're all clear today."
      : inboxTotal <= 3
        ? `${inboxTotal} item${inboxTotal === 1 ? "" : "s"} need${inboxTotal === 1 ? "s" : ""} your attention.`
        : inboxTotal <= 10
          ? `Busy morning — ${inboxTotal} items waiting.`
          : `Heavy load — ${inboxTotal} items. Start with the most overdue.`;

  return (
    <div className="space-y-6 mb-6">
      {/* ── Greeting block ── confident, Workday-style large type. */}
      <header className="space-y-2 pt-2">
        <h1 className="text-3xl font-bold tracking-tight leading-[1.15]">
          {greeting}, {firstName}.
        </h1>
        <p className="text-[15px] text-muted leading-relaxed max-w-2xl">
          {lead}
        </p>
      </header>

      {/* ── KPI cards ── larger, calmer, single hover treatment. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.label}
              href={t.href}
              className="group rounded-xl border border-border bg-surface p-5 transition-fast hover:border-[color:var(--accent)]/40 hover:shadow-[0_4px_16px_-6px_rgba(0,0,0,0.10)] hover:-translate-y-px"
            >
              <div className="flex items-center justify-between mb-4">
                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${t.chipBg} ${t.chipFg}`}>
                  <Icon size={18} />
                </span>
                <ArrowRight
                  size={14}
                  className="text-muted-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-fast"
                />
              </div>
              <p className="text-3xl font-bold tabular-nums tracking-tight leading-none mb-1.5">
                {t.n}
              </p>
              <p className="text-[12.5px] text-muted leading-snug">{t.label}</p>
            </Link>
          );
        })}
      </div>

      {/* ── What needs you + Quick start ─────────────────────────────
          Two-column. The preview column is the wider focal element;
          quick start is a calm right-rail that doesn't compete. */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* What needs you */}
        <section className="lg:col-span-2 rounded-xl border border-border bg-surface">
          <header className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold">What needs you</h2>
            <Link
              href="/inbox"
              className="text-[12.5px] font-medium text-[color:var(--accent-strong)] hover:underline inline-flex items-center gap-1"
            >
              Open Inbox
              {inboxTotal > 0 && <span className="text-muted-2">· {inboxTotal}</span>}
              <ArrowRight size={11} />
            </Link>
          </header>
          {preview.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-muted">Inbox zero — nothing pressing.</p>
              <p className="text-xs text-muted-2 mt-1.5">
                New tasks, approvals, and reviews will land here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {preview.slice(0, 5).map((p) => {
                const Icon = p.icon;
                return (
                  <li key={p.id}>
                    <Link
                      href={p.href}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-[color:var(--surface-elevated)] transition-fast"
                    >
                      <span
                        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${p.accent}`}
                      >
                        <Icon size={14} />
                      </span>
                      <span className="text-[13.5px] font-medium truncate flex-1">{p.title}</span>
                      <span className="text-[11.5px] text-muted-2 flex-shrink-0">{p.meta}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Quick start */}
        <section className="rounded-xl border border-border bg-surface">
          <header className="px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold">Quick start</h2>
          </header>
          <div className="p-2">
            {quickActions.map((q) => {
              const Icon = q.icon;
              return (
                <Link
                  key={q.label}
                  href={q.href}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[color:var(--surface-elevated)] transition-fast"
                >
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] flex-shrink-0">
                    <Icon size={14} />
                  </span>
                  <span className="text-[13.5px] flex-1">{q.label}</span>
                  <Plus
                    size={12}
                    className="text-muted-2 opacity-0 group-hover:opacity-100 transition-fast"
                  />
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Working late";
}
