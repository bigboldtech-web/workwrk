// inbox-kinds.ts — the ONE routing table between what the app writes into
// `Notification.type` and what a person sees in their Inbox.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox, "Kind
// routing table"), which asks for this file by name and asks it to be
// "unit-tested against every `notification.create` call site's `type` literal,
// so an unrouted type fails the build instead of landing in Other with a
// snake_case label".
//
// WHAT WAS WRONG. The Inbox page carried a private `TYPE_VISUAL` map of ten
// hard-coded types with hex colours. The app writes twenty-six distinct type
// strings from twenty-seven sites in three casing conventions, so sixteen of
// them rendered as a grey bell in "Other" with no label at all — every
// reminder, every review, every survey, every policy. Two of the ten mapped
// types (`approval`, `boundary_request`) were phantom: `approval` is written by
// nothing. And `lib/workflows/runtime.ts` lets an automation author supply ANY
// string as the type, so no table over this column can ever be exhaustive.
//
// THE TABLE IS THEREFORE TOTAL BY CONSTRUCTION. `kindFor()` always returns a
// kind. An unknown type resolves to the `other` fallback with a label built
// from the type itself rather than a bare bell, and the completeness test
// (inbox-kinds.completeness.test.ts) asserts that every LITERAL type the
// repository writes has a real row, so drift is caught at test time while a
// runtime surprise is still rendered honestly.
//
// NO IMPORTS, on purpose: the API routes, the Inbox page, the bell popover and
// the sidebar count all read this, and the completeness test loads it in
// vitest's node environment where "@/" does not resolve.

/** The five tabs of the Inbox, in render order. `?tab=` carries these. */
export type InboxTab = "primary" | "other" | "mentions" | "snoozed" | "cleared";

/** The tab a kind routes to when the row is unread and not snoozed. */
export type KindTab = "primary" | "other";

/**
 * The Filter panel's checkbox rows (spec section 2 /inbox toolbar). One group
 * per row, so filtering is "Tasks" rather than "task_assigned, task_due_today,
 * task_overdue, task_status_changed".
 */
export type InboxFilterGroup =
  | "tasks"
  | "mentions"
  | "comments"
  | "reminders"
  | "requests"
  | "people"
  | "announcements"
  | "kudos"
  | "automations"
  | "talk";

export interface InboxKind {
  /** The stored `Notification.type`, normalised. */
  type: string;
  /** User words. Never a snake_case type string. */
  label: string;
  /** A Lucide icon NAME. This module stays import-free; the row resolves it. */
  icon: string;
  /** Which tab an unread row lands in. */
  tab: KindTab;
  /** Which Filter checkbox owns it. */
  filterGroup: InboxFilterGroup;
  /** `mention` is the only kind that is in Primary AND in the Mentions tab. */
  inMentions?: boolean;
}

function k(
  type: string,
  label: string,
  icon: string,
  tab: KindTab,
  filterGroup: InboxFilterGroup,
  inMentions = false,
): InboxKind {
  return { type, label, icon, tab, filterGroup, inMentions };
}

/**
 * Every type the app writes, keyed by its NORMALISED form. Order is the order
 * of the spec's table so the two can be diffed by eye.
 */
