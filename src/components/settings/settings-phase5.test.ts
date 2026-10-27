// Settings clean-up Phase 5 (docs/plans/settings-cleanup.md D Phase 5, B4 to
// B12): Identity & culture, Locale & work week, and Access. Each page or card
// is rendered to static markup with its shell, session and reads stubbed, so
// what is asserted is what the browser receives on first paint: one card per
// block with nothing boxed inside it, Theme the shared segmented control, the
// dead icons-only lock gone while a stored key still reads and is carried
// through, consequence sentences visible and the rest behind Show more, the
// Fiscal year a search-free PickerSelect, the Work week on the shared rows
// and chips, Public links a SettingsCard, and each permission grid a
// TableCard that scrolls inside itself with its names pinned.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  query: "",
  role: "ADMIN" as "OWNER" | "ADMIN" | "MEMBER",
  section: null as unknown,
  /** While set, an effect runs during the render that declares it (a server render runs none). */
  effects: false,
}));

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    Suspense: ({ children }: { children?: import("react").ReactNode }) => children,
    useEffect: (fn: () => void, deps?: unknown[]) => (state.effects ? void fn() : real.useEffect(fn, deps)),
  };
});
// Every hash landing asked for, by id (SettingsCard's own calls stay inside its module).
const landed = vi.hoisted(() => [] as string[]);
vi.mock("./settings-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("./settings-card")>();
  return { ...real, landOnHash: (id: string, pulse: (on: boolean) => void) => { landed.push(id); return () => void pulse; } };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/identity",
  useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "o1" } }, status: "authenticated", update: async () => null }),
  signOut: async () => {},
}));
vi.mock("@/components/ui/dialog-provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/dialog-provider")>();
  return { ...real, useConfirm: () => async () => false, usePrompt: () => async () => null };
});
vi.mock("@/components/layout/os/boot-context", () => ({
  useBoot: () => ({ boot: { viewer: { id: "me", orgRole: state.role, isAgent: false, adminScopes: [] }, org: { objectShare: false, inboxAutoClears: false } } }),
  useViewerRole: () => ({
    orgRole: state.role,
    isOwner: state.role === "OWNER",
    isAdmin: state.role === "OWNER" || state.role === "ADMIN",
    isGuest: false,
  }),
}));
vi.mock("@/components/layout/os/shell-context", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/layout/os/shell-context")>();
  const prefs = { theme: { appearance: "LIGHT" }, density: "comfortable", lockedKeys: [], home: { ui: {}, locale: { timezone: "Asia/Kolkata" } }, sidebar: {} };
  return { ...real, useOsShell: () => ({ prefs, rowVersion: () => 0, bumpRowVersion: () => {} }) };
});
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/ui/coming-soon-row", () => ({ useShowUpcoming: () => false, UpcomingOnly: () => null, ComingSoonRow: () => null }));
vi.mock("@/hooks/use-settings-section", () => ({
  useSettingsSection: () => ({ status: "ready", error: null, retry: () => {}, save: async () => ({ ok: true }), data: state.section }),
}));
// Every Picker drawn, with the props it was given, so a closed one can be
// asked what it was told (search, edge, placement). It still draws.
const pickers = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/components/ui/picker", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/picker")>();
  const { createElement } = await import("react");
  return { ...real, Picker: (props: import("@/components/ui/picker").PickerProps) => { pickers.push(props as unknown as Record<string, unknown>); return createElement(real.Picker, props); } };
});

