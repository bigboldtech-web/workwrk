// The tools one Ask AI chat offers (tool-names.ts askAiToolNames), the set
// its routes give the model and its approvals check a request against: the
// cross set, the chat's product's own, no Tables tools without Tables, and
// never a teammate's tool.

import { describe, expect, it } from "vitest";
import { BROWSER_TOOL_NAMES, CROSS_TOOL_NAMES, LEARNING_TOOL_NAMES, TEAMMATE_TOOL_NAMES, askAiToolNames, drivesBrowser } from "./tool-names";

describe("askAiToolNames", () => {
  it("is the cross set for a plain chat", () => {
    expect(askAiToolNames({}).sort()).toEqual([...CROSS_TOOL_NAMES].sort());
  });

  it("adds the chat's product's own tools", () => {
    const people = askAiToolNames({ agentProductSlug: "workwrk-people" });
    expect(people).toContain("create_kra");
    expect(people).toContain("create_kpi");
    expect(askAiToolNames({})).not.toContain("create_kra");
  });

  it("drops the Tables tools without Tables", () => {
    const off = askAiToolNames({ tablesOn: false });
    expect(off).not.toContain("create_data_table");
    expect(off).not.toContain("list_data_tables");
    expect(askAiToolNames({ tablesOn: true })).toContain("create_data_table");
  });

  it("reads a product as an own key only, so no slug can break a chat", () => {
    for (const slug of ["constructor", "__proto__", "toString", "no-such-product"]) {
      expect(askAiToolNames({ agentProductSlug: slug }).sort()).toEqual([...CROSS_TOOL_NAMES].sort());
    }
  });

  it("never offers an AI teammate's tool", () => {
    const offered = new Set<string>(askAiToolNames({ agentProductSlug: "workwrk-contracts" }));
    for (const name of TEAMMATE_TOOL_NAMES) expect(offered.has(name)).toBe(false);
  });
});

// Review of Phase 5 step 1: a teammate holds the browser only through one of
// Phase 4's browser tools, never through fill_fields or ask_to_show_me.
describe("drivesBrowser", () => {
  it("is every browser tool but learning by showing's", () => {
    expect(BROWSER_TOOL_NAMES.filter(drivesBrowser)).toEqual(["open_page", "read_page", "find_on_page", "scroll_page", "show_page", "click", "type_text", "select_option", "ask_to_take_over", "close_browser"]);
    for (const n of LEARNING_TOOL_NAMES) expect(drivesBrowser(n), n).toBe(false);
    for (const n of ["search_tasks", "send_email", "", "constructor"]) expect(drivesBrowser(n), n).toBe(false);
  });
});
