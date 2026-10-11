// The computer's UI (docs/plans/ai-teammates-phase4.md step 4), held to its
// rules by reading the components as written, since the suite runs in node
// with no page: the browser card (browser-card.tsx), the approval card's
// picture and Take over (approval-card.tsx), the thread that draws the card
// (teammate-thread.tsx), Settings, Apps & modules (teammate-browser-section.tsx)
// and the teammate's Allowed sites (settings/browser-sites.tsx).
//
// Each needle is a rule the spec or the brief sets: the live view's frame
// and where its address may live, pictures only from their route, every
// write naming its workspace and reloading on workspace_changed, the copy in
// teammate-copy.ts, and one blue button per page.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const card = read("src/components/agents/browser-card.tsx");
const approval = read("src/components/agents/approval-card.tsx");
const thread = read("src/components/agents/teammate-thread.tsx");
const section = read("src/app/(dashboard)/settings/apps/teammate-browser-section.tsx");
const page = read("src/app/(dashboard)/settings/apps/page.tsx");
const sites = read("src/components/agents/settings/browser-sites.tsx");
const toolsTab = read("src/components/agents/settings/tools-tab.tsx");

/** The source without its comments, so a rule is held by the code, not by what a comment says. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Every apiFetch call that sends something, as written up to its closing body. */
function writes(src: string): string[] {
  const out: string[] = [];
  const re = /apiFetch<[^>]*>\([^)]*?method:\s*"(POST|PUT|PATCH|DELETE)"[\s\S]*?\}\s*\)/g;
  for (const m of code(src).matchAll(re)) out.push(m[0]);
  return out;
}

describe("the browser card's live view (Decision 19)", () => {
  const c = code(card);

  it("is a frame with the spec's sandbox, no referrer, clipboard-write only, and a title", () => {
    expect(c).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(c).toContain('referrerPolicy="no-referrer"');
    expect(c).toContain('allow="clipboard-write"');
    expect(c).toContain("title={B.liveViewTitle}");
    expect(c.match(/<iframe\b/g)).toHaveLength(1);
  });

  it("is view-only outside a take over: inert, out of the tab order, under an overlay that takes pointer events", () => {
    expect(c).toContain("inert={!interactive}");
    expect(c).toContain("tabIndex={interactive ? 0 : -1}");
    expect(c).toContain('className="absolute inset-0 cursor-default"');
    for (const ev of ["onPointerDown", "onMouseDown", "onClick", "onContextMenu", "onKeyDown"]) expect(c, ev).toContain(`${ev}={swallow}`);
    // The overlay never takes focus: no tab stop of its own.
    const overlay = c.slice(c.indexOf("data-view-only"), c.indexOf("/>", c.indexOf("data-view-only")));
    expect(overlay).not.toContain("tabIndex");
    // Interactive only while the person has the browser and the address was minted for that.
    expect(c).toContain('const interactive = Boolean(shownLive?.interactive && state === "handed_over");');
  });

  it("embeds an address only once the page repeated the origin check, and keeps it in state alone", () => {
    expect(c).toContain("liveViewShownOk(u, { production: PRODUCTION })");
    expect(c).toContain("src={url}");
    expect(c).toContain("url={shownLive.url}");
    for (const leak of ["localStorage", "sessionStorage", "console.", "history.", "router.", "searchParams", "location.href", "location.hash"]) {
      expect(c, leak).not.toContain(leak);
    }
  });
});

describe("pictures (Decision 16)", () => {
  it("load only from /api/teammate-browser/shots/<id>, through shotSrc, on both cards", () => {
    for (const [name, src] of [["browser card", code(card)], ["approval card", code(approval)]] as const) {
      const imgs = [...src.matchAll(/<img\b[\s\S]*?\/>/g)].map((m) => m[0]);
      expect(imgs.length, name).toBeGreaterThan(0);
      for (const img of imgs) expect(img, name).toMatch(/src=\{src\}/);
      expect(src, name).toContain("shotSrc(");
    }
    expect(code(approval)).toContain("alt={BROWSER_PANEL_COPY.picture}");
    expect(code(approval)).toContain('loading="lazy"');
    expect(code(approval)).toContain("max-w-full");
  });
});