import IdentitySettingsPage from "@/app/(dashboard)/settings/identity/page";
import { APPEARANCE_DEFAULTS_DESCRIPTION, AppearanceDefaultsCard, LOCK_CONSEQUENCE, appearanceStateOf, type AppearanceState } from "@/app/(dashboard)/settings/identity/appearance-defaults";
import LocaleSettingsPage from "@/app/(dashboard)/settings/locale/page";
import { WorkWeekCard, WorkWeekView, workDaysWords } from "@/app/(dashboard)/settings/locale/work-week-card";
import AccessSettingsPage from "@/app/(dashboard)/settings/access/page";
import { PermissionGrid, WHAT_NARROW, WHAT_WIDE, whatColumnWidth } from "./permission-grid";
import { PUBLIC_LINKS_WORDS, PublicLinksCardView } from "./public-links-card";
import { PermissionMatrixView } from "./permission-matrix-view";
import { SETTINGS_SECTION_LABEL, SettingsSection } from "./settings-section";
import { SETTINGS_MORE_LABEL } from "./settings-more";
import { toggleChipClass } from "@/components/layout/os/page-header/page-header";
import { LOCKABLE_PREFERENCE_PATHS, PREFERENCE_LOCK_GROUPS, RETIRED_LOCK_PATHS, nextLockedKeys, refusedLockedKeys } from "@/lib/preferences-locks";
import { WORK_SCHEDULE_DEFAULTS, type WorkSchedule } from "@/lib/work-schedule";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
function page(Page: ComponentType, query = ""): string {
  state.query = query;
  return html(h(Page));
}
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ");
/** The markup without the closed Show more bodies (hidden, so not read or seen until opened). */
const visible = (s: string) => s.replace(/<div id="[^"]*" hidden=""[^>]*>[\s\S]*?<\/div>/g, "");
/** The closed Show more bodies alone. */
const hiddenBodies = (s: string) => (s.match(/<div id="[^"]*" hidden=""[^>]*>[\s\S]*?<\/div>/g) ?? []).join(" ");
/** One <section id=...> to its own </section> (no nested sections in these cards). */
function sectionById(s: string, id: string): string {
  const start = s.indexOf(`<section id="${id}"`);
  expect(start, id).toBeGreaterThanOrEqual(0);
  return s.slice(start, s.indexOf("</section>", start) + "</section>".length);
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const appearance = (over: Partial<AppearanceState> = {}): AppearanceState => ({ appearance: "AUTO", accent: "workwrk", density: "cozy", lockedKeys: [], ...over });
const card = (s: AppearanceState | null) =>
  html(h(AppearanceDefaultsCard, { state: s, loadError: null, saving: false, onRetry: () => {}, onAppearance: () => {}, onAccent: () => {}, onDensity: () => {}, onLock: () => {} }));

describe("Identity > Appearance defaults (D Phase 5, B4, B5, B6, DS 5.12)", () => {
  it("is ONE card: no bordered box, uppercase label or blue callout inside it", () => {
    const c = card(appearance());
    expect((c.match(/<section\b/g) ?? []).length).toBe(1);
    const inside = c.slice(c.indexOf(">") + 1);
    expect(inside).not.toMatch(/rounded-lg border\b/);
    expect(inside).not.toContain("uppercase");
    expect(inside).not.toContain("bg-brand-soft");
    // The description is the card's one line, at most two (B4).
    expect(c).toContain(`<p class="mt-1 text-sm text-ink-2">${APPEARANCE_DEFAULTS_DESCRIPTION.replace(/'/g, "&#x27;")}</p>`);
    expect(APPEARANCE_DEFAULTS_DESCRIPTION.length).toBeLessThanOrEqual(200);
    // Every default and every lock is a shared SettingsRow.
    expect((c.match(/data-settings-row=""/g) ?? []).length).toBe(5);
  });

  it("draws Theme as the segmented control saying Light, Dark, System, the stored AUTO reading System", () => {
    const c = card(appearance({ appearance: "AUTO" }));
    const group = /<div role="radiogroup" aria-label="Theme"[\s\S]*?<\/div>/.exec(c)?.[0] ?? "";
    expect(group).not.toBe("");
    const radios = [...group.matchAll(/<button[^>]*role="radio" aria-checked="(true|false)"[^>]*>([^<]+)<\/button>/g)].map((m) => [m[2], m[1]]);
    expect(radios).toEqual([["Light", "false"], ["Dark", "false"], ["System", "true"]]);
    // A roving tab stop: only the chosen segment is in the Tab order, the arrows move it (DS 5.12).
    expect((group.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect(c).not.toContain(">Auto<");
    // Density is the same control, not a hand-built one.
    expect(c).toMatch(/<div role="radiogroup" aria-label="Density"/);
  });

  it("shows the lock's consequence, with the rest of the explanation behind Show more", () => {
    const c = card(appearance());
    expect(text(visible(c))).toContain(LOCK_CONSEQUENCE);
    expect(text(visible(c))).not.toContain("While locked");
    expect(text(hiddenBodies(c))).toContain("Unlock to hand the choice back.");
    expect(text(hiddenBodies(c))).toContain("My settings, Preferences");
    expect(c).toContain(SETTINGS_MORE_LABEL);
    // The old 12px --os-ink-3 footnote is gone (below AA).
    expect(c).not.toContain("text-xs text-ink-3");
  });
});

describe("the dead icons-only lock (D Phase 5: deleted, a stored key still reads)", () => {
  it("offers three locks, named by their visible words, and none for the sidebar", () => {
    const c = card(appearance());
    const switches = [...c.matchAll(/<button[^>]*role="switch"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(switches).toEqual(["Lock the theme", "Lock density", "Lock Home cards"]);
    for (const name of switches) expect(text(c)).toContain(name);
    expect(c).not.toMatch(/sidebar layout|icons-only|iconsOnly/i);
    expect(PREFERENCE_LOCK_GROUPS.map((g) => g.key)).toEqual(["theme", "density", "home"]);
    expect([...LOCKABLE_PREFERENCE_PATHS]).not.toContain("sidebar.iconsOnly");
    expect([...RETIRED_LOCK_PATHS]).toEqual(["sidebar.iconsOnly"]);
  });

  it("reads a workspace that stored the sidebar lock without error, and keeps the key through every other lock change", () => {
    const st = appearanceStateOf({ preference: { lockedKeys: ["sidebar.iconsOnly", "density"] } });
    expect(st.lockedKeys).toEqual(["sidebar.iconsOnly", "density"]);
    const c = card(st);
    const checked = [...c.matchAll(/<button[^>]*role="switch" aria-checked="(true|false)"[^>]*aria-label="([^"]+)"/g)].map((m) => [m[2], m[1]]);
    expect(checked).toEqual([["Lock the theme", "false"], ["Lock density", "true"], ["Lock Home cards", "false"]]);
    // Locking the theme sends the stored key back untouched...
    const next = nextLockedKeys(st.lockedKeys, ["theme.appearance", "theme.accent"], true);
    expect(next).toEqual(["sidebar.iconsOnly", "density", "theme.appearance", "theme.accent"]);
    expect(nextLockedKeys(next, ["density"], false)).toEqual(["sidebar.iconsOnly", "theme.appearance", "theme.accent"]);
    // ...and the route accepts it because it is already stored, never as a new lock.
    expect(refusedLockedKeys(next, st.lockedKeys)).toEqual([]);
    expect(refusedLockedKeys(["sidebar.iconsOnly", "density"], ["density"])).toEqual(["sidebar.iconsOnly"]);
    expect(refusedLockedKeys(["theme.colour"], null)).toEqual(["theme.colour"]);
    expect(read("src/app/api/org/preferences/route.ts")).toContain("refusedLockedKeys(parsed.data.lockedKeys, (await getOrgPreferenceRow(c.organizationId))?.lockedKeys)");
  });

  it("a null or missing lock list reads as no locks", () => {
    expect(appearanceStateOf({ preference: null }).lockedKeys).toEqual([]);
    expect(appearanceStateOf({ preference: { lockedKeys: null } })).toEqual({ appearance: "LIGHT", accent: "workwrk", density: "comfortable", lockedKeys: [] });
  });
});

const profile = { form: { name: "Acme Corp", domain: "", industry: "Other", businessType: "", teamSize: "" }, logo: null };

describe("Identity > Profile and Danger zone (A.2, B5, B12)", () => {
  it("the pointer to Locale & work week is the Workspace card's last row, not a caption under the cards", () => {
    state.section = profile;
    const p = page(IdentitySettingsPage);
    const ws = sectionById(p, "identity.workspace");
    expect(text(ws)).toContain("Time zone, currency and the fiscal year");
    expect(ws).toMatch(/<a [^>]*href="\/settings\/locale"[^>]*>Locale &amp; work week<\/a>/);
    expect(ws.lastIndexOf('data-settings-row=""')).toBeGreaterThan(ws.indexOf('id="identity.domain"'));
    const after = p.slice(p.lastIndexOf("</section>"));
    expect(after).not.toContain("/settings/locale");
  });

  it("an Admin who is not an Owner sees Owners only where the Transfer control would be; an Owner keeps the button and its confirm", () => {
    state.section = { orgName: "Acme Corp", viewer: { isOwner: false, mayManageOwnerPages: true } };
    const admin = page(IdentitySettingsPage, "tab=danger");
    const row = (s: string, id: string) => s.slice(s.indexOf(`id="${id}"`), s.indexOf("</div></div></div>", s.indexOf(`id="${id}"`)));
    const transfer = row(admin, "identity.transfer");
    expect(text(transfer)).toContain("Owners only");
    expect(transfer).not.toContain("<button");
    state.section = { orgName: "Acme Corp", viewer: { isOwner: true, mayManageOwnerPages: true } };
    const owner = page(IdentitySettingsPage, "tab=danger");
    expect(row(owner, "identity.transfer")).toMatch(/<button[^>]*>Transfer ownership<\/button>/);
    expect(text(owner)).not.toContain("Owners only");
    // Delete workspace: every fact of its consequence in the one-line hint, beside its unchanged button.
    expect(text(row(owner, "identity.delete"))).toContain("Signs everyone out. WorkwrK support can restore it for 30 days, then it is gone for good.");
    const src = read("src/app/(dashboard)/settings/identity/page.tsx");
    expect(src).toContain('<p className="text-ink-2">Everyone is signed out within minutes. For 30 days WorkwrK support can restore it; after that it is deleted for good.</p>');
    expect(src).toContain("typed={orgName}");
  });
});

const locale = { timezone: "Asia/Kolkata", currency: "USD", fiscalYearStart: 4, language: "en", weekStart: "MON", dateFormat: "DMY", timeFormat: "24h" };

describe("Locale & work week (D Phase 5, B5, B9)", () => {
  // Final Settings review, H2: every Locale value is a SettingsRow with its control at the right, so the four
  // pickers open from their end edge (PickerSelect's own default), as Preferences > Language & region's do.
  it("Fiscal year is a PickerSelect like the Region pickers: end edge, placed to fit, no search over twelve months, the month number as its value", () => {
    state.section = locale;
    pickers.length = 0;
    const p = page(LocaleSettingsPage);
    const named = (n: string) => pickers.find((x) => x.ariaLabel === n);
    const fiscal = named("Fiscal year starts in");
    expect(fiscal).toBeTruthy();
    expect(fiscal?.noSearch).toBe(true);
    expect(fiscal?.align).toBe("end");
    expect(fiscal?.autoPlace).toBe(true);
    const opts = ((fiscal?.sections as Array<{ options: Array<{ value: string; label: string }> }>)[0]).options;
    expect(opts.map((o) => o.value)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    expect(opts[3].label).toBe("April");
    for (const n of ["Time zone", "Currency", "Default language"]) expect(named(n)?.align, n).toBe("end");
    // The trigger is named by its label and its value (fix M1), and nothing on the page is a native select.
    expect(p).toMatch(/<span id="[^"]+-name" hidden="">Fiscal year starts in<\/span><button[^>]*aria-haspopup="listbox"[^>]*>[\s\S]*?April/);
    expect(p).not.toContain("<select");
  });

  const schedule: WorkSchedule = { ...WORK_SCHEDULE_DEFAULTS, workdays: [1, 2, 3, 4, 5], hoursPerDay: 7.5, holidays: [{ date: "2026-09-23", name: "Founders Day" }] };
  const view = (over: Partial<Parameters<typeof WorkWeekView>[0]> = {}) =>
    html(h(WorkWeekView, {
      schedule, canEdit: true, problem: null, dirty: false, saving: false, newHoliday: { date: null, name: "" }, wallDate: (d: string) => `day ${d}`,
      onDay: () => {}, onHours: () => {}, onRemoveHoliday: () => {}, onNewHoliday: () => {}, onAddHoliday: () => {}, onSave: () => {}, onReload: () => {},
      ...over,
    }));

  it("the Work week card is the shared rows and the toolbar's toggle chips", () => {
    const c = view();
    const rows = c.match(/data-settings-row=""/g) ?? [];
    expect(rows.length).toBe(3); // Working days, Hours in a work day, one holiday
    const group = /<span role="group" aria-labelledby="locale-workdays-label"[\s\S]*?<\/span>/.exec(c)?.[0] ?? "";
    const days = [...group.matchAll(/<button type="button" aria-pressed="(true|false)" class="([^"]+)">(\w+)<\/button>/g)];
    expect(days.map((d) => d[3])).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    // The toolbar's chip with its outlined state cue (Phase 5 review, M1): an ink border only on a pressed day.
    for (const d of days) expect(d[2]).toBe(toggleChipClass(d[1] === "true", { outlined: true }));
    expect(toggleChipClass(true)).toContain("h-8");
    for (const d of days) expect(d[2].includes("border-ink"), d[3]).toBe(d[1] === "true");
    expect(c).toContain('<span id="locale-workdays-label">Working days</span>');
    // The week's length is the row's hint at --os-ink-2, not a 3rd-ink caption beside the field.
    expect(c).toMatch(/<div id="locale-hours-hint" class="mt-0.5 text-sm text-ink-2">A full week is 37:30<\/div>/);
    expect(c).toMatch(/<input id="locale-hours-input" type="number"[^>]*aria-describedby="locale-hours-hint"/);
    // Holidays: the card's 13/500 sub-heading, a row per holiday, a worded Remove named for it.
    expect(c).toContain('<h3 class="text-sm font-medium text-ink">Holidays</h3>');
    expect(c).toMatch(/<button type="button" aria-label="Remove Founders Day, day 2026-09-23" class="[^"]*os-btn-ghost[^"]*">Remove<\/button>/);
    expect(text(c)).toContain("day 2026-09-23");
    expect(view({ schedule: { ...schedule, holidays: [] } })).toContain('<p class="mt-1 text-base text-ink-2">No holidays yet.</p>');
  });

  it("someone who cannot change it reads every value as text, with no control", () => {
    const c = view({ canEdit: false });
    expect(c).not.toMatch(/<button|<input/);
    expect(text(c)).toContain(workDaysWords([1, 2, 3, 4, 5]));
    expect(workDaysWords([1, 2, 3, 4, 5])).toBe("Mon, Tue, Wed, Thu, Fri");
    expect(workDaysWords([])).toBe("No fixed days");
    expect(text(c)).toContain("7:30");
    expect(text(c)).toContain("You need Owner or Admin access to change it.");
  });

  it("while it loads it is already the Work week card, so nothing moves when the schedule arrives", () => {
    const c = html(h(WorkWeekCard));
    expect(c).toMatch(/^<section class="[^"]*rounded-lg border[^"]*p-6/);
    expect(c).toContain('<h2 class="text-lg font-semibold text-ink">Work week</h2>');
    expect(c).toContain('aria-busy="true"');
  });
});

describe("Access > Settings (D Phase 5, B4, B6, B10)", () => {
  it("How access works says two lines with the roles and keeps the rest behind Show more; Manage people is its card action", () => {
    state.role = "ADMIN";
    const p = page(AccessSettingsPage);
    const ex = sectionById(p, "access.explainer");
    const seen = text(visible(ex));
    expect(seen).toContain("Everyone here is an Owner, an Admin or a Member.");
    expect(seen).toContain("Admins run the workspace and open every Space; Members work in the Spaces they are added to.");
    expect(seen).not.toContain("Each thing you share offers its own levels");
    expect(seen).not.toContain("seniority tier");
    const more = text(hiddenBodies(ex));
    expect(more).toContain("Each thing you share offers its own levels");
    expect(more).toContain("See who can open something: its ••• menu, then Share.");
    const head = ex.slice(ex.indexOf("<header"), ex.indexOf("</header>"));
    expect(head).toMatch(/<a [^>]*href="\/settings\/members"[^>]*>Manage people<\/a>/);
  });

  it("Public links is a SettingsCard whose row keeps the consequence of Off in view", () => {
    const p = page(AccessSettingsPage);
    const pl = sectionById(p, "access.publicLinks");
    expect(pl).toMatch(/^<section id="access.publicLinks" class="[^"]*rounded-lg border[^"]*p-6/);
    expect(pl).toContain('<h2 class="text-lg font-semibold text-ink">Public links</h2>');
    expect(pl).not.toContain("os-chrome");
    expect(pl).not.toContain("<header class=\"flex h-11");
    expect(text(visible(pl))).toContain(PUBLIC_LINKS_WORDS.hint);
    // The anchor is the card itself, no wrapper div holding it.
    expect(p).not.toContain('<div class="w-full" id="access.publicLinks">');
  });

  it("the switch is named by the row's words and described by the consequence; read-only shows the value", () => {
    const base = { unset: false, saving: false, savedAt: null, failure: null, onChange: () => {} };
    const on = html(h(PublicLinksCardView, { ...base, canEdit: true, value: "view" }));
    expect(on).toMatch(/<button type="button" role="switch" aria-checked="true"[^>]*aria-labelledby="public-links-label" aria-describedby="public-links-hint"/);
    expect(on).toContain(`<span id="public-links-label">${PUBLIC_LINKS_WORDS.label}</span>`);
    expect(on).toContain(`<div id="public-links-hint" class="mt-0.5 text-sm text-ink-2">${PUBLIC_LINKS_WORDS.hint}</div>`);
    const ro = html(h(PublicLinksCardView, { ...base, canEdit: false, value: "off" }));
    expect(ro).not.toContain('role="switch"');
    expect(ro).toContain('<span class="text-base text-ink">Off</span>');
    const unset = html(h(PublicLinksCardView, { ...base, canEdit: true, value: "off", unset: true }));
    expect(text(unset)).toContain(PUBLIC_LINKS_WORDS.unset);
    const failed = html(h(PublicLinksCardView, { ...base, canEdit: true, value: "off", failure: { message: "Forbidden", intended: "view" } }));
    expect(failed).toMatch(/role="alert">Forbidden<button[^>]*>Retry<\/button>/);
  });

  // Final Settings review, M2: the line also says Owners and Admins always can (the grid has no column for them),
  // and its Show more ends the line instead of floating on its own between the label and the grid.
  it("Legacy is the shared section label, its line with the rest behind Show more, and its grid holds its own height while it loads", () => {
    const p = page(AccessSettingsPage);
    const start = p.indexOf('<section id="access.legacy"');
    expect(start).toBeGreaterThan(0);
    const legacy = p.slice(start);
    expect(legacy).toContain(`<h2 class="${SETTINGS_SECTION_LABEL} mb-1">Legacy`);
    expect(text(visible(legacy))).toContain("The old grid's rules that the server still checks. Owners and Admins always can. A change here applies to everyone once saved.");
    expect(text(visible(legacy))).not.toContain("When the new access engine is switched on");
    expect(text(hiddenBodies(legacy))).toContain("When the new access engine is switched on");
    const table = /<div class="os-tc [^"]*" role="table" aria-label="Enforced permissions">[\s\S]*?<\/div><\/div><\/div>/.exec(legacy)?.[0] ?? "";
    expect(table).not.toBe("");
    expect((table.match(/os-skeleton-pulse/g) ?? []).length).toBe(14);
  });
});

describe("a section anchor lands (E2: anchors keep working; #access.legacy is a registry link)", () => {
  it("a SettingsSection with an id lands on its hash like a card; one without an id asks for nothing", () => {
    landed.length = 0;
    state.effects = true;
    (globalThis as { window?: unknown }).window = {};
    try {
      html(h(SettingsSection, { id: "access.legacy", label: "Legacy" }, "x"));
      html(h(SettingsSection, { label: "AI" }, "y"));
    } finally {
      state.effects = false;
      delete (globalThis as { window?: unknown }).window;
    }
    expect(landed).toEqual(["access.legacy"]);
  });
});

describe("the permission grids are TableCards that scroll inside themselves (D Phase 5)", () => {
  const rows = [
    { mod: "sops" as const, action: "create", label: "Create SOPs" },
    { mod: "sops" as const, action: "delete", label: "Delete SOPs" },
  ];
  // Final Settings review, M2: Owner and Admin, who always can, have no column; the page says so in words.
  it("every level but Owner and Admin is a column, Member and Agent included, behind a pinned What column", () => {
    const g = html(h(PermissionGrid, { rows, ariaLabel: "Enforced permissions", allows: () => false, canEdit: true, onToggle: () => {} }));
    const heads = [...g.matchAll(/role="columnheader"[^>]*>[\s\S]*?<span class="truncate">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(heads).toEqual(["What", "Executive", "VP", "Director", "People team", "Manager", "Team lead", "Member", "Agent"]);
    // Where it is wider than its card (a phone) it scrolls in the card's own scroller, never the page.
    expect(g).toContain('<div class="min-h-0 flex-1 overflow-auto"><div style="min-width:736px">');
    // The names are pinned to the start edge, opaque, in the header and in every row.
    const pinned = g.match(/role="(?:columnheader|cell)" class="[^"]*sticky start-0[^"]*"/g) ?? [];
    expect(pinned.length).toBe(1 + rows.length);
    expect(g).toMatch(/role="cell" class="[^"]*sticky start-0[^"]*bg-raised/);
    // A tick for an Admin to change, named "level: rule"; the two levels that always can show a lock.
    expect(g).toContain('aria-label="Member: Create SOPs"');
    expect(g).toContain('aria-label="Agent: Delete SOPs"');
    expect(g).not.toContain("always can");
    // Not TableCard's row-selection checkbox, whose unticked state hides until hover at Cozy and Compact.
    expect(g).not.toContain("os-tc__check");
    // A focused cell is kept clear of the pinned column, and a long name wraps rather than being cut.
    expect(g).toMatch(/<div class="os-tc [^"]*\[&amp;&gt;div:first-child\]:\[scroll-padding-inline-start:180px\]" role="table"/);
    expect(g).toContain('<span class="line-clamp-2 min-w-0 leading-[18px]" title="Create SOPs">Create SOPs</span>');
  });

  it("on a phone the pinned names narrow, so the Member column can scroll out whole beside them", () => {
    expect(whatColumnWidth(0)).toBe(WHAT_WIDE);
    expect(whatColumnWidth(758)).toBe(WHAT_WIDE);
    expect(whatColumnWidth(292)).toBe(WHAT_NARROW);
    // At 292 (a 390 phone) the room beside the pin holds the last two columns whole, Member and Agent (122px)...
    expect(292 - 2 - WHAT_NARROW).toBeGreaterThanOrEqual(68 + 54);
    // ...which the wide 180 does not leave.
    expect(292 - 2 - WHAT_WIDE).toBeLessThan(68 + 54);
    expect(read("src/components/settings/permission-grid.tsx")).toContain('"[&>div:first-child]:[scroll-padding-inline-start:150px]"');
  });

  it("read-only, the retired grid, and someone who cannot change it see Yes or No", () => {
    // The page answers each cell (checkPermission over its matrix); the grid draws that answer.
    const allows = (level: string, r: { action: string }) => level === "EMPLOYEE" && r.action === "create";
    const ro = html(h(PermissionGrid, { rows, ariaLabel: "Retired enforced permissions", allows, canEdit: true, readOnly: true, onToggle: () => {} }));
    expect(ro).not.toContain('type="checkbox"');
    expect((ro.match(/<span class="text-ink-2">Yes<\/span>/g) ?? []).length).toBe(1);
    expect((ro.match(/<span class="text-ink-2">No<\/span>/g) ?? []).length).toBe(2 * 8 - 1);
    const edit = html(h(PermissionGrid, { rows, ariaLabel: "Enforced permissions", allows, canEdit: true, onToggle: () => {} }));
    expect(edit).toContain('aria-label="Member: Create SOPs" checked=""/>');
    expect(edit).toContain('aria-label="Member: Delete SOPs"/>');
    expect((edit.match(/ checked=""/g) ?? []).length).toBe(1);
    // Someone who cannot change it reads the same words, with no checkbox.
    const viewer = html(h(PermissionGrid, { rows, ariaLabel: "Enforced permissions", allows, canEdit: false, onToggle: () => {} }));
    expect(viewer).not.toContain('type="checkbox"');
  });
});

describe("Access > Who can do what (B4, B6, AA)", () => {
  it("the table's description is two lines with how cells are worked out behind Show more, and the access footnote is readable", () => {
    const m = html(h(PermissionMatrixView));
    const first = sectionById(m, "access.matrix");
    const head = first.slice(first.indexOf("<header"), first.indexOf("</header>"));
    expect(text(head)).toContain("A cell that names tasks applies to those tasks only");
    expect(text(visible(head))).not.toContain("Every cell is worked out");
    expect(text(hiddenBodies(head))).toContain("Every cell is worked out by the rule that enforces it");
    const rules = sectionById(m, "access.matrix.rules");
    expect(rules).toMatch(/<p class="m-0 max-w-\[720px\] text-sm text-ink-2">\s*A workspace made before the current sharing rules/);
    expect(m).not.toContain("text-ink-3");
    expect(m).toContain('<span class="text-xs text-ink-2">No</span>');
  });
});
