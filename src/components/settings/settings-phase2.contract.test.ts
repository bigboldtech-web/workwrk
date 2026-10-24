// Settings clean-up Phase 2 (docs/plans/settings-cleanup.md D Phase 2, B3,
// B6, B10, B11): Apps & modules and the Overview, held by reading the
// components as written, like the frame's own contract test, because the
// pages need the whole app around them to render.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_SETTINGS_COPY } from "@/lib/mcp/mcp-copy";
import { BROWSER_POLICY_COPY, CONNECTOR_POLICY_COPY, SKILL_POLICY_COPY } from "@/lib/agents/teammate-copy";
import { SETTINGS_PAGE_LIST, WORKSPACE_GROUP_ORDER } from "@/lib/settings-registry";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** The source without its comments, so a rule is held by the code, not by what a comment says. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const APPS = "src/app/(dashboard)/settings/apps/";
const page = code(read(`${APPS}page.tsx`));
const modules = code(read(`${APPS}modules-section.tsx`));
const mcp = code(read(`${APPS}mcp-section.tsx`));
const browser = code(read(`${APPS}teammate-browser-section.tsx`));
const google = code(read(`${APPS}teammate-google-section.tsx`));
const chips = code(read("src/components/settings/site-chips.tsx"));
const overview = code(read("src/app/(dashboard)/settings/overview-client.tsx"));
// As written: its comments name "/settings/*" URLs, which a block-comment strip would read as a comment's start.
const shell = read("src/components/layout/os/settings-shell.tsx");

/** One 13px line of a hint across a 760 card's body, and two for a card's description. */
const ONE_LINE = 110;
const TWO_LINES = 220;

