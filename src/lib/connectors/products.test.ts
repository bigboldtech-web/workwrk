// The Google products a person may connect (src/lib/connectors/products.ts):
// each product asks only its own scopes, counts only when Google granted all
// of them, and every tool names its product.

import { describe, expect, it } from "vitest";
import { CONNECTOR_TOOL_NAMES } from "@/lib/agents/tool-names";
import {
  CONNECTOR_LIMITS,
  GOOGLE_BASE_SCOPES,
  NO_PRODUCTS,
  PRODUCT_SCOPES,
  TAINTING_TOOLS,
  TOOL_PRODUCT,
  isEventId,
  parseProducts,
  productOfTool,
  productSet,
  productsGranted,
  scopesFor,
} from "./products";

const GMAIL_READ = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
const CAL_EVENTS = "https://www.googleapis.com/auth/calendar.events";
const CAL_FREEBUSY = "https://www.googleapis.com/auth/calendar.freebusy";

describe("scopesFor", () => {
  it("never asks Calendar alone for any Gmail scope", () => {
    const s = scopesFor(["calendar"]);
    expect(s.some((x) => x.includes("gmail."))).toBe(false);
    expect(s).toEqual(["openid", "email", CAL_EVENTS, CAL_FREEBUSY]);
  });

  it("always asks the base scopes, and each scope once", () => {
    expect(scopesFor([])).toEqual([...GOOGLE_BASE_SCOPES]);
    const both = scopesFor(["gmail", "calendar", "gmail"]);
    expect(both).toEqual(["openid", "email", GMAIL_READ, GMAIL_COMPOSE, CAL_EVENTS, CAL_FREEBUSY]);
    expect(new Set(both).size).toBe(both.length);
  });

  it("asks nothing that could delete mail or change calendar settings", () => {
    const all = Object.values(PRODUCT_SCOPES).flat();
    expect(all.some((s) => /gmail\.modify|mail\.google\.com|auth\/calendar$/.test(s))).toBe(false);
  });
});

describe("productsGranted", () => {
  it("needs both Gmail scopes: one alone is no Gmail", () => {
    expect(productsGranted(`openid email ${GMAIL_READ}`)).toEqual([]);
    expect(productsGranted(`openid email ${GMAIL_COMPOSE}`)).toEqual([]);
    expect(productsGranted(`${GMAIL_READ} ${GMAIL_COMPOSE}`)).toEqual(["gmail"]);
  });

  it("reads a partial grant as the product granted in full only", () => {
    expect(productsGranted(`openid ${CAL_EVENTS} ${CAL_FREEBUSY} ${GMAIL_READ}`)).toEqual(["calendar"]);
    expect(productsGranted(`${CAL_FREEBUSY}  ${GMAIL_COMPOSE}\n${CAL_EVENTS} ${GMAIL_READ}`)).toEqual(["gmail", "calendar"]);
  });

  it("ignores scopes it does not know", () => {
    expect(productsGranted("https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.modify")).toEqual([]);
    expect(productsGranted("")).toEqual([]);
  });
});

describe("parseProducts", () => {
  it("keeps known names once, in the products' order", () => {
    expect(parseProducts("gmail,foo,gmail")).toEqual(["gmail"]);
    expect(parseProducts(" calendar , GMAIL ")).toEqual(["gmail", "calendar"]);
    expect(parseProducts(["calendar", "gmail", 7, "drive"])).toEqual(["gmail", "calendar"]);
  });

  it("reads anything else as none", () => {
    expect(parseProducts(undefined)).toEqual([]);
    expect(parseProducts("")).toEqual([]);
    expect(parseProducts({ gmail: true })).toEqual([]);
  });
});