export const KINDS: Readonly<Record<string, InboxKind>> = {
  // ── Primary ───────────────────────────────────────────────────────
  task_assigned: k("task_assigned", "Assigned to you", "UserPlus", "primary", "tasks"),
  task_comment: k("task_comment", "Comment on your task", "MessageSquare", "primary", "comments"),
  comment_assigned: k("comment_assigned", "Comment assigned to you", "MessageSquare", "primary", "comments"),
  mention: k("mention", "Mentioned you", "AtSign", "primary", "mentions", true),
  task_due_today: k("task_due_today", "Due today", "CalendarClock", "primary", "tasks"),
  task_overdue: k("task_overdue", "Overdue", "CalendarClock", "primary", "tasks"),
  reminder: k("reminder", "Reminder", "Bell", "primary", "reminders"),
  action_item: k("action_item", "Action item from a meeting", "ListChecks", "primary", "tasks"),
  boundary_request: k("boundary_request", "Needs your approval", "ShieldCheck", "primary", "requests"),
  access_request: k("access_request", "Access request", "KeyRound", "primary", "requests"),
  access_granted: k("access_granted", "Access granted", "KeyRound", "primary", "requests"),
  access_expiring: k("access_expiring", "Access expiring", "KeyRound", "primary", "requests"),
  okr_assigned: k("okr_assigned", "Goal assigned", "Trophy", "primary", "people"),
  okr_check_in_due: k("okr_check_in_due", "Check-in due", "Trophy", "primary", "people"),
  kra_assigned: k("kra_assigned", "KRA assigned", "Trophy", "primary", "people"),
  kpi_score_due: k("kpi_score_due", "KPI score due", "Trophy", "primary", "people"),
  review_cycle_opened: k("review_cycle_opened", "Review to complete", "ClipboardCheck", "primary", "people"),
  review: k("review", "Review to complete", "ClipboardCheck", "primary", "people"),
  survey: k("survey", "Survey", "ClipboardList", "primary", "people"),
  candor_session: k("candor_session", "Candor session", "ClipboardList", "primary", "people"),
  // ── The cross-unit contract (consistency-report section G) ────────
  // Five row kinds this file OWNS and teams-performance CONSUMES. Nothing
  // writes them yet; they are declared here first, on purpose, because that
  // is what owning a contract means. Without them the consumer's rows fall
  // through to `fallbackKind`: a grey Bell in Other with a de-snake-cased
  // label ("Manager reviews due"), which is a failure quiet enough to ship
  // unnoticed. Four sit in Primary because they are work addressed to one
  // person with a deadline; kudos is recognition, which is Other, exactly
  // where the existing `kudos` kind already sits.
  review_open: k("review_open", "Review to complete", "ClipboardCheck", "primary", "people"),
  manager_reviews_due: k("manager_reviews_due", "Reviews due from you", "ClipboardCheck", "primary", "people"),
  candor_open: k("candor_open", "Candor session", "ClipboardList", "primary", "people"),
  survey_open: k("survey_open", "Survey", "ClipboardList", "primary", "people"),
  policy: k("policy", "Policy to acknowledge", "ScrollText", "primary", "announcements"),
  policy_published: k("policy_published", "Policy to acknowledge", "ScrollText", "primary", "announcements"),
  meeting_invite: k("meeting_invite", "Meeting invite", "Video", "primary", "people"),
  timesheet_approved: k("timesheet_approved", "Timesheet approved", "ClipboardCheck", "primary", "people"),
  timesheet_rejected: k("timesheet_rejected", "Timesheet returned", "ClipboardCheck", "primary", "people"),
  timesheet_submitted: k("timesheet_submitted", "Timesheet to review", "ClipboardCheck", "primary", "people"),
  // The two Phase 4 timesheet kinds. Both are action-required notices about
  // somebody's pay week, so they sit in Primary beside their three siblings
  // rather than falling through `fallbackKind` into Other with a grey Bell.
  //   timesheet_changed_after_close  api/time-entries/punch/route.ts
  //   timesheet_reopened            api/timesheets/[id]/route.ts
  timesheet_changed_after_close: k("timesheet_changed_after_close", "Closed week changed", "ClipboardCheck", "primary", "people"),
  timesheet_reopened: k("timesheet_reopened", "Timesheet reopened", "ClipboardCheck", "primary", "people"),
  task_escalated: k("task_escalated", "Task escalated to you", "ShieldCheck", "primary", "tasks"),
  /**
   * NOTHING WRITES THIS ANY MORE (spec-talk.md section 4 step 10: "call_incoming
   * never lands as a row; it is the ring"). A call is a live event, so the
   * answer to it is the incoming call card, and the durable record is the call
   * card message in the conversation itself, which keeps its roster and its
   * duration for ever. A bell row about a call that rang out twenty minutes
   * ago is a row you cannot act on.
   *
   * The kind stays registered so the rows written BEFORE this release keep
   * their label and their icon instead of falling through `fallbackKind` and
   * reading "Call incoming" on a grey Bell.
   */
  call_incoming: k("call_incoming", "Incoming call", "Video", "primary", "talk"),

  // ── Other ─────────────────────────────────────────────────────────
  sop: k("sop", "SOP assigned", "BookOpen", "other", "announcements"),
  sop_published: k("sop_published", "SOP updated", "BookOpen", "other", "announcements"),
  // The nine process kinds spec-process section 4 expects the Inbox to
  // render. Registered here BEFORE most of their writers exist (the same
  // reason the review kinds above are), because an unregistered dotted type
  // falls through to `fallbackKind` and reads "Sop.assigned" on a grey Bell.
  // The dotted spellings the writers use are aliased in TYPE_ALIASES.
  sop_assigned: k("sop_assigned", "SOP assigned", "BookOpen", "primary", "tasks"),
  sop_due_soon: k("sop_due_soon", "SOP due soon", "BookOpen", "primary", "tasks"),
  run_assigned: k("run_assigned", "Run assigned to you", "ListChecks", "primary", "tasks"),
  run_completed: k("run_completed", "Run completed", "ListChecks", "other", "announcements"),
  policy_assigned: k("policy_assigned", "Policy to acknowledge", "ScrollText", "primary", "announcements"),
  policy_reacknowledge: k("policy_reacknowledge", "Policy changed, acknowledge again", "ScrollText", "primary", "announcements"),
  contract_signed: k("contract_signed", "Contract signed", "FileSignature", "other", "announcements"),
  contract_declined: k("contract_declined", "Contract declined", "FileSignature", "primary", "announcements"),
  contract_completed: k("contract_completed", "Contract completed", "FileSignature", "other", "announcements"),
  /** An internal party's own signing link (lib/contract-notify.ts). */
  contract_sent: k("contract_sent", "Contract to sign", "FileSignature", "primary", "tasks"),
  /** Form "Tell these people about each new response" and its daily summary
   *  (api/forms/[id]/responses, api/cron/form-daily-summary). */
  form_response: k("form_response", "New form response", "ClipboardList", "other", "requests"),
  form_daily_summary: k("form_daily_summary", "Form responses today", "ClipboardList", "other", "requests"),
  task_status_changed: k("task_status_changed", "Task status changed", "CircleDot", "other", "tasks"),
  kudos: k("kudos", "Kudos", "Heart", "other", "kudos"),
  /** The fifth contract kind (see the block in Primary above). */
  kudos_received: k("kudos_received", "Kudos", "Heart", "other", "kudos"),
  /**
   * Announcements split in two, because the Inbox routes by TYPE STRING and
   * one row cannot land in two tabs (spec-talk.md section 4 step 10: "must
   * acknowledge announcements to Primary, other announcements to Other").
   * An ordinary announcement is something to read; a must-acknowledge one is
   * something to DO, and burying it under the kudos and the automation runs is
   * how a policy goes unsigned.
   */
  announcement: k("announcement", "Announcement", "Megaphone", "other", "announcements"),
  announcement_ack: k("announcement_ack", "Announcement to acknowledge", "Megaphone", "primary", "announcements"),
  automation: k("automation", "Automation ran", "Zap", "other", "automations"),
  automation_limit: k("automation_limit", "Automation limit", "Zap", "other", "automations"),
  asset_assigned: k("asset_assigned", "Asset assigned", "Laptop", "other", "announcements"),
  tool_shared: k("tool_shared", "Tool shared", "Laptop", "other", "announcements"),
  idea_update: k("idea_update", "Idea updated", "Lightbulb", "other", "announcements"),
  /**
   * Talk messages split the same way and for the same reason: a direct
   * message is addressed to you and a channel's "All messages" ring is
   * ambient. `mention` (Primary, and the only kind that is also in the
   * Mentions tab) covers being named anywhere.
   */
  chat_message: k("chat_message", "Channel message", "MessageCircle", "other", "talk"),
  chat_message_dm: k("chat_message_dm", "Direct message", "MessageCircle", "primary", "talk"),
  organization_hard_deleted: k("organization_hard_deleted", "Workspace removed", "Megaphone", "other", "announcements"),
};

