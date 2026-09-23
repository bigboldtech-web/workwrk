// What the announcements list shows, as pure functions.
//
// Spec: docs/plans/ui-refresh/spec-talk.md section 2.3 (/announcements) and
// section 2.4 (/announcements/[id]).
//
// WHAT THIS REPLACED. The page held its own type map, its own priority map,
// its own relative-time function and its own grouping, all keyed to the old
// catalog palette: five hues for five types, four more for four priorities,
// and sections coloured by priority. A reader could not tell an Urgent
// Celebration from a Normal Warning without learning nine colours, and none
// of it was testable because all of it was inside the component.
//
// The rules live here instead: one label table, one chip tone per priority,
// one grouping (Pinned, then This week, then Earlier, by the VIEWER's local
// day), one sort table, and one audience sentence. The page renders them.
//
// NO IMPORTS, on purpose: the API route, the page, the drawer and the
// completeness tests all read this, and vitest's node environment does not
// resolve "@/".

export const ANNOUNCEMENT_TYPES = ["INFO", "WARNING", "POLICY", "EVENT", "CELEBRATION"] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

export const ANNOUNCEMENT_PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export const ANNOUNCEMENT_TYPE_LABELS: Record<AnnouncementType, string> = {
  INFO: "Info",
  WARNING: "Warning",
  POLICY: "Policy",
  EVENT: "Event",
  CELEBRATION: "Celebration",
};

/** The Lucide icon NAME per type. This module stays import-free; callers resolve it. */
export const ANNOUNCEMENT_TYPE_ICONS: Record<AnnouncementType, string> = {
  INFO: "Info",
  WARNING: "TriangleAlert",
  POLICY: "ShieldCheck",
  EVENT: "CalendarRange",
  CELEBRATION: "PartyPopper",
};

export const ANNOUNCEMENT_PRIORITY_LABELS: Record<AnnouncementPriority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  NORMAL: "Normal",
  LOW: "Low",
};

/**
 * The chip tone per priority, as spec 2.3 sets it: Urgent reads danger, High
 * reads warning, Normal and Low read neutral. Four priorities, three tones,
 * on purpose: "Normal" does not need a colour to say it is normal.
 */
export type ChipTone = "danger" | "warning" | "neutral";
export const ANNOUNCEMENT_PRIORITY_TONE: Record<AnnouncementPriority, ChipTone> = {
  URGENT: "danger",
  HIGH: "warning",
  NORMAL: "neutral",
  LOW: "neutral",
};

export function isAnnouncementType(v: unknown): v is AnnouncementType {
  return typeof v === "string" && (ANNOUNCEMENT_TYPES as readonly string[]).includes(v);
}
export function isAnnouncementPriority(v: unknown): v is AnnouncementPriority {
  return typeof v === "string" && (ANNOUNCEMENT_PRIORITIES as readonly string[]).includes(v);
}

/** The four views of the list, carried in `?view=`. `all` is the default and is not written. */
export const ANNOUNCEMENT_VIEWS = ["all", "ack", "pinned", "mine"] as const;
export type AnnouncementView = (typeof ANNOUNCEMENT_VIEWS)[number];

export function parseAnnouncementView(raw: string | null | undefined): AnnouncementView {
  return (ANNOUNCEMENT_VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as AnnouncementView)
    : "all";
}

/** The four sorts of the list, carried in `?sort=`. `newest` is the default. */
export const ANNOUNCEMENT_SORTS = ["newest", "oldest", "priority", "expiring"] as const;
export type AnnouncementSort = (typeof ANNOUNCEMENT_SORTS)[number];
export const ANNOUNCEMENT_SORT_LABELS: Record<AnnouncementSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  priority: "Priority",
  expiring: "Expiring soon",
};

export function parseAnnouncementSort(raw: string | null | undefined): AnnouncementSort {
  return (ANNOUNCEMENT_SORTS as readonly string[]).includes(raw ?? "")
    ? (raw as AnnouncementSort)
    : "newest";
}

