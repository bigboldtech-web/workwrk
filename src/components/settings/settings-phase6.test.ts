// Settings clean-up Phase 6: Task system, Scoring & reviews and Data.
//
// Each page is rendered (server markup, no DOM) over faked reads, and where
// a handler matters the element tree a component returns is walked, so the
// test sees the control and what it calls, not only a string in the source.
//
// The modules new with this phase are imported inside the tests that need
// them, so on the code before it each test fails on its own assertion
// rather than the whole file failing to load.

import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  query: "",
  pathname: "/settings/tasks",
  /** Each settings section's read: its status, over one GET /api/settings body. */
  sections: {} as Record<string, "loading" | "ready" | "error">,
  body: {} as Record<string, unknown>,
  canEditScoring: true,
  showUpcoming: false,
  /** While set, effects are queued here instead of dropped (a server render runs none); the test runs them after the render. */
  effects: null as Array<() => unknown> | null,
  /** While set, every external store reads this (a phone's width match), not the server's snapshot. */
  snapshot: undefined as unknown,
  /** While set, the render's useState calls take these values by call order (what a click or a read would have set). */
  seed: null as Map<number, unknown> | null,
  seedAt: 0,
  /** Every apiFetch call: its URL and init. */
  apiCalls: [] as Array<[string, unknown]>,
}));

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    Suspense: ({ children }: { children?: import("react").ReactNode }) => children,
    useEffect: (fn: () => unknown, deps?: unknown[]) => (state.effects ? void state.effects.push(fn) : real.useEffect(fn as () => void, deps)),
    useSyncExternalStore: <T,>(sub: (cb: () => void) => () => void, get: () => T, server?: () => T): T =>
      (state.snapshot !== undefined ? (state.snapshot as T) : real.useSyncExternalStore(sub, get, server)),
    useState: <S,>(init: S | (() => S)) => {
      if (state.seed) {
        const i = state.seedAt++;
        if (state.seed.has(i)) return [state.seed.get(i) as S, () => {}] as const;
      }
      return real.useState(init);
    },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "o1" } }, status: "authenticated", update: async () => null }),
  signOut: async () => {},
}));
vi.mock("@/components/ui/dialog-provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/dialog-provider")>();
  return { ...real, useConfirm: () => async () => true, usePrompt: () => async () => null };
});
vi.mock("@/components/layout/os/boot-context", () => ({
  useBoot: () => ({ boot: { viewer: { id: "me", orgRole: "ADMIN", isAgent: false, adminScopes: [] }, org: { objectShare: false, inboxAutoClears: false, trashPurges: false } } }),
  useViewerRole: () => ({ orgRole: "ADMIN", isOwner: false, isAdmin: true, isGuest: false }),
}));
vi.mock("@/components/layout/os/shell-context", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/layout/os/shell-context")>();
  const prefs = { theme: { appearance: "LIGHT" }, density: "comfortable", lockedKeys: [], home: { ui: {}, locale: { timezone: "Asia/Kolkata" } }, sidebar: {}, modules: { activeAppKeys: ["tables"] } };
  return { ...real, useOsShell: () => ({ prefs, rowVersion: () => 0, bumpRowVersion: () => {} }) };
});
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/ui/coming-soon-row", () => ({ useShowUpcoming: () => state.showUpcoming, UpcomingOnly: () => null, ComingSoonRow: () => null }));
vi.mock("@/components/ui/date-text", () => ({ DateText: ({ value }: { value: unknown }) => String(value) }));
vi.mock("@/components/tables/csv-import-dialog", () => ({ CsvImportDialog: () => null }));
vi.mock("@/components/people/people-import", () => ({
  usePeopleImport: () => ({ state: { step: "upload", busy: false, staged: null }, missing: [], back: () => {}, stage: async () => {}, commit: async () => {}, reset: () => {} }),
  importable: () => 0,
  PeopleImport: () => null,
}));
vi.mock("@/hooks/use-settings-section", () => ({
  useSettingsSection: (section: string, select: (b: unknown) => unknown) => {
    const status = state.sections[section] ?? "ready";
    return {
      status,
      error: status === "error" ? "HTTP 500" : null,
      data: status === "ready" ? select(state.body) : null,
      retry: () => {},
      reload: async () => {},
      save: async () => ({ ok: true }),
    };
  },
}));
vi.mock("@/lib/api-fetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api-fetch")>();
  return { ...real, apiFetch: async (url: string, init?: unknown) => { state.apiCalls.push([url, init]); return { ok: true, status: 200, data: {} }; } };
});

import { SettingsCard } from "./settings-card";
import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";
import { SettingsToolbar } from "./settings-page";
import { ErrorState } from "@/components/ui/error-state";
import { DotsArt } from "@/components/ui/dots-art";
import { DEFAULT_CADENCES } from "@/lib/review-cadence";
import TaskSystemPage from "@/app/(dashboard)/settings/tasks/page";
import { TaskTypesTab } from "@/app/(dashboard)/settings/tasks/task-types-tab";
import { TagsManager, type TagRow } from "@/app/(dashboard)/settings/tasks/tags-manager";
import { TemplatesTab } from "@/app/(dashboard)/settings/tasks/templates-tab";
import ScoringSettingsPage from "@/app/(dashboard)/settings/scoring/page";
import DataSettingsPage from "@/app/(dashboard)/settings/data/page";
import { ByokManager } from "./byok-manager";
import { PickerSelect } from "./picker-select";
import { RowMoreButton, TableCard, type TableColumn } from "@/components/ui/table-card";
import { MenuItem } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { SETTINGS_ENTRIES } from "@/lib/settings-registry";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

