import { describe, expect, it } from "vitest";
import { CONNECTORS, filterConnectors, isRequestableConnector } from "./registry";

describe("the Integrations catalogue", () => {
  it("has no finance connectors and no fake Connect rows", () => {
    const keys = CONNECTORS.map((c) => c.key);
    expect(keys).not.toContain("stripe");
    expect(keys).not.toContain("quickbooks");
    expect(keys).not.toContain("qb");
    for (const k of ["whatsapp", "gmail", "slack", "google-calendar"]) expect(keys).toContain(k);
    // Every ready card names a real place to set it up.
    for (const c of CONNECTORS.filter((x) => x.kind === "ready")) expect(c.setup?.href).toMatch(/^\//);
    for (const c of CONNECTORS) expect(c.blurb).not.toMatch(/\u2014|--/);
  });

  it("hides upcoming rows unless Show upcoming features is on", () => {
    expect(filterConnectors({}).some((c) => c.key === "looker")).toBe(false);
    expect(filterConnectors({ showUpcoming: true }).some((c) => c.key === "looker")).toBe(true);
  });

  it("shows Google Calendar only where the deployment has it", () => {
    expect(filterConnectors({}).some((c) => c.key === "google-calendar")).toBe(false);
    expect(filterConnectors({ availability: { "google-calendar": true } }).some((c) => c.key === "google-calendar")).toBe(true);
  });

  it("filters by search, category and status", () => {
    expect(filterConnectors({ q: "slack" }).map((c) => c.key)).toEqual(["slack"]);
    expect(filterConnectors({ category: "Storage" }).map((c) => c.key)).toEqual(["google-drive", "onedrive"]);
    expect(filterConnectors({ status: "requested" }, new Set(["jira"])).map((c) => c.key)).toEqual(["jira"]);
    expect(filterConnectors({ status: "ready" })).toEqual([]);
  });

  it("only takes requests for connectors that are not built", () => {
    expect(isRequestableConnector("slack")).toBe(true);
    expect(isRequestableConnector("google-calendar")).toBe(false);
    expect(isRequestableConnector("made-up")).toBe(false);
  });
});
