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
// Phase 5 step 3: the Skills tab, the drawer that draws it and the line that links to it.
const skillsTab = read("src/components/agents/settings/skills-tab.tsx");
const drawer = read("src/components/agents/teammate-settings-drawer.tsx");
const systemLine = read("src/components/agents/system-line.tsx");

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
    // Phase 5 step 3 adds Show how's /record.
    expect(writes(card).map((w) => /`\$\{url\}(\/[a-z/-]+)`/.exec(w)?.[1]).sort()).toEqual(["/live-view", "/record", "/stop", "/take-over", "/take-over/done"]);
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

/* ───────────────────── Phase 5 step 3: showing it how, and skills ───────────────────── */

describe("Show how on the browser card (docs/plans/ai-teammates-phase5.md step 3)", () => {
  const c = cardBody();

  it("is offered only while the view says a recording may start, beside Take over, naming the request to be shown how that waits", () => {
    expect(c).toMatch(/\{view\.canRecord \? \(\s*<button type="button" className=\{SECONDARY\} disabled=\{busy\} onClick=\{\(\) => setShowHow\(\{ actionId: showMeRequestOf\(view\), name: "" \}\)\}>/);
    expect(c.indexOf("{R.showHow}")).toBeGreaterThan(c.indexOf("{B.takeOver}"));
  });

  it("opens a dialog whose name starts empty, or with the person's own words from their request card, and posts record with the request's id", () => {
    const dialog = code(card).slice(code(card).indexOf("function ShowHowDialog("));
    expect(dialog).toContain("useState(initialName.slice(0, SKILL_NAME_MAX))");
    for (const needle of ["{R.dialogTitle}", "{R.dialogBody}", "{R.closesBy(endsBy)}", "{R.nameLabel}", "placeholder={R.namePlaceholder}", "{R.start}", "{R.cancel}"]) expect(dialog, needle).toContain(needle);
    expect(dialog).toMatch(/className=\{SECONDARY\} disabled=\{busy \|\| !words\}/);
    expect(dialog).toMatch(/className=\{GHOST\} disabled=\{busy\} onClick=\{onCancel\}/);
    expect(c).toContain("if (await record(name, showHow.actionId)) setShowHow(null);");
    expect(c).toContain("json: { organizationId: view.organizationId, name, ...(actionId ? { actionId } : {}) },");
    // Opened interactive, as Take over's answer opens it.
    expect(c).toMatch(/const record = useCallback[\s\S]*?hold\(\{ url: r\.data\.liveView\?\.url, interactive: true \}\)/);
    // The approval card's handle opens it with the request's words; an inline card opens it once read, only while that request waits.
    expect(c).toContain("showHow: (actionId, name) => {");
    expect(c).toContain("if (!view.canRecord || showMeRequestOf(view) !== showHowFor.actionId) return;");
  });

  it("opens Show how from the approval card only while the browser may record, and marks an inline card's opening only as it opens (review of step 3)", () => {
    // The handle reads the last read's canRecord (before: it opened the dialog whatever the browser said).
    expect(c).toContain("canRecordRef.current = view?.canRecord === true;");
    expect(c).toMatch(/showHow: \(actionId, name\) => \{\s*rootRef\.current\?\.scrollIntoView\(\{ block: "center" \}\);\s*if \(canRecordRef\.current\) setShowHow\(\{ actionId, name \}\);\s*\}/);
    // Before: marked before the canRecord check, so a first read that could not record yet never opened it later.
    const effect = c.slice(c.indexOf("const showedHowFor = useRef<string | null>(null);"), c.indexOf("}, [showHowFor, view]);"));
    expect(effect.indexOf("showedHowFor.current = showHowFor.actionId;")).toBeGreaterThan(effect.indexOf("if (!view.canRecord || showMeRequestOf(view) !== showHowFor.actionId) return;"));
    expect(effect).toMatch(/setTimeout\(\(\) => \{\s*showedHowFor\.current = showHowFor\.actionId;\s*setShowHow/);
  });

  it("while recording: the Recording chip, the hint and the steps so far, Done and Discard, all before the frame, Discard asking first", () => {
    expect(c).toContain('const rec = state === "handed_over" ? view.recording : null;');
    expect(c).toContain("const chip = rec ? RECORDING_CHIP : CHIP[state];");
    expect(code(card)).toContain('const RECORDING_CHIP: { label: string; tone: RunTone } = { label: R.chip, tone: "danger" };');
    const frame = c.indexOf("<LiveFrame");
    for (const needle of ["{R.done}", "{R.discard}", "{R.hint}", "{R.stepsSoFar(rec.steps)}", "{R.full}"]) {
      expect(c.indexOf(needle), needle).toBeGreaterThan(0);
      expect(c.indexOf(needle), needle).toBeLessThan(frame);
    }
    expect(c).toMatch(/className=\{DANGER_GHOST\} disabled=\{busy\} onClick=\{\(\) => void giveBack\(false\)\}>\{R\.discard\}/);
    expect(c).toContain("confirm({ title: R.discardTitle, description: R.discardBody, confirmLabel: R.discard, destructive: true })");
    // Done that kept nothing says so.
    expect(c).toContain("if (recording && finished && !r.data.recorded) toast(R.nothingRecorded);");
  });
});

describe("the approval card's request to be shown how (step 3)", () => {
  const c = code(approval);
  it("offers Show how (secondary) in place of Approve, with the person's own words, and Not now denies it", () => {
    expect(c).toContain("const showMeOf = a.preview.browser?.showMe ? a.preview.browser.sessionId : null;");
    expect(c).toContain('const personWhat = showMeOf ? (a.preview.browser?.personWhat ?? "") : "";');
    expect(c).toMatch(/waiting && showMeOf \? \(\s*<div[^>]*>\s*(?:\{\s*\}\s*)?<button type="button" className=\{SECONDARY\}[\s\S]{0,80}?onClick=\{\(\) => showHow\(showMeOf\)\}>\s*\{RECORDING_COPY\.showHow\}/);
    // Review of step 3: never held by the card drawn under it, so a dialog cancelled there opens again (before: disabled={denying || inline}).
    expect(c).toContain("className={SECONDARY} disabled={denying} onClick={() => showHow(showMeOf)}>");
    expect(c).toMatch(/showHow\(showMeOf\)\}>\s*\{RECORDING_COPY\.showHow\}\s*<\/button>\s*<button type="button" className=\{GHOST\}[\s\S]{0,120}?decision: "deny" \}\], "deny"\)\}>\s*\{BROWSER_PANEL_COPY\.notNow\}/);
    expect(c).toContain("card.showHow(a.id, personWhat);");
    expect(c).toContain('<BrowserCard browserSessionId={showMeOf} showHowFor={a.status === "PENDING" ? { actionId: a.id, name: personWhat } : undefined} />');
    // Recording for it reads You have it, never Approving.
    expect(c).toContain('const handedOver = (takeOverOf !== null || showMeOf !== null) && a.status === "RUNNING";');
  });
});

