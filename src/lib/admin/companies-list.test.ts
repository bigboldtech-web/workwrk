import { describe, expect, it } from "vitest";
import {
  activeCompanyFilterCount,
  companyFilterWhere,
  companyListQuery,
  companyOrderBy,
  companyViewWhere,
  csvCell,
  modulesFromSlugs,
  ownerIdsOf,
  parseCompanyListParams,
  trialEndsWithinWhere,
  parseDay,
  parseList,
  seatsLabel,
  subscriptionSource,
  toCsv,
} from "./companies-list";

const sp = (s: string) => new URLSearchParams(s);

describe("parseCompanyListParams", () => {
  it("reads defaults from an empty query", () => {
    const p = parseCompanyListParams(sp(""));
    expect(p).toMatchObject({ view: "all", search: "", plans: [], sort: "newest", page: 1, limit: 40, owners: null });
    expect(activeCompanyFilterCount(p)).toBe(0);
  });
  it("keeps only allowed words and drops the rest", () => {
    const p = parseCompanyListParams(sp("view=paying&plan=GROWTH,PRO,GROWTH&status=TRIAL&subscription=past_due,x&modules=chat,slack&owners=none&sort=people"));
    expect(p.view).toBe("paying");
    expect(p.plans).toEqual(["GROWTH"]);
    expect(p.statuses).toEqual(["TRIAL"]);
    expect(p.subscriptions).toEqual(["past_due"]);
    expect(p.modules).toEqual(["chat"]);
    expect(p.owners).toBe("none");
    expect(parseCompanyListParams(sp("view=all&owners=0")).owners).toBe("none");
    expect(parseCompanyListParams(sp("owners=1")).owners).toBeNull();
    expect(p.sort).toBe("people");
    expect(activeCompanyFilterCount(p)).toBe(5);
  });
  it("an unknown view is All, a bad page is 1, a huge limit is capped", () => {
    const p = parseCompanyListParams(sp("view=deleted&page=abc&limit=9999&people_min=-3&signed_from=2026-13-40"));
    expect(p.view).toBe("all");
    expect(p.page).toBe(1);
    expect(p.limit).toBe(100);
    expect(p.peopleMin).toBeNull();
    expect(p.signedFrom).toBeNull();
  });
  it("reads Trial ends in the next 7 days as a counted filter, and writes it back", () => {
    const p = parseCompanyListParams(sp("view=trials&trial_ends=7d"));
    expect(p.trialEnds).toBe("7d");
    expect(activeCompanyFilterCount(p)).toBe(1);
    expect(companyListQuery(p)).toBe("?view=trials&trial_ends=7d");
    expect(parseCompanyListParams(sp("trial_ends=30d")).trialEnds).toBeNull();
    const now = new Date("2026-09-29T00:00:00.000Z");
    const window = { gte: now, lte: new Date("2026-10-06T00:00:00.000Z") };
    // A self-serve end is a UTC calendar day: today through the seventh day, whole.
    const dayWindow = { gte: new Date("2026-09-29T00:00:00.000Z"), lte: new Date("2026-10-06T23:59:59.999Z") };
    expect(companyFilterWhere(p, { now })).toEqual({
      AND: [
        {
          OR: [
            { subscription: { is: { trialEndsAt: window } } },
            // A self-serve trial's own date, only where nothing else decides it.
            {
              status: "TRIAL",
              trialEndsAt: dayWindow,
              NOT: {
                subscription: {
                  is: {
                    OR: [
                      { trialEndsAt: { not: null } },
                      { stripeSubscriptionId: { not: null } },
                      { billingMode: "FLAT_TIER", stripeSubscriptionId: null },
                    ],
                  },
                },
              },
            },
          ],
        },
      ],
    });
  });
  it("still counts a self-serve trial on its last day after noon UTC, as its page reads 'ends today'", () => {
    const now = new Date("2026-10-05T16:00:00.000Z");
    const where = trialEndsWithinWhere(now) as { OR: Array<{ trialEndsAt?: { gte: Date; lte: Date } }> };
    const selfServe = where.OR[1].trialEndsAt!;
    const endsToday = new Date("2026-10-05T12:00:00.000Z");
    expect(endsToday >= selfServe.gte && endsToday <= selfServe.lte).toBe(true);
    // and a day already over is out
    expect(new Date("2026-10-04T12:00:00.000Z") >= selfServe.gte).toBe(false);
  });
  it("counts the name search as a filter, so Clear all clears it", () => {
    expect(activeCompanyFilterCount(parseCompanyListParams(sp("search=acme")))).toBe(1);
  });
  it("round-trips through companyListQuery, leaving defaults out", () => {
    const p = parseCompanyListParams(sp("view=trials&search=acme&plan=SCALE&people_min=5&sort=name&page=2"));
    const q = companyListQuery(p);
    expect(q).toBe("?view=trials&search=acme&plan=SCALE&people_min=5&sort=name&page=2");
    expect(companyListQuery(parseCompanyListParams(sp("")))).toBe("");
  });
});

describe("parseList and parseDay", () => {
  it("parseList keeps order and removes repeats", () => {
    expect(parseList("b,a,b,c", ["a", "b"] as const)).toEqual(["b", "a"]);
    expect(parseList(null, ["a"] as const)).toEqual([]);
  });
  it("parseDay accepts a real calendar day only", () => {
    expect(parseDay("2026-09-29")).toBe("2026-09-29");
    expect(parseDay("29/09/2026")).toBeNull();
    expect(parseDay("")).toBeNull();
  });
});

