import { describe, expect, it } from "vitest";
import {
  anchorLegacyDay,
  campaignToTask,
  campaignsToCsvRows,
  choiceValue,
  contentToTask,
  eventToTask,
  eventsToCsvRows,
  isUtcMidnight,
  legacyDateCorrection,
  legacyDates,
  legacyMarketingTarget,
  legacyRowState,
  legacyTaskIndex,
  tasksInTrashSnapshot,
  mapMarketingStatus,
  marketingTemplateProblem,
  moneyToNumber,
  ITEM_PROVENANCE_KEY,
  type LegacyCampaignRow,
  type LegacyContentRow,
  type LegacyEventRow,
} from "./legacy-map";
import { MARKETING_FIELDS } from "../../../prisma/seed-templates";

const created = new Date("2026-01-05T10:00:00.000Z");

const campaign: LegacyCampaignRow = {
  id: "cmp_1",
  name: "  Q4 demand gen ",
  description: "Drive demo requests.",
  status: "ACTIVE",
  channel: "Paid Search",
  budget: "50000.00",
  spent: 1234.5,
  currency: "USD",
  startDate: new Date("2026-02-01T00:00:00.000Z"),
  endDate: new Date("2026-04-30T00:00:00.000Z"),
  ownerId: "user_a",
  goalMetric: "Leads",
  goalTarget: 200,
  goalActual: 12,
  utmCampaign: "q4-demand",
  workspaceId: null,
  createdAt: created,
};

const content: LegacyContentRow = {
  id: "cnt_1",
  title: "How three teams scaled",
  type: "CASE_STUDY",
  status: "BRIEFED",
  channel: "Blog",
  ownerId: null,
  authorId: "user_b",
  briefUrl: "https://example.com/brief",
  draftUrl: null,
  publishedUrl: "https://example.com/post",
  scheduledFor: new Date("2026-03-01T00:00:00.000Z"),
  publishedAt: null,
  campaignId: "cmp_1",
  notes: "Interview the three leads first.",
  workspaceId: "ws_1",
  createdAt: created,
};

const event: LegacyEventRow = {
  id: "evt_1",
  name: "SaaS summit",
  description: "Booth and one talk.",
  type: "Conference",
  format: "In-person",
  startDate: new Date("2026-06-10T00:00:00.000Z"),
  endDate: null,
  location: "San Francisco",
  capacity: 5000,
  registeredCount: 120,
  attendedCount: 0,
  budget: "75000",
  spent: null,
  status: "REGISTERING",
  ownerId: "user_a",
  campaignId: null,
  url: "https://example.com/summit",
  notes: null,
  workspaceId: null,
  createdAt: created,
};

describe("mapMarketingStatus", () => {
  it("keeps every value the Lists carry and moves the two nobody could set", () => {
    expect(mapMarketingStatus("campaigns", "ACTIVE")).toEqual({ value: "ACTIVE", exact: true, unmapped: false });
    expect(mapMarketingStatus("campaigns", "APPROVED")).toEqual({ value: "PLANNING", exact: false, unmapped: false });
    expect(mapMarketingStatus("content", "BRIEFED")).toEqual({ value: "IDEA", exact: false, unmapped: false });
    expect(mapMarketingStatus("events", "REGISTERING")).toEqual({ value: "PROMOTING", exact: false, unmapped: false });
  });

  it("lands an unknown value on the first status and says so", () => {
    expect(mapMarketingStatus("events", "SOMETHING_NEW")).toEqual({ value: "PLANNING", exact: false, unmapped: true });
    expect(mapMarketingStatus("content", null)).toEqual({ value: "IDEA", exact: false, unmapped: true });
  });
});