describe("every write names its workspace and reloads on workspace_changed", () => {
  for (const [name, src, pin] of [
    ["the browser card", card, "organizationId: view.organizationId"],
    ["the Apps & modules section", section, "organizationId: shownIn"],
    ["the Allowed sites", sites, "organizationId: view.organizationId"],
  ] as const) {
    it(name, () => {
      const w = writes(src);
      expect(w.length, name).toBeGreaterThan(0);
      for (const call of w) expect(call, name).toContain(pin);
      expect(code(src)).toMatch(/code === "workspace_changed"\)\s*\{?\s*(refused\(r\);\s*return r\.error;|window\.location\.reload\(\))/);
    });
  }

  it("the browser card writes to its own session's routes only", () => {
    expect(writes(card).map((w) => /`\$\{url\}(\/[a-z/-]+)`/.exec(w)?.[1]).sort()).toEqual(["/live-view", "/stop", "/take-over", "/take-over/done"]);
    expect(code(card)).toContain("const url = `/api/teammate-browser/sessions/${encodeURIComponent(id)}`;");
  });
});

describe("one blue button per page, and the copy in teammate-copy.ts", () => {
  for (const [name, src] of [
    ["browser card", card],
    ["section", section],
    ["Allowed sites", sites],
  ] as const) {
    it(name, () => {
      const c = code(src);
      expect(c, name).not.toMatch(/bg-brand\b|btn\.primary/);
      // No words typed into the markup: every sentence comes from the copy.
      const texts = [...c.matchAll(/>\s*([A-Za-z][^<>{};()=]*?)\s*<\//g)].map((m) => m[1].trim()).filter(Boolean);
      expect(texts, name).toEqual([]);
    });
  }

  it("the Stop button asks first with the spec's words, through useConfirm", () => {
    expect(code(card)).toContain("confirm({ title: B.stopTitle, description: B.stopBody, confirmLabel: B.stop, destructive: true })");
  });
});

describe("the approval card's take over request", () => {
  const c = code(approval);
  it("offers Take over (secondary) in place of Approve, and Not now denies it", () => {
    expect(c).toContain("a.preview.browser?.takeOver");
    expect(c).toMatch(/className=\{SECONDARY\}[\s\S]{0,120}?onClick=\{\(\) => void takeOver\(takeOverOf\)\}>\s*\{BROWSER_PANEL_COPY\.takeOver\}/);
    expect(c).toMatch(/className=\{GHOST\}[\s\S]{0,120}?decision: "deny" \}\], "deny"\)\}>\s*\{BROWSER_PANEL_COPY\.notNow\}/);
  });
  it("hands the browser to that session's card on screen, or draws one", () => {
    expect(c).toContain("cards?.handleFor(sessionId)");
    expect(c).toContain("await card.takeOver(a.id)");
    expect(c).toContain("<BrowserCard browserSessionId={takeOverOf} takeOverFor={a.id} />");
  });
});

describe("where the pieces are drawn", () => {
  it("the thread draws a browser card for a browser_started line, which stays its fallback", () => {
    const c = code(thread);
    expect(c).toContain('m.event === "browser_started" && m.browserSessionId');
    expect(c).toContain("<BrowserCard browserSessionId={m.browserSessionId} fallback={line} />");
    expect(c).toContain("<BrowserCardsProvider hasRequest={hasRequest} tick={tick}>");
  });

  it("Apps & modules draws the section after Google's, anchored #ai-browser, and nothing where the computer is not offered", () => {
    expect(page.indexOf("<TeammateBrowserSection />")).toBeGreaterThan(page.indexOf("<TeammateGoogleSection />"));
    expect(code(section)).toContain('id="ai-browser"');
    expect(code(section)).toContain('view.reason === "not_configured") return null;');
  });

  it("the Tools tab draws the Allowed sites while a browser tool is ticked, which has a row only while the computer is available", () => {
    expect(code(toolsTab)).toContain('const browsing = t.status !== "ARCHIVED" && t.tools.some((x) => x.browser !== null && x.enabled);');
    expect(code(toolsTab)).toContain("{browsing ? <BrowserSites slug={t.slug} onChanged={onReload} /> : null}");
  });
});