describe("Apps & modules: one heading per section, in the plan's order", () => {
  // Phase 2 review, M2 (decided by the lead): the cards with no label over them come before the first label. Last,
  // under the Requests label, Rail apps read as a third request card and sank as the requests grew.
  it("draws Modules, Rail apps and Automations, then the AI cards, then Requests", () => {
    const ai = page.indexOf('<SettingsSection label="AI"');
    const at = [
      page.indexOf("<ModulesSection />"),
      page.search(/<SettingsCard\s+id="rail"/),
      page.indexOf("<AutomationsCard />"),
      ai,
      page.indexOf("<TeammateGoogleSection />"),
      page.indexOf("<TeammateBrowserSection />"),
      page.indexOf("<McpSection />"),
      page.indexOf("</SettingsSection>", ai),
      page.indexOf("<RequestsSection />"),
    ];
    for (const i of at) expect(i).toBeGreaterThan(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Nothing after Requests: no card sits under its label.
    expect(page.slice(page.indexOf("<RequestsSection />"), page.indexOf("<ConfirmDialog"))).not.toMatch(/<SettingsCard\b/);
  });

  it("labels only the two groups of cards, never with a card's own title", () => {
    const labels = [...page.matchAll(/<SettingsSection\b[^>]*?\blabel="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["AI", "Requests"]);
    const titles = [
      ...[page, modules].flatMap((c) => [...c.matchAll(/\btitle="([^"]+)"/g)].map((m) => m[1])),
      MCP_SETTINGS_COPY.title,
      BROWSER_POLICY_COPY.title,
      CONNECTOR_POLICY_COPY.title,
    ];
    for (const t of ["Modules", "Automations", "Connector requests", "App suggestions", "Rail apps"]) expect(titles).toContain(t);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    for (const l of labels) expect(titles.map(norm), l).not.toContain(norm(l));
    // The AI cards draw no label of their own; their hidden check still comes before their card.
    for (const [name, c, card] of [["mcp", mcp, '<SettingsCard id="ai-apps"'], ["browser", browser, '<SettingsCard id="ai-browser"'], ["google", google, '<SettingsCard id="ai-google"']] as const) {
      expect(c, name).not.toContain("SettingsSection");
      expect(c.indexOf("return null;"), name).toBeGreaterThan(0);
      expect(c.indexOf("return null;"), name).toBeLessThan(c.indexOf(card));
    }
  });

  // B7: cards with no label over them are 24px apart; labelled sections 32.
  it("sets Modules, Rail apps and Automations 24px apart, the labelled sections 32", () => {
    // (A stripped comment leaves its braces behind.)
    expect(page).toMatch(/<div className="flex flex-col gap-8">\s*(\{\}\s*)?<div className="flex flex-col gap-6">\s*<ModulesSection \/>\s*<SettingsCard\s+id="rail"[\s\S]*?<\/SettingsCard>\s*<AutomationsCard \/>\s*<\/div>\s*(\{\}\s*)?<SettingsSection label="AI"/);
  });

  // B3: a section label groups two or more cards. In production only AI apps (MCP) may be offered, and "AI" over
  // that one card read as its title said twice.
  it("shows the AI label only over two or more AI cards, and takes no room while none is drawn", () => {
    expect(page).toContain('<SettingsSection label="AI" className="[&:not(:has(section))]:hidden [&:not(:has(section~section))>h2]:hidden">');
    // The cards are the group's sibling sections: SettingsCard draws a <section>, and the label is the group's <h2>.
    expect(read("src/components/settings/settings-card.tsx")).toMatch(/return \(\s*<section\b/);
    expect(read("src/components/settings/settings-section.tsx")).toMatch(/<section id=\{id\}[\s\S]*?<h2 className=/);
  });

  it("drops the footer links; each card's one link to where people ask shows once", () => {
    expect(page).not.toContain('href="/build"');
    expect(page).toContain('actions={requestsEmpty ? null : <Link href="/integrations" className={REQUEST_LINK}>Integrations</Link>}');
    expect(page).toContain('actions={suggestionsEmpty ? null : <Link href="/store" className={REQUEST_LINK}>Marketplace</Link>}');
    expect(page.match(/href="\/integrations"/g)).toHaveLength(2);
    expect(page.match(/href="\/store"/g)).toHaveLength(2);
  });

  it("draws Requests as two SettingsCards of SettingsRow rows, with B10 empty rows and no box of its own", () => {
    const req = page.slice(page.indexOf("function RequestsSection("));
    expect(req).toMatch(/<SettingsSection id="requests" label="Requests" className="[^"]*">/);
    expect(req).toMatch(/<SettingsCard\s+title="Connector requests"/);
    expect(req).toMatch(/<SettingsCard\s+title="App suggestions"/);
    expect(req.match(/<SettingsRow\b/g)?.length).toBe(2);
    expect(req).toContain('No connector requests yet · <Link href="/integrations" className="text-brand-deep hover:underline">Open Integrations</Link>');
    expect(req).toContain('No app suggestions yet · <Link href="/store" className="text-brand-deep hover:underline">Open Marketplace</Link>');
    expect(req).not.toContain("rounded-lg border");
    expect(req).not.toContain("Nobody has");
    expect(req).toContain("helper={askedByLine(names, t.count)}");
  });

  it("draws Rail apps from one grid, with no Rail hub caption and no box inside its card", () => {
    expect(page).toContain("<div className={`${RAIL_GRID} pb-1 text-sm font-medium`}>");
    expect(page).toContain("className={`${RAIL_GRID} min-h-12 border-b border-line-soft py-2 last:border-b-0");
    expect(page).not.toContain('"Rail hub"');
    expect(page).not.toMatch(/px-\[13px\]|w-\[108px\]|gap-\[108px\]/);
    const rail = page.slice(page.search(/<SettingsCard\s+id="rail"/), page.indexOf("</SettingsCard>", page.search(/<SettingsCard\s+id="rail"/)));
    expect(rail).not.toContain("rounded-lg border");
    expect(rail).toContain('<h3 className="mt-4 pb-1 text-sm font-medium text-ink">Apps inside hubs</h3>');
  });

  // The 390 shot: the card's body is 260px wide (a 294 card: 1px borders and 16px padding each side). Before, a
  // row's fixed columns alone were 394px and the switch was cut off at the card's edge. (Phase 2 review, L8: this
  // said 262, leaving out the borders.)
  it("fits a Rail apps row in a phone's 260px card body, Who can see it at its full 190px", () => {
    const grid = /const RAIL_GRID =\s*"([^"]+)"/.exec(page)?.[1] ?? "";
    const tpl = (prefix: string) => new RegExp(`${prefix}\\[grid-template-columns:([^\\]]+)\\]`).exec(grid)?.[1].split("_") ?? [];
    const desk = tpl("(?:^| )");
    const phone = tpl("max-\\[640px\\]:");
    expect(desk).toEqual(["16px", "32px", "minmax(0,1fr)", "190px", "56px", "40px"]);
    expect(phone).toHaveLength(4);
    const body = 294 - 2 * 1 - 2 * 16;
    expect(body).toBe(260);
    const gap = 12;
    const fixed = phone.filter((c) => c.endsWith("px")).reduce((n, c) => n + parseFloat(c), 0) + gap * (phone.length - 1);
    const fr = body - fixed;
    expect(fr).toBeGreaterThan(80);
    // Who can see it spans the first three columns on a phone; the switch and the arrows share the last.
    expect(page).toContain('who: "max-[640px]:col-span-3 max-[640px]:col-start-1 max-[640px]:row-start-2"');
    expect(16 + 32 + fr + gap * 2).toBeGreaterThanOrEqual(190);
    expect(parseFloat(phone[3])).toBeGreaterThanOrEqual(56);
    // And on a phone narrower still, the 190px picker gives way to its cell rather than crossing the card's edge:
    // the Picker's wrapper is max-w-full beside the row's w-[190px], and its trigger fills the wrapper.
    expect(page).toContain('className="w-[190px]"');
    const picker = read("src/components/settings/picker-select.tsx");
    expect(picker).toContain('<span ref={wrapRef} className={cn("relative inline-block max-w-full align-middle", className)}>');
    expect(picker).toMatch(/className="inline-flex h-9 w-full max-w-\[260px\] items-center/);
  });

  it("keeps the Modules description to the modules, with tiles that fit a phone", () => {
    expect(modules).toMatch(/<SettingsCard\s+id="modules"\s+title="Modules"\s+description="Premium modules extend your workspace\. Turn one on to add it to every member's rail\."/);
    expect(modules).not.toContain("/api/integrations/requests");
    expect(modules).not.toContain("/api/marketplace/requests");
    expect(modules).not.toMatch(/connector|suggestion/i);
    expect(modules.match(/minmax\(min\(300px,100%\),1fr\)/g)).toHaveLength(2);
    expect(modules).not.toContain("minmax(300px,1fr)");
    // On a phone's tile the plan chip wraps under the module's name instead of cutting it to "Ta...".
    const card = code(read("src/components/modules/module-card.tsx"));
    expect(card).toContain('<div className="flex flex-wrap items-center gap-x-2 gap-y-1">\n            <h3 className="flex-1 text-lg font-semibold text-ink">{m.label}</h3>');
    expect(card).not.toMatch(/<h3 className="[^"]*truncate/);
  });

  it("gives Automations its own card title, its three links as the card's actions", () => {
    const auto = page.slice(page.indexOf("function AutomationsCard("), page.indexOf("function RequestsSection("));
    expect(auto).toMatch(/<SettingsCard\s+id="apps\.automations"\s+title="Automations"\s+actions=\{/);
    for (const href of ["/automation/health", "/automation/usage", "/automation/logs"]) expect(auto).toContain(`href="${href}"`);
    expect(auto.indexOf('href="/automation/logs"')).toBeLessThan(auto.indexOf("<SettingsRow"));
  });

  it("keeps every anchor: #modules, #rail, #requests, #apps.automations, #ai-google, #ai-browser, #ai-apps", () => {
    expect(modules).toContain('id="modules"');
    expect(page).toMatch(/<SettingsCard\s+id="rail"/);
    expect(page).toContain('<SettingsSection id="requests"');
    expect(page).toContain('id="apps.automations"');
    expect(google).toContain('<SettingsCard id="ai-google"');
    expect(browser).toContain('<SettingsCard id="ai-browser"');
    expect(mcp).toContain('<SettingsCard id="ai-apps"');
  });
});

// The anchor hold: the AI cards each draw only once their answer comes, and the Modules tiles once theirs do, so a
// card landed on by its hash was pushed down after landing (the probe's first run: #rail pushed 1,900px down).
// Its behaviour is run for real in settings-card-hold.test.ts (Phase 2 review, L8); here, that SettingsCard runs it.
describe("an anchor lands on its card while the cards above it still load", () => {
  const card = code(read("src/components/settings/settings-card.tsx"));

  it("runs landOnHash for its id, the effect's cleanup ending the hold at unmount", () => {
    expect(card).toMatch(/useEffect\(\(\) => \{\s*if \(!id \|\| typeof window === "undefined"\) return;\s*return landOnHash\(id, setPulse\);\s*\}, \[id\]\);/);
    expect(card).toContain("export function keepInView(el: HTMLElement): () => void {");
    expect(card).toContain("export function landOnHash(id: string, pulse: (on: boolean) => void): () => void {");
  });
});

describe("Apps & modules: long help behind Show more (B6)", () => {
  const descriptions = [
    ...[page, modules].flatMap((c) => [...c.matchAll(/\bdescription="([^"]+)"/g)].map((m) => m[1])),
    MCP_SETTINGS_COPY.intro,
    BROWSER_POLICY_COPY.intro,
    CONNECTOR_POLICY_COPY.intro,
  ];
  const hints = [MCP_SETTINGS_COPY.allowedHint, MCP_SETTINGS_COPY.switchHint, BROWSER_POLICY_COPY.allowHint, BROWSER_POLICY_COPY.blockHint, SKILL_POLICY_COPY.switchHint];

  it("shows each hint in one line and each card description in at most two", () => {
    expect(descriptions.length).toBeGreaterThanOrEqual(7);
    for (const d of descriptions) expect(d.length, d).toBeLessThanOrEqual(TWO_LINES);
    for (const h of hints) expect(h.length, h).toBeLessThanOrEqual(ONE_LINE);
  });

  it("draws the rest behind the shared Show more, in place", () => {
    expect(mcp).toContain("more={C.allowedMore}");
    expect(browser).toContain("more={planLine ? undefined : P.introMore}");
    expect(browser).toContain("more={K.switchMore}");
    expect(browser).toContain("more={P.allowMore}");
    expect(google).toContain("more={P.introMore}");
    expect(page).toMatch(/<SettingsCard\s+id="rail"[\s\S]*?more=\{/);
    expect(chips).toContain("{more ? <SettingsMore className=\"mt-0.5\">{more}</SettingsMore> : null}");
  });

  // Phase 2 review, M1: these switches turn on with no confirm, so what each one sends where, and what the
  // pictures can show, stays visible; the rest is behind Show more. Each split keeps every word, and is held here in
  // the order the page shows it: the description or hint, then what Show more opens.
  it("keeps every privacy sentence visible, and splits each sentence the reviews settled without losing a word", () => {
    expect(`${CONNECTOR_POLICY_COPY.intro} ${CONNECTOR_POLICY_COPY.introMore}`).toBe(
      "People connect their own Google account, and only their own chats and routines with the teammates they allow use it. What a teammate reads goes to the AI provider to answer them. Sending an email, replying, or inviting anyone always asks them first.",
    );
    expect(CONNECTOR_POLICY_COPY.intro).toContain("What a teammate reads goes to the AI provider to answer them.");
    expect(`${BROWSER_POLICY_COPY.intro} ${BROWSER_POLICY_COPY.introMore}`).toBe(
      "Teammates can open and read web pages for the person using them, in that person's own chats. What a teammate reads on a page goes to the AI provider to answer them. Every click, every word typed and every choice waits for that person's approval. Each browser runs on a WorkwrK server for one chat, and is deleted when it closes.",
    );
    expect(BROWSER_POLICY_COPY.intro).toContain("What a teammate reads on a page goes to the AI provider to answer them.");
    expect(`${SKILL_POLICY_COPY.switchHint} ${SKILL_POLICY_COPY.switchMore}`).toBe(
      "Pictures of the pages, which can show what they typed or chose, are kept for them alone for 24 hours. People record a job once in their teammate's browser and review the steps it keeps: the pages, the words on the buttons and links they click, and which fields and lists they use, never what they type or choose. Each skill is that person's alone. Off until you turn it on.",
    );
    expect(SKILL_POLICY_COPY.switchHint).toBe("Pictures of the pages, which can show what they typed or chose, are kept for them alone for 24 hours.");
    for (const more of [CONNECTOR_POLICY_COPY.introMore, BROWSER_POLICY_COPY.introMore, SKILL_POLICY_COPY.switchMore]) {
      expect(more).not.toMatch(/AI provider|[Pp]ictures/);
    }
    // The visible part is what each card and row draws in sight: the description, the hint.
    expect(google).toContain("description={P.intro} more={P.introMore}");
    expect(browser).toContain("description={planLine ? undefined : P.intro} more={planLine ? undefined : P.introMore}");
    expect(browser).toMatch(/label=\{K\.switchLabel\}\s*helper=\{K\.switchHint\}\s*more=\{K\.switchMore\}/);
    expect(`${BROWSER_POLICY_COPY.allowHint} ${BROWSER_POLICY_COPY.allowMore}`).toBe(
      "Only these sites, and of them only the ones each teammate's managers pick. Add a site like example.com, which includes www. Add *.example.com for every part of it. Pages still load their pictures and scripts from wherever they do, as in your own browser.",
    );
  });
});

describe("Overview", () => {
  const tile = overview.slice(overview.indexOf("function OverviewTile("));

  it("lines the tile's two values up with its title, beside the icon", () => {
    expect(tile).toContain('className="flex min-h-[132px] items-start gap-3 rounded-lg border border-line bg-raised p-4 transition-colors hover:bg-hover"');
    const column = tile.indexOf('<div className="flex min-w-0 flex-1 flex-col self-stretch">');
    expect(column).toBeGreaterThan(tile.indexOf("<Icon "));
    expect(tile.indexOf("{page.label}")).toBeGreaterThan(column);
    expect(tile.indexOf('<div className="mt-auto flex flex-col gap-0.5 pt-3 text-base text-ink">')).toBeGreaterThan(tile.indexOf("{page.summary}"));
    // The values close inside the column: the tile ends with the column's and the link's own closings.
    expect(tile).toMatch(/\) : null\}\s*<\/div>\s*<\/div>\s*<\/Link>/);
  });

  it("puts All settings on the search row, not as a tile alone under Billing", () => {
    expect(overview).toContain('<Link href={SETTINGS_PAGES.all.href} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">{SETTINGS_PAGES.all.label}</Link>');
    expect(overview).not.toContain("countAll");
    expect(overview).not.toContain('aria-label="More"');
    expect(overview).not.toContain('href="/settings/all"');
    // Only grouped pages are tiles, so every Workspace page but the two ungrouped rows has a group the grid draws.
    for (const p of SETTINGS_PAGE_LIST.filter((x) => x.door === "workspace")) {
      if (p.key === "overview" || p.key === "all") expect(p.group, p.key).toBeUndefined();
      else expect(WORKSPACE_GROUP_ORDER, p.key).toContain(p.group);
    }
  });

  it("ends the crumb with Overview on the Overview, as on every other page", () => {
    expect(shell).not.toContain('current.key !== "overview"');
    expect(shell).toMatch(/\} else if \(current\) \{\s+(\/\/[^\n]*\s+)*const extra = ALSO_ACTIVE_CRUMBS/);
  });
});

describe("Phase 2 review fixes (settings-p2-review.md)", () => {
  // M3: the Google card drew a skeleton while it loaded, then nothing where Google is not offered, so the card and
  // the page's AI label flashed. It now draws nothing before its first answer, as the computer's and AI apps' do.
  it("M3: the Google card draws nothing before its first answer, so no card flashes first", () => {
    const fn = google.slice(google.indexOf("export function TeammateGoogleSection("));
    expect(fn).toContain('if (r.status === 403 || r.status === 404) { setState("hidden"); return; }');
    const hidden = fn.indexOf('if (state === "hidden" || !view) return null;');
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(fn.indexOf('<SettingsCard id="ai-google"'));
    expect(fn.indexOf("if (!view.available) return null;")).toBeLessThan(fn.indexOf('<SettingsCard id="ai-google"'));
    expect(google).not.toContain("SkeletonRows");
    expect(google).not.toContain("<SettingsSection");
  });

  // L6: the region and the skills count were loose lines in the computer's card.
  it("L6: the region is the browser switch's hint, and the skills count a row with Delete every skill as its control", () => {
    expect(browser).not.toMatch(/<p className="[^"]*">\{P\.regionLine\(view\.region\)\}<\/p>/);
    expect(browser).toMatch(/<SettingsRow\s+label=\{P\.switchLabel\}\s+helper=\{view\.region \? P\.regionLine\(view\.region\) : undefined\}/);
    const kept = browser.slice(browser.indexOf("const skillsKept ="), browser.indexOf(") : null;", browser.indexOf("const skillsKept =")));
    expect(kept).toMatch(/<SettingsRow\s+label=\{K\.skillsCount\(view\.skills\.kept, view\.skills\.people\)\}\s+control=\{kept > 0 \? \(/);
    expect(kept).toMatch(/<button type="button" className=\{btn\.dangerGhost\} onClick=\{\(\) => setDeleteAllOpen\(true\)\}>\s*\{K\.deleteAll\}\s*<\/button>\s*\) : undefined\}/);
    expect(kept).not.toContain("<p ");
    // The button still opens the same confirm, unchanged.
    expect(browser).toMatch(/open=\{deleteAllOpen\}[\s\S]*?title=\{K\.deleteAllTitle\}\s*confirmLabel=\{K\.deleteAll\}\s*danger\s*busy=\{busy\}[\s\S]*?const ok = await deleteAll\(\);[\s\S]*?<p>\{K\.deleteAllBody\}<\/p>/);
  });

  // L7: one half of Requests answering 403 or 404 left the label over a single card.
  it("L7: the Requests label shows only over both cards", () => {
    const req = page.slice(page.indexOf("function RequestsSection("));
    expect(req).toContain('<SettingsSection id="requests" label="Requests" className="[&:has(section):not(:has(section~section))>h2]:hidden">');
    // The cards are its sibling sections, as in the AI group.
    expect(req.match(/<SettingsCard\b/g)).toHaveLength(2);
  });

  it("L9: the comments say what the code does now", () => {
    const rawOverview = read("src/app/(dashboard)/settings/overview-client.tsx");
    expect(rawOverview).not.toContain('"See all settings"');
    expect(rawOverview).toContain("the All settings\n//      link (SETTINGS_PAGES.all.label)");
    const disclosed = read("src/lib/browser/disclosed.ts");
    expect(disclosed).toContain("BROWSER_POLICY_COPY introMore");
    expect(disclosed).not.toContain("BROWSER_POLICY_COPY intro and");
  });

  // L10: Marketplace draws the same ModuleCard tiles as Modules, and its fixed 300px minimum crossed a narrow phone.
  it("L10: Marketplace's tiles fit a phone, as the Modules card's do", () => {
    const store = code(read("src/app/(dashboard)/store/page.tsx"));
    expect(store.match(/minmax\(min\(300px,100%\),1fr\)/g)).toHaveLength(2);
    expect(store).not.toContain("minmax(300px,1fr)");
  });
});