describe("choiceValue", () => {
  it("writes the same slug the seed's choices() helper writes", () => {
    expect(choiceValue("Paid Search")).toBe("PAID_SEARCH");
    expect(choiceValue("In-person")).toBe("IN_PERSON");
    expect(choiceValue(" Blog ")).toBe("BLOG");
  });

  it("lands every legacy channel, goal, type and format on a seeded choice", () => {
    const has = (fields: readonly { key: string; options?: { choices?: Array<{ value: string }> } }[], key: string, v: string) =>
      Boolean(fields.find((f) => f.key === key)?.options?.choices?.some((c) => c.value === v));
    for (const ch of ["Email", "Paid Search", "Social", "Outbound", "Event", "Content", "Webinar"]) {
      expect(has(MARKETING_FIELDS.campaigns, "channel", choiceValue(ch)), ch).toBe(true);
    }
    for (const g of ["Leads", "MQLs", "Pipeline", "Brand"]) expect(has(MARKETING_FIELDS.campaigns, "goal_metric", choiceValue(g)), g).toBe(true);
    for (const f of ["In-person", "Virtual", "Hybrid"]) expect(has(MARKETING_FIELDS.events, "format", choiceValue(f)), f).toBe(true);
    for (const t of ["Conference", "Trade Show", "Webinar", "Customer Event", "Field Event"]) expect(has(MARKETING_FIELDS.events, "event_type", choiceValue(t)), t).toBe(true);
    expect(has(MARKETING_FIELDS.content, "type", "CASE_STUDY")).toBe(true);
    expect(has(MARKETING_FIELDS.content, "channel", "LINKEDIN")).toBe(true);
  });
});

describe("moneyToNumber", () => {
  it("reads a Decimal-like, a number or a numeric string", () => {
    expect(moneyToNumber("50000.00")).toBe(50000);
    expect(moneyToNumber(12.5)).toBe(12.5);
    expect(moneyToNumber({ toString: () => "7.25" })).toBe(7.25);
    expect(moneyToNumber(null)).toBeNull();
    expect(moneyToNumber("abc")).toBeNull();
  });
});

describe("campaignToTask", () => {
  it("writes the seeded field keys, the built-in dates and the provenance", () => {
    const t = campaignToTask(campaign, { listCurrency: "USD" });
    expect(t.title).toBe("Q4 demand gen");
    expect(t.status).toBe("ACTIVE");
    expect(t.startAt).toEqual(campaign.startDate);
    expect(t.dueAt).toEqual(campaign.endDate);
    expect(t.ownerId).toBe("user_a");
    expect(t.metadata).toMatchObject({
      description: "Drive demo requests.",
      channel: "PAID_SEARCH",
      budget: 50000,
      spent: 1234.5,
      goal_metric: "LEADS",
      goal_target: 200,
      goal_actual: 12,
      utm_campaign: "q4-demand",
    });
    expect(t.metadata[ITEM_PROVENANCE_KEY]).toMatchObject({ kind: "campaigns", id: "cmp_1", currency: "USD", status: "ACTIVE" });
    expect(t.currencyMismatch).toBe(false);
    expect(t.folded).toEqual([]);
    // Every metadata key that is not the description or the provenance is a seeded field.
    const fieldKeys = new Set(MARKETING_FIELDS.campaigns.map((f) => f.key));
    for (const k of Object.keys(t.metadata)) {
      if (k === "description" || k === ITEM_PROVENANCE_KEY) continue;
      expect(fieldKeys.has(k), k).toBe(true);
    }
  });

  it("keeps a campaign in another currency out of the org-currency money columns and writes its figures with their code", () => {
    const t = campaignToTask({ ...campaign, currency: "eur" }, { listCurrency: "USD" });
    expect(t.currencyMismatch).toBe(true);
    expect(t.metadata.description).toContain("Currency: EUR");
    expect(t.metadata.description).toContain("Budget: 50,000.00 EUR");
    expect(t.metadata.description).toContain("Spent: 1,234.50 EUR");
    expect(t.metadata.budget).toBeUndefined();
    expect(t.metadata.spent).toBeUndefined();
    expect(t.metadata[ITEM_PROVENANCE_KEY]).toMatchObject({ currency: "EUR", budget: 50000, spent: 1234.5 });
    expect(t.folded).toEqual(["Currency", "Budget", "Spent"]);
  });

  it("writes the money columns when the campaign is in the org currency", () => {
    const t = campaignToTask({ ...campaign, currency: "" }, { listCurrency: "USD" });
    expect(t.currencyMismatch).toBe(false);
    expect(t.metadata.budget).toBe(50000);
    expect(t.metadata.spent).toBe(1234.5);
  });

  it("never writes a null field value", () => {
    const t = campaignToTask({ ...campaign, description: null, channel: null, budget: null, spent: null, goalMetric: null, goalTarget: null, goalActual: null, utmCampaign: null, name: "" }, { listCurrency: "USD" });
    expect(t.title).toBe("Untitled campaign");
    expect(Object.keys(t.metadata)).toEqual([ITEM_PROVENANCE_KEY]);
  });
});

