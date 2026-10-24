// Settings clean-up Phase 3 (docs/plans/settings-cleanup.md D Phase 3, B3 to
// B6, B9, B10, B12): My settings, held by reading the components as written
// for the states a first render cannot reach (a connected Google account, an
// AI app with changes, a muted Space, the two step verification menu open).
// What a first render can show is rendered in settings-phase3.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTIONS_COPY, SKILLS_COPY } from "@/lib/agents/teammate-copy";
import { MCP_CONNECTED_COPY, MCP_LOGOUT_COPY } from "@/lib/mcp/mcp-copy";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** The source without its comments, so a rule is held by the code, not by what a comment says. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const ACCOUNT = "src/app/(dashboard)/account/";
const PAGES = ["profile", "preferences", "notifications", "security", "connections", "shortcuts", "all"] as const;
const page = Object.fromEntries(PAGES.map((p) => [p, code(read(`${ACCOUNT}${p}/page.tsx`))])) as Record<(typeof PAGES)[number], string>;
const apps = code(read("src/components/account/connected-apps-card.tsx"));
const google = code(read("src/components/account/teammate-google-card.tsx"));
const skills = code(read("src/components/account/teammate-skills-list.tsx"));
const everything = [...Object.values(page), apps, google, skills];

/** One 13px line of a hint across a 760 card's body, and two for a card's description (Phase 2's measure). */
const ONE_LINE = 110;
const TWO_LINES = 220;