type El = { type: unknown; props: Record<string, unknown> };
/** Every element in a tree a component returned (its own elements; child components are not called). */
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) elements(n, out); return out; }
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return out;
  const el = node as El;
  out.push(el);
  for (const v of Object.values(el.props ?? {})) if (v && typeof v === "object") elements(v, out);
  return out;
}
/** The tree a hook-using component returns for these props, made inside a real render so its hooks run. */
function treeOf<P>(C: (p: P) => ReactNode, props: P): unknown {
  let out: unknown = null;
  const Probe = () => { out = C(props); return null; };
  html(h(Probe));
  return out;
}
const words = (node: unknown): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(words).join("");
  if (typeof node === "object" && "props" in node) return words((node as El).props.children);
  return "";
};
/** A render whose useState calls, by call order, start from `seed` (index, value): a server render keeps only first states. */
function withSeed<T>(seed: Array<[number, unknown]>, run: () => T): T {
  state.seed = new Map(seed);
  state.seedAt = 0;
  try { return run(); } finally { state.seed = null; state.seedAt = 0; }
}
/** A render with its effects queued, then run once the render is done (a state set then is dropped, as on the server). */
function withEffects<T>(run: () => T): T {
  state.effects = [];
  let queued: Array<() => unknown> = [];
  try { const out = run(); queued = state.effects; return out; } finally { state.effects = null; for (const fn of queued) fn(); }
}
/** The browser globals a click handler reaches for: a frame that runs at once, timers that never fire, and the focus it asks for. */
function stubBrowser() {
  const focused: string[] = [];
  const el = (id: string) => ({ id, focus: () => { focused.push(id); } });
  vi.stubGlobal("window", { requestAnimationFrame: (cb: (t: number) => void) => { cb(0); return 1; }, setTimeout: () => 0, clearTimeout: () => {} });
  vi.stubGlobal("document", { getElementById: (id: string) => el(id), activeElement: null, body: {} });
  return { focused, el };
}

/** The markup of the element with this id, up to the end of the section it opens. */
function sectionById(markup: string, id: string): string {
  const start = markup.indexOf(`id="${id}"`);
  if (start < 0) return "";
  return markup.slice(start, markup.indexOf("</section>", start));
}

/* ───────────────────────── Task system ───────────────────────── */

describe("Task system > Task types", () => {
  it("New type is in the toolbar from the first paint, grey with its reason only once every custom type is used", async () => {
    const { newTypePrimary } = await import("@/app/(dashboard)/settings/tasks/task-system-ui");
    const open = vi.fn();
    const before = newTypePrimary(null, open);
    expect(before.label).toBe("New type");
    expect(before.disabled).toBe(false);
    expect(newTypePrimary({ used: 3, limit: 20 }, open).disabled).toBe(false);
    const full = newTypePrimary({ used: 20, limit: 20 }, open);
    expect(full.disabled).toBe(true);
    expect(full.title).toMatch(/All 20 custom types are in use/);
    (before as { onClick: () => void }).onClick();
    expect(open).toHaveBeenCalledOnce();

    // The page draws it before the list has answered (the old page drew no toolbar until then, and the content jumped 44px).
    state.query = "";
    const markup = html(h(TaskSystemPage));
    expect(text(markup)).toContain("New type");
  });

  it("the active types are the tab's table, with the custom-type count in its footer; Recommended is a SettingsCard that shows skeleton rows while the read is out", async () => {
    const tree = treeOf(TaskTypesTab, { createOpen: false, onCreateOpenChange: () => {}, onUsage: () => {} });
    const all = elements(tree);
    const cards = all.filter((e) => e.type === SettingsCard);
    expect(cards.map((c) => c.props.title)).toEqual(["Recommended"]);
    // No bare 14/600 heading above the table any more.
    const markup = html(h(TaskTypesTab, { createOpen: false, onCreateOpenChange: () => {}, onUsage: () => {} }));
    expect(markup).not.toContain(">Active types<");
    // Still reading: never "Nothing to add", which read as a finished answer.
    expect(text(markup)).not.toMatch(/Nothing to add|Every recommended type/);
    const { customTypesLine } = await import("@/app/(dashboard)/settings/tasks/task-system-ui");
    expect(customTypesLine({ used: 2, limit: 20 })).toBe("2 of 20 custom types");
  });

  it("an empty library line says why, with its one action (B10)", async () => {
    const { recommendedEmptyLine } = await import("@/app/(dashboard)/settings/tasks/task-system-ui");
    expect(recommendedEmptyLine(true)).toEqual({ text: "No recommended types match", action: { kind: "clear", label: "Clear the filter" } });
    expect(recommendedEmptyLine(false)).toEqual({ text: "Every recommended type is added", action: null });
  });
});

