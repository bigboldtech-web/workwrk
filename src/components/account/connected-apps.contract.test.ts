// The MCP server's pages (docs/plans/mcp-server.md 6.2, 6.3, step 4), held
// to their rules by reading the components as written, since the suite runs
// in node with no page (the browser UI's own method,
// src/components/agents/browser-ui.contract.test.ts): Settings, Apps &
// modules, AI apps (MCP) (settings/apps/mcp-section.tsx), the chip list it
// shares with the browser section (components/settings/site-chips.tsx),
// and My settings, Calendar & connections, AI apps
// (components/account/connected-apps-card.tsx).
//
// Each needle is a rule the spec or the brief sets: nothing drawn before the
// first answer or while MCP_OFFERED is unset, every write naming its
// workspace and reloading on workspace_changed, turning off and Disconnect
// asking first, the copy in mcp-copy.ts, no blue button, and where each is
// mounted. Fails on the code before step 4: none of the three files existed.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const section = read("src/app/(dashboard)/settings/apps/mcp-section.tsx");
const chips = read("src/components/settings/site-chips.tsx");
const card = read("src/components/account/connected-apps-card.tsx");
const appsPage = read("src/app/(dashboard)/settings/apps/page.tsx");
const browserSection = read("src/app/(dashboard)/settings/apps/teammate-browser-section.tsx");
const connectionsPage = read("src/app/(dashboard)/account/connections/page.tsx");

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