describe("Delete every skill and the switch in Apps & modules (step 3)", () => {
  const c = code(section);
  it("draws the switch under the computer's only where this WorkwrK offers it, asking before it goes off", () => {
    expect(c).toContain("{view.skillsOffered ? (");
    expect(c.indexOf("label={K.switchLabel}")).toBeGreaterThan(c.indexOf("label={P.switchLabel}"));
    expect(c).toContain("else setSkillsOff(true);");
    expect(c).toContain("json: { organizationId: shownIn, skillsEnabled: on },");
    expect(c).toMatch(/open=\{skillsOff\}[\s\S]*?title=\{K\.turnOffTitle\}[\s\S]*?<p>\{K\.turnOffBody\}<\/p>/);
  });
  it("shows the counts only, and deletes every skill only behind its confirm, while any is kept", () => {
    expect(c).toContain("K.skillsCount(view.skills.kept, view.skills.people)");
    expect(c).toContain("const kept = view.skills?.kept ?? 0;");
    expect(c).toContain("{kept > 0 ? (");
    expect(c).toMatch(/className=\{btn\.dangerGhost\} onClick=\{\(\) => setDeleteAllOpen\(true\)\}>\s*\{K\.deleteAll\}/);
    expect(c).toMatch(/open=\{deleteAllOpen\}[\s\S]*?title=\{K\.deleteAllTitle\}[\s\S]*?const ok = await deleteAll\(\);[\s\S]*?<p>\{K\.deleteAllBody\}<\/p>/);
    expect(c).toContain('json: { organizationId: shownIn, confirm: "delete" },');
  });

  it("keeps the count and Delete every skill under the plan's line, where the computer is not set up, and where skills are no longer offered, while any is kept (review of step 3, M1)", () => {
    // Before: drawn only inside the available branch's {view.skillsOffered ? ( ... )}.
    expect(c).toContain("const skillsKept = view.skills && (view.skillsOffered || kept > 0) ? (");
    const planBranch = c.slice(c.indexOf(") : planLine ? ("), c.indexOf("{view.region ?"));
    expect(planBranch).toContain("{skillsKept}");
    const offered = c.slice(c.indexOf("{view.skillsOffered ? ("), c.indexOf(") : null}", c.indexOf("{view.skillsOffered ? (")));
    expect(offered).not.toContain("skillsKept");
    expect(offered).not.toContain("K.deleteAll");
    expect(c.split("{skillsKept}")).toHaveLength(3);
    expect(c).toMatch(/view\.reason === "not_configured"\s*\?\s*BROWSER_ROUTE_ERRORS\.notConfigured/);
  });
});

