import { describe, expect, it } from "vitest";
import { rowMatchesQuery } from "./command-palette";

// The typed-query APPS match (spec-shell 2.9): a person who saw "Agents" in
// the JUMP TO list and types it must find it, and the canon page names of
// spec-ai-automation 1.3 must reach rows whose visible label is the hub's.

describe("rowMatchesQuery", () => {
  it("matches the label, case-insensitive, on a substring", () => {
    expect(rowMatchesQuery({ label: "Agents" }, "agents")).toBe(true);
    expect(rowMatchesQuery({ label: "Integrations" }, "integr")).toBe(true);
    expect(rowMatchesQuery({ label: "Everything" }, "every")).toBe(true);
    expect(rowMatchesQuery({ label: "Favorites" }, "inbox")).toBe(false);
  });

  it("matches a hidden alias so the canon page name finds the hub row", () => {
    const ai = { label: "AI", aliases: ["Ask AI"] };
    expect(rowMatchesQuery(ai, "ask ai")).toBe(true);
    expect(rowMatchesQuery(ai, "ask")).toBe(true);
    const automation = { label: "Automation", aliases: ["Workflows"] };
    expect(rowMatchesQuery(automation, "workflows")).toBe(true);
    expect(rowMatchesQuery(automation, "autom")).toBe(true);
  });

  it("does not match a row with no alias on another row's alias", () => {
    expect(rowMatchesQuery({ label: "Automation" }, "workflows")).toBe(false);
    expect(rowMatchesQuery({ label: "AI", aliases: [] }, "ask ai")).toBe(false);
  });

  it("never matches an empty query (the empty state is the launcher, not a match)", () => {
    expect(rowMatchesQuery({ label: "Agents", aliases: ["x"] }, "")).toBe(false);
  });
});
