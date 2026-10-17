// Whether a teammate holds the browser (browser-access.ts holdsBrowserTool
// and computerAgentFrom): only through one of Phase 4's browser tools, so
// taking every one away ends its browsers (Phase 4 Decision 6), whatever
// learning by showing's tools it still holds (review of Phase 5 step 1).

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/browser/sessions", () => ({ computerAccess: async () => ({ ok: false, reason: "not_configured" }) }));

import { computerAgentFrom, holdsBrowserTool } from "./browser-access";

const row = (toolNames: unknown) => ({ id: "a1", name: "Shopper", status: "ENABLED", browserSites: ["shop.proof.test", 7], toolNames });

describe("holding the browser", () => {
  it("holds it through any of Phase 4's browser tools", () => {
    for (const n of ["open_page", "read_page", "click", "ask_to_take_over", "close_browser"]) expect(holdsBrowserTool(["search_tasks", n]), n).toBe(true);
  });

  it("never through fill_fields, ask_to_show_me or use_skill alone", () => {
    // Before: fill_fields and ask_to_show_me were browser tools held, so the sweep and the PATCH route kept the browsers open.
    expect(holdsBrowserTool(["search_tasks", "fill_fields", "ask_to_show_me", "use_skill"])).toBe(false);
    expect(computerAgentFrom(row(["fill_fields", "ask_to_show_me"]))).toEqual({ id: "a1", name: "Shopper", status: "ENABLED", browserSites: ["shop.proof.test"], browserTools: false, learns: false });
    expect(computerAgentFrom(row(["fill_fields", "open_page"])).browserTools).toBe(true);
  });

  it("never for a legacy agent or a list that is not one", () => {
    for (const v of [null, undefined, "open_page", { open_page: true }, [7, null]]) expect(holdsBrowserTool(v), String(v)).toBe(false);
  });
});

describe("learning by showing (Phase 5 step 2)", () => {
  it("says a teammate learns only when its stored tools hold use_skill (Decision 4)", () => {
    // Before: no read said so, so a recording could start for a teammate that could never use the skill.
    expect(computerAgentFrom(row(["open_page", "use_skill"])).learns).toBe(true);
    expect(computerAgentFrom(row(["open_page", "ask_to_show_me", "fill_fields"])).learns).toBe(false);
    expect(computerAgentFrom(row(null)).learns).toBe(false);
  });
});