describe("Task system > Tags", () => {
  const TAGS: TagRow[] = [
    { id: "t1", name: "Migration fixture", type: "CUSTOM", color: null, description: "From the old grid", archived: false, assignmentCount: 1 },
    { id: "t2", name: "EMEA", type: "REGION", color: null, description: null, archived: true, assignmentCount: 0 },
  ];

  it("every dimension is a SettingsCard with one way to add, under one Tag groups label; the search and Show archived are the tab's toolbar", () => {
    const all = elements(treeOf(TagsManager, { initial: TAGS }));
    const cards = all.filter((e) => e.type === SettingsCard);
    expect(cards.map((c) => c.props.title)).toEqual(["Cost centers", "Business units", "Locations", "Regions", "Projects", "Functions", "Custom"]);
    for (const c of cards) {
      const inline = elements(c.props.children).filter((e) => e.type === "button" && /^Add a /.test(words(e)));
      const add = elements(c.props.actions)[0];
      // An empty group's line carries the add; any other group has the ghost Add at the title's right. Never both.
      if (inline.length) {
        expect(add, String(c.props.title)).toBeUndefined();
      } else {
        expect(add?.type, String(c.props.title)).toBe("button");
        expect(String(add?.props.className)).toContain("os-btn-ghost");
        expect(add?.props["aria-label"]).toMatch(/^Add a /);
      }
    }
    // Custom holds a tag, Regions only an archived one (shown as "1 archived region · Show archived"): both keep the ghost Add.
    expect(cards.filter((c) => c.props.actions).map((c) => c.props.title)).toEqual(["Regions", "Custom"]);
    const section = all.find((e) => e.type === SettingsSection);
    expect(section?.props.label).toBe("Tag groups");
    expect(String(section?.props.description)).toContain("Tags travel across People, Tasks, KRAs and OKRs");
    const toolbar = all.find((e) => e.type === SettingsToolbar);
    expect(toolbar, "the toolbar").toBeTruthy();
    const left = elements(toolbar!.props.left);
    expect(left.some((e) => e.type === "input" && e.props["aria-label"] === "Search tags")).toBe(true);
    expect(left.some((e) => e.type === "button" && words(e).includes("Show archived"))).toBe(true);
  });

  it("a tag is a neutral label chip on a SettingsRow, never brand blue; Delete is the danger text", () => {
    const all = elements(treeOf(TagsManager, { initial: TAGS }));
    const rows = all.filter((e) => e.type === SettingsRow);
    expect(rows).toHaveLength(1); // the archived region is hidden until Show archived
    const markup = html(h(TagsManager, { initial: TAGS }));
    expect(markup).not.toMatch(/bg-blue-50|text-blue-700/);
    const chip = /<span class="([^"]*)" title="Migration fixture"><span class="min-w-0 truncate">Migration fixture<\/span><\/span>/.exec(markup);
    expect(chip?.[1]).toContain("bg-subtle");
    const del = all.find((e) => typeof e.props.className === "string" && words(e).includes("Delete") && "onSelect" in e.props);
    expect(del?.props.className).toBe("text-danger-text");
  });

  it("a group with no tag says so in one line with its action: add, show the archived ones, or clear the search", async () => {
    const markup = text(html(h(TagsManager, { initial: TAGS })));
    expect(markup).toContain("No cost centers yet · Add a cost center");
    expect(markup).toContain("1 archived region · Show archived");
    expect(markup).not.toContain("No tag here matches");
    const { tagGroupEmptyLine } = await import("@/app/(dashboard)/settings/tasks/task-system-ui");
    expect(tagGroupEmptyLine("CUSTOM", { query: "", hiddenArchived: 0 })).toEqual({ text: "No custom tags yet", action: { kind: "add", label: "Add a custom tag" } });
    expect(tagGroupEmptyLine("REGION", { query: "", hiddenArchived: 2 }).text).toBe("2 archived regions");
    expect(tagGroupEmptyLine("REGION", { query: "emea", hiddenArchived: 2 })).toEqual({ text: "No regions match", action: { kind: "clear", label: "Clear the search" } });
  });

  it("the Tags tab holds its toolbar row in the header, so the toolbar arriving moves nothing", () => {
    state.query = "tab=tags";
    const markup = html(h(TaskSystemPage));
    // The measured heights: 44 from 531px, two lines (88) below.
    expect(markup).toMatch(/<div data-settings-toolbar-row="" class="min-h-11 max-\[531px\]:min-h-\[88px\]"><\/div>/);
    state.query = "";
  });
});

describe("Task system > Templates", () => {
  it("two SettingsCards, each with its link as the card's action, no illustration, and two labels for two places", () => {
    const all = elements(treeOf(TemplatesTab, {} as never));
    const cards = all.filter((e) => e.type === SettingsCard);
    expect(cards.map((c) => c.props.title)).toEqual(["Templates", "Statuses and fields"]);
    expect(all.some((e) => e.type === DotsArt)).toBe(false);
    const links = cards.map((c) => elements(c.props.actions)[0]);
    expect(links.map((l) => l.props.href)).toEqual(["/templates?kind=task", "/templates?kind=list"]);
    const labels = links.map((l) => words(l));
    expect(new Set(labels).size).toBe(2);
  });
});

/* ───────────────────────── Scoring & reviews ───────────────────────── */

