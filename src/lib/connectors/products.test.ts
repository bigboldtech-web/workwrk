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