describe("the Skills tab (step 3)", () => {
  const c = code(skillsTab);
  it("draws no blue button, types no words into its markup, and writes only with its workspace, reloading when it changed", () => {
    expect(c).not.toMatch(/bg-brand\b|btn\.primary/);
    const texts = [...c.matchAll(/>\s*([A-Za-z][^<>{};()=]*?)\s*<\//g)].map((m) => m[1].trim()).filter(Boolean);
    expect(texts).toEqual([]);
    const w = writes(skillsTab);
    expect(w.length).toBe(3);
    for (const call of w) expect(call).toMatch(/organizationId: (s|view)\.organizationId/);
    expect(c).toContain('if (r.code === "workspace_changed") window.location.reload();');
    // Every button is secondary, ghost or a ghost icon, or Try again's text link, as on the Routines tab.
    for (const m of c.matchAll(/<button\b[^>]*className=\{([A-Z_]+)\}/g)) expect(["SECONDARY", "GHOST", "GHOST_ICON", "LINK"], m[0]).toContain(m[1]);
  });
  it("offers Teach a skill only with canTeach, and sends its message through the store, closing the drawer", () => {
    expect(c).toContain("{!removed && avail?.canTeach && data ? (");
    expect(c).toContain("if (!sendShowMe(t.slug, v.name, v.site, v.address)) {");
    expect(c).toContain("onSent();");
  });
  // Step 4: Run in chat and Practice run, a ready skill's, while skills may be used with this teammate.
  it("offers Run in chat and Practice run on a ready skill only while skills may be used, through the store, closing the drawer", () => {
    expect(c).toContain('{open.status === "ready" && !removed && avail?.on ? (');
    expect(c).toContain("label={S.run}");
    expect(c).toContain("label={S.practice}");
    expect(c).toContain("run(open, false);");
    expect(c).toContain("run(open, true);");
    expect(c).toContain("if (!sendSkillRun(t.slug, s.id, s.name, { practice })) {");
  });
  it("says a step the person does themselves once, in what it does (review of step 3)", () => {
    // Before: FACTS.yourself and then yourselfLine, the same thing twice.
    expect(c).not.toContain("S.yourselfLine(");
    expect(c).toContain("S.FACTS.start(homeOf(v.address)) : v.facts}");
  });

  it("deletes a skill only behind its confirm, and a recording has no menu", () => {
    expect(c).toContain("confirm({ title: S.deleteTitle, description: S.deleteBody, confirmLabel: S.delete, destructive: true })");
    expect(c).toContain('{s.status !== "recording" ? (');
  });
  it("sends only what a review may change: each kept step's id, its title when changed, its value and forgetName, and startHome", () => {
    const save = c.slice(c.indexOf("steps: steps.map((s) => {"), c.indexOf("setBusy(true);", c.indexOf("steps: steps.map((s) => {")));
    expect(save).toContain("id: s.view.id,");
    expect(save).toContain("...(s.titled && s.title.trim() !== s.view.title ? { title: s.title.trim() } : {}),");
    expect(save).toContain("...(value && !sameValue(s.view.value, value) ? { value } : {}),");
    expect(save).toContain("...(s.forget ? { forgetName: true as const } : {}),");
    expect(save).toContain("...(startHome ? { startHome: true as const } : {}),");
    expect(save).not.toMatch(/site|address|role|name:/);
    // A stale tab is read again; a value refused says why under its step.
    expect(c).toContain("toast(S.changedElsewhere");
    expect(c).toContain("SKILL_VALUE_WORDS[issues.problem as keyof typeof SKILL_VALUE_WORDS]");
  });
  it("shows pictures only through shotSrc, in the browser card's lightbox, and says when one is gone", () => {
    expect(c).toContain("const src = v.shot ? shotSrc(v.shot.id) : null;");
    expect(c).toContain('import { Picture as PictureLightbox } from "../browser-card";');
    expect(c).toContain("{!src && v.pictureGone ? <p");
  });
  it("is drawn by the drawer only where it says so, and a kept recording's line links to it", () => {
    const d = code(drawer);
    expect(d).toContain('const tabs = TABS.filter((x) => x.key !== "skills" || skillsShown);');
    expect(d).toContain("<SkillsTab key={t.slug} teammate={t} openSkill={skill} onSent={onClose} />");
    const l = code(systemLine);
    expect(l).toContain('const review = m.event === "skill_recorded" && m.skillId && reviewHref ? reviewHref(m.skillId) : null;');
    expect(l).toContain("{RECORDING_COPY.review}");
    expect(code(thread)).toContain("reviewHref={slug && !teammateFor ? (skillId) => skillReviewHref(slug, skillId) : undefined}");
  });
});