/**
 * Types that existed under a louder name. Normalisation happens at WRITE time
 * (every writer now stores the lowercase form) and once over the stored rows
 * (scripts/migrate-notification-types.ts), but reads still go through here so
 * a row written by the release before the migration is routed correctly rather
 * than dropped into Other. Left in place permanently: it costs one map lookup
 * and it is the difference between an old row being readable and not.
 */
export const TYPE_ALIASES: Readonly<Record<string, string>> = {
  KUDOS: "kudos",
  SURVEY: "survey",
  REVIEW: "review",
  POLICY: "policy",
  SOP: "sop",
  TASK_ESCALATED: "task_escalated",
  // Written by src/app/api/access-requests/route.ts with a dotted form in an
  // earlier draft of the access spec; both shapes resolve to one kind.
  "access.request": "access_request",
  "access.granted": "access_granted",
  "access.expiring": "access_expiring",
  // The process unit's dotted forms (spec-process section 4).
  "sop.assigned": "sop_assigned",
  "sop.due_soon": "sop_due_soon",
  "run.assigned": "run_assigned",
  "run.completed": "run_completed",
  "policy.assigned": "policy_assigned",
  "policy.reacknowledge": "policy_reacknowledge",
  "contract.signed": "contract_signed",
  "contract.declined": "contract_declined",
  "contract.completed": "contract_completed",
  "contract.sent": "contract_sent",
  "form.response": "form_response",
  "form.daily_summary": "form_daily_summary",
};

