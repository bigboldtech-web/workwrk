// Settings clean-up, the final review's look and layout (workwrk-launch-backup/
// agents/settings-final-visual-review.md: H1, H2, M1 to M6, L1, L4 to L6, L10,
// L12, L13). The shared pieces are rendered to static markup and their pure
// decisions called; the pages, which need the whole app around them to
// render, are held by reading their source as written, without its comments,
// like the phase contract tests, so a rule is held by the code and not by
// what a comment says.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ query: "" }));

// SettingsPage waits for ?tab= inside a Suspense boundary; here it is a
// pass-through, so a page that cannot render fails the test instead of
// quietly drawing its fallback.
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, Suspense: ({ children }: { children?: import("react").ReactNode }) => children };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/structure",
  useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/ui/date-text", () => ({ DateText: ({ value }: { value: unknown }) => String(value) }));

import { CONTROL_GHOST_ALIGN, GHOST_END_ALIGN, GHOST_MARK, STACKED_GHOST_ALIGN, SettingsRow, inlineControl } from "./settings-row";
import { SettingsCard } from "./settings-card";
import { SettingsSection } from "./settings-section";
import { SETTINGS_MORE_LABEL } from "./settings-more";
import { SETTINGS_TOOLBAR_ROW, SettingsPage, reservedToolbarRow, tabHasToolbar, type SettingsTab } from "./settings-page";
import { NumberInput, btn } from "./settings-form";
import { GRID_LEVELS, LEVEL_WIDTH, WHAT_WIDE, permissionGridColumns } from "./permission-grid";
import { PermissionMatrixView, ROLES_LINE, RULES_LINE, SHOWN_RULES } from "./permission-matrix-view";
import { officesCsv } from "./offices-manager";
import { TableCard } from "@/components/ui/table-card";
import { Switch } from "@/components/ui/switch";
import { PROTECTED_ADMIN_ROLES } from "@/lib/permissions";
import { RELATIONSHIP_RULES, WORKSPACE_ROLES } from "@/lib/access/permission-matrix";
import { membersTabs } from "@/app/(dashboard)/settings/members/members-shared";
import { TeamsCard } from "@/app/(dashboard)/settings/members/teams-tab";
import { OrgChartCard, structureTabs } from "@/app/(dashboard)/settings/structure/structure-client";
import { ProfileFieldsCard } from "@/components/people/profile-fields-manager";
import { RecentExportsTable, TrashCard } from "@/app/(dashboard)/settings/data/data-cards";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** The source without its comments. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
/** The markup without the closed Show more bodies (hidden until opened). */
const visible = (s: string) => s.replace(/<div id="[^"]*" hidden=""[^>]*>[\s\S]*?<\/div>/g, "");
const hiddenBodies = (s: string) => (s.match(/<div id="[^"]*" hidden=""[^>]*>[\s\S]*?<\/div>/g) ?? []).join(" ");
function sectionById(s: string, id: string): string {
  const start = s.indexOf(`<section id="${id}"`);
  expect(start, id).toBeGreaterThanOrEqual(0);
  return s.slice(start, s.indexOf("</section>", start) + "</section>".length);
}
const headerOf = (card: string) => /<header\b[\s\S]*?<\/header>/.exec(card)?.[0] ?? "";
/** The classes of the first element whose opening tag matches. */
const classOf = (s: string, re: RegExp) => /class="([^"]*)"/.exec(re.exec(s)?.[0] ?? "")?.[1] ?? "";

/** One 13px line across a 760 card's 712px body, about 110 characters (the phase tests' measure). */
const ONE_LINE = 110;

