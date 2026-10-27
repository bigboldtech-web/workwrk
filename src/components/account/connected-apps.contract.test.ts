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
const securityPage = read("src/app/(dashboard)/account/security/page.tsx");
const logoutDialog = read("src/components/account/sign-out-everywhere-dialog.tsx");

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
    const hidden = c.indexOf('if (state === "hidden") return null;');
    expect(hidden).toBeGreaterThan(0);
    // Nothing while it loads; a first read that failed draws the title with
    // the error and Try again, never nothing (final Settings review, L4).
    expect(c).toMatch(/if \(!view\) \{\s+return state === "error" \? \(\s+<SettingsCard id="ai-apps" title=\{C\.title\}>\s+<ErrorState compact what=\{C\.errorWhat\}[^]*?\) : null;\s+\}/);
    // Settings clean-up Phase 2 (B3): the section draws its card alone, under
    // the page's one AI label, so no "AI apps (MCP)" label repeats the card's
    // title; the hidden check must still come before the card.
    expect(hidden).toBeLessThan(c.indexOf('<SettingsCard id="ai-apps"'));
    expect(c).not.toContain("<SettingsSection");
    expect(c).not.toContain("SkeletonRows");
  });

  it("names its workspace in every write, and reloads on workspace_changed", () => {
    const w = writes(section);
    expect(w).toHaveLength(2);
    for (const call of w) expect(call).toContain("organizationId: shownIn");
    expect(c).toMatch(/if \(r\.code === "workspace_changed"\) window\.location\.reload\(\);/);
    expect(c).toMatch(/if \(r\.code === "workspace_changed"\) \{ refused\(r\); return r\.error; \}/);
  });

  // Review of step 4, L3: shownIn was the latest answer's workspace, so a focus reload after a switch in another
  // tab drew the other workspace's switch and sent its id, and workspace_changed never fired. It is now the first
  // answer's, and a later answer for another workspace reloads the page. Fails on eb8a880b.
  it("pins the workspace to its first answer, and reloads the page when a later read answers another", () => {
    expect(c).not.toContain("const shownIn = view?.organizationId");
    expect(c).toContain('const [shownIn, setShownIn] = useState("");');
    expect(c).toMatch(
      /if \(pinned\.current === null\) \{\s*pinned\.current = r\.data\.organizationId;\s*setShownIn\(r\.data\.organizationId\);\s*\} else if \(r\.data\.organizationId !== pinned\.current\) \{\s*window\.location\.reload\(\);\s*return;\s*\}\s*setView\(r\.data\);/,
    );
    // The focus reload goes through the same read.
    expect(c).toMatch(/const onFocus = \(\) => \{ void load\(\); \};/);
    // Only a write's own answer (the route refuses another workspace) is drawn without that check.
    expect(c.match(/setView\(/g)).toHaveLength(3);
  });

  it("asks before turning off, naming how many connections it ends, and can always go off though not on while AI is off or the workspace closed", () => {
    expect(c).toContain("else setTurningOff(true);");
    expect(c).toMatch(/open=\{turningOff\}[\s\S]*?title=\{C\.turnOffTitle\}[\s\S]*?const ok = await setEnabled\(false\);[\s\S]*?<p>\{C\.turnOffBody\(view\.connections\)\}<\/p>/);
    expect(c).toContain("const canTurnOn = !view.aiOff && view.workspaceOpen;");
    expect(c).toContain("disabled={saving || (!view.enabled && !canTurnOn)}");
    expect(c).toContain("const why = view.aiOff ? (view.enabled ? C.aiOffWhileOn : C.aiOff) : !view.workspaceOpen ? MCP_POLICY_COPY.workspaceClosed : null;");
  });

  // Review of step 4, L2: each change sent the whole list, built from a read a moment before, so two Admins at
  // once lost one change. Now one app added or taken away, which the route applies under its lock. Fails on
  // eb8a880b: the section sent allowedApps.
  it("draws Allowed apps with the shared chip list, each change one app added or taken away", () => {
    // Settings clean-up Phase 2 (B6): the hint is one line, and which site to add for which app is behind Show more.
    expect(c).toContain('<SiteChips list="apps" heading={C.allowedHeading} hint={C.allowedHint} more={C.allowedMore} sites={view.allowedApps} onChange={changeApp} words={CHIP_WORDS} />');
    expect(c).toContain('json: "add" in change ? { organizationId: shownIn, addApp: change.add } : { organizationId: shownIn, removeApp: change.remove },');
    expect(c).not.toContain("allowedApps: next");
    // No read before the write: the list the change is applied to is the route's, under its lock.
    const body = c.slice(c.indexOf("const changeApp = useCallback("), c.indexOf("// Drawn only once its answer is known"));
    expect(body.match(/apiFetch</g)).toHaveLength(1);
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
    // Settings clean-up Phase 2 (B6): the allow list's hint is one line, the rest behind Show more.
    expect(code(browserSection)).toContain('<SiteChips list="allow" heading={P.allowHeading} hint={P.allowHint} more={P.allowMore} sites={view.allowSites} onChange={changeSite} words={P} />');
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
    // Settings clean-up Phase 3: the card is the shared SettingsCard now (it draws the <section>); the hidden check
    // still comes before it, and it is the card's only return of markup.
    const cardAt = c.indexOf("<SettingsCard id={ANCHOR}");
    expect(cardAt).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(cardAt);
    expect(c.match(/<SettingsCard\b/g)).toHaveLength(1);
  });

  it("names each app with a capital first letter and Not checked by WorkwrK, where it works and with what access, when connected and last used", () => {
    expect(c).toContain("const label = capitalFirst(a.app);");
    // Settings clean-up Phase 3: the "Not checked by WorkwrK" chip is the shared neutral label chip beside the name.
    expect(c).toMatch(/\{label\}\s*<span className=\{TAG\}>\{C\.notChecked\}<\/span>/);
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

  // Found by the live proof (connections-disconnect-confirm.png): the confirm
  // read "Disconnect An app on this computer?", the row's capital carried into
  // the middle of a sentence. The label goes in as frozen; the row and the
  // toast, which lead with it, keep the capital. Fails on 66d3ff1a.
  it("names the app in the Disconnect confirm as frozen, mid-sentence, and with a capital only where it leads", () => {
    expect(c).toContain('title={C.disconnectTitle(confirm ? confirm.app : "")}');
    expect(c).not.toContain("C.disconnectTitle(confirm ? capitalFirst(confirm.app)");
    expect(c).toContain("toast(C.disconnectedToast(capitalFirst(app.app)));");
  });

  it("says when none is connected and how to connect one, and that a plain log out keeps them connected", () => {
    expect(c).toContain("{C.none}");
    expect(c).toContain("{C.howTo}");
    expect(c).toContain("C.howToLine(view.address)");
    expect(c).toContain("{C.logoutNote}");
    // Settings clean-up Phase 3 (B6): the how-to steps are behind Show more, under the "No AI apps connected" line;
    // the logout note is a consequence, so it is never behind it.
    const more = c.slice(c.indexOf("<SettingsMore"), c.indexOf("</SettingsMore>"));
    expect(c.indexOf("{C.none}")).toBeLessThan(c.indexOf("<SettingsMore"));
    expect(more).toContain("{C.howTo}");
    expect(more).toContain("C.howToLine(view.address)");
    expect(more).not.toContain("C.logoutNote");
    expect(c.indexOf("{C.logoutNote}")).toBeGreaterThan(c.indexOf("</SettingsMore>"));
  });

  // L3 (review of step 4): the card is the person's own, in every workspace, so no workspace is pinned and a
  // switch in another tab changes nothing it draws or does (a guard: true before too).
  it("names no workspace in its reads or its Disconnect", () => {
    expect(c).not.toContain("organizationId");
    expect(c).not.toContain("workspace_changed");
  });

  it("is mounted after the Google card, anchored #ai-apps, where the Inbox notices link", () => {
    expect(connectionsPage.indexOf("<ConnectedAppsCard />")).toBeGreaterThan(connectionsPage.indexOf("<TeammateGoogleCard outcome={aiOutcome} />"));
    expect(c).toContain('const ANCHOR = "ai-apps";');
    expect(c).toContain("<SettingsCard id={ANCHOR} title={C.title} description={C.intro}>");
    expect(read("src/lib/oauth/grants.ts")).toContain('export const CONNECTED_APPS_HREF = "/account/connections#ai-apps";');
  });
});

// docs/plans/mcp-server.md 11.2 (step 4 departure 5): "Log out everywhere" on My settings, Security, its hint and
// its confirm, say it also disconnects the person's AI apps, and only where this WorkwrK offers them, learnt from
// the connected-apps route (200 offered, 404 not), so no one is told of a hidden feature. The words are
// mcp-copy.ts's. Fails on eb8a880b: neither said so.
describe("My settings, Security, Log out everywhere (11.2)", () => {
  const page = code(securityPage);
  const dialog = code(logoutDialog);

  it("learns whether AI apps are offered from the connected-apps route's 200, false until then and on any failure", () => {
    const src = code(card);
    const hook = src.slice(src.indexOf("export function useAiAppsOffered(): boolean {"), src.indexOf("export function ConnectedAppsCard() {"));
    expect(hook.length).toBeGreaterThan(0);
    expect(hook).toContain("const [offered, setOffered] = useState(false);");
    expect(hook).toContain("void apiFetch<ConnectedAppsView>(ROUTE, { cache: \"no-store\" }).then((r) => {");
    expect(hook).toContain("if (live) setOffered(r.ok);");
    expect(card).toContain('const ROUTE = "/api/me/connected-apps";');
  });

  it("adds the clause to the row's hint and the confirm only when they are offered", () => {
    expect(securityPage).toContain('import { useAiAppsOffered } from "@/components/account/connected-apps-card";');
    expect(securityPage).toContain('import { MCP_LOGOUT_COPY } from "@/lib/mcp/mcp-copy";');
    expect(page).toContain("const appsOffered = useAiAppsOffered();");
    expect(page).toContain("helper={`Ends every session, on every device, including this one${appsOffered ? `, ${MCP_LOGOUT_COPY.alsoDisconnects}` : \"\"}`}");
    expect(page).toContain("<SignOutEverywhereDialog open={logoutAllOpen} onOpenChange={setLogoutAllOpen} disconnectsApps={appsOffered} />");
    expect(logoutDialog).toContain('import { MCP_LOGOUT_COPY } from "@/lib/mcp/mcp-copy";');
    expect(dialog).toContain("disconnectsApps = false");
    expect(dialog).toContain("This logs you out on every device, including this one{disconnectsApps ? `, ${MCP_LOGOUT_COPY.alsoDisconnects}` : \"\"}. Other devices are logged out within 5 minutes.");
    // Never typed in where it would show regardless.
    for (const src of [page, dialog]) expect(src).not.toContain("disconnects your AI apps");
  });
});