/** Rank for the Priority sort. Urgent first. */
export const PRIORITY_RANK: Record<AnnouncementPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

/**
 * The group headers of the feed, in render order. "Pinned" first, then the
 * two date buckets. A post is in exactly one group.
 */
export type AnnouncementGroup = "pinned" | "week" | "earlier";

export const ANNOUNCEMENT_GROUP_LABELS: Record<AnnouncementGroup, string> = {
  pinned: "Pinned",
  week: "This week",
  earlier: "Earlier",
};

/**
 * Which group a card belongs to.
 *
 * The date buckets compare DAY KEYS, not instants, because "this week" is a
 * question about the reader's calendar: a post made at 23:00 last night is
 * yesterday to the reader, whatever UTC thinks. The caller hands the two keys
 * in through `dayKey()` from src/lib/format/date.ts, which already reads the
 * viewer's zone, so no zone logic is duplicated here.
 */
export function announcementGroup(
  row: { pinned: boolean },
  postedDayKey: string,
  todayDayKey: string,
): AnnouncementGroup {
  if (row.pinned) return "pinned";
  return daysBetweenKeys(postedDayKey, todayDayKey) <= 6 ? "week" : "earlier";
}

/** Whole days from `from` to `to`, both yyyy-mm-dd. Negative when `from` is later. */
export function daysBetweenKeys(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export interface AnnouncementSortable {
  priority: AnnouncementPriority;
  postedAt: string;
  expiresAt: string | null;
}

/**
 * The list order for one sort. Stable and total: every comparison falls
 * through to the posted instant so two Urgent posts never swap places between
 * two renders of the same data.
 */
export function compareAnnouncements(
  sort: AnnouncementSort,
  a: AnnouncementSortable,
  b: AnnouncementSortable,
): number {
  const aPosted = Date.parse(a.postedAt) || 0;
  const bPosted = Date.parse(b.postedAt) || 0;
  switch (sort) {
    case "oldest":
      return aPosted - bPosted || 0;
    case "priority": {
      const d = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      return d !== 0 ? d : bPosted - aPosted;
    }
    case "expiring": {
      // A post with no expiry never expires, so it sorts last rather than
      // first, which is what a naive null-as-zero comparison would do.
      const ax = a.expiresAt ? Date.parse(a.expiresAt) : Number.POSITIVE_INFINITY;
      const bx = b.expiresAt ? Date.parse(b.expiresAt) : Number.POSITIVE_INFINITY;
      if (ax === bx) return bPosted - aPosted;
      return ax - bx;
    }
    case "newest":
    default:
      return bPosted - aPosted;
  }
}

/** The one place the card, the drawer and the meta row read "when was this posted". */
export function postedInstant(row: { publishedAt?: string | null; createdAt: string }): string {
  return row.publishedAt ?? row.createdAt;
}

/** Is this post still waiting to appear in the feed? */
export function isScheduled(row: { publishedAt?: string | null }, nowMs: number): boolean {
  if (!row.publishedAt) return false;
  const t = Date.parse(row.publishedAt);
  return !Number.isNaN(t) && t > nowMs;
}

/** Has the post dropped off the feed? A null expiry never expires. */
export function isExpired(row: { expiresAt?: string | null }, nowMs: number): boolean {
  if (!row.expiresAt) return false;
  const t = Date.parse(row.expiresAt);
  return !Number.isNaN(t) && t <= nowMs;
}

/**
 * The audience sentence on the card and in the detail meta row.
 *
 * `names` are already resolved by the caller (the API returns them with the
 * row), so this never queries and never guesses: an audience whose names did
 * not resolve reads as its kind rather than as an empty string.
 */
export function audienceLabel(
  audience: { type: string; ids: string[] } | null | undefined,
  names: string[],
  orgName: string,
): string {
  const type = audience?.type ?? "ALL";
  if (type === "ALL") return `Everyone at ${orgName}`;
  const listed = names.filter(Boolean);
  if (listed.length === 0) {
    switch (type) {
      case "DEPARTMENTS": return "Selected departments";
      case "OFFICES": return "Selected offices";
      case "USERS": return "Selected people";
      case "TAGS": return "Selected tags";
      case "SPACE": return "People in a Space";
      default: return `Everyone at ${orgName}`;
    }
  }
  if (type === "SPACE") return `People in ${listed[0]}`;
  if (listed.length <= 3) return listed.join(", ");
  return `${listed.slice(0, 3).join(", ")} and ${listed.length - 3} more`;
}

/**
 * "Reminded 3h ago" on the Remind pending button, and whether it is still
 * inside its 24 hour cool-off. A duration, not a clock time, so it needs no
 * locale (spec section 1 Dates and times).
 */
export const REMIND_COOLOFF_MS = 24 * 60 * 60 * 1000;

export function remindCooloff(
  lastRemindedAt: string | null | undefined,
  nowMs: number,
): { blocked: boolean; label: string } {
  if (!lastRemindedAt) return { blocked: false, label: "Remind pending" };
  const t = Date.parse(lastRemindedAt);
  if (Number.isNaN(t)) return { blocked: false, label: "Remind pending" };
  const ago = nowMs - t;
  if (ago >= REMIND_COOLOFF_MS) return { blocked: false, label: "Remind pending" };
  const hours = Math.floor(ago / 3_600_000);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(ago / 60_000));
    return { blocked: true, label: `Reminded ${mins}m ago` };
  }
  return { blocked: true, label: `Reminded ${hours}h ago` };
}

