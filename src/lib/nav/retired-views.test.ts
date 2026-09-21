import { describe, it, expect } from "vitest";
import { RETIRED_VIEWS, normaliseRetiredView, legacySopEditorTarget, isMalformedLegacySopId, LEGACY_SOP_EDITOR_PATHS } from "./retired-views";

describe("isMalformedLegacySopId (a broken edit link must not mint a row)", () => {
  it("flags an id that is present but not an id", () => {
    expect(isMalformedLegacySopId("/sops/new/text", "?id=a%20b")).toBe(true);
    expect(isMalformedLegacySopId("/sops/new/checklist", "?id=../../admin")).toBe(true);
  });

  it("is false for a plain create (no id) and for a real id (that one redirects)", () => {
    expect(isMalformedLegacySopId("/sops/new/text", "")).toBe(false);
    expect(isMalformedLegacySopId("/sops/new/text", "?id=")).toBe(false);
    expect(isMalformedLegacySopId("/sops/new/text", "?id=clx123abc")).toBe(false);
  });

  it("only applies to the two legacy editor paths", () => {
    expect(isMalformedLegacySopId("/sops/new/steps", "?id=a%20b")).toBe(false);
  });
});

describe("legacySopEditorTarget (spec-process section 0, the two ?id= editor URLs)", () => {
  it("sends /sops/new/text?id=X to the SOP page in edit mode", () => {
    expect(legacySopEditorTarget("/sops/new/text", "?id=clx123abc")).toBe("/sops/clx123abc?edit=1");
  });

  it("sends /sops/new/checklist?id=X to the same place", () => {
    expect(legacySopEditorTarget("/sops/new/checklist", "id=clx123abc")).toBe("/sops/clx123abc?edit=1");
  });

  it("answers null with no id, so the create door mints a row as 'new' should", () => {
    expect(legacySopEditorTarget("/sops/new/text", "")).toBeNull();
    expect(legacySopEditorTarget("/sops/new/checklist", "?foo=1")).toBeNull();
    expect(legacySopEditorTarget("/sops/new/text", "?id=")).toBeNull();
  });

  it("refuses an id that is not an id, so a crafted link cannot build a path", () => {
    expect(legacySopEditorTarget("/sops/new/text", "?id=../../admin")).toBeNull();
    expect(legacySopEditorTarget("/sops/new/text", "?id=a%20b")).toBeNull();
  });

  it("only applies to the two legacy editor paths", () => {
    expect(legacySopEditorTarget("/sops/new/steps", "?id=clx123abc")).toBeNull();
    expect(legacySopEditorTarget("/sops/new", "?id=clx123abc")).toBeNull();
    expect(legacySopEditorTarget("/docs", "?id=clx123abc")).toBeNull();
    expect(LEGACY_SOP_EDITOR_PATHS).toEqual(["/sops/new/text", "/sops/new/checklist"]);
  });

  it("tolerates a trailing slash", () => {
    expect(legacySopEditorTarget("/sops/new/text/", "?id=clx123abc")).toBe("/sops/clx123abc?edit=1");
  });

  it("never returns a URL that is itself a legacy editor URL, so it cannot loop", () => {
    const out = legacySopEditorTarget("/sops/new/text", "?id=clx123abc") as string;
    const [p, q = ""] = out.split("?");
    expect(legacySopEditorTarget(p, q)).toBeNull();
  });
});

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