describe("the tools and their products", () => {
  it("names a product for every connector tool, and none for any other tool", () => {
    expect(Object.keys(TOOL_PRODUCT).sort()).toEqual([...CONNECTOR_TOOL_NAMES].sort());
    for (const t of CONNECTOR_TOOL_NAMES) expect(productOfTool(t)).toBe(t.includes("email") ? "gmail" : "calendar");
    expect(productOfTool("create_task")).toBeNull();
    expect(productOfTool("constructor")).toBeNull();
  });

  it("taints a turn only with the reads that carry other people's words", () => {
    expect([...TAINTING_TOOLS].sort()).toEqual(["list_events", "read_email", "search_email"]);
  });

  it("reads a stored list as a set, unknown names dropped, and starts with nothing on", () => {
    expect(productSet(["calendar", "drive"])).toEqual({ gmail: false, calendar: true });
    expect(productSet(null)).toEqual(NO_PRODUCTS);
    expect(NO_PRODUCTS).toEqual({ gmail: false, calendar: false });
    expect(Object.isFrozen(NO_PRODUCTS)).toBe(true);
  });

  it("holds the spec's limits", () => {
    expect(CONNECTOR_LIMITS).toMatchObject({ callsPerTurn: 12, perPersonPerMinute: 30, searchMax: 20, bodyChars: 4000, threadChars: 20_000, eventsMax: 50, listWindowDays: 31, freeWindowDays: 14, freeOthersMax: 5 });
  });
});

// Review round 1 of Phase 3: an id the model wrote from a planted email is
// checked before any address is built from it.
describe("isEventId", () => {
  it("takes the ids Google gives, an instance's suffix included, and the stand-in's hyphens", () => {
    for (const id of ["7cbh8rpc10lrc0ckih9tafss99", "_68r3ac9h6co3ib9k6os4ab9k6", "abc123_20261013", "abc123_20261013T100000Z", "e-solo", "e-weekly_20261013"]) {
      expect(isEventId(id)).toBe(true);
    }
  });
  it("refuses a dot, a slash, an escape, a space, capitals outside the suffix, nothing, and more than 1024 characters", () => {
    for (const id of ["..", ".", "a.b", "a/b", "e%2e%2e", "a b", "Team", "", "a".repeat(1025), "abc_20261013T100000z"]) {
      expect(isEventId(id)).toBe(false);
    }
    expect(isEventId(null)).toBe(false);
    expect(isEventId(12)).toBe(false);
  });

  // Review round 2 of Phase 3: a series split by "this and following events"
  // carries "_R" and its start, which the round 1 shape refused, so the
  // teammate could not change an event list_events had just named.
  it("takes a split series' id and its single times, and still never a dot or a loose R segment", () => {
    for (const id of ["7cbh8rpc10lrc0ckih9tafss99_R20261013T150000", "7cbh8rpc10lrc0ckih9tafss99_R20261013T150000_20261020T150000Z", "abc123_R20261013T150000_20261020"]) {
      expect(isEventId(id)).toBe(true);
    }
    for (const id of ["abc_R20261013T150000.", "abc_R2026101T150000", "abc_r20261013T150000x", "abc_R../x"]) {
      expect(isEventId(id)).toBe(false);
    }
  });

  // Review round 3 of Phase 3: a split all-day series names its start as a
  // day alone, and a moment may carry its Z; both were refused at the zod
  // check, so the teammate could not change, cancel or answer an all-day
  // event list_events had just named.
  it("takes an all-day split series and its single days, and a split moment with its Z, still never a dot", () => {
    for (const id of ["7cbh8rpc10lrc0ckih9tafss99_R20261013", "abc_R20261013_20261020", "abc_R20261013T150000Z", "abc_R20261013T150000Z_20261020T150000Z", "abc_R20261013_20261020T150000Z"]) {
      expect(isEventId(id)).toBe(true);
    }
    for (const id of ["abc_R20261013.", "abc_R20261013Z", "abc_R20261013T1500Z", "abc_R20261013T150000ZZ", "abc_R20261013_2026102", "abc_R20261013/..", "abc_R_20261013"]) {
      expect(isEventId(id)).toBe(false);
    }
  });
});
