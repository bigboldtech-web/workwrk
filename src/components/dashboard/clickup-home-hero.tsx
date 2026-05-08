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

  return (
    <div className="space-y-6 mb-8">
      {/* Greeting + headline */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {greeting}, {firstName}.
          </h1>
          <p className="text-sm text-muted mt-1">
            {inboxTotal === 0
              ? "You're all clear today."
              : `${inboxTotal} item${inboxTotal === 1 ? "" : "s"} need you across the platform.`}
          </p>
        </div>
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg transition-colors"
        >
          Open Inbox <ArrowRight size={12} />
        </Link>
      </div>

      {/* KPI tiles — ClickUp-style: clean white card, vivid icon chip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.label}
              href={t.href}
              className="relative rounded-xl border border-slate-200 bg-white dark:bg-card dark:border-line p-4 transition-all hover:border-slate-300 hover:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 group"
            >
              <div className="flex items-start justify-between gap-2">
                <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${t.chipBg} ${t.chipFg}`}>
                  <Icon size={16} />
                </span>
                <ArrowRight size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
              </div>
              <p className="text-3xl font-bold mt-3 tabular-nums tracking-tight">{t.n}</p>
              <p className="text-xs mt-1 text-slate-500 dark:text-muted">{t.label}</p>
            </Link>
          );
        })}
      </div>

      {/* Two-column: What needs you (preview) + Quick actions */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-line bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">What needs you</p>
            <Link
              href="/inbox"
              className="text-xs text-muted hover:text-fg inline-flex items-center gap-1"
            >
              View all {inboxTotal > 0 && `(${inboxTotal})`} <ArrowRight size={10} />
            </Link>
          </div>
          {preview.length === 0 ? (
            <p className="text-xs text-muted py-6 text-center">
              Nothing pressing — clean Inbox.
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {preview.slice(0, 5).map((p) => {
                const Icon = p.icon;
                return (
                  <li key={p.id}>
                    <Link
                      href={p.href}
                      className="flex items-center gap-3 py-2.5 hover:bg-card-2/30 -mx-2 px-2 rounded transition-colors"
                    >
                      <span
                        className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${p.accent}`}
                      >
                        <Icon size={13} />
                      </span>
                      <span className="text-sm font-medium truncate flex-1">{p.title}</span>
                      <span className="text-[11px] text-muted flex-shrink-0">{p.meta}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-line bg-card p-4">
          <p className="text-sm font-semibold mb-3">Quick start</p>
          <div className="space-y-1.5">
            {quickActions.map((q) => {
              const Icon = q.icon;
              return (
                <Link
                  key={q.label}
                  href={q.href}
                  className="flex items-center gap-2.5 py-2 px-2.5 rounded-md hover:bg-card-2/40 transition-colors group"
                >
                  <Icon size={14} className="text-muted group-hover:text-fg transition-colors" />
                  <span className="text-sm flex-1">{q.label}</span>
                  <Plus size={11} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              );
            })}
          </div>
        </div>
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
