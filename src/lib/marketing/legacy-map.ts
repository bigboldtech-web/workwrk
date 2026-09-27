// The legacy Marketing module (Campaign, ContentItem, EventBrief rows) mapped
// onto the three Lists of the seeded "Marketing" Space template. Pure: no
// database, no session. The importer (legacy-import.ts), the CSV writer
// (legacy-export.ts), the /marketing resolver and scripts/migrate-marketing.ts
// all read this file, so a status or field key exists in exactly one place.
//
// Spec: docs/plans/ui-refresh/spec-tools-misc.md section 2.7 to 2.11.
//
// WHERE THE MARKERS LIVE. The spec names `Space.metadata.legacySource` and
// `Board.metadata.legacyKind`; neither model has a `metadata` column (each has
// `settings Json`), so the markers are `Space.settings.legacySource` and
// `Board.settings.legacyKind`, which needs no migration and is the same key
// the Ideas migration used for its List (`Board.settings.legacyIdeasList`).

import type { CsvCell } from "@/lib/csv";

export type MarketingKind = "campaigns" | "content" | "events";
export const MARKETING_KINDS: readonly MarketingKind[] = ["campaigns", "content", "events"];

/** `Space.settings[SPACE_MARKER_KEY] === LEGACY_SOURCE` marks the migrated Space. */
export const SPACE_MARKER_KEY = "legacySource";
export const LEGACY_SOURCE = "marketing";
/** `Board.settings[LIST_MARKER_KEY]` is one of MARKETING_KINDS on the three Lists. */
export const LIST_MARKER_KEY = "legacyKind";
/** The seeded Space template the importer builds from. */
export const MARKETING_TEMPLATE_KEY = "space.marketing";
/** Written back on `Campaign.customFields`, `ContentItem.customFields` and `EventBrief.customFields`. */
export const MIGRATED_ITEM_KEY = "migratedItemId";
/** The per-task provenance blob, under `Item.metadata.legacyMarketing`. */
export const ITEM_PROVENANCE_KEY = "legacyMarketing";

export const LIST_NAME: Record<MarketingKind, string> = {
  campaigns: "Campaigns",
  content: "Content",
  events: "Events",
};

// ── Statuses ────────────────────────────────────────────────────────
//
// Each List's set is the legacy enum minus the values no screen could ever
// set. `exact` is false when the legacy value had to move to a neighbour, so
// the report can say how many rows changed status on the way over.

export interface StatusMapping {
  value: string;
  exact: boolean;
}

const CAMPAIGN_STATUS: Record<string, StatusMapping> = {
  PLANNING: { value: "PLANNING", exact: true },
  APPROVED: { value: "PLANNING", exact: false },
  ACTIVE: { value: "ACTIVE", exact: true },
  PAUSED: { value: "PAUSED", exact: true },
  COMPLETED: { value: "COMPLETED", exact: true },
  CANCELLED: { value: "CANCELLED", exact: true },
};

const CONTENT_STATUS: Record<string, StatusMapping> = {
  IDEA: { value: "IDEA", exact: true },
  BRIEFED: { value: "IDEA", exact: false },
  IN_DRAFT: { value: "IN_DRAFT", exact: true },
  IN_REVIEW: { value: "IN_REVIEW", exact: true },
  APPROVED: { value: "APPROVED", exact: true },
  SCHEDULED: { value: "SCHEDULED", exact: true },
  PUBLISHED: { value: "PUBLISHED", exact: true },
  ARCHIVED: { value: "ARCHIVED", exact: true },
};

const EVENT_STATUS: Record<string, StatusMapping> = {
  PLANNING: { value: "PLANNING", exact: true },
  PROMOTING: { value: "PROMOTING", exact: true },
  REGISTERING: { value: "PROMOTING", exact: false },
  LIVE: { value: "LIVE", exact: true },
  COMPLETED: { value: "COMPLETED", exact: true },
  CANCELLED: { value: "CANCELLED", exact: true },
};

const STATUS_TABLE: Record<MarketingKind, Record<string, StatusMapping>> = {
  campaigns: CAMPAIGN_STATUS,
  content: CONTENT_STATUS,
  events: EVENT_STATUS,
};

/** The first status of each List, where an unknown legacy value lands. */
const FIRST_STATUS: Record<MarketingKind, string> = {
  campaigns: "PLANNING",
  content: "IDEA",
  events: "PLANNING",
};