const ACCESS = code(read("src/app/(dashboard)/settings/access/page.tsx"));
const LOCALE = code(read("src/app/(dashboard)/settings/locale/page.tsx"));
const MEMBERS = code(read("src/app/(dashboard)/settings/members/page.tsx"));
const TEAMS = code(read("src/app/(dashboard)/settings/members/teams-tab.tsx"));
const FIELDS = code(read("src/components/people/profile-fields-manager.tsx"));
const DATA = code(read("src/app/(dashboard)/settings/data/page.tsx"));
const MY_SECURITY = code(read("src/app/(dashboard)/account/security/page.tsx"));
const PROFILE = code(read("src/app/(dashboard)/account/profile/page.tsx"));
const PREFERENCES = code(read("src/app/(dashboard)/account/preferences/page.tsx"));
const NOTIFICATIONS = code(read("src/app/(dashboard)/account/notifications/page.tsx"));
const BILLING = code(read("src/app/(dashboard)/settings/billing/page.tsx"));
const SECURITY = code(read("src/app/(dashboard)/settings/security/page.tsx"));
const APPS = code(read("src/app/(dashboard)/settings/apps/page.tsx"));

/* ───────────── M1, L1, L12: the shared row and card ───────────── */

describe("M1: a ghost button that ends a control slot ends on the card's edge from 641px", () => {
  it("pulls forward by the ghost's own 12px padding, spelled out whole, beside the phone's start pull", () => {
    expect(GHOST_END_ALIGN).toBe(`min-[641px]:[&>.${GHOST_MARK}:last-child]:-me-3`);
    expect(CONTROL_GHOST_ALIGN.split(" ")).toEqual([STACKED_GHOST_ALIGN, GHOST_END_ALIGN]);
    expect(btn.ghost.split(" ")).toContain("px-3");
    expect(btn.dangerGhost.split(" ")).toContain("px-3");
  });

  it("the row's control slot and the card's actions slot carry both pulls", () => {
    const row = html(h(SettingsRow, { label: "Founders Day", control: h("button", { type: "button", className: btn.ghost }, "Remove") }));
    const slot = classOf(row, /<div class="[^"]*\bshrink-0\b[^"]*">/);
    expect(slot).toContain("min-[641px]:[&amp;&gt;.os-btn-ghost:last-child]:-me-3");
    expect(slot).toContain("max-[640px]:[&amp;&gt;.os-btn-ghost:first-child]:-ms-3");
    const card = html(h(SettingsCard, { title: "Design", actions: h("button", { type: "button", className: btn.ghost }, "Archive") }, "x"));
    const actions = classOf(card, /<div class="flex shrink-0 items-center gap-1[^"]*">/);
    expect(actions).toContain("min-[641px]:[&amp;&gt;.os-btn-ghost:last-child]:-me-3");
    expect(actions).toContain("max-[640px]:[&amp;&gt;.os-btn-ghost:first-child]:-ms-3");
  });
});

describe("L1: a switch stays at the right of its label on a phone; only a wide control stacks", () => {
  const lineOf = (r: string) => /<div data-settings-row=""[^>]*><div class="([^"]*)">/.exec(r)?.[1] ?? "";

  it("one Switch is the narrow control; anything else is not", () => {
    expect(inlineControl(h(Switch, { checked: true, "aria-label": "Mentions" }))).toBe(true);
    expect(inlineControl(h("button", { type: "button" }, "Go"))).toBe(false);
    expect(inlineControl(h("span", null, h(Switch, { checked: true })))).toBe(false);
    expect(inlineControl(null)).toBe(false);
  });

  it("a switch row keeps its line a row below 640px, a button row stacks, and `inline` decides when given", () => {
    const sw = html(h(SettingsRow, { label: "Mentions of me", helper: "When someone mentions you", control: h(Switch, { checked: true, "aria-label": "Mentions of me" }) }));
    expect(lineOf(sw)).toBe("flex items-center gap-4");
    expect(sw).not.toContain("max-[640px]:w-full");
    const button = html(h(SettingsRow, { label: "Export", control: h("button", { type: "button" }, "Download") }));
    expect(lineOf(button)).toContain("max-[640px]:flex-col");
    expect(lineOf(html(h(SettingsRow, { label: "A", inline: true, control: h("button", { type: "button" }, "Go") })))).not.toContain("max-[640px]:flex-col");
    expect(lineOf(html(h(SettingsRow, { label: "A", inline: false, control: h(Switch, { checked: false }) })))).toContain("max-[640px]:flex-col");
  });

  it("a locked or read-only switch row shows words in the switch's place, which stack as words do", () => {
    const control = h(Switch, { checked: true, "aria-label": "Theme" });
    expect(lineOf(html(h(SettingsRow, { label: "Theme", control, lock: { value: "Dark" } })))).toContain("max-[640px]:flex-col");
    expect(lineOf(html(h(SettingsRow, { label: "Theme", control, readOnlyValue: "On" })))).toContain("max-[640px]:flex-col");
  });
});

