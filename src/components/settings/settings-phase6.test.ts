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
}));

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, Suspense: ({ children }: { children?: import("react").ReactNode }) => children };
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
  return { ...real, apiFetch: async () => ({ ok: true, status: 200, data: {} }) };
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
    const chip = /<span class="([^"]*)" title="Migration fixture">Migration fixture<\/span>/.exec(markup);
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
    expect(markup).toContain('<label for="scoring-cadence-weekly-auto">Open the cycle automatically</label>');
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
    expect(cadenceSummary("monthly", { anchor: 1, reminderLeadDays: 3, autoOpen: true })).toBe("day 1 of the month · remind 3 days before · opens itself");
  });
});

/* ───────────────────────── Data ───────────────────────── */

describe("Data > Export", () => {
  it("the legacy downloads sit under the card's 13/500 sub-heading, and Recent exports is a card with its title", () => {
    state.query = "";
    state.pathname = "/settings/data";
    const markup = html(h(DataSettingsPage));
    expect(markup).toContain('<h3 class="text-sm font-medium text-ink">Legacy</h3>');
    expect(markup).not.toMatch(/uppercase tracking-\[0\.06em\][^>]*>Legacy/);
    // Recent exports' heading is a SettingsCard's 16/600 title inside the card's own bordered section.
    expect(markup).toMatch(/<section class="[^"]*rounded-lg border[^"]*"><header[^>]*><div[^>]*><h2 class="text-lg font-semibold text-ink">Recent exports<\/h2>/);
  });

  it("the full workspace row keeps what pressing it costs visible and opens the rest under Show more", () => {
    const markup = html(h(DataSettingsPage));
    const row = markup.slice(markup.indexOf('id="data.export.all"'), markup.indexOf('id="data.export.people"'));
    expect(text(row)).toContain("keep this page open");
    expect(text(row)).toContain("without files or attachments");
    expect(row).toMatch(/<button type="button" class="[^"]*" aria-expanded="false" aria-controls="[^"]+">Show more<\/button>/);
    const hidden = /<div id="[^"]+" hidden=""[^>]*>([\s\S]*?)<\/div>/.exec(row);
    expect(text(hidden?.[1] ?? "")).toContain("Not included: files and attachments");
  });

  it("the recent exports table is rows inside its card, no box of its own, and says when there are none", async () => {
    const { RecentExportsTable } = await import("@/app/(dashboard)/settings/data/data-cards");
    const rows = [{ id: "e1", when: "2026-09-30T10:00:00.000Z", who: "VerifyAdmin Bot", what: "Exported the audit log (2121 events)", kind: "audit" }];
    const markup = html(h(RecentExportsTable, { rows }));
    expect(markup).toContain('<table aria-label="Recent exports"');
    // What happened first, then who, then when (My settings > Security's order); a date never breaks.
    expect([...markup.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1])).toEqual(["What", "Who", "When"]);
    expect(markup).toMatch(/<td class="[^"]*whitespace-nowrap[^"]*">2026-09-30/);
    expect(text(markup)).toContain("VerifyAdmin Bot");
    expect(markup).not.toMatch(/rounded-lg border/);
    expect(text(html(h(RecentExportsTable, { rows: [] })))).toContain("No exports yet");
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
    expect(row).toMatch(/aria-expanded="false"[^>]*>Show more<\/button>/);
    const hidden = /<div id="[^"]+" hidden=""[^>]*>([\s\S]*?)<\/div>/.exec(row);
    expect(text(hidden?.[1] ?? "")).toContain("Always kept: review decisions");
    state.showUpcoming = false;
    state.query = "";
  });

  it("the AI key card draws nothing while its read is out, never rows that then vanish", () => {
    expect(html(h(ByokManager))).toBe("");
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
    const markup = text(html(h(TrashCard, { purges: false, info: { total: 12, capped: false, retentionDays: 30 } })));
    expect(markup).toContain("Open Trash · 12 items in Trash");
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