/* ── Feed visibility ──────────────────────────────────────────────── */

/** The lifecycle fields the feed rule reads. Dates may arrive as Date (a
 *  Prisma row) or as an ISO string (a serialized one), so both are accepted. */
export interface AnnouncementFeedFacts {
  authorId: string;
  publishedAt: Date | string | null;
  createdAt: Date | string;
  expiresAt: Date | string | null;
}

export interface AnnouncementFeedViewer {
  viewerId: string;
  /** Owner or Admin: reads everything, per canReadAnyAnnouncement. */
  oversight: boolean;
  /** Already resolved by the caller, because the audience needs the database. */
  inAudience: boolean;
  /** Milliseconds, injected so a test is not at the mercy of the clock. */
  now: number;
}

function ms(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * May this viewer see this announcement IN A LIST.
 *
 * WHY THIS IS ONE FUNCTION AND NOT TWO COPIES. /api/announcements gated on
 * audience and lifecycle in its own route body, and /api/search did not gate
 * announcements AT ALL: its query asked for `organizationId` and nothing
 * else, so search returned the TITLE of every announcement in the workspace
 * to any signed-in member, including posts scheduled for a future date and
 * posts addressed to a department, office, tag, Space or named user list the
 * reader is not in. A title is frequently the whole of the sensitive part.
 *
 * Both callers now read this, so the two surfaces cannot drift apart again,
 * and the rule is testable without a database.
 *
 * THE RULE, in order:
 *   1. The audience decides who may read. The author and oversight readers
 *      (Owner, Admin) read everything.
 *   2. A scheduled post belongs to nobody but its author until it publishes.
 *      `publishedAt` is the publish instant; a row without one published when
 *      it was created.
 *   3. An expired post leaves the list. A DIRECT LINK still resolves, which
 *      is the spec's rule, so this is the list rule only: never call it to
 *      gate GET /api/announcements/[id].
 */
export function announcementInFeed(a: AnnouncementFeedFacts, v: AnnouncementFeedViewer): boolean {
  const mine = a.authorId === v.viewerId;
  if (!(v.oversight || mine || v.inAudience)) return false;
  const published = ms(a.publishedAt) ?? ms(a.createdAt) ?? 0;
  if (published > v.now && !mine) return false;
  const expires = ms(a.expiresAt);
  if (expires !== null && expires <= v.now) return false;
  return true;
}
