import { describe, it, expect } from "vitest";
import { RETIRED_VIEWS, normaliseRetiredView } from "./retired-views";

describe("normaliseRetiredView", () => {
  it("drops /docs?view=meeting down to plain /docs", () => {
    expect(normaliseRetiredView("/docs", "?view=meeting")).toBe("/docs");
  });

  it("maps /docs?view=private to the Mine view, which is what it meant", () => {
    expect(normaliseRetiredView("/docs", "?view=private")).toBe("/docs?view=my");
  });

  it("maps /notetaker?mine=1 to ?view=my, the parameter the page reads", () => {
    expect(normaliseRetiredView("/notetaker", "?mine=1")).toBe("/notetaker?view=my");
  });

  it("answers null when nothing on the URL is retired", () => {
    expect(normaliseRetiredView("/docs", "")).toBeNull();
    expect(normaliseRetiredView("/docs", "?view=my")).toBeNull();
    expect(normaliseRetiredView("/docs", "?view=recent")).toBeNull();
    expect(normaliseRetiredView("/notetaker", "?view=my")).toBeNull();
  });

  it("is idempotent: the URL it returns is never retired itself, so it cannot loop", () => {
    for (const rule of RETIRED_VIEWS) {
      const first = normaliseRetiredView(rule.path, `?${rule.key}=${rule.from}`);
      expect(first).not.toBeNull();
      const [p, q = ""] = (first as string).split("?");
      expect(normaliseRetiredView(p, q)).toBeNull();
    }
  });

  it("carries every other parameter across", () => {
    expect(normaliseRetiredView("/docs", "?view=private&q=onboarding&sort=name"))
      .toBe("/docs?q=onboarding&sort=name&view=my");
    expect(normaliseRetiredView("/docs", "?view=meeting&q=kickoff")).toBe("/docs?q=kickoff");
  });

  it("matches the retired value case-insensitively, since stored links vary", () => {
    expect(normaliseRetiredView("/docs", "?view=PRIVATE")).toBe("/docs?view=my");
  });

  it("only applies to its own path", () => {
    expect(normaliseRetiredView("/canvas", "?view=private")).toBeNull();
    expect(normaliseRetiredView("/docs", "?mine=1")).toBeNull();
  });

  it("tolerates a trailing slash and a search string with no leading ?", () => {
    expect(normaliseRetiredView("/docs/", "view=private")).toBe("/docs?view=my");
  });

  it("leaves /docs?view=archived alone: that one is a real 308 in next.config", () => {
    // It changes path (to /trash), so it is a config redirect, not a page fix.
    expect(normaliseRetiredView("/docs", "?view=archived")).toBeNull();
  });
});
