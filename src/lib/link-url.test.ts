import { describe, expect, it } from "vitest";
import { normaliseLinkUrl } from "./link-url";

describe("normaliseLinkUrl", () => {
  it("leaves a full http or https address alone", () => {
    expect(normaliseLinkUrl("https://workwrk.com/a?b=1#c")).toBe("https://workwrk.com/a?b=1#c");
    expect(normaliseLinkUrl("http://localhost:3007/tlk")).toBe("http://localhost:3007/tlk");
  });

  it("assumes https for a bare host, which is what people type", () => {
    expect(normaliseLinkUrl("example.com")).toBe("https://example.com");
    expect(normaliseLinkUrl("  docs.workwrk.com/guide  ")).toBe("https://docs.workwrk.com/guide");
  });

  it("turns a bare email address into a mailto", () => {
    expect(normaliseLinkUrl("anita@acme.com")).toBe("mailto:anita@acme.com");
    expect(normaliseLinkUrl("mailto:anita@acme.com")).toBe("mailto:anita@acme.com");
  });

  it("REFUSES a scheme that can run code in somebody else's session", () => {
    expect(normaliseLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseLinkUrl("JavaScript:alert(1)")).toBeNull();
    expect(normaliseLinkUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(normaliseLinkUrl("file:///etc/passwd")).toBeNull();
    expect(normaliseLinkUrl("vbscript:msgbox")).toBeNull();
  });

  it("answers null for nothing usable rather than inventing a link", () => {
    expect(normaliseLinkUrl("")).toBeNull();
    expect(normaliseLinkUrl("   ")).toBeNull();
    expect(normaliseLinkUrl("just some words")).toBeNull();
    expect(normaliseLinkUrl("nodot")).toBeNull();
  });
});