/** The stored type in its canonical, lowercase, underscore form. */
export function normaliseNotificationType(type: string | null | undefined): string {
  const raw = (type ?? "").trim();
  if (!raw) return "";
  if (TYPE_ALIASES[raw]) return TYPE_ALIASES[raw];
  const lower = raw.toLowerCase();
  if (TYPE_ALIASES[lower]) return TYPE_ALIASES[lower];
  return lower;
}

/**
 * The fallback kind. An automation author can put any string in this column
 * (lib/workflows/runtime.ts passes `cfg.notificationType` through), so the one
 * thing this must never do is render a bare bell with no words: the label is
 * built from the type so the row still says what it is.
 */
export function fallbackKind(type: string): InboxKind {
  const words = type.replace(/[._-]+/g, " ").trim();
  const label = words ? words.charAt(0).toUpperCase() + words.slice(1) : "Notification";
  return k(type, label, "Bell", "other", "announcements");
}

/** Total: every type resolves to a kind. */
export function kindFor(type: string | null | undefined): InboxKind {
  const normalised = normaliseNotificationType(type);
  return KINDS[normalised] ?? fallbackKind(normalised || "notification");
}

/** Which of the two unread tabs this type belongs in. */
export function tabFor(type: string | null | undefined): KindTab {
  return kindFor(type).tab;
}

/** True when the type belongs in the Mentions tab. */
export function isMentionType(type: string | null | undefined): boolean {
  return kindFor(type).inMentions === true;
}

/**
 * Every type that routes to a tab, in the canonical form AND every alias
 * spelling that resolves to it. Used to build SQL `in` lists, where a row
 * written as "run.assigned" by an older release must land in the same tab
 * as "run_assigned" (the alias table is otherwise applied at render time,
 * after the query has already sorted the row into Other).
 */
export function typesForTab(tab: KindTab): string[] {
  const canonical = Object.values(KINDS).filter((x) => x.tab === tab).map((x) => x.type);
  const set = new Set(canonical);
  for (const [alias, target] of Object.entries(TYPE_ALIASES)) if (set.has(target)) set.add(alias);
  return Array.from(set);
}

/** Every normalised type in a Filter group. */
export function typesForFilterGroup(group: InboxFilterGroup): string[] {
  return Object.values(KINDS).filter((x) => x.filterGroup === group).map((x) => x.type);
}

/** Every normalised type flagged for the Mentions tab. */
export function mentionTypes(): string[] {
  return Object.values(KINDS).filter((x) => x.inMentions).map((x) => x.type);
}

/** The Filter panel's rows, in render order, with user words. */
export const FILTER_GROUPS: ReadonlyArray<{ key: InboxFilterGroup; label: string }> = [
  { key: "tasks", label: "Tasks" },
  { key: "mentions", label: "Mentions" },
  { key: "comments", label: "Comments" },
  { key: "reminders", label: "Reminders" },
  { key: "requests", label: "Requests and approvals" },
  { key: "people", label: "People and goals" },
  { key: "announcements", label: "Announcements" },
  { key: "kudos", label: "Kudos and surveys" },
  { key: "automations", label: "Automations" },
  { key: "talk", label: "Talk" },
];

/** The tabs, in render order, with the words the pills print. */
export const INBOX_TABS: ReadonlyArray<{ key: InboxTab; label: string }> = [
  { key: "primary", label: "Primary" },
  { key: "other", label: "Other" },
  { key: "mentions", label: "Mentions" },
  { key: "snoozed", label: "Snoozed" },
  { key: "cleared", label: "Cleared" },
];

/** `?tab=` parsing that never throws and never returns an unknown tab. */
export function parseTab(raw: string | null | undefined): InboxTab {
  const v = (raw ?? "").toLowerCase();
  // "later" was this tab's name before the action beside it was called Snooze.
  if (v === "later") return "snoozed";
  return (INBOX_TABS.find((t) => t.key === v)?.key ?? "primary") as InboxTab;
}

/** The empty-state sentence per tab (spec section 2 /inbox States). */
export const TAB_EMPTY_SENTENCE: Readonly<Record<InboxTab, string>> = {
  primary: "You're all caught up",
  other: "Nothing else to read",
  mentions: "No one has mentioned you yet",
  snoozed: "Nothing snoozed",
  cleared: "Nothing cleared yet",
};