// The legacy API stored a picked day as UTC midnight and the legacy pages
// showed it as a calendar day; a task shows an instant in the viewer's zone,
// so a verbatim copy reads a day early west of UTC. The anchoring below is
// what keeps "Dec 31" as Dec 31 for a marketer in New York.
describe("legacy dates", () => {
  const feb1 = new Date("2026-02-01T00:00:00.000Z");
  const jun10 = new Date("2026-06-10T00:00:00.000Z");
  const withTime = new Date("2026-02-01T10:30:00.000Z");

  it("tells a picked day from a real instant", () => {
    expect(isUtcMidnight(feb1)).toBe(true);
    expect(isUtcMidnight(withTime)).toBe(false);
  });

  it("anchors a picked day to midnight of the same calendar day in the import zone, across DST", () => {
    expect(anchorLegacyDay(feb1, "America/New_York")?.toISOString()).toBe("2026-02-01T05:00:00.000Z");
    expect(anchorLegacyDay(jun10, "America/New_York")?.toISOString()).toBe("2026-06-10T04:00:00.000Z");
    expect(anchorLegacyDay(feb1, "Asia/Kolkata")?.toISOString()).toBe("2026-01-31T18:30:00.000Z");
    expect(anchorLegacyDay(feb1, "UTC")?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("keeps a real instant, a missing value and a verbatim copy when no zone is given", () => {
    expect(anchorLegacyDay(withTime, "America/New_York")).toBe(withTime);
    expect(anchorLegacyDay(null, "America/New_York")).toBeNull();
    expect(anchorLegacyDay(feb1, null)).toBe(feb1);
    expect(anchorLegacyDay(feb1, undefined)).toBe(feb1);
  });

  it("reads each kind's date columns in one place, an event without an end due the day it starts", () => {
    expect(legacyDates("campaigns", campaign, "America/New_York")).toEqual({ startAt: new Date("2026-02-01T05:00:00.000Z"), dueAt: new Date("2026-04-30T04:00:00.000Z") });
    expect(legacyDates("content", content, "America/New_York")).toEqual({ startAt: null, dueAt: new Date("2026-03-01T05:00:00.000Z") });
    expect(legacyDates("events", event, "America/New_York")).toEqual({ startAt: new Date("2026-06-10T04:00:00.000Z"), dueAt: new Date("2026-06-10T04:00:00.000Z") });
    expect(legacyDates("events", event, null)).toEqual({ startAt: event.startDate, dueAt: event.startDate });
  });

  it("makes every mapper anchor its dates in the import zone and name the zone in the provenance", () => {
    const c = campaignToTask(campaign, { listCurrency: "USD", importZone: "America/New_York" });
    expect(c.startAt?.toISOString()).toBe("2026-02-01T05:00:00.000Z");
    expect(c.dueAt?.toISOString()).toBe("2026-04-30T04:00:00.000Z");
    expect(c.metadata[ITEM_PROVENANCE_KEY]).toMatchObject({ dateZone: "America/New_York" });
    const ct = contentToTask(content, { importZone: "Asia/Kolkata" });
    expect(ct.dueAt?.toISOString()).toBe("2026-02-28T18:30:00.000Z");
    const e = eventToTask(event, { listCurrency: "USD", importZone: "America/New_York" });
    expect(e.startAt?.toISOString()).toBe("2026-06-10T04:00:00.000Z");
    expect(e.dueAt?.toISOString()).toBe("2026-06-10T04:00:00.000Z");
    // No dates, no zone in the provenance.
    const bare = campaignToTask({ ...campaign, startDate: null, endDate: null }, { listCurrency: "USD", importZone: "America/New_York" });
    expect(bare.metadata[ITEM_PROVENANCE_KEY]).not.toHaveProperty("dateZone");
  });

  it("corrects only a date the task still holds exactly as the row stored it", () => {
    // Written verbatim by an earlier run: both dates move.
    expect(legacyDateCorrection("campaigns", campaign, "America/New_York", { startAt: campaign.startDate, dueAt: campaign.endDate })).toEqual({
      startAt: new Date("2026-02-01T05:00:00.000Z"),
      dueAt: new Date("2026-04-30T04:00:00.000Z"),
    });
    // The due date was set by hand since: only the untouched start moves.
    expect(legacyDateCorrection("campaigns", campaign, "America/New_York", { startAt: campaign.startDate, dueAt: new Date("2026-05-02T04:00:00.000Z") })).toEqual({
      startAt: new Date("2026-02-01T05:00:00.000Z"),
    });
    // Already anchored, or a zone where midnight is midnight: nothing to do.
    expect(legacyDateCorrection("campaigns", campaign, "America/New_York", { startAt: new Date("2026-02-01T05:00:00.000Z"), dueAt: new Date("2026-04-30T04:00:00.000Z") })).toBeNull();
    expect(legacyDateCorrection("campaigns", campaign, "UTC", { startAt: campaign.startDate, dueAt: campaign.endDate })).toBeNull();
    // A task whose date was cleared is left cleared.
    expect(legacyDateCorrection("content", content, "America/New_York", { startAt: null, dueAt: null })).toBeNull();
  });

  it("never corrects a task whose provenance already names the zone it was anchored in", () => {
    // Anchored in UTC, midnight reads exactly as the row stored it: without
    // the marker a later run in New York would take it for a verbatim copy
    // and move it a second time.
    expect(legacyDateCorrection("campaigns", campaign, "America/New_York", { startAt: campaign.startDate, dueAt: campaign.endDate, dateZone: "UTC" })).toBeNull();
    // No marker (a task an early run wrote verbatim): corrected as before.
    expect(legacyDateCorrection("campaigns", campaign, "America/New_York", { startAt: campaign.startDate, dueAt: campaign.endDate, dateZone: null })).not.toBeNull();
  });
});

// The moved-or-not rule. A task in Trash is still the row's task: read only
// against the live Item table, a campaign someone trashed on purpose came
// back as a second task on the next Import, and restoring the first made two.
describe("legacyRowState", () => {
  const prov = (kind: string, id: string) => ({ [ITEM_PROVENANCE_KEY]: { kind, id } });
  const mark = (itemId: string) => ({ migratedItemId: itemId });

  // One of each: a live task, an archived one (Trash > Archived), one
  // deleted to Trash on its own, one deleted with its List, one deleted as a
  // subtask of another task, and one live task on a marker List whose row
  // never got its mark (the crash window).
  const trashed = [
    ...tasksInTrashSnapshot("item", { row: { id: "it_deleted", metadata: prov("campaigns", "cmp_deleted") }, children: { subtasks: [], listLinks: [] } }),
    ...tasksInTrashSnapshot("board", { row: { id: "list_old" }, children: { items: [{ id: "it_in_list", metadata: prov("content", "cnt_in_list") }], views: [], members: [] } }),
    ...tasksInTrashSnapshot("item", { row: { id: "it_parent", metadata: {} }, children: { subtasks: [{ id: "it_sub", metadata: prov("events", "evt_unmarked") }] } }),
    // A note holds no task, whatever its snapshot looks like.
    ...tasksInTrashSnapshot("note", { row: { id: "it_ghost", metadata: prov("campaigns", "cmp_new") } }),
  ];
  const index = legacyTaskIndex({
    live: [
      { id: "it_live", kind: "campaigns", rowId: "cmp_live" },
      { id: "it_archived", kind: "campaigns", rowId: "cmp_archived", archived: true },
      { id: "it_crash", kind: "content", rowId: "cnt_crash" },
    ],
    trashed,
  });

  it("reads the tasks out of every snapshot kind that holds one, and none out of the rest", () => {
    expect(trashed.map((t) => t.id)).toEqual(["it_deleted", "it_in_list", "it_parent", "it_sub"]);
    expect(trashed.find((t) => t.id === "it_sub")).toEqual({ id: "it_sub", kind: "events", rowId: "evt_unmarked" });
    expect(tasksInTrashSnapshot("space", null)).toEqual([]);
    expect(tasksInTrashSnapshot("space", { row: {}, children: { items: "not a list" } })).toEqual([]);
  });

  it("a row whose task is live is moved", () => {
    expect(legacyRowState("campaigns", { id: "cmp_live", customFields: mark("it_live") }, index)).toEqual({ state: "live", itemId: "it_live", marked: true });
  });

  it("a row whose task was deleted to Trash is moved, not waiting", () => {
    expect(legacyRowState("campaigns", { id: "cmp_deleted", customFields: mark("it_deleted") }, index)).toEqual({ state: "trashed", itemId: "it_deleted", marked: true });
  });

  it("a row whose task is archived, or went to Trash with its List, is moved", () => {
    expect(legacyRowState("campaigns", { id: "cmp_archived", customFields: mark("it_archived") }, index)).toEqual({ state: "trashed", itemId: "it_archived", marked: true });
    expect(legacyRowState("content", { id: "cnt_in_list", customFields: mark("it_in_list") }, index)).toEqual({ state: "trashed", itemId: "it_in_list", marked: true });
  });

  it("a row with no mark is matched by provenance, live or in Trash, so it is re-linked and never imported", () => {
    expect(legacyRowState("content", { id: "cnt_crash", customFields: {} }, index)).toEqual({ state: "live", itemId: "it_crash", marked: false });
    expect(legacyRowState("events", { id: "evt_unmarked", customFields: null }, index)).toEqual({ state: "trashed", itemId: "it_sub", marked: false });
  });

  it("only a row no task names, live or in Trash, is never moved", () => {
    expect(legacyRowState("campaigns", { id: "cmp_new", customFields: {} }, index)).toEqual({ state: "none" });
    // A mark naming a task deleted for good from Trash: importable again.
    expect(legacyRowState("campaigns", { id: "cmp_purged", customFields: mark("it_purged") }, index)).toEqual({ state: "none" });
    // Provenance is per kind: a content task never claims a campaign.
    expect(legacyRowState("campaigns", { id: "cnt_in_list", customFields: {} }, index)).toEqual({ state: "none" });
  });

  it("under one row a task on its List wins over one in Trash", () => {
    const both = legacyTaskIndex({
      live: [{ id: "it_back", kind: "campaigns", rowId: "cmp_twice" }],
      trashed: [{ id: "it_old", kind: "campaigns", rowId: "cmp_twice" }],
    });
    expect(legacyRowState("campaigns", { id: "cmp_twice", customFields: {} }, both)).toEqual({ state: "live", itemId: "it_back", marked: false });
  });
});

describe("contentToTask", () => {
  it("maps type and channel to choices, links to the URL fields and folds the campaign name", () => {
    const t = contentToTask(content, { campaignTitleById: new Map([["cmp_1", "Q4 demand gen"]]) });
    expect(t.status).toBe("IDEA");
    expect(t.statusExact).toBe(false);
    expect(t.dueAt).toEqual(content.scheduledFor);
    expect(t.ownerId).toBe("user_b");
    expect(t.metadata).toMatchObject({ type: "CASE_STUDY", channel: "BLOG", link: "https://example.com/post", brief_link: "https://example.com/brief" });
    expect(t.metadata.description).toBe("Interview the three leads first.\n\nCampaign: Q4 demand gen");
    expect(t.folded).toEqual(["Campaign"]);
    const fieldKeys = new Set(MARKETING_FIELDS.content.map((f) => f.key));
    for (const k of Object.keys(t.metadata)) {
      if (k === "description" || k === ITEM_PROVENANCE_KEY) continue;
      expect(fieldKeys.has(k), k).toBe(true);
    }
  });
});

describe("eventToTask", () => {
  it("maps the counts, the money and the links, and uses the start date as due when there is no end", () => {
    const t = eventToTask(event, { listCurrency: "INR" });
    expect(t.status).toBe("PROMOTING");
    expect(t.startAt).toEqual(event.startDate);
    expect(t.dueAt).toEqual(event.startDate);
    expect(t.metadata).toMatchObject({ format: "IN_PERSON", event_type: "CONFERENCE", location: "San Francisco", capacity: 5000, registered: 120, attended: 0, budget: 75000, page_link: "https://example.com/summit" });
    expect(t.metadata).not.toHaveProperty("spend");
    expect(t.metadata[ITEM_PROVENANCE_KEY]).toMatchObject({ kind: "events", currency: "INR" });
    const fieldKeys = new Set(MARKETING_FIELDS.events.map((f) => f.key));
    for (const k of Object.keys(t.metadata)) {
      if (k === "description" || k === ITEM_PROVENANCE_KEY) continue;
      expect(fieldKeys.has(k), k).toBe(true);
    }
  });
});

describe("legacyMarketingTarget", () => {
  const migrated = { spaceSlug: "marketing", lists: { campaigns: "campaigns", content: "content-2", events: "events" } };

  it("sends each legacy path to its Space, List or task", () => {
    expect(legacyMarketingTarget([], migrated, null)).toBe("/spaces/marketing");
    expect(legacyMarketingTarget(["campaigns"], migrated, null)).toBe("/boards/campaigns");
    expect(legacyMarketingTarget(["content"], migrated, null)).toBe("/boards/content-2");
    expect(legacyMarketingTarget(["events"], migrated, null)).toBe("/boards/events");
    expect(legacyMarketingTarget(["cmp_1"], migrated, "item_9")).toBe("/item/item_9");
  });

  it("sends a campaign that was not moved to the Campaigns List with the arrival notice", () => {
    expect(legacyMarketingTarget(["cmp_new"], migrated, null)).toBe("/boards/campaigns?notice=campaign-not-moved");
    expect(legacyMarketingTarget(["cmp_gone"], migrated, null, true)).toBe("/boards/campaigns?notice=campaign-in-trash");
  });

  it("falls back to the Space when a List is missing", () => {
    expect(legacyMarketingTarget(["events"], { spaceSlug: "mk", lists: {} }, null)).toBe("/spaces/mk");
    expect(legacyMarketingTarget(["cmp_new"], { spaceSlug: "mk", lists: {} }, null)).toBe("/spaces/mk");
  });
});

describe("CSV rows", () => {
  it("lets a campaign's own currency win over the org's", () => {
    const rows = campaignsToCsvRows([campaign, { ...campaign, id: "cmp_2", currency: "" }], "INR");
    expect(rows[0].Currency).toBe("USD");
    expect(rows[1].Currency).toBe("INR");
    expect(rows[0].Budget).toBe(50000);
    expect(rows[0]["Start date"]).toBe("2026-02-01");
  });

  it("names the campaign an event belongs to", () => {
    const rows = eventsToCsvRows([{ ...event, campaignId: "cmp_1" }], "USD", new Map([["cmp_1", "Q4 demand gen"]]));
    expect(rows[0].Campaign).toBe("Q4 demand gen");
    expect(rows[0].Currency).toBe("USD");
  });
});

describe("marketingTemplateProblem", () => {
  const good = {
    lists: [
      { name: "Campaigns", statuses: [{ value: "PLANNING" }], fields: [{ key: "budget" }] },
      { name: "Content", statuses: [{ value: "IDEA" }], fields: [{ key: "type" }] },
      { name: "Events", statuses: [{ value: "PLANNING" }], fields: [{ key: "format" }] },
    ],
  };

  it("accepts the rewritten template", () => {
    expect(marketingTemplateProblem(good)).toBeNull();
  });

  it("refuses a missing or unseeded template", () => {
    expect(marketingTemplateProblem(null)).toContain("not seeded");
    expect(marketingTemplateProblem({})).toContain("not seeded");
  });

  it("refuses the old two-List seed by name rather than falling back to the first List", () => {
    const old = { lists: [{ name: "Campaigns" }, { name: "Content calendar" }] };
    expect(marketingTemplateProblem(old)).toContain('List "Campaigns" has no statuses');
    const noEvents = { lists: good.lists.slice(0, 2) };
    expect(marketingTemplateProblem(noEvents)).toContain('no "Events" List');
  });

  it("refuses a List without fields", () => {
    const noFields = { lists: [good.lists[0], good.lists[1], { name: "Events", statuses: [{ value: "PLANNING" }], fields: [] }] };
    expect(marketingTemplateProblem(noFields)).toContain('List "Events" has no fields');
  });
});