/**
 * A legacy status onto the List's own set. Unknown values (a row written by
 * a version of the module this file never saw) land on the List's first
 * status and are reported as `unmapped`.
 */
export function mapMarketingStatus(kind: MarketingKind, legacy: string | null | undefined): StatusMapping & { unmapped: boolean } {
  const key = String(legacy ?? "").trim().toUpperCase();
  const hit = STATUS_TABLE[kind][key];
  if (hit) return { ...hit, unmapped: false };
  return { value: FIRST_STATUS[kind], exact: false, unmapped: true };
}

// ── Dropdown choices ────────────────────────────────────────────────

/** The same slug the seed's `choices()` helper writes, so a legacy label lands on a real choice. */
export function choiceValue(label: string): string {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ── Rows to tasks ───────────────────────────────────────────────────

/** The parts of a legacy row the mapping reads. Decimal columns arrive as strings or numbers. */
export interface LegacyCampaignRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  channel: string | null;
  budget: unknown;
  spent: unknown;
  currency: string;
  startDate: Date | null;
  endDate: Date | null;
  ownerId: string | null;
  goalMetric: string | null;
  goalTarget: number | null;
  goalActual: number | null;
  utmCampaign: string | null;
  workspaceId: string | null;
  createdAt: Date;
}

export interface LegacyContentRow {
  id: string;
  title: string;
  type: string;
  status: string;
  channel: string | null;
  ownerId: string | null;
  authorId: string | null;
  briefUrl: string | null;
  draftUrl: string | null;
  publishedUrl: string | null;
  scheduledFor: Date | null;
  publishedAt: Date | null;
  campaignId: string | null;
  notes: string | null;
  workspaceId: string | null;
  createdAt: Date;
}

export interface LegacyEventRow {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  format: string | null;
  startDate: Date | null;
  endDate: Date | null;
  location: string | null;
  capacity: number | null;
  registeredCount: number | null;
  attendedCount: number | null;
  budget: unknown;
  spent: unknown;
  status: string;
  ownerId: string | null;
  campaignId: string | null;
  url: string | null;
  notes: string | null;
  workspaceId: string | null;
  createdAt: Date;
}

export interface MappedTask {
  title: string;
  status: string;
  statusExact: boolean;
  statusUnmapped: boolean;
  startAt: Date | null;
  dueAt: Date | null;
  /** The legacy owner, kept only when the caller confirms they are a live member. */
  ownerId: string | null;
  metadata: Record<string, unknown>;
  /** Legacy columns with a value that has no List field and were folded into the description. */
  folded: string[];
  /** The row carries a currency other than the List's. */
  currencyMismatch: boolean;
}

/** A Prisma Decimal, a number or a numeric string, as a number; null otherwise. */
export function moneyToNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(typeof v === "object" && v !== null && "toString" in v ? String(v) : v);
  return Number.isFinite(n) ? n : null;
}

function provenance(kind: MarketingKind, row: { id: string; workspaceId: string | null; createdAt: Date }, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { kind, id: row.id, createdAt: row.createdAt.toISOString(), ...extra };
  if (row.workspaceId) out.workspaceId = row.workspaceId;
  return out;
}

function describe(parts: Array<[label: string, value: string | null | undefined]>, body: string | null | undefined): { description: string; folded: string[] } {
  const folded: string[] = [];
  const lines: string[] = [];
  for (const [label, value] of parts) {
    const text = (value ?? "").trim();
    if (!text) continue;
    folded.push(label);
    lines.push(`${label}: ${text}`);
  }
  const main = (body ?? "").trim();
  const description = [main, lines.join("\n")].filter(Boolean).join("\n\n");
  return { description, folded };
}

