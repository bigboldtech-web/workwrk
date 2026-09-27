import { describe, expect, it } from "vitest";
import {
  campaignToTask,
  campaignsToCsvRows,
  choiceValue,
  contentToTask,
  eventToTask,
  eventsToCsvRows,
  legacyMarketingTarget,
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
