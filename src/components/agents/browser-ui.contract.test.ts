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
    // Taken over for the request only while it waits (review of Phase 4 step 4).
    expect(c).toContain('<BrowserCard browserSessionId={takeOverOf} takeOverFor={a.status === "PENDING" ? a.id : undefined} />');
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
    expect(code(section)).toContain('if (state === "hidden" || !view || !browserSectionShown(view)) return null;');
  });

  it("the Tools tab draws the Allowed sites while a browser tool is ticked, which has a row only while the computer is available", () => {
    expect(code(toolsTab)).toContain('const browsing = t.status !== "ARCHIVED" && t.tools.some((x) => x.browser !== null && x.enabled);');
    expect(code(toolsTab)).toContain("{browsing ? <BrowserSites slug={t.slug} onChanged={onReload} /> : null}");
  });
});

/* ───────────────────── review of Phase 4 step 4 ───────────────────── */

/** The BrowserCard function's own source, without its comments. */
function cardBody(): string {
  const c = code(card);
  return c.slice(c.indexOf("export function BrowserCard("), c.indexOf("function LiveFrame("));
}

/** The takeOverFor effect, as written. */
function takeOverForEffect(): string {
  const c = cardBody();
  const from = c.indexOf("const tookOverFor = useRef");
  return c.slice(from, c.indexOf("}, [takeOverFor, view, takeOver]);", from));
}

describe("a take over request is answered by whichever card takes the browser (review of Phase 4 step 4)", () => {
  it("the browser card's own Take over names the request that waits", () => {
    expect(cardBody()).toContain("onClick={() => void takeOver(takeOverRequestOf(view))}>{B.takeOver}");
    expect(cardBody()).not.toContain("void takeOver(null)");
  });

  it("the card drawn for a request answers it while it waits, handed over too, and counts only a take over that went through", () => {
    const e = takeOverForEffect();
    expect(e).toContain('if (takeOverForStep(view, takeOverFor) === "done") {');
    // No longer returns for a browser already handed over.
    expect(e).not.toContain('state === "handed_over"');
    // tookOverFor is set only once the request no longer waits, or after the take over went through.
    const sets = [...e.matchAll(/tookOverFor\.current = takeOverFor;/g)].map((m) => m.index ?? -1);
    expect(sets).toHaveLength(2);
    expect(sets[0]).toBeGreaterThan(e.indexOf('=== "done"'));
    expect(sets[0]).toBeLessThan(e.indexOf("setTimeout("));
    expect(e).toContain("if (ok) tookOverFor.current = takeOverFor;");
    // A refused one is tried again only at a read after the refusal's own, never in a loop.
    expect(e).toContain("else retryAfterRead.current = latest.current;");
    expect(e).toContain("if (viewRead.current <= retryAfterRead.current) return;");
    expect(cardBody()).toContain("viewRead.current = n;");
  });
});

describe("an open browser shows the newest page it showed the person (review of Phase 4 step 4)", () => {
  it("draws its thumbnail in every open state, read only through shotSrc, opening the lightbox", () => {
    const c = cardBody();
    expect(c).toContain('const latestShot = state === "closed" ? null : newestPageShot(view);');
    expect(c).toContain("{latestShot ? <LatestPicture key={latestShot} id={latestShot} onOpen={setPicture} /> : null}");
    const part = code(card).slice(code(card).indexOf("function LatestPicture("), code(card).indexOf("function Picture("));
    expect(part).toContain("const src = shotSrc(id);");
    expect(part).toContain("onClick={() => onOpen(id)}");
    expect(part).toContain("<img src={src}");
    // The lightbox is the card's one Picture, open in every state.
    expect(c).toContain("<Picture id={picture} onClose={() => setPicture(null)} />");
  });
});

describe("Apps & modules draws its section only once its answer is known (review of Phase 4 step 4)", () => {
  it("returns nothing before the first answer, and never draws a loading card or its intro first", () => {
    const c = code(section);
    const fn = c.slice(c.indexOf("export function TeammateBrowserSection("), c.indexOf("function SiteChips("));
    expect(fn.indexOf('if (state === "hidden" || !view || !browserSectionShown(view)) return null;')).toBeGreaterThan(0);
    expect(fn.indexOf('if (state === "hidden" || !view || !browserSectionShown(view)) return null;')).toBeLessThan(fn.search(/return \(\s*<section>/));
    expect(c).not.toContain("SkeletonRows");
  });
});

describe("the approval card's Take over reaches a card that has read its browser (review of Phase 4 step 4)", () => {
  it("a browser card registers only once it read its browser, so until then the approval card draws its own", () => {
    const c = cardBody();
    expect(c).toContain('const canTakeOver = view !== null && load !== "missing";');
    expect(c).toContain("if (!register || !canTakeOver) return;");
    expect(c).toContain("}, [register, id, canTakeOver]);");
    expect(code(approval)).toMatch(/const card = cards\?\.handleFor\(sessionId\) \?\? null;\s*if \(!card\) \{\s*setInline\(true\);\s*return;/);
  });
});

describe("the person can always leave the browser they have (review of Phase 4 step 4)", () => {
  it("Done and Give it back, and the line saying to click into it, come before the frame", () => {
    const c = cardBody();
    const frame = c.indexOf("<LiveFrame");
    expect(frame).toBeGreaterThan(0);
    for (const needle of ["{B.done}", "{B.giveBack}", "{B.stop}", "B.clickToUse"]) {
      expect(c.indexOf(needle), needle).toBeGreaterThan(0);
      expect(c.indexOf(needle), needle).toBeLessThan(frame);
    }
  });

  it("nothing focuses the frame", () => {
    const c = code(card);
    expect(c).not.toMatch(/\.focus\(/);
    expect(c).not.toContain("frameRef");
    const iframe = c.slice(c.indexOf("<iframe"), c.indexOf("/>", c.indexOf("<iframe")));
    expect(iframe).not.toContain("onLoad");
    expect(iframe).not.toContain("autoFocus");
  });
});