describe("no blue button, and no words typed into the markup", () => {
  for (const [name, src] of [
    ["the AI apps section", section],
    ["the chip list", chips],
    ["the AI apps on Calendar & connections", card],
  ] as const) {
    it(name, () => {
      const c = code(src);
      expect(c, name).not.toMatch(/bg-brand\b|btn\.primary|cxn__btn--primary|wa-btn--primary/);
      // Every sentence comes from the copy.
      const texts = [...c.matchAll(/>\s*([A-Za-z][^<>{};()=]*?)\s*<\//g)].map((m) => m[1].trim()).filter(Boolean);
      expect(texts, name).toEqual([]);
    });
  }

  it("the section and the card read their words from mcp-copy.ts", () => {
    expect(section).toContain('import { MCP_POLICY_COPY, MCP_SETTINGS_COPY as C } from "@/lib/mcp/mcp-copy";');
    expect(card).toContain('import { MCP_CONNECTED_COPY as C, MCP_TOOL_COPY } from "@/lib/mcp/mcp-copy";');
    // The chip list draws no sentence of its own: its words come from the section using it.
    expect(code(chips)).not.toMatch(/import[^;]*-copy"/);
    expect(code(chips)).toContain("aria-label={words.remove(site)}");
    expect(code(chips)).toContain("placeholder={words.addPlaceholder}");
  });
});

describe("Settings, Apps & modules, AI apps (MCP) (6.3)", () => {
  const c = code(section);

  it("draws nothing before its first answer, for anyone the route refuses, or while the MCP server is not offered", () => {
    expect(c).toContain('if (r.status === 403 || r.status === 404) { setState("hidden"); return; }');
    const hidden = c.indexOf('if (state === "hidden" || !view) return null;');
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(c.search(/return \(\s*<section>/));
    expect(c).not.toContain("SkeletonRows");
  });

  it("names its workspace in every write, and reloads on workspace_changed", () => {
    const w = writes(section);
    expect(w).toHaveLength(2);
    for (const call of w) expect(call).toContain("organizationId: shownIn");
    expect(c).toContain("const shownIn = view?.organizationId ?? \"\";");
    expect(c).toMatch(/if \(r\.code === "workspace_changed"\) window\.location\.reload\(\);/);
    expect(c).toMatch(/if \(r\.code === "workspace_changed"\) \{ refused\(r\); return r\.error; \}/);
  });

  it("asks before turning off, naming how many connections it ends, and can always go off though not on while AI is off or the workspace closed", () => {
    expect(c).toContain("else setTurningOff(true);");
    expect(c).toMatch(/open=\{turningOff\}[\s\S]*?title=\{C\.turnOffTitle\}[\s\S]*?const ok = await setEnabled\(false\);[\s\S]*?<p>\{C\.turnOffBody\(view\.connections\)\}<\/p>/);
    expect(c).toContain("const canTurnOn = !view.aiOff && view.workspaceOpen;");
    expect(c).toContain("disabled={saving || (!view.enabled && !canTurnOn)}");
    expect(c).toContain("const why = view.aiOff ? C.aiOff : !view.workspaceOpen ? MCP_POLICY_COPY.workspaceClosed : null;");
  });

  it("draws Allowed apps with the shared chip list, each change built from the list the route holds now", () => {
    expect(c).toContain('<SiteChips list="apps" heading={C.allowedHeading} hint={C.allowedHint} sites={view.allowedApps} onChange={changeApp} words={CHIP_WORDS} />');
    expect(c.indexOf("const now = await apiFetch<McpPolicyView>(ROUTE")).toBeLessThan(c.indexOf("json: { organizationId: shownIn, allowedApps: next }"));
    expect(c).toContain('if (r.code !== "invalid_app" && r.code !== "too_many_apps") toast(');
  });

  it("shows counts only, with the link to the Audit log's Data tab", () => {
    expect(c).toContain("C.connections(view.connections, view.people)");
    expect(c).toContain("C.today(view.today.calls, view.today.changes)");
    expect(c).toContain('const AUDIT_HREF = "/settings/audit?tab=data";');
  });

  it("is mounted after the browser section, anchored #ai-apps", () => {
    expect(appsPage.indexOf("<McpSection />")).toBeGreaterThan(appsPage.indexOf("<TeammateBrowserSection />"));
    expect(appsPage).toContain('import { McpSection } from "./mcp-section";');
    expect(c).toContain('<SettingsCard id="ai-apps" title={C.title} description={C.intro}>');
  });
});

describe("the chip list moved out of the browser section (6.3)", () => {
  it("is drawn by both sections from one module, the browser section's words passed in", () => {
    expect(code(browserSection)).not.toContain("function SiteChips(");
    expect(browserSection).toContain('import { SiteChips } from "@/components/settings/site-chips";');
    expect(code(browserSection)).toContain('<SiteChips list="allow" heading={P.allowHeading} hint={P.allowHint} sites={view.allowSites} onChange={changeSite} words={P} />');
    expect(code(browserSection)).toContain('<SiteChips list="block" heading={P.blockHeading} hint={P.blockHint} sites={view.blockSites} onChange={changeSite} words={P} />');
    expect(chips).toContain("export function SiteChips<L extends string>(");
  });
});

describe("My settings, Calendar & connections, AI apps (6.2)", () => {
  const c = code(card);

  it("draws nothing before its first answer, nor while the MCP server is not offered", () => {
    expect(c).toContain('if (r.status === 404) { setState("hidden"); return; }');
    const hidden = c.indexOf('if (state === "hidden" || !view) return null;');
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(c.indexOf("<section"));
  });

  it("names each app with a capital first letter and Not checked by WorkwrK, where it works and with what access, when connected and last used", () => {
    expect(c).toContain("const label = capitalFirst(a.app);");
    expect(c).toMatch(/\{label\}\s*<em>\{C\.notChecked\}<\/em>/);
    expect(c).toContain('C.where(workspace, a.access === "write")');
    expect(c).toContain('C.connected(fmt.date(a.connectedAt, "date"))');
    expect(c).toContain("a.lastUsedAt ? C.lastUsed(fmt.relative(a.lastUsedAt)) : C.neverUsed");
  });

  it("shows its changes from the connection's own route, and disconnects only behind its confirm", () => {
    expect(c).toContain("`${ROUTE}/${encodeURIComponent(id)}/activity`");
    expect(c).toContain("{shown ? C.hideChanges : C.showChanges}");
    const w = writes(card);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('apiFetch<{ disconnected: boolean }>(url, { method: "DELETE" })');
    expect(c).toContain("const url = `${ROUTE}/${encodeURIComponent(app.id)}`;");
    expect(c).toContain("onClick={() => setConfirm(a)}");
    expect(c).toMatch(/open=\{confirm !== null\}[\s\S]*?title=\{C\.disconnectTitle\([\s\S]*?onConfirm=\{async \(\) => \{ if \(confirm\) await disconnect\(confirm\); \}\}[\s\S]*?<p>\{C\.disconnectBody\}<\/p>/);
  });

  it("says when none is connected and how to connect one, and that a plain log out keeps them connected", () => {
    expect(c).toContain("{C.none}");
    expect(c).toContain("{C.howTo}");
    expect(c).toContain("C.howToLine(view.address)");
    expect(c).toContain("{C.logoutNote}");
  });

  it("is mounted after the Google card, anchored #ai-apps, where the Inbox notices link", () => {
    expect(connectionsPage.indexOf("<ConnectedAppsCard />")).toBeGreaterThan(connectionsPage.indexOf("<TeammateGoogleCard outcome={aiOutcome} />"));
    expect(c).toContain('const ANCHOR = "ai-apps";');
    expect(c).toContain('<section className="cxn__card" id={ANCHOR}>');
    expect(read("src/lib/oauth/grants.ts")).toContain('export const CONNECTED_APPS_HREF = "/account/connections#ai-apps";');
  });
});
