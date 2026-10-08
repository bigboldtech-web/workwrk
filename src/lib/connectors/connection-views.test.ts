// The Connections card's pure half (docs/plans/ai-teammates-phase3.md step 2):
// an ?ai_error= code read as words, and the products a teammate's tools reach.

import { describe, expect, it } from "vitest";
import { productsOfTools, teammateConnectSentence } from "./connection-views";

describe("teammateConnectSentence", () => {
  it("words each code the routes send", () => {
    expect(teammateConnectSentence("access_denied")).toBe("you didn't give WorkwrK access");
    expect(teammateConnectSentence("workspace_changed")).toBe("you switched workspace meanwhile");
  });
  it("reads an unknown code as itself, so it can be searched for (connect-errors.ts rule)", () => {
    expect(teammateConnectSentence("invalid_scope")).toBe("invalid_scope");
  });
  it("never puts a crafted link's own sentence on the page", () => {
    expect(teammateConnectSentence("Your account is locked. Call 555 0100")).toBe("unknown");
    expect(teammateConnectSentence("constructor")).toBe("constructor");
    expect(teammateConnectSentence("__proto__")).toBe("__proto__");
  });
});

describe("productsOfTools", () => {
  it("is on for a product when one of its tools is there, and never for other tools", () => {
    expect(productsOfTools(["search_email", "create_task"])).toEqual({ gmail: true, calendar: false });
    expect(productsOfTools(["find_free_time"])).toEqual({ gmail: false, calendar: true });
    expect(productsOfTools(["create_task", "toString"])).toEqual({ gmail: false, calendar: false });
  });
});