describe("Scoring & reviews", () => {
  const scoringBody = () => ({
    settings: { reviewCadences: { ...DEFAULT_CADENCES, weekly: { ...DEFAULT_CADENCES.weekly, autoOpen: false } } },
    viewer: { canEditScoring: state.canEditScoring },
  });

  it("no native checkbox: Open the cycle automatically is a Switch its words name and toggle", () => {
    state.canEditScoring = true;
    state.body = scoringBody();
    const markup = html(h(ScoringSettingsPage));
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).toMatch(/<button type="button" id="scoring-cadence-weekly-auto" role="switch" aria-checked="false"/);
    expect(markup).toContain('<label for="scoring-cadence-weekly-auto" id="scoring-cadence-weekly-auto-label">Open the cycle automatically</label>');
  });

  it("the weekday and month are pickers named by the words shown before them, which open them", () => {
    state.body = scoringBody();
    const markup = html(h(ScoringSettingsPage));
    expect(markup).toContain('<label for="scoring-weekly-anchor">Due on</label>');
    const trigger = /<button type="button" id="scoring-weekly-anchor" aria-labelledby="([^"]+)" aria-haspopup="listbox"/.exec(markup);
    expect(trigger, "the weekday trigger").toBeTruthy();
    const [nameId, valueId] = trigger![1].split(" ");
    expect(markup).toContain(`<span id="${nameId}" hidden="">Due on</span>`);
    expect(markup).toMatch(new RegExp(`<span id="${valueId}"[^>]*>Friday</span>`));
  });

  it("every cadence is a SettingsRow, and Open the talent grid is the bands card's last line, not a link under the cards", () => {
    state.body = scoringBody();
    const all = elements(treeOf(ScoringSettingsPage, {} as never));
    const cadenceRows = all.filter((e) => e.type === SettingsRow);
    expect(cadenceRows.map((r) => words(r.props.label))).toEqual(["Weekly check-in", "Monthly pulse", "Quarterly review", "Annual appraisal"]);
    const markup = html(h(ScoringSettingsPage));
    expect(sectionById(markup, "scoring.bands")).toContain('href="/talent"');
  });

  it("a read-only viewer reads each cadence as words, in the singular for one day", async () => {
    state.canEditScoring = false;
    state.body = scoringBody();
    const markup = text(html(h(ScoringSettingsPage)));
    expect(markup).toContain("Friday · remind 1 day before");
    expect(markup).not.toContain("1 days");
    state.canEditScoring = true;
    const { cadenceSummary } = await import("@/app/(dashboard)/settings/scoring/scoring-ui");
    expect(cadenceSummary("monthly", { anchor: 1, reminderLeadDays: 3, autoOpen: true })).toBe("Day 1 of the month · remind 3 days before · opens itself");
  });
});

/* ───────────────────────── Data ───────────────────────── */