describe("views and filters as where clauses", () => {
  it("Paying is a Stripe subscription that is active or past due", () => {
    expect(companyViewWhere("paying")).toEqual({
      subscription: { is: { stripeSubscriptionId: { not: null }, status: { in: ["ACTIVE", "PAST_DUE"] } } },
    });
  });
  it("Lifetime is a flat tier with no Stripe id; Suspended is the workspace status", () => {
    expect(companyViewWhere("lifetime")).toEqual({ subscription: { is: { billingMode: "FLAT_TIER", stripeSubscriptionId: null } } });
    expect(companyViewWhere("suspended")).toEqual({ status: "SUSPENDED" });
    expect(companyViewWhere("all")).toEqual({});
  });
  it("an empty filter set is no clause at all", () => {
    expect(companyFilterWhere(parseCompanyListParams(sp("")))).toEqual({});
  });
  it("a people range adds the pre-queried ids, and a zero minimum keeps companies with nobody", () => {
    const p = parseCompanyListParams(sp("people_max=3"));
    const w = companyFilterWhere(p, { peopleIds: ["a", "b"] }) as { AND: { OR: unknown[] }[] };
    expect(w.AND[0].OR).toEqual([{ id: { in: ["a", "b"] } }, { users: { none: { deletedAt: null } } }]);
    const p2 = parseCompanyListParams(sp("people_min=2"));
    const w2 = companyFilterWhere(p2, { peopleIds: ["a"] }) as { AND: { OR: unknown[] }[] };
    expect(w2.AND[0].OR).toEqual([{ id: { in: ["a"] } }]);
  });
  it("each named module must be on", () => {
    const w = companyFilterWhere(parseCompanyListParams(sp("modules=chat,tables"))) as { AND: unknown[] };
    expect(w.AND).toHaveLength(2);
  });
  it("sorts break ties by id so paging is stable", () => {
    expect(companyOrderBy("newest")).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(companyOrderBy("name")).toEqual([{ name: "asc" }, { id: "asc" }]);
  });
});

describe("row facts", () => {
  it("names the subscription source", () => {
    expect(subscriptionSource(null)).toBe("none");
    expect(subscriptionSource({ stripeSubscriptionId: "sub_1", billingMode: "PER_USER", status: "ACTIVE", seats: 5 })).toBe("stripe");
    expect(subscriptionSource({ stripeSubscriptionId: null, billingMode: "FLAT_TIER", status: "ACTIVE", seats: 25 })).toBe("lifetime");
    expect(subscriptionSource({ stripeSubscriptionId: null, billingMode: "PER_USER", status: "TRIALING", seats: 0 })).toBe("none");
  });
  it("reads seats as n of m, Unlimited, or None", () => {
    expect(seatsLabel(null, 4)).toBe("None");
    expect(seatsLabel({ stripeSubscriptionId: null, billingMode: "FLAT_TIER", status: "ACTIVE", seats: 25 }, 12)).toBe("12 of 25");
    expect(seatsLabel({ stripeSubscriptionId: null, billingMode: "FLAT_TIER", status: "ACTIVE", seats: 999_999 }, 12)).toBe("Unlimited");
    expect(seatsLabel({ stripeSubscriptionId: "s", billingMode: "PER_USER", status: "ACTIVE", seats: 0 }, 3)).toBe("Unlimited");
  });
  it("finds Owners: every SUPER_ADMIN plus the earliest admin when that is a COMPANY_ADMIN", () => {
    const t = (d: string) => new Date(d);
    expect(ownerIdsOf([])).toEqual([]);
    expect(
      ownerIdsOf([
        { id: "a", level: "COMPANY_ADMIN", createdAt: t("2026-01-01") },
        { id: "b", level: "COMPANY_ADMIN", createdAt: t("2026-02-01") },
        { id: "c", level: "EMPLOYEE", createdAt: t("2025-01-01") },
      ]),
    ).toEqual(["a"]);
    expect(
      ownerIdsOf([
        { id: "s", level: "SUPER_ADMIN", createdAt: t("2026-03-01") },
        { id: "a", level: "COMPANY_ADMIN", createdAt: t("2026-01-01") },
      ]),
    ).toEqual(["a", "s"]);
    expect(
      ownerIdsOf([
        { id: "s", level: "SUPER_ADMIN", createdAt: t("2025-01-01") },
        { id: "a", level: "COMPANY_ADMIN", createdAt: t("2026-01-01") },
      ]),
    ).toEqual(["s"]);
  });
  it("maps installed product slugs to module keys in registry order", () => {
    expect(modulesFromSlugs(["workwrk-tables", "workwrk-talk", "other"])).toEqual(["chat", "tables"]);
  });
});

describe("CSV", () => {
  it("quotes every cell and doubles quotes", () => {
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(12)).toBe('"12"');
  });
  it("neutralises a cell a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("-2")).toBe(`"'-2"`);
    expect(csvCell("@x")).toBe(`"'@x"`);
  });
  it("joins rows with CRLF", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe('"a","b"\r\n"c","d"\r\n');
  });
});
