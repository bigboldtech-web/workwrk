import { describe, expect, it } from "vitest";
import { consoleCallbackUrl } from "./signed-out-redirect";

describe("consoleCallbackUrl", () => {
  it("keeps a console deep link with its query", () => {
    expect(consoleCallbackUrl("/admin/companies/abc", "?x=1")).toBe("/admin/companies/abc?x=1");
    expect(consoleCallbackUrl("/admin", "")).toBe("/admin");
  });
  it("never sends anything else back", () => {
    expect(consoleCallbackUrl("/adminx", "")).toBe("/admin");
    expect(consoleCallbackUrl("/home", "")).toBe("/admin");
    expect(consoleCallbackUrl("//evil.example/admin", "")).toBe("/admin");
  });
});