describe("L12: a card is no heavier under its last row than over its first", () => {
  it("the last row of a list has no bottom padding (and still no separator)", () => {
    const r = html(h(SettingsRow, { label: "A" }));
    const cls = /<div data-settings-row="" class="([^"]+)"/.exec(r)?.[1].split(" ") ?? [];
    expect(cls).toEqual(expect.arrayContaining(["py-2", "last:border-b-0", "last:pb-0"]));
  });
});

/* ───────────── M3: one toolbar row and one form of create ───────────── */

describe("M3: the first card starts at one height on every tab", () => {
  const withToolbar: SettingsTab = { key: "a", label: "A", primary: { label: "New", onClick: () => {} } };
  const plain: SettingsTab = { key: "b", label: "B" };
  const own: SettingsTab = { key: "c", label: "C", ownToolbar: true, toolbarRow: "min-h-11 max-[500px]:min-h-[88px]" };

  it("a tab has a toolbar when it carries a primary, a menu, Filter, Sort, a secondary or its own toolbar", () => {
    expect(tabHasToolbar(withToolbar)).toBe(true);
    expect(tabHasToolbar(own)).toBe(true);
    expect(tabHasToolbar({ menu: [{ label: "Export CSV", onClick: () => {} }] })).toBe(true);
    expect(tabHasToolbar({ menu: [] })).toBe(false);
    expect(tabHasToolbar(plain)).toBe(false);
  });

  it("holds the 44px row on a tab with nothing for it when a sibling tab has a toolbar, never on a page with none", () => {
    expect(reservedToolbarRow([withToolbar, plain], plain, false)).toBe(SETTINGS_TOOLBAR_ROW);
    expect(reservedToolbarRow([withToolbar, plain], withToolbar, true)).toBeUndefined();
    expect(reservedToolbarRow([own, plain], own, false)).toBe(own.toolbarRow);
    expect(reservedToolbarRow([plain, { key: "d", label: "D" }], plain, false)).toBeUndefined();
    // An untabbed page holds it only while its primary is still to come (Plan & billing).
    expect(reservedToolbarRow([], null, false, true)).toBe(SETTINGS_TOOLBAR_ROW);
    expect(reservedToolbarRow([], null, false)).toBeUndefined();
  });

  it("Structure: every one of its five tabs puts the same 44px row under the tabs, drawn or held", () => {
    const tabs = structureTabs(true, () => {});
    for (const t of tabs) {
      state.query = `tab=${t.key}`;
      const s = html(h(SettingsPage, { pageKey: "structure", tabs, width: "list", children: "x" }));
      const head = s.slice(0, s.indexOf("</header>"));
      const held = (/<div data-settings-toolbar-row=""[^>]*>/.exec(head)?.[0] ?? "").includes("min-h-11");
      expect(held || head.includes("os-toolbar"), t.key).toBe(true);
    }
    state.query = "";
  });
});