/** An amount with its currency code, for a description line: "5,000.00 EUR". */
export function moneyText(amount: number, currency: string): string {
  try {
    return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ${currency}`;
  } catch {
    return `${amount} ${currency}`;
  }
}

export function campaignToTask(row: LegacyCampaignRow, opts: { listCurrency: string }): MappedTask {
  const status = mapMarketingStatus("campaigns", row.status);
  const currency = (row.currency || opts.listCurrency).toUpperCase();
  const currencyMismatch = currency !== opts.listCurrency.toUpperCase();
  const budget = moneyToNumber(row.budget);
  const spent = moneyToNumber(row.spent);
  // The List's Budget and Spent columns are MONEY fields bound to the org
  // currency, so a campaign kept in another currency would render its figure
  // under the wrong symbol and be summed with the rest. Its money goes into
  // the description with its own code instead, and the columns stay empty.
  const { description, folded } = describe(
    [
      ["Currency", currencyMismatch ? currency : null],
      ["Budget", currencyMismatch && budget !== null ? moneyText(budget, currency) : null],
      ["Spent", currencyMismatch && spent !== null ? moneyText(spent, currency) : null],
    ],
    row.description,
  );
  const metadata: Record<string, unknown> = {};
  if (description) metadata.description = description;
  if (row.channel) metadata.channel = choiceValue(row.channel);
  if (!currencyMismatch && budget !== null) metadata.budget = budget;
  if (!currencyMismatch && spent !== null) metadata.spent = spent;
  if (row.goalMetric) metadata.goal_metric = choiceValue(row.goalMetric);
  if (row.goalTarget !== null && row.goalTarget !== undefined) metadata.goal_target = row.goalTarget;
  if (row.goalActual !== null && row.goalActual !== undefined) metadata.goal_actual = row.goalActual;
  if (row.utmCampaign) metadata.utm_campaign = row.utmCampaign;
  metadata[ITEM_PROVENANCE_KEY] = provenance("campaigns", row, {
    currency,
    status: row.status,
    ...(currencyMismatch && budget !== null ? { budget } : {}),
    ...(currencyMismatch && spent !== null ? { spent } : {}),
    ...(row.channel ? { channel: row.channel } : {}),
    ...(row.goalMetric ? { goalMetric: row.goalMetric } : {}),
  });
  return {
    title: row.name.trim() || "Untitled campaign",
    status: status.value,
    statusExact: status.exact,
    statusUnmapped: status.unmapped,
    startAt: row.startDate,
    dueAt: row.endDate,
    ownerId: row.ownerId,
    metadata,
    folded,
    currencyMismatch,
  };
}

/** The legacy ContentType enum values as the seeded Type choice labels. */
const CONTENT_TYPE_LABEL: Record<string, string> = {
  BLOG_POST: "Blog post",
  EMAIL: "Email",
  SOCIAL_POST: "Social post",
  VIDEO: "Video",
  PODCAST: "Podcast",
  WHITEPAPER: "Whitepaper",
  EBOOK: "Ebook",
  CASE_STUDY: "Case study",
  WEBINAR: "Webinar",
  ONE_PAGER: "One pager",
  PRESS_RELEASE: "Press release",
  OTHER: "Other",
};

export function contentToTask(row: LegacyContentRow, opts: { campaignTitleById?: ReadonlyMap<string, string> } = {}): MappedTask {
  const status = mapMarketingStatus("content", row.status);
  const campaignTitle = row.campaignId ? opts.campaignTitleById?.get(row.campaignId) ?? null : null;
  const { description, folded } = describe(
    [
      ["Campaign", campaignTitle ?? (row.campaignId ? row.campaignId : null)],
      ["Published", row.publishedAt ? row.publishedAt.toISOString().slice(0, 10) : null],
    ],
    row.notes,
  );
  const metadata: Record<string, unknown> = {};
  if (description) metadata.description = description;
  const typeLabel = CONTENT_TYPE_LABEL[row.type] ?? row.type;
  if (typeLabel) metadata.type = choiceValue(typeLabel);
  if (row.channel) metadata.channel = choiceValue(row.channel);
  if (row.publishedUrl) metadata.link = row.publishedUrl;
  if (row.briefUrl) metadata.brief_link = row.briefUrl;
  if (row.draftUrl) metadata.draft_link = row.draftUrl;
  metadata[ITEM_PROVENANCE_KEY] = provenance("content", row, {
    status: row.status,
    type: row.type,
    ...(row.channel ? { channel: row.channel } : {}),
    ...(row.campaignId ? { campaignId: row.campaignId } : {}),
    ...(row.authorId ? { authorId: row.authorId } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
  });
  return {
    title: row.title.trim() || "Untitled content",
    status: status.value,
    statusExact: status.exact,
    statusUnmapped: status.unmapped,
    startAt: null,
    dueAt: row.scheduledFor,
    ownerId: row.ownerId ?? row.authorId,
    metadata,
    folded,
    currencyMismatch: false,
  };
}

export function eventToTask(row: LegacyEventRow, opts: { listCurrency: string; campaignTitleById?: ReadonlyMap<string, string> }): MappedTask {
  const status = mapMarketingStatus("events", row.status);
  const budget = moneyToNumber(row.budget);
  const spent = moneyToNumber(row.spent);
  const campaignTitle = row.campaignId ? opts.campaignTitleById?.get(row.campaignId) ?? null : null;
  const { description, folded } = describe(
    [["Campaign", campaignTitle ?? (row.campaignId ? row.campaignId : null)]],
    [row.description, row.notes].filter((s) => s && s.trim()).join("\n\n"),
  );
  const metadata: Record<string, unknown> = {};
  if (description) metadata.description = description;
  if (row.format) metadata.format = choiceValue(row.format);
  if (row.type) metadata.event_type = choiceValue(row.type);
  if (row.location) metadata.location = row.location;
  if (row.capacity !== null && row.capacity !== undefined) metadata.capacity = row.capacity;
  if (row.registeredCount !== null && row.registeredCount !== undefined) metadata.registered = row.registeredCount;
  if (row.attendedCount !== null && row.attendedCount !== undefined) metadata.attended = row.attendedCount;
  if (budget !== null) metadata.budget = budget;
  if (spent !== null) metadata.spend = spent;
  if (row.url) metadata.page_link = row.url;
  metadata[ITEM_PROVENANCE_KEY] = provenance("events", row, {
    status: row.status,
    // EventBrief has no currency column: its money was always in the org's currency.
    currency: opts.listCurrency.toUpperCase(),
    ...(row.type ? { type: row.type } : {}),
    ...(row.format ? { format: row.format } : {}),
    ...(row.campaignId ? { campaignId: row.campaignId } : {}),
  });
  return {
    title: row.name.trim() || "Untitled event",
    status: status.value,
    statusExact: status.exact,
    statusUnmapped: status.unmapped,
    startAt: row.startDate,
    dueAt: row.endDate ?? row.startDate,
    ownerId: row.ownerId,
    metadata,
    folded,
    currencyMismatch: false,
  };
}

// ── The template ────────────────────────────────────────────────────

/** What the importer needs of the seeded Space template: the three Lists by name, each with its own statuses and fields. */
export interface MarketingTemplateShape {
  lists?: Array<{ name: string; statuses?: unknown[]; fields?: unknown[] }>;
}

/** The blocked sentence the person on the page reads when the template is not ready. */
export const TEMPLATE_NOT_READY = "The Marketing Space template is not ready on this workspace yet. Ask whoever runs your WorkwrK server to update the built-in templates, then try again.";

/**
 * Why a seeded template cannot be built from, or null when it can. An older
 * seed (two Lists, no fields) would have Content and Events built from the
 * Campaigns payload, with statuses no List has and values on no column, and
 * a run marks every row, so the check is strict and the reason is exact.
 */
export function marketingTemplateProblem(payload: MarketingTemplateShape | null | undefined): string | null {
  if (!payload || !Array.isArray(payload.lists)) return `the built-in template "${MARKETING_TEMPLATE_KEY}" is not seeded; run prisma/seed-templates.ts --write first`;
  for (const kind of MARKETING_KINDS) {
    const list = payload.lists.find((l) => l && l.name === LIST_NAME[kind]);
    if (!list) return `the built-in template "${MARKETING_TEMPLATE_KEY}" has no "${LIST_NAME[kind]}" List (an older seed); run prisma/seed-templates.ts --write to update it`;
    if (!Array.isArray(list.statuses) || list.statuses.length === 0) return `the built-in template "${MARKETING_TEMPLATE_KEY}" List "${LIST_NAME[kind]}" has no statuses of its own (an older seed); run prisma/seed-templates.ts --write to update it`;
    if (!Array.isArray(list.fields) || list.fields.length === 0) return `the built-in template "${MARKETING_TEMPLATE_KEY}" List "${LIST_NAME[kind]}" has no fields (an older seed); run prisma/seed-templates.ts --write to update it`;
  }
  return null;
}

// ── The /marketing resolver ─────────────────────────────────────────

export interface MigratedMarketing {
  spaceSlug: string;
  lists: Partial<Record<MarketingKind, string>>;
}

/**
 * Where a legacy /marketing path goes once the import has run (spec 2.7 step
 * 3). `campaignTrashed` is the campaign whose task sits in Trash: it lands on
 * the Campaigns List with a notice saying so, never inside the trashed task.
 */
export function legacyMarketingTarget(
  segments: readonly string[],
  migrated: MigratedMarketing,
  campaignItemId: string | null,
  campaignTrashed = false,
): string {
  const spaceHref = `/spaces/${migrated.spaceSlug}`;
  const listHref = (kind: MarketingKind) => (migrated.lists[kind] ? `/boards/${migrated.lists[kind]}` : spaceHref);
  const [head] = segments;
  if (!head) return spaceHref;
  if (head === "campaigns") return listHref("campaigns");
  if (head === "content") return listHref("content");
  if (head === "events") return listHref("events");
  // /marketing/{id}: the migrated task, else the Campaigns List (spec 2.11).
  if (campaignItemId) return `/item/${campaignItemId}`;
  const notice = campaignTrashed ? "campaign-in-trash" : "campaign-not-moved";
  return migrated.lists.campaigns ? `${listHref("campaigns")}?notice=${notice}` : spaceHref;
}

/** The Owner and Admin landing before the import has run (spec 2.7 step 4). */
export const LEGACY_IMPORT_HREF = "/settings/data?tab=import&legacy=marketing";

// ── CSV ─────────────────────────────────────────────────────────────

const CAMPAIGN_COLUMNS = ["Name", "Status", "Channel", "Budget", "Spent", "Currency", "Start date", "End date", "Goal metric", "Goal target", "Goal actual", "UTM campaign", "Description", "Created", "Legacy id"];
const CONTENT_COLUMNS = ["Title", "Type", "Status", "Channel", "Scheduled for", "Published at", "Published URL", "Draft URL", "Brief URL", "Campaign", "Notes", "Created", "Legacy id"];
const EVENT_COLUMNS = ["Name", "Status", "Type", "Format", "Start date", "End date", "Location", "Capacity", "Registered", "Attended", "Budget", "Spent", "Currency", "URL", "Campaign", "Description", "Notes", "Created", "Legacy id"];

export const MARKETING_CSV_COLUMNS: Record<MarketingKind, readonly string[]> = {
  campaigns: CAMPAIGN_COLUMNS,
  content: CONTENT_COLUMNS,
  events: EVENT_COLUMNS,
};

const day = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function campaignsToCsvRows(rows: readonly LegacyCampaignRow[], orgCurrency: string): Record<string, CsvCell>[] {
  return rows.map((r) => ({
    Name: r.name,
    Status: r.status,
    Channel: r.channel,
    Budget: moneyToNumber(r.budget),
    Spent: moneyToNumber(r.spent),
    // Each row's own currency wins where it is set (spec 2.7 Data).
    Currency: (r.currency || orgCurrency).toUpperCase(),
    "Start date": day(r.startDate),
    "End date": day(r.endDate),
    "Goal metric": r.goalMetric,
    "Goal target": r.goalTarget,
    "Goal actual": r.goalActual,
    "UTM campaign": r.utmCampaign,
    Description: r.description,
    Created: day(r.createdAt),
    "Legacy id": r.id,
  }));
}

export function contentToCsvRows(rows: readonly LegacyContentRow[], campaignTitleById: ReadonlyMap<string, string> = new Map()): Record<string, CsvCell>[] {
  return rows.map((r) => ({
    Title: r.title,
    Type: CONTENT_TYPE_LABEL[r.type] ?? r.type,
    Status: r.status,
    Channel: r.channel,
    "Scheduled for": day(r.scheduledFor),
    "Published at": day(r.publishedAt),
    "Published URL": r.publishedUrl,
    "Draft URL": r.draftUrl,
    "Brief URL": r.briefUrl,
    Campaign: r.campaignId ? campaignTitleById.get(r.campaignId) ?? r.campaignId : null,
    Notes: r.notes,
    Created: day(r.createdAt),
    "Legacy id": r.id,
  }));
}

export function eventsToCsvRows(rows: readonly LegacyEventRow[], orgCurrency: string, campaignTitleById: ReadonlyMap<string, string> = new Map()): Record<string, CsvCell>[] {
  return rows.map((r) => ({
    Name: r.name,
    Status: r.status,
    Type: r.type,
    Format: r.format,
    "Start date": day(r.startDate),
    "End date": day(r.endDate),
    Location: r.location,
    Capacity: r.capacity,
    Registered: r.registeredCount,
    Attended: r.attendedCount,
    Budget: moneyToNumber(r.budget),
    Spent: moneyToNumber(r.spent),
    Currency: orgCurrency.toUpperCase(),
    URL: r.url,
    Campaign: r.campaignId ? campaignTitleById.get(r.campaignId) ?? r.campaignId : null,
    Description: r.description,
    Notes: r.notes,
    Created: day(r.createdAt),
    "Legacy id": r.id,
  }));
}