describe("every My settings page is SettingsCards and SettingsRows only (B4, B5)", () => {
  it("draws no hand-built box: no bordered div, no cxn card, no list box inside a card", () => {
    for (const src of everything) {
      expect(src).not.toMatch(/className="[^"]*\brounded-(md|lg)\b[^"]*\bborder\b[^"]*\bborder-line\b[^"]*"[^>]*>\s*<SkeletonRows/);
      expect(src).not.toMatch(/<div className="w-full rounded-lg border/);
      expect(src).not.toContain("cxn__");
      expect(src).not.toMatch(/<ul className="[^"]*\bborder\b/);
    }
    // The connections styles went with the markup.
    expect(read("src/app/(dashboard)/os.css")).not.toMatch(/\.cxn\b/);
  });

  it("passes no card the dead `wide` prop any more (C3 said it goes with its callers)", () => {
    for (const src of everything) expect(src).not.toMatch(/<SettingsCard\b[^>]*\bwide=/);
  });

  it("keeps every hint to one line and every card description to two", () => {
    const literals = everything.flatMap((s) => [...s.matchAll(/\b(helper|description)="([^"]+)"/g)].map((m) => [m[1], m[2]] as const));
    expect(literals.length).toBeGreaterThanOrEqual(25);
    for (const [kind, t] of literals) expect(t.length, t).toBeLessThanOrEqual(kind === "helper" ? ONE_LINE : TWO_LINES);
    for (const d of [CONNECTIONS_COPY.blurb, MCP_CONNECTED_COPY.intro]) expect(d.length, d).toBeLessThanOrEqual(TWO_LINES);
    for (const t of [CONNECTIONS_COPY.gmailHint, CONNECTIONS_COPY.calendarHint, SKILLS_COPY.accountHint]) expect(t.length, t).toBeLessThanOrEqual(ONE_LINE);
    expect(`Ends every session, on every device, including this one, ${MCP_LOGOUT_COPY.alsoDisconnects}`.length).toBeLessThanOrEqual(ONE_LINE);
  });
});

describe("Calendar & connections: the AI apps card", () => {
  it("draws each app as a SettingsRow: name and chip, where it works as the hint, Disconnect as the control, dates and changes as detail lines", () => {
    const row = apps.slice(apps.indexOf("<SettingsRow"), apps.indexOf("</SettingsRow>"));
    expect(row).toMatch(/helper=\{C\.where\(workspace, a\.access === "write"\)\}/);
    expect(row).toMatch(/control=\{\s*<button type="button" className=\{btn\.dangerGhost\} onClick=\{\(\) => setConfirm\(a\)\} disabled=\{busy\}>/);
    // The dates, the hold lines and Show changes are the row's own lines, after the control.
    const control = row.indexOf("control=");
    for (const needle of ["C.connected(", "C.aiOff(workspace)", "MCP_TOOL_COPY.errors.holdMfa", "{shown ? C.hideChanges : C.showChanges}", "C.changesNewest("]) {
      expect(row.indexOf(needle), needle).toBeGreaterThan(control);
    }
    expect(row).toContain('aria-expanded={!!shown}');
    // A stable hook for the live proof (scripts/live-proof-mcp.ts finds a row by its label).
    expect(row).toContain('data-ai-app-label=""');
    expect(code(read("scripts/live-proof-mcp.ts"))).toContain('querySelectorAll("[data-settings-row]")');
    expect(read("src/components/settings/settings-row.tsx")).toContain('data-settings-row=""');
  });

  it("lands on #ai-apps through the card's own landing, which honours reduced motion, never a hand-made smooth scroll", () => {
    expect(apps).not.toContain("scrollIntoView");
    expect(apps).not.toContain("useRef");
    expect(apps).toContain("<SettingsCard id={ANCHOR}");
  });
});

describe("Calendar & connections: Google for your AI teammates", () => {
  it("draws nothing while the first read is out, and its error in the card, titled", () => {
    expect(google).not.toContain("C.loading");
    const error = google.indexOf("if (loadError) {");
    const none = google.indexOf("if (!view) return null;");
    expect(error).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(error);
    expect(google.slice(error, none)).toMatch(/<SettingsCard id="ai-google" title=\{C\.cardTitle\}>[\s\S]*?\{C\.loadFailed\}[\s\S]*?\{C\.tryAgain\}/);
    expect(google).toContain('<SettingsCard id="ai-google" title={C.cardTitle} description={C.blurb}>');
    expect(google).not.toContain("scrollIntoView");
  });

  it("offers the products as switch rows, never native checkboxes, each hint (what sending asks first) in sight", () => {
    expect(google).not.toMatch(/type="checkbox"/);
    const pick = google.slice(google.indexOf('id="ai-google-pick"'), google.indexOf("{C.connect}"));
    expect(pick).toContain('role="group" aria-labelledby="ai-google-pick"');
    expect(pick).toMatch(/<SettingsRow\s+key=\{p\}\s+label=\{productWord\(p\)\}\s+helper=\{p === "gmail" \? C\.gmailHint : C\.calendarHint\}\s+control=\{\s*<Switch\s+checked=\{choice\.includes\(p\)\}/);
    expect(pick).not.toContain("SettingsMore");
    // With nothing picked Connect is a real disabled button, not a span that looked live.
    expect(google).toMatch(/<button type="button" className=\{btn\.secondary\} disabled>\s*<Link2 [^>]*\/> \{C\.connect\}/);
  });

  it("puts Disconnect on the connection's row, behind the same confirm, and each allow on a switch row", () => {
    expect(google).toMatch(/<SettingsRow\s+label=\{C\.connectedAs\(connection\.accountEmail, fmt\.date\(connection\.connectedAt, "date"\)\)\}[\s\S]*?control=\{\s*<button type="button" className=\{btn\.dangerGhost\} onClick=\{\(\) => setConfirmOpen\(true\)\} disabled=\{busy === "disconnect"\}>/);
    expect(google).toMatch(/open=\{confirmOpen\}[\s\S]*?title=\{C\.disconnectTitle\}[\s\S]*?onConfirm=\{disconnect\}[\s\S]*?<p>\{C\.disconnectBody\}<\/p>/);
    expect(google).toMatch(/<Switch\s+checked=\{t\.allowed\[p\]\}\s+disabled=\{busy === `allow:\$\{t\.slug\}` \|\| needsAdd\}\s+onChange=\{\(next\) => \{ void setAllow\(t, \{ \[p\]: next \}\); \}\}/);
    expect(google).toMatch(/<SettingsRow\s+label=\{C\.changedSince\(titleList\(changedParts, changedParts\.length\)\)\}/);
    // The connect outcome and a stopped connection are lines, never a box.
    expect(google).toContain('<OutcomeLine tone="bad" role="status">');
  });
});

describe("Calendar & connections: Google Calendar and the feed", () => {
  const c = page.connections;

  it("draws each calendar as a SettingsRow with its two labelled switches, and Disconnect on the connected row", () => {
    expect(c).toMatch(/<SettingsRow\s+key=\{cal\.id\}/);
    expect(c).toContain("aria-labelledby={`cal-in-${cal.id}`}");
    expect(c).toContain("aria-labelledby={`cal-titles-${cal.id}`}");
    expect(c).toMatch(/control=\{\s*<button type="button" className=\{btn\.dangerGhost\} onClick=\{\(\) => \{ void disconnectGoogle\(\); \}\} disabled=\{busy === "google"\}>/);
    // Set semantics kept: every change still sends the whole set.
    expect(c).toContain('.filter((s) => s.externalCalendarId)');
  });

  it("keeps the feed's who-can-read-it sentence in sight under the link, and its empty state one inline row", () => {
    const feed = c.slice(c.indexOf('id="connections.feed"'));
    expect(feed).toContain("Anyone with this link can read your schedule. Replace it if you shared it by mistake.");
    expect(feed.slice(0, feed.indexOf("Anyone with this link"))).not.toContain("SettingsMore");
    expect(feed).toMatch(/<TextInput id="connections-feed-url" readOnly value=\{feed\.url\}/);
    expect(feed).toMatch(/No feed link yet ·\{" "\}\s*<button type="button"/);
    // One blue button on the page, Connect Google Calendar.
    expect(c.match(/btn\.primary/g)).toHaveLength(1);
  });
});

describe("Notifications", () => {
  const n = page.notifications;

  it("picks a custom mute time on the shared date and time pickers, never a native date field (B9)", () => {
    expect(n).not.toContain('type="datetime-local"');
    expect(n).toMatch(/<DateTimeField label="Mute until" value=\{custom\} onChange=\{\(next\) => \{ setCustom\(next\); setCustomValid\(Date\.parse\(next\) > Date\.now\(\)\); \}\}/);
    // The Mute button and the future-only rule are unchanged.
    expect(n).toContain("disabled={!custom || !customValid}");
  });

  it("draws Muted items as SettingsRows, their kind the hint and Unmute the control", () => {
    const muted = n.slice(n.indexOf("function MutedItemsCard("), n.indexOf("function EmailTab("));
    expect(muted).toMatch(/<SettingsRow\s+key=\{m\.key\}\s+label=\{m\.href \? <Link href=\{m\.href\} className="hover:underline">\{m\.name\}<\/Link> : m\.name\}\s+helper=\{m\.kind\}/);
    expect(muted).not.toContain("<li");
    expect(muted).toContain('<p className="m-0 text-base text-ink-2">Nothing muted · Mute a Space, List or channel from its ••• menu</p>');
  });

  it("keeps a report's hint one line, and what happens while it can't be opened a detail line in sight", () => {
    const reports = n.slice(n.indexOf("function ReceivedReports("));
    expect(reports).toContain('helper={[when, sender ? `from ${sender}` : "", next].filter(Boolean).join(" · ")}');
    // (A stripped comment leaves its braces behind.)
    expect(reports).toMatch(/>\s*(\{\}\s*)?\{!readable \? <p className="m-0">Nothing is sent to you while you can&apos;t open it\. If your access comes back, it starts again\.<\/p> : null\}\s*<\/SettingsRow>/);
    expect(reports).not.toContain('<span className="block">');
  });

  it("keeps the deleted-for-good sentence as the hint and the rest behind Show more", () => {
    expect(n).toMatch(/label="Delete cleared items after"\s+helper="Notifications you have cleared are deleted for good this many days after you cleared them\."\s+more="Read items stay until you clear them\."/);
  });
});

describe("Security", () => {
  const s = page.security;

  it("makes the two step verification menu a popover layer, opening from the button's left edge on a phone", () => {
    expect(s).toContain('useLayer(menuOpen, { kind: "popover", close: closeMenu });');
    expect(s).toMatch(/<div role="menu" aria-label="Two step verification options" className="absolute end-0 top-9 [^"]*max-\[640px\]:end-auto max-\[640px\]:start-0">/);
  });

  it("hands focus back to the menu's button before a choice opens its dialog, so the dialog returns it there", () => {
    expect(s).toMatch(/const closeMenu = useCallback\(\(\) => \{\s*setMenuOpen\(false\);\s*menuButton\.current\?\.focus\(\{ preventScroll: true \}\);\s*\}, \[\]\);/);
    expect(s).toContain("<button\n                      ref={menuButton}");
    for (const opens of ['setCodesOpen("read")', 'setCodesOpen("new")', "setDisableOpen(true)"]) {
      expect(s, opens).toContain(`onClick={() => { closeMenu(); ${opens}; }}`);
    }
    expect(s).not.toContain("setMenuOpen(false); setCodesOpen");
  });

  // The 390 shot: the activity table kept its 480px minimum, so When was past the card's edge on a phone.
  it("fits the activity table's three columns in a phone's card, a long address wrapping in its cell", () => {
    expect(s).toContain('<table className="w-full min-w-[480px] border-collapse text-base max-[640px]:min-w-0">');
    expect(s).toContain('<td className="px-2 text-ink-2 [overflow-wrap:anywhere]">{e.ipAddress || "Unknown"}</td>');
  });

  it("keeps Log out everywhere, its MCP clause only when offered, and its dialog", () => {
    expect(s).toContain("helper={`Ends every session, on every device, including this one${appsOffered ? `, ${MCP_LOGOUT_COPY.alsoDisconnects}` : \"\"}`}");
    expect(s).toContain("<SignOutEverywhereDialog open={logoutAllOpen} onOpenChange={setLogoutAllOpen} disconnectsApps={appsOffered} />");
  });
});

describe("Profile", () => {
  it("keeps the delete confirm exactly, opened from the danger zone's row", () => {
    const p = page.profile;
    expect(p).toContain('control={<button type="button" className={btn.dangerGhost} onClick={() => setDeleteOpen(true)}>Delete my account</button>}');
    expect(p).toMatch(/<DeleteAccountDialog\s+open=\{deleteOpen\}\s+onOpenChange=\{setDeleteOpen\}\s+isLastOwner=\{me\.isLastAdmin\}\s+orgName=\{me\.organization\.name\}\s+canOpenMembers=\{isAdmin\}\s+\/>/);
  });

  // Logged, not changed (plan D Phase 3): DateField has no typed entry, only a month grid with Previous and Next.
  it("leaves Date of birth on the browser's date field while DateField cannot take a typed date", () => {
    expect(code(read("src/components/ui/date-field.tsx"))).not.toMatch(/<input\b/);
    expect(page.profile).toContain('<TextInput id="pf-dob" type="date"');
  });
});

describe("Profile: the skills list in Your data", () => {
  it("draws each skill as a SettingsRow under a 13/500 sub-heading, its deletion date a line in sight", () => {
    expect(skills).toContain('<h3 className="m-0 text-sm font-medium text-ink">{S.accountHeading}</h3>');
    expect(skills).toMatch(/<SettingsRow\s+key=\{s\.id\}/);
    expect(skills).toContain('{s.deletesOn ? <p className="m-0">{S.deletesOnLine(formatDate(s.deletesOn, datePrefs, "date"))}</p> : null}');
    expect(skills).not.toContain("<li");
  });
});