describe("M3: a list tab's create is its toolbar primary", () => {
  it("Members: Teams' New team, and Pending's Invite people, a secondary only while the rules' Save bar shows", () => {
    const onNewTeam = vi.fn();
    const tabs = membersTabs(true, () => {}, { canMakeTeams: true, onNewTeam });
    const teams = tabs.find((t) => t.key === "teams");
    expect(teams?.primary?.label).toBe("New team");
    teams?.primary?.onClick?.();
    expect(onNewTeam).toHaveBeenCalledTimes(1);
    expect(tabs.find((t) => t.key === "pending")?.primary?.label).toBe("Invite people");
    // While unsaved, one blue button: the Save bar's.
    const dirty = membersTabs(true, () => {}, { rulesDirty: true }).find((t) => t.key === "pending");
    expect(dirty?.primary).toBeUndefined();
    expect(html(h("div", null, dirty?.right))).toContain(">Invite people</button>");
    // A reader makes no team.
    expect(membersTabs(true, () => {}, { canMakeTeams: false, onNewTeam }).find((t) => t.key === "teams")?.primary).toBeUndefined();
  });

  it("the page counts New team (the New office pattern) and Pending says when its rules are unsaved", () => {
    expect(MEMBERS).toContain("onNewTeam: () => setNewTeam((n) => n + 1),");
    expect(MEMBERS).toContain("<TeamsTab createSignal={newTeam} />");
    expect(MEMBERS).toContain("const showsSaveBar = canEdit && dirty;");
    expect(MEMBERS).toMatch(/useEffect\(\(\) => \{ onRulesDirty\(showsSaveBar\); \}, \[showsSaveBar, onRulesDirty\]\);/);
    // Leaving the tab with unsaved rules does not leave Invite people a secondary.
    expect(MEMBERS).toContain("useEffect(() => () => onRulesDirty(false), [onRulesDirty]);");
  });

  it("Teams: only a press made while the tab is open opens the name row, and the row is no second blue button", () => {
    expect(TEAMS).toMatch(/const seenSignal = useRef\(createSignal\);\s*useEffect\(\(\) => \{\s*if \(createSignal === seenSignal\.current\) return;/);
    const closed = html(h(TeamsCard, { canEdit: true, empty: false, onMade: () => {} }));
    expect(closed).not.toContain("<form");
    expect(closed).not.toContain("<input");
    const open = html(h(TeamsCard, { canEdit: true, empty: false, naming: true, onNaming: () => {}, onMade: () => {} }));
    expect(open).toContain('aria-label="New team name"');
    expect(open).not.toContain("bg-brand");
    // A reader never sees the row, even asked to open it.
    expect(html(h(TeamsCard, { canEdit: false, empty: false, naming: true, onMade: () => {} }))).not.toContain("<form");
  });

  it("Profile fields: New field is its own toolbar's primary, grey at the limit, opening the name row", () => {
    expect(FIELDS).toContain('{canEdit ? <SettingsToolbar primary={{ label: "New field", onClick: openAdd, disabled: full, title: full ? FIELDS_FULL_TITLE : undefined }} /> : null}');
    expect(FIELDS).not.toContain("btn.primary");
    const props = { fields: [], canEdit: true, save: "idle" as const, draft: "", onDraft: () => {}, onAdd: () => {}, onRename: () => {}, onMove: () => {}, onRemove: () => {} };
    expect(html(h(ProfileFieldsCard, props))).not.toContain('aria-label="New field name"');
    const open = html(h(ProfileFieldsCard, { ...props, adding: true }));
    expect(open).toContain('aria-label="New field name"');
    expect(open).not.toContain("bg-brand");
  });

  it("Structure: Profile fields draws its own toolbar; Offices has New office and the ... the other two have", () => {
    const tabs = structureTabs(true, () => {});
    expect(tabs.find((t) => t.key === "fields")?.ownToolbar).toBe(true);
    const offices = tabs.find((t) => t.key === "offices");
    expect(offices?.primary?.label).toBe("New office");
    expect(offices?.menu).toHaveLength(1);
  });
});

/* ───────────── H1: Who can do what ───────────── */

describe("H1: Who can do what is a title, one line and Show more per card", () => {
  const m = html(h(PermissionMatrixView));

  it("each prose card's line fits one line, and its list opens under Show more", () => {
    expect(RULES_LINE.length).toBeLessThanOrEqual(ONE_LINE);
    expect(ROLES_LINE.length).toBeLessThanOrEqual(ONE_LINE);
    const rules = sectionById(m, "access.matrix.rules");
    expect(text(headerOf(rules))).toContain(RULES_LINE);
    expect(headerOf(rules)).toContain(`>${SETTINGS_MORE_LABEL}</button>`);
    for (const r of RELATIONSHIP_RULES.filter((x) => !SHOWN_RULES.has(x.key))) {
      expect(text(visible(rules)), r.key).not.toContain(r.who);
      expect(text(hiddenBodies(rules)), r.key).toContain(r.who);
    }
    const roles = sectionById(m, "access.matrix.roles");
    expect(text(headerOf(roles))).toContain(ROLES_LINE);
    for (const r of WORKSPACE_ROLES) {
      expect(text(visible(roles)), r.role).not.toContain(r.summary);
      expect(text(hiddenBodies(roles)), r.role).toContain(r.summary);
    }
  });

  it("a line that says what something leads to stays in view: an assignment opens the task, an older workspace keeps more", () => {
    const rules = text(visible(sectionById(m, "access.matrix.rules")));
    expect([...SHOWN_RULES]).toEqual(["assigning"]);
    expect(rules).toContain("which opens that task to them");
    expect(rules).toContain("A workspace made before the current sharing rules keeps the access people had then wherever it is higher");
  });

  it("the level legend under the table is behind its own Show more", () => {
    const table = sectionById(m, "access.matrix");
    expect(table).toContain(">Show what each level means</button>");
    const after = table.slice(table.indexOf("</table>"));
    expect(text(visible(after))).not.toContain("Change settings, sharing, delete and transfer.");
    expect(text(hiddenBodies(after))).toContain("Full access:");
  });
});

/* ───────────── H2: Locale & work week ───────────── */

describe("H2: Locale's values are rows with the control at the right, as on its twin page", () => {
  it("every value is a SettingsRow under its registry anchor; no stacked Field is left", () => {
    expect(LOCALE).not.toContain("<Field");
    for (const id of ["locale.timezone", "locale.currency", "locale.language", "locale.weekStart", "locale.dateFormat", "locale.timeFormat", "locale.fiscalYearStart"]) {
      expect(LOCALE, id).toMatch(new RegExp(`<SettingsRow\\s+id="${id.replace(".", "\\.")}"`));
    }
    // The helper is the row's hint, and each picker opens from its end edge at the row's right.
    expect(LOCALE).toContain('helper="Reminders, digests and due dates run on this clock."');
    expect(LOCALE).toContain('helper="Fiscal quarters and review periods count from this month."');
    expect(LOCALE).not.toContain('align="start"');
  });

  it("the pointer to each person's own choices is the Region card's description, not a line under its rows", () => {
    const region = LOCALE.slice(LOCALE.indexOf('title="Region"'), LOCALE.indexOf('title="Dates and the week"'));
    expect(region).toMatch(/description=\{\s*<>\s*People can pick their own language, formats and week start in/);
    expect(region.indexOf("People can pick their own")).toBeLessThan(region.indexOf("<SettingsRow"));
  });
});

/* ───────────── M2: the Legacy grid ───────────── */

describe("M2: the Legacy grid fits the column and its links live inside it", () => {
  it("has no column for the two levels that always can, so it is narrower than the 760 column", () => {
    const cols = permissionGridColumns({ allows: () => false, canEdit: true, readOnly: false, onToggle: () => {} });
    for (const l of PROTECTED_ADMIN_ROLES) expect(cols.some((c) => c.key === l), l).toBe(false);
    expect(GRID_LEVELS.map((l) => l.value)).not.toContain("SUPER_ADMIN");
    const total = WHAT_WIDE + GRID_LEVELS.reduce((w, l) => w + LEVEL_WIDTH[l.value], 0);
    expect(total).toBe(736);
    expect(total).toBeLessThanOrEqual(760 - 2);
    // The What column takes the room left over.
    expect(cols[0].width).toBe(`minmax(${WHAT_WIDE}px,1fr)`);
  });

  it("the section line says Owners and Admins always can, and its Show more ends that line", () => {
    expect(ACCESS).toContain("Owners and Admins always can.");
    expect(ACCESS).toContain('<SettingsSection label="Legacy" id="access.legacy" description={LEGACY_LINE} more={<p className="m-0">{LEGACY_MORE}</p>}>');
    expect(ACCESS).not.toContain("<SettingsMore");
    expect(ACCESS).not.toContain("The Owner column");
    const s = html(h(SettingsSection, { label: "Legacy", description: "One line.", more: "The rest." }, h("div", null, "grid")));
    expect(s).toMatch(/<p class="mb-2 text-sm text-ink-2">One line\. <button type="button"[^>]*aria-expanded="false"[^>]*>Show more<\/button><\/p><div id="[^"]+" hidden="" class="mb-2 [^"]*">The rest\.<\/div><div>grid<\/div>/);
    expect(html(h(SettingsSection, { label: "AI" }, "x"))).not.toContain(SETTINGS_MORE_LABEL);
  });

  it("Show the rest of the old grid is the enforced grid's footer line, not a link under the card", () => {
    expect(ACCESS).toMatch(/const othersToggle: TableFooter = \{[\s\S]*?hideTotal: true,\s*hidePaging: true,\s*leading: \(\s*<button[^>]*aria-expanded=\{showOthers\}/);
    expect(ACCESS).toContain('{grid(legacyRows, "Enforced permissions", false, othersToggle)}');
    const grid = code(read("src/components/settings/permission-grid.tsx"));
    expect(grid).toContain("footer={footer}");
  });
});

/* ───────────── M4: one table style ───────────── */

describe("M4: a table among cards is a titled TableCard", () => {
  it("TableCard's title band is inside its border, names the table, and never scrolls with the rows", () => {
    const t = html(h(TableCard<{ id: string }>, { title: "Recent exports", description: "The last 20.", titleActions: h("a", { href: "/x" }, "All"), columns: [{ key: "a", label: "A", render: (r) => r.id }], rows: [{ id: "r1" }], rowKey: (r) => r.id }));
    const id = /<h2 id="([^"]+)" class="text-lg font-semibold text-ink">Recent exports<\/h2>/.exec(t)?.[1];
    expect(id).toBeTruthy();
    expect(t).toMatch(new RegExp(`^<div class="os-tc [^"]*rounded-lg border border-line[^"]*" role="table" aria-labelledby="${id}"><div data-table-title=""`));
    // Before the scroller, not inside it.
    expect(t.indexOf("data-table-title")).toBeLessThan(t.indexOf("overflow-auto"));
    expect(t).toContain("The last 20.");
    expect(t).toContain('<a href="/x">All</a>');
    // An untitled table is unchanged.
    expect(html(h(TableCard<{ id: string }>, { columns: [{ key: "a", label: "A", render: (r) => r.id }], rows: [], rowKey: (r) => r.id }))).not.toContain("data-table-title");
  });

  it("Data's recent exports and My settings > Security's activity are titled TableCards, the activity keeping its anchor", () => {
    expect(html(h(RecentExportsTable, { rows: [] }))).toContain(">Recent exports</h2>");
    expect(DATA).toContain("<RecentExportsTable");
    expect(DATA).not.toContain('title="Recent exports"');
    expect(MY_SECURITY).toMatch(/<TableCard<SecEvent>\s+id="security\.activity"\s+className=\{pulse \? "border-brand" : undefined\}\s+title="Recent security activity"/);
    expect(MY_SECURITY).toContain('const pulse = useHashPulse("security.activity");');
    expect(MY_SECURITY).not.toContain("<table");
  });
});

/* ───────────── M5, M6: link cards and titles ───────────── */

describe("M5: a link card's link is its title action; the body is status lines", () => {
  it("Org chart", () => {
    const s = html(h(OrgChartCard, { unlinked: 1 }));
    expect(headerOf(s)).toMatch(/<a [^>]*href="\/organization"[^>]*>Open the org chart<\/a>/);
    const body = s.slice(s.indexOf("</header>"));
    expect(body).not.toContain('href="/organization"');
    expect(text(body)).toBe("No manager: 1 person · Fix in Members");
  });

  it("Trash, its count line held from the first paint", () => {
    const s = html(h(TrashCard, { purges: false, info: { total: 255, capped: false, retentionDays: 60 } }));
    expect(headerOf(s)).toMatch(/<a [^>]*href="\/trash"[^>]*>Open Trash<\/a>/);
    const body = s.slice(s.indexOf("</header>"));
    expect(body).not.toContain('href="/trash"');
    expect(text(body)).toContain("255 items in Trash");
    // Before the count arrives its line is already there, so nothing below it moves.
    expect(html(h(TrashCard, { purges: false, info: null }))).toContain('<p class="m-0 min-h-[1lh] text-sm text-ink-2"></p>');
  });
});

describe("M6: every card has a title, its anchor kept", () => {
  it("Data's Export and Profile's Photo", () => {
    expect(DATA).toContain('<SettingsCard title="Export" id="data.export">');
    expect(PROFILE).toContain('<SettingsCard title="Photo" id="profile.photo">');
  });
});

/* ───────────── L4 to L6, L10, L13 ───────────── */

describe("L4: no heading is said twice", () => {
  it("Preferences has no Theme card over its Theme row; the row keeps its registry anchor", () => {
    expect(PREFERENCES).not.toContain('title="Theme"');
    expect(PREFERENCES).toContain('id="preferences.appearance.theme.appearance"');
    expect(PREFERENCES).toContain('label="Theme"');
  });

  it("Billing's plan name is the card's value, not a second 16/600 heading", () => {
    expect(BILLING).toContain('<span className="text-base font-medium text-ink">{PLAN_LABEL[data.plan] ?? data.plan}</span>');
    expect(BILLING).not.toContain('<span className="text-lg font-semibold text-ink">{PLAN_LABEL');
  });

  it("Notifications' Email tab card is named for what it holds, not the tab's word", () => {
    expect(NOTIFICATIONS).not.toContain('<SettingsCard title="Email"');
    expect(NOTIFICATIONS).toContain('<SettingsCard title="Task and kudos emails" id="notifications.email">');
  });
});

describe("L5, L6: fields end on one edge", () => {
  it("Profile's name grid is 560 wide, the Phone field's width", () => {
    expect(PROFILE).toContain('<div className="grid max-w-[560px] grid-cols-2 gap-4 max-[640px]:grid-cols-1">');
  });

  it("Workspace Security's number fields give the unit word one fixed slot, as wide as the widest unit", () => {
    expect(SECURITY).toMatch(/const UNIT_SLOT = (\d+);/);
    expect(Number(/const UNIT_SLOT = (\d+);/.exec(SECURITY)?.[1])).toBeGreaterThanOrEqual(72);
    expect(SECURITY).toContain("suffixWidth={UNIT_SLOT}");
    expect(html(h(NumberInput, { value: 8, onChange: () => {}, suffix: "days", suffixWidth: 76 }))).toContain('<span class="text-base text-ink-2" style="width:76px">days</span>');
    expect(html(h(NumberInput, { value: 8, onChange: () => {}, suffix: "days" }))).toContain('<span class="text-base text-ink-2">days</span>');
  });
});

describe("L10: a lone AI or Requests card, its label hidden, sits 24px under the card above", () => {
  it("gives back the 8px a labelled section adds over the column's 32px gap", () => {
    expect(APPS).toContain('<div className="flex flex-col gap-8">');
    expect(APPS).toContain("[&:not(:has(section~section))>h2]:hidden [&:not(:has(section~section))]:-mt-2");
    expect(APPS).toContain("[&:has(section):not(:has(section~section))>h2]:hidden [&:has(section):not(:has(section~section))]:-mt-2");
  });
});

describe("L13: small items", () => {
  it("Org chart's fix link starts with a capital", () => {
    expect(text(html(h(OrgChartCard, { unlinked: 4 })))).toContain("· Fix in Members");
  });

  it("Offices' Export CSV writes the table's columns, an office with no city or time zone included", () => {
    const csv = officesCsv([
      { id: "o1", name: "Pune", city: "Pune", country: "India", timezone: "Asia/Kolkata", address: null, isHeadquarters: true, _count: { members: 12 } },
      { id: "o2", name: "Remote", city: null, country: null, timezone: null, address: null, isHeadquarters: false },
    ]);
    expect(csv.split("\n")).toEqual(["Office,City,Country,Time zone,Headquarters,Members", "Pune,Pune,India,Asia/Kolkata,Yes,12", "Remote,,,,,0"]);
  });
});