describe("Data > Export", () => {
  // Final Settings review, M6 and M4: the Export card has its title, Legacy is its h3 sub-heading, and Recent
  // exports is a titled TableCard, its 16/600 title inside the table's own border.
  it("the legacy downloads sit under the Export card's 13/500 sub-heading, and Recent exports is a titled TableCard", () => {
    state.query = "";
    state.pathname = "/settings/data";
    const markup = html(h(DataSettingsPage));
    expect(markup).toMatch(/<section id="data\.export" class="[^"]*"><header[^>]*><div[^>]*><h2 class="text-lg font-semibold text-ink">Export<\/h2>/);
    expect(markup).toContain('<h3 class="text-sm font-medium text-ink">Legacy</h3>');
    expect(markup).not.toMatch(/uppercase tracking-\[0\.06em\][^>]*>Legacy/);
    expect(markup).toMatch(/<div class="os-tc [^"]*" role="table" aria-labelledby="[^"]+"><div data-table-title="" class="[^"]*"><div class="min-w-0 flex-1"><h2 id="[^"]+" class="text-lg font-semibold text-ink">Recent exports<\/h2>/);
  });

  it("the full workspace row keeps what pressing it costs visible and opens the rest under Show more", () => {
    const markup = html(h(DataSettingsPage));
    const row = markup.slice(markup.indexOf('id="data.export.all"'), markup.indexOf('id="data.export.people"'));
    // Final Settings review, M13: what is left out and that the page stays open, both on the line.
    expect(text(row)).toContain("Keep this page open while it runs.");
    expect(text(row)).toContain("Not files, canvases, forms or chat.");
    // Final Settings review, L6: the link is named for its row.
    expect(row).toMatch(/<button type="button" class="[^"]*" aria-expanded="false" aria-controls="[^"]+">Show more<span class="sr-only"> about Full workspace \(ZIP\)<\/span><\/button>/);
    const hidden = /<div id="[^"]+" hidden=""[^>]*>([\s\S]*?)<\/div>/.exec(row);
    expect(text(hidden?.[1] ?? "")).toContain("Not included: files and attachments");
  });

  // Final Settings review, M4: one table style. The recent exports are a titled TableCard, not a hand-built table.
  it("the recent exports table is a titled TableCard, and says when there are none or the read failed", async () => {
    const { RecentExportsTable } = await import("@/app/(dashboard)/settings/data/data-cards");
    const rows = [{ id: "e1", when: "2026-09-30T10:00:00.000Z", who: "VerifyAdmin Bot", what: "Exported the audit log (2121 events)", kind: "audit" }];
    const markup = html(h(RecentExportsTable, { rows }));
    expect(markup).toMatch(/^<div class="os-tc /);
    expect(markup).not.toContain("<table");
    // What happened first, then who, then when (My settings > Security's order); a date never breaks.
    expect([...markup.matchAll(/role="columnheader"[^>]*>[\s\S]*?<span class="truncate">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(["What", "Who", "When"]);
    expect(markup).toMatch(/role="cell" class="[^"]*whitespace-nowrap[^"]*">2026-09-30/);
    expect(text(markup)).toContain("VerifyAdmin Bot");
    expect(text(html(h(RecentExportsTable, { rows: [] })))).toContain("No exports yet");
    expect(text(html(h(RecentExportsTable, { rows: null, failed: true, onRetry: () => {} })))).toContain("Couldn't load the recent exports · Try again");
    // Still loading: skeleton rows, inside the same titled card.
    expect(html(h(RecentExportsTable, { rows: null }))).toContain("os-skeleton-pulse");
  });
});

describe("Data > Retention & privacy: each card over the read it saves through", () => {
  const body = { settings: { retention: { trashDays: 60, auditDays: null }, data: { selfExport: true, aiEnabled: true, aiFields: false, aiTalkUpdates: false } } };

  it("the view waits for both reads, then gives each card its own state", async () => {
    const { retentionTabView } = await import("@/app/(dashboard)/settings/data/data-ui");
    expect(retentionTabView("ready", "loading", false)).toEqual({ kind: "loading" });
    expect(retentionTabView("loading", "ready", true)).toEqual({ kind: "loading" });
    expect(retentionTabView("loading", "ready", false)).toEqual({ kind: "cards", retention: null, privacy: "form" });
    expect(retentionTabView("error", "ready", false)).toEqual({ kind: "cards", retention: null, privacy: "form" });
    expect(retentionTabView("ready", "error", true)).toEqual({ kind: "cards", retention: "form", privacy: "error" });
  });

  it("a failed read of the privacy section is the card's ErrorState with Try again, never switches whose every save is refused", () => {
    state.query = "tab=retention";
    state.body = body;
    state.sections = { retention: "ready", data: "error" };
    const markup = html(h(DataSettingsPage));
    expect(text(markup)).toContain("Couldn't load the privacy settings");
    expect(text(markup)).toContain("Try again");
    expect(markup).not.toContain('role="switch"');
  });

  it("a failed retention read never hides the privacy switches when the retention card is not shown", () => {
    state.sections = { retention: "error", data: "ready" };
    const markup = html(h(DataSettingsPage));
    expect(text(markup)).not.toContain("Couldn't load the retention settings");
    expect(markup).toMatch(/role="switch" aria-checked="true" aria-label="AI features for everyone"/);
  });

  it("while the privacy read is out the tab shows its loading rows, not switches drawn from the other read", () => {
    state.sections = { retention: "ready", data: "loading" };
    const markup = html(h(DataSettingsPage));
    expect(markup).not.toContain('role="switch"');
    expect(markup).not.toContain(">Privacy<");
    state.sections = {};
    state.query = "";
  });

  it("the audit window's row says what it removes, and what the purge always keeps opens under Show more", () => {
    state.query = "tab=retention";
    state.showUpcoming = true;
    state.sections = {};
    state.body = { settings: { ...body.settings, retention: { trashDays: 60, auditDays: 400 } } };
    const markup = html(h(DataSettingsPage));
    const row = markup.slice(markup.indexOf('id="data.retention.auditDays"'));
    expect(text(row)).toContain("entries older than this are removed for good");
    // Final Settings review, L6: the link is named for its row.
    expect(row).toMatch(/aria-expanded="false"[^>]*>Show more<span class="sr-only"> about Keep the audit log for<\/span><\/button>/);
    const hidden = /<div id="[^"]+" hidden=""[^>]*>([\s\S]*?)<\/div>/.exec(row);
    expect(text(hidden?.[1] ?? "")).toContain("Always kept: review decisions");
    state.showUpcoming = false;
    state.query = "";
  });

  it("the AI key card draws nothing while its read is out when Data asks for that, never rows that then vanish under Privacy", () => {
    expect(html(h(ByokManager, { quietWhileLoading: true }))).toBe("");
  });
});

describe("Data > Trash", () => {
  it("is a link card: its title, what Trash keeps, the link with its count, what stays in storage visible, no illustration", async () => {
    const { TrashCard } = await import("@/app/(dashboard)/settings/data/data-cards");
    const all = elements(treeOf(TrashCard, { purges: false, info: { total: 12, capped: false, retentionDays: 30 } }));
    const card = all.find((e) => e.type === SettingsCard);
    expect(card?.props.title).toBe("Trash");
    expect(String(card?.props.description)).toContain("stay in Trash until an Owner or Admin deletes them for good");
    expect(all.some((e) => e.type === DotsArt)).toBe(false);
    // Final Settings review, M5: Open Trash is the card's title action; the body is status lines only.
    const raw = html(h(TrashCard, { purges: false, info: { total: 12, capped: false, retentionDays: 30 } }));
    expect(/<header[\s\S]*?<\/header>/.exec(raw)?.[0] ?? "").toMatch(/<a [^>]*href="\/trash"[^>]*>Open Trash<\/a>/);
    const markup = text(raw);
    expect(markup).toContain("12 items in Trash");
    expect(markup).not.toContain("Open Trash ·");
    expect(markup).toContain("email privacy@workwrk.com");
  });
});

describe("Data > Import: Marketing (legacy) is one card with ordinary rows", () => {
  const counts = { campaigns: 8, content: 3, events: 2 };
  const waitingState = {
    counts,
    hasRows: true,
    migrated: { spaceSlug: "marketing", lists: {} },
    moved: { campaigns: 7, content: 3, events: 2 },
    pending: { toWrite: { campaigns: 1, content: 0, events: 0 }, trashed: { campaigns: 0, content: 0, events: 0 }, toRedate: 0, zone: "UTC" },
  };

  it("a failed read is the card's ErrorState, whose Try again is the read again", async () => {
    const { MarketingLegacyCard } = await import("@/app/(dashboard)/settings/data/data-cards");
    const onRetry = vi.fn();
    const all = elements(treeOf(MarketingLegacyCard, { state: "error", wanted: false, pulse: false, preview: null, running: null, busy: null, onRetry, onRun: () => {}, onExport: () => {} }));
    expect(all.find((e) => e.type === SettingsCard)?.props.title).toBe("Marketing (legacy)");
    const err = all.find((e) => e.type === ErrorState);
    expect(err?.props.onRetry).toBe(onRetry);
    expect(String(err?.props.title)).toContain("Couldn't check whether this workspace has anything from the retired Marketing module");
  });

  it("its line keeps every word of what Import does, its Import is secondary and calls Import, and its CSVs are SettingsRows", async () => {
    const { MarketingLegacyCard } = await import("@/app/(dashboard)/settings/data/data-cards");
    const onRun = vi.fn();
    const props = { state: waitingState as never, wanted: false, pulse: false, preview: null, running: null, busy: null, onRetry: () => {}, onRun, onExport: () => {} };
    const all = elements(treeOf(MarketingLegacyCard, props));
    const card = all.find((e) => e.type === SettingsCard)!;
    expect(text(html(h("p", null, card.props.description as ReactNode)))).toContain("1 campaign still waits: Import brings it over, and nothing is deleted. Everyone can view the Space; add people to it to let them edit.");
    const importBtn = all.find((e) => e.type === "button" && words(e).trim().endsWith("Import"))!;
    expect(String(importBtn.props.className)).not.toContain("bg-brand");
    (importBtn.props.onClick as () => void)();
    expect(onRun).toHaveBeenCalledWith(true);
    expect(all.filter((e) => e.type === SettingsRow).map((r) => r.props.label)).toEqual(["Campaigns as a CSV", "Content as a CSV", "Events as a CSV"]);
    const markup = html(h(MarketingLegacyCard, props));
    expect(markup).not.toMatch(/text-ink-3|rounded-xl/);
  });

  it("draws nothing for a workspace that never held a row, unless /marketing sent the person here", async () => {
    const { MarketingLegacyCard } = await import("@/app/(dashboard)/settings/data/data-cards");
    const empty = { counts: { campaigns: 0, content: 0, events: 0 }, hasRows: false, migrated: null, moved: { campaigns: 0, content: 0, events: 0 }, pending: null };
    const base = { state: empty as never, pulse: false, preview: null, running: null, busy: null, onRetry: () => {}, onRun: () => {}, onExport: () => {} };
    expect(html(h(MarketingLegacyCard, { ...base, wanted: false }))).toBe("");
    expect(text(html(h(MarketingLegacyCard, { ...base, wanted: true })))).toContain("Open the template");
  });
});

/* ───────────────────────── The Phase 6 review's fixes ───────────────────────── */

type TypeRow = { id: string; singular: string; plural: string; icon: string; description: string | null; category: string | null; isDefault: boolean; builtIn: boolean };
const TYPE = (id: string, singular: string, extra: Partial<TypeRow> = {}): TypeRow => ({ id, singular, plural: `${singular}s`, icon: "CircleDot", description: null, category: null, isDefault: false, builtIn: false, ...extra });
const typesProps = (onUsage: (s: unknown) => void = () => {}) => ({ createOpen: false, onCreateOpenChange: () => {}, onUsage });
/** TaskTypesTab's useState calls, in order: what each index holds. */
const TT = { types: 0, recommended: 1, menu: 6 };

describe("Phase 6 review M1: New type while the task types read has failed", () => {
  it("is grey, its title says to try again first, and the full list's reason is unchanged", async () => {
    const { newTypePrimary, NEW_TYPE_READ_FAILED } = await import("@/app/(dashboard)/settings/tasks/task-system-ui");
    const failed = newTypePrimary("error", () => {});
    expect(failed.disabled).toBe(true);
    expect(failed.title).toBe("Couldn't load the task types. Try again first.");
    expect(NEW_TYPE_READ_FAILED).toBe(failed.title);
    expect(newTypePrimary({ used: 20, limit: 20 }, () => {}).title).toMatch(/All 20 custom types are in use/);
    expect(newTypePrimary(null, () => {}).disabled).toBe(false);
  });

  it("the tab tells the page when its read fails, by an error answer or a thrown fetch, and the page greys its New type", async () => {
    for (const failing of [async () => ({ ok: false, status: 500, json: async () => ({}) }), async () => { throw new Error("offline"); }]) {
      const onUsage = vi.fn();
      vi.stubGlobal("fetch", vi.fn(failing));
      try {
        withEffects(() => treeOf(TaskTypesTab, typesProps(onUsage)));
        await vi.waitFor(() => expect(onUsage).toHaveBeenCalledWith("error"));
      } finally { vi.unstubAllGlobals(); }
    }
    // The page holds what the tab said (its second state) and draws the primary from it.
    const tree = withSeed([[1, "error"]], () => treeOf(TaskSystemPage, {} as never));
    const page = elements(tree).find((e) => Array.isArray(e.props.tabs));
    const types = (page?.props.tabs as Array<{ key: string; primary?: { disabled?: boolean; title?: string } }>).find((t) => t.key === "types");
    expect(types?.primary?.disabled).toBe(true);
    expect(types?.primary?.title).toBe("Couldn't load the task types. Try again first.");
  });
});

describe("Phase 6 review L9 and L10: Make default keeps focus, on the desktop buttons and the phone menu", () => {
  const BUG = TYPE("b1", "Bug");
  const MILESTONE = TYPE("m1", "Milestone", { builtIn: true });
  const TASK = TYPE("t1", "Task", { builtIn: true, isDefault: true });

  it("the name cell is a focus target out of the Tab order, and Make default sends its PATCH and moves focus there", () => {
    const table = elements(treeOf(TaskTypesTab, typesProps())).find((e) => e.type === TableCard)!;
    const cols = table.props.columns as TableColumn<TypeRow>[];
    const cell = elements(cols[0].render(BUG, 0)).find((e) => e.props.tabIndex === -1);
    expect(cell?.props.id, "the name cell").toBeTruthy();
    const make = elements((table.props.rowMenu as (t: TypeRow) => ReactNode)(BUG)).find((e) => e.type === "button" && words(e) === "Make default")!;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const { focused } = stubBrowser();
    vi.stubGlobal("fetch", fetchMock);
    try {
      (make.props.onClick as () => void)();
      expect(fetchMock).toHaveBeenCalledWith("/api/item-types/b1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ isDefault: true }) }));
      // The button goes with the swap; focus goes to the row's name, never the page.
      expect(focused).toEqual([cell!.props.id]);
    } finally { vi.unstubAllGlobals(); }
  });

  it("below 640px a row's actions are one \"...\" named by the type, none on the built-in default, and its menu's Make default keeps focus", () => {
    state.snapshot = true;
    const anchor = { focus: vi.fn() };
    let tree: unknown;
    try {
      tree = withSeed([[TT.menu, { type: BUG, anchor: { current: anchor } }]], () => treeOf(TaskTypesTab, typesProps()));
    } finally { state.snapshot = undefined; }
    const table = elements(tree).find((e) => e.type === TableCard)!;
    const rowMenu = table.props.rowMenu as (t: TypeRow) => ReactNode;
    expect(table.props.rowMenuWidth).toBe(44);
    const more = elements(rowMenu(BUG))[0];
    expect(more?.type).toBe(RowMoreButton);
    expect(more?.props.label).toBe("Actions for Bug");
    expect(elements(rowMenu(MILESTONE))[0]?.type).toBe(RowMoreButton);
    expect(rowMenu(TASK)).toBeNull();

    const portal = elements(tree).find((e) => e.type === MorePortal)!;
    const items = elements(portal.props.children).filter((e) => e.type === MenuItem);
    expect(items.map((i) => i.props.label)).toEqual(["Make default", "Delete"]);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const { focused } = stubBrowser();
    vi.stubGlobal("fetch", fetchMock);
    try {
      (items[0].props.onClick as () => void)();
      expect(fetchMock).toHaveBeenCalledWith("/api/item-types/b1", expect.objectContaining({ method: "PATCH" }));
      expect(anchor.focus).toHaveBeenCalled(); // the menu hands focus back to its "..." first
      expect(focused).toEqual(["task-type-name-b1"]); // then the new default's name takes it
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("Phase 6 review L10: Templates' \"Choose a type\" never sends a PATCH", () => {
  it("with no stored default the picker reads Choose a type, and only a real choice saves", async () => {
    const types = [{ id: "t1", singular: "Task", isDefault: false }, { id: "t2", singular: "Bug", isDefault: false }];
    const tree = withSeed([[0, types]], () => treeOf(TemplatesTab, {} as never));
    const picker = elements(tree).find((e) => e.type === PickerSelect)!;
    expect(picker.props.value).toBe("");
    expect(picker.props.placeholder).toBe("Choose a type");
    expect(text(withSeed([[0, types]], () => html(h(TemplatesTab))))).toContain("Choose a type");
    state.apiCalls = [];
    (picker.props.onChange as (v: string) => void)("");
    await Promise.resolve();
    expect(state.apiCalls).toEqual([]);
    (picker.props.onChange as (v: string) => void)("t2");
    await vi.waitFor(() => expect(state.apiCalls.length).toBeGreaterThan(1));
    // The choice is saved, then the list is read again.
    expect(state.apiCalls).toEqual([["/api/item-types/t2", { method: "PATCH", json: { isDefault: true } }], ["/api/item-types", { cache: "no-store" }]]);
  });
});

describe("Phase 6 review extra: the Recommended library below 640px", () => {
  const REC = [{ singular: "Bug", plural: "Bugs", icon: "Bug", description: "A defect to fix", category: "Engineering" }];
  const rows = (phone: boolean) => {
    state.snapshot = phone || undefined;
    try {
      const tree = withSeed([[TT.types, []], [TT.recommended, REC]], () => treeOf(TaskTypesTab, typesProps()));
      const card = elements(tree).find((e) => e.type === SettingsCard && e.props.title === "Recommended")!;
      return elements(card.props.children).filter((e) => e.type === SettingsRow);
    } finally { state.snapshot = undefined; }
  };

  it("keeps Add on the name's line as a 32px icon-only \"+\" named Add {type}, with no control line under it; wider, the ghost Add stays", () => {
    const [row] = rows(true);
    expect(row.props.control).toBeUndefined();
    const add = elements(row.props.label).find((e) => e.type === "button")!;
    expect(add.props["aria-label"]).toBe("Add Bug");
    expect(String(add.props.className)).toMatch(/\bh-8\b.*\bw-8\b/);
    expect(words(add).trim()).toBe("");
    expect(words(row.props.label)).toContain("Bug");

    // From 640px the row keeps its ghost Add as the control.
    const [wide] = rows(false);
    expect(wide.props.label).toBe("Bug");
    const ghost = elements(wide.props.control)[0];
    expect(ghost?.props["aria-label"]).toBe("Add Bug");
    expect(String(ghost?.props.className)).toContain("os-btn-ghost");
    expect(words(ghost)).toContain("Add");
  });
});

describe("Phase 6 review L1: the AI key card where it is the whole tab", () => {
  it("shows skeleton rows while its read is out by default (API > AI keys), and Data asks it to stay quiet", () => {
    const markup = html(h(ByokManager));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("os-skeleton-pulse");
    state.query = "tab=retention";
    state.pathname = "/settings/data";
    state.sections = {};
    state.body = { settings: { retention: { trashDays: 60, auditDays: null }, data: { selfExport: true, aiEnabled: true, aiFields: false, aiTalkUpdates: false } } };
    expect(html(h(DataSettingsPage))).not.toContain("os-skeleton-pulse");
    state.query = "";
  });
});

describe("Phase 6 review L2 to L4 and L8: Scoring's names and words", () => {
  const body = () => ({ settings: { reviewCadences: DEFAULT_CADENCES }, viewer: { canEditScoring: state.canEditScoring } });

  it("each cadence's fields are named with the cadence first, so no two fields on the page share a name", () => {
    state.canEditScoring = true;
    state.body = body();
    const markup = html(h(ScoringSettingsPage));
    expect(markup).toContain('aria-label="Weekly check-in, remind days before"');
    expect(markup).toContain('aria-label="Monthly pulse, remind days before"');
    expect(markup).toContain('aria-label="Quarterly review, remind days before"');
    expect(markup).toContain('aria-label="Monthly pulse, opens on day"');
    expect(markup).toContain('aria-label="Quarterly review, opens on day"');
    expect(markup).toMatch(/id="scoring-cadence-weekly-auto" role="switch" aria-checked="true" aria-labelledby="scoring-cadence-weekly scoring-cadence-weekly-auto-label"/);
    const cadence = sectionById(markup, "scoring.cadence");
    const names = [...cadence.matchAll(/<input[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toHaveLength(5); // three reminders, two day numbers (Due on is a picker)
    expect(new Set(names).size).toBe(names.length);
  });

  it("a read-only cadence line starts with a capital", async () => {
    state.canEditScoring = false;
    state.body = body();
    const markup = text(html(h(ScoringSettingsPage)));
    expect(markup).toContain("Day 1 of the month · remind 3 days before · opens itself");
    expect(markup).toContain("Day 1 of the quarter · remind 7 days before · opens itself");
    expect(markup).not.toMatch(/\bday 1 of the/);
    state.canEditScoring = true;
  });

  it("US spelling: Behavioral anchors on the card and in search, behavior in the weights' search line, Behavioral in its reset words", () => {
    state.body = body();
    const markup = html(h(ScoringSettingsPage));
    expect(markup).toContain(">Behavioral anchors<");
    expect(markup).not.toMatch(/Behaviour/i);
    expect(SETTINGS_ENTRIES["scoring.anchors"].label).toBe("Behavioral anchors");
    expect(SETTINGS_ENTRIES["scoring.weights"].description).toBe("How KPIs, SOPs, behavior and peers add up.");
    // The weights card's reset dialog (its fourth state: which card is being reset).
    const tree = withSeed([[3, "weights"]], () => treeOf(ScoringSettingsPage, {} as never));
    const dialog = elements(tree).find((e) => e.props.title === "Reset to defaults?")!;
    expect(words(dialog.props.children)).toContain("KPI 40, SOP compliance 20, Behavioral 30, Peer 10.");
  });

  it("the bands line says what each place does with the bands", () => {
    state.body = body();
    const bands = text(sectionById(html(h(ScoringSettingsPage)), "scoring.bands"));
    expect(bands).toContain("Reviews and calibration name scores with these bands, and the talent grid places people by them.");
    expect(bands).not.toContain("Reviews, calibration and the talent grid show these bands");
  });
});

describe("Phase 6 review L5 to L7: Data and Tags", () => {
  it("each recent export cell has room above and below when it wraps at 390 (py-2), and its row grows", async () => {
    const { RecentExportsTable } = await import("@/app/(dashboard)/settings/data/data-cards");
    const rows = [{ id: "e1", when: "2026-09-30T10:00:00.000Z", who: "VerifyAdmin Bot", what: "Exported the audit log (2121 events)", kind: "audit" }];
    const markup = html(h(RecentExportsTable, { rows }));
    const cells = [...markup.matchAll(/role="cell" class="([^"]*)"/g)].map((m) => m[1]);
    expect(cells).toHaveLength(3);
    for (const c of cells) expect(c.split(" ")).toContain("py-2");
    expect(markup).toContain("min-height:var(--os-row-h)");
  });

  it("a long tag name ends in an ellipsis: the name is its own truncating span inside a chip held to the line", () => {
    const long = "A very long tag name that will not fit on a phone card at all, it keeps going";
    // Shown with Show archived on (its second state), so the "Archived" word is drawn beside the name.
    const markup = withSeed([[1, true]], () => html(h(TagsManager, { initial: [{ id: "t9", name: long, type: "CUSTOM", color: null, description: null, archived: true, assignmentCount: 0 }] })));
    expect(markup).toContain(`<span class="min-w-0 truncate">${long}</span>`);
    const chip = new RegExp(`<span class="flex min-w-0"><span class="([^"]*)" title="${long}">`).exec(markup);
    expect(chip?.[1]).toContain("max-w-full");
    // "Archived" never gives way to the name.
    expect(markup).toMatch(/<span class="shrink-0 text-sm font-normal text-ink-2">Archived<\/span>/);
  });

  // Final Settings review, M6: the Export card has an h2 title now, so Legacy is an h3 under it.
  it("Legacy is an h3 under the Export card's h2: the Export tab skips no heading level", () => {
    state.query = "";
    state.pathname = "/settings/data";
    const markup = html(h(DataSettingsPage));
    expect(markup).toContain('<h3 class="text-sm font-medium text-ink">Legacy</h3>');
    expect(markup.indexOf(">Export</h2>")).toBeGreaterThan(0);
    expect(markup.indexOf(">Export</h2>")).toBeLessThan(markup.indexOf(">Legacy</h3>"));
    expect(markup).not.toContain("<h4");
  });
});
