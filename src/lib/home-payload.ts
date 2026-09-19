// home-payload.ts — the shape `GET /api/me/home` answers with, and the widget
// catalogue the page renders from it.
//
// It is a type module with one small pure helper, shared by the route and the
// page so the two cannot drift. A Next route module may not export types the
// client imports, which is the other reason it lives here.

export interface HomeTaskRow {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueAt: string | null;
  list: { id: string; slug: string; name: string } | null;
  /**
   * The status value the Home checkbox writes when this task is ticked: this
   * List's OWN first done status, resolved server-side. `null` means the List
   * has no done status, and the checkbox does not render for that row rather
   * than writing a status the List does not hold.
   */
  doneStatus: string | null;
}

export interface HomeWorkData {
  overdue: HomeTaskRow[];
  today: HomeTaskRow[];
  week: HomeTaskRow[];
  counts: { overdue: number; today: number; week: number; shown: number; more: number };
}

export interface HomeInboxRow {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  kind: { label: string; icon: string };
  href: string | null;
}

export interface HomeInboxData {
  unread: number;
  rows: HomeInboxRow[];
}

export interface HomeReminderRow {
  id: string;
  title: string;
  remindAt: string;
  overdue: boolean;
  href: string | null;
}

export interface HomeGoalRow {
  id: string;
  title: string;
  progress: number;
  endDate: string | null;
  status: string;
}

export interface HomeWeeklyReview {
  weekStart: string | null;
  status: string;
  kpisToRecord: number;
}

export interface HomeDocRow {
  id: string;
  title: string;
  viewedAt: string;
}

export interface HomePayload {
  isGuest: boolean;
  locale: { timeZone: string | null; weekStart: number | null };
  /** `null` means the widget could not be loaded, and it says so with a Retry. */
  work: HomeWorkData | null;
  inbox: HomeInboxData | null;
  /** `null` also means "not for this viewer" on the four a Guest never gets. */
  reminders: { rows: HomeReminderRow[] } | null;
  goals: { rows: HomeGoalRow[] } | null;
  weeklyReview: HomeWeeklyReview | null;
  recentDocs: { rows: HomeDocRow[] } | null;
}

/**
 * The words a Weekly review status prints, and the StatusChip tone that goes
 * with it. `WeeklyReviewStatus` is a Prisma enum, but this file must stay
 * importable from a test with no generated client, so the map is by string and
 * an unknown value falls back rather than throwing.
 */
export const REVIEW_STATUS: Readonly<Record<string, { label: string; tone: "neutral" | "warning" | "info" | "success" }>> = {
  NOT_STARTED: { label: "Not started", tone: "neutral" },
  DRAFT: { label: "In progress", tone: "warning" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  REVIEWED: { label: "Reviewed", tone: "success" },
  ACKNOWLEDGED: { label: "Reviewed", tone: "success" },
};

export function reviewStatusChip(status: string | null | undefined): { label: string; tone: "neutral" | "warning" | "info" | "success" } {
  const key = (status ?? "").toUpperCase();
  return REVIEW_STATUS[key] ?? { label: "Not started", tone: "neutral" };
}
