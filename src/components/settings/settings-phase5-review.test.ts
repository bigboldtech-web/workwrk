// Settings clean-up Phase 5 review (1 high, 1 medium, 9 low), and the sweep
// of every other Settings card for the high one's pattern.
//
// H1: a failed Work week read filled the card with the defaults and its
// banner's Retry SAVED them. What the card does now is driven through its own
// reducer and load and save steps (work-week-state.ts) with the requests
// faked, and its views are walked as the element trees they return, so the
// handler a button carries is the one asserted, not only the markup.
//
// The modules new with this fix are imported inside the tests that need
// them, so on the code before it each test fails on its own assertion rather
// than the whole file failing to load.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  query: "",
  role: "ADMIN" as "OWNER" | "ADMIN" | "MEMBER",
  section: null as unknown,
  /** What the prompt dialog answers. */
  promptAnswer: null as string | null,
  /** Every request the faked apiFetch was asked for. */
  requests: [] as Array<{ url: string; method: string; json?: unknown }>,
}));

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, Suspense: ({ children }: { children?: import("react").ReactNode }) => children };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/locale",
  useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "o1" } }, status: "authenticated", update: async () => null }),
  signOut: async () => {},
}));
vi.mock("@/components/ui/dialog-provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/dialog-provider")>();
  return { ...real, useConfirm: () => async () => true, usePrompt: () => async () => state.promptAnswer };
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
vi.mock("@/lib/api-fetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api-fetch")>();
  return {
    ...real,
    apiFetch: async (url: string, init: { method?: string; json?: unknown } = {}) => {
      state.requests.push({ url, method: init.method ?? "GET", json: init.json });
      return { ok: true, status: 200, data: {} };
    },
  };
});

import { ErrorState } from "@/components/ui/error-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TableCard } from "@/components/ui/table-card";
import { toggleChipClass } from "@/components/layout/os/page-header/page-header";
import { AppearanceDefaultsCard, type AppearanceState } from "@/app/(dashboard)/settings/identity/appearance-defaults";
import LocaleSettingsPage from "@/app/(dashboard)/settings/locale/page";
import * as workWeekCard from "@/app/(dashboard)/settings/locale/work-week-card";
import AccessSettingsPage from "@/app/(dashboard)/settings/access/page";
import * as grid from "./permission-grid";
import * as publicLinks from "./public-links-card";
import { SettingsCard } from "./settings-card";
import { OrganizeListTab } from "./organize-list-tab";
import { WORK_SCHEDULE_DEFAULTS, type WorkSchedule } from "@/lib/work-schedule";
import { cn } from "@/lib/utils";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const tick = () => new Promise((r) => setTimeout(r, 0));

type El = { type: unknown; props: Record<string, unknown> };
/** Every element in a tree a component returned (its own elements; children components are not called). */
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
const labelOf = (el: El): string => {
  const c = el.props.children;
  return (Array.isArray(c) ? c : [c]).filter((x) => typeof x === "string").join("").trim();
};

/** The workspace's real week: four days, seven and a half hours, a zone, a holiday. */
const REAL: WorkSchedule = { workdays: [1, 2, 3, 4], hoursPerDay: 7.5, timezone: "Europe/London", holidays: [{ date: "2026-09-23", name: "Founders Day" }] };
const ok = (schedule: WorkSchedule) => ({ ok: true as const, status: 200, data: { schedule, configured: true, canEdit: true } });
const down = { ok: false as const, status: 503, error: "Couldn't read the working calendar. Try again in a moment." };

describe("H1: a failed Work week read never becomes a week anyone can save", () => {
  it("a failed first read leaves nothing on screen or saved, draws ErrorState whose Try again READS again, and no PUT is ever sent", async () => {
    const ws = await import("@/app/(dashboard)/settings/locale/work-week-state");
    const calls: string[] = [];
    const answers: Array<typeof down | ReturnType<typeof ok>> = [down, ok(REAL)];
    const get = async () => { calls.push("GET"); return answers.shift()!; };
    const put = async () => { calls.push("PUT"); return { ok: true as const, status: 200, data: {} }; };
    let st = ws.WORK_WEEK_START;
    const dispatch = (a: Parameters<typeof ws.workWeekReducer>[1]) => { st = ws.workWeekReducer(st, a); };

    await ws.loadWorkWeek(dispatch, get);
    // Never the defaults: nothing at all, and the server's own sentence.
    expect(st.schedule).toBeNull();
    expect(st.saved).toBeNull();
    expect(st.problem).toEqual({ kind: "load", message: down.error });
    expect(ws.workWeekDirty(st)).toBe(false);
    // Nothing read is nothing to save: the save (the dirty guard's onSave too) sends no request.
    expect(await ws.saveWorkWeek(st, dispatch, put)).toBe(true);
    expect(calls).toEqual(["GET"]);

    // The card in that state is ErrorState inside the Work week card, and its
    // Try again is the reload it was handed, never a save. No week is drawn.
    const reload = vi.fn();
    const failed = workWeekCard.WorkWeekLoadFailed({ message: st.problem!.message, onRetry: reload });
    const es = elements(failed).find((e) => e.type === ErrorState);
    expect(es?.props.onRetry).toBe(reload);
    const m = html(failed as Parameters<typeof html>[0]);
    expect(text(m)).toContain("Couldn't load the working calendar");
    expect(text(m)).toContain("Try again");
    expect(text(m)).toContain(down.error);
    expect(m).not.toContain("aria-pressed");
    expect(m).not.toContain("Save work week");
    expect(m).not.toContain('type="number"');
    // The card wires it so: the first-read failure draws WorkWeekLoadFailed with reload, and reload reads.
    const src = read("src/app/(dashboard)/settings/locale/work-week-card.tsx");
    expect(src).toContain("return problem ? <WorkWeekLoadFailed message={problem.message} onRetry={reload} /> : <WorkWeekLoading />;");
    expect(src).toMatch(/const reload = useCallback\(\(\) => \{\s*dispatch\(\{ type: "loadStarted" \}\);\s*void load\(\);\s*\}, \[load\]\);/);
    expect(src).not.toContain("WORK_SCHEDULE_DEFAULTS");

    // Try again: the card's reload, read again. The real week arrives; still no PUT.
    dispatch({ type: "loadStarted" });
    await ws.loadWorkWeek(dispatch, get);
    expect(calls).toEqual(["GET", "GET"]);
    expect(st.problem).toBeNull();
    expect(st.schedule).toEqual(REAL);
    expect(st.saved).toEqual(REAL);
    expect(st.schedule).not.toEqual(WORK_SCHEDULE_DEFAULTS);
  });

  it("a failed read after a real one keeps the real values, never the defaults, and its Retry reads", async () => {
    const ws = await import("@/app/(dashboard)/settings/locale/work-week-state");
    let st = ws.workWeekReducer(ws.WORK_WEEK_START, { type: "loaded", schedule: REAL, canEdit: true });
    st = ws.workWeekReducer(st, { type: "loadFailed", message: "offline" });
    expect(st.schedule).toEqual(REAL);
    expect(st.saved).toEqual(REAL);
    expect(ws.workWeekRetry(st.problem!)).toEqual({ label: "Retry", does: "reload" });
  });

  it("the banner's Retry saves only after a failed save; after a failed read it reads, and after a 409 it is Reload", () => {
    const onSave = vi.fn();
    const onReload = vi.fn();
    const press = (kind: "load" | "save" | "conflict") => {
      onSave.mockClear(); onReload.mockClear();
      const tree = workWeekCard.WorkWeekProblemBanner({ problem: { kind, message: "x" }, onSave, onReload });
      const btn = elements(tree).find((e) => e.type === "button")!;
      (btn.props.onClick as () => void)();
      return { label: labelOf(btn), saved: onSave.mock.calls.length, reloaded: onReload.mock.calls.length };
    };
    expect(press("save")).toEqual({ label: "Retry", saved: 1, reloaded: 0 });
    expect(press("load")).toEqual({ label: "Retry", saved: 0, reloaded: 1 });
    expect(press("conflict")).toEqual({ label: "Reload", saved: 0, reloaded: 1 });
    // The view hands the banner both and draws it for any problem.
    const view = workWeekCard.WorkWeekView({ ...viewProps(), problem: { kind: "load", message: "x" }, onSave, onReload });
    const banner = elements(view).find((e) => e.type === workWeekCard.WorkWeekProblemBanner);
    expect(banner?.props.onReload).toBe(onReload);
    expect(banner?.props.onSave).toBe(onSave);
    expect(elements(view).some((e) => e.type === "button" && e.props.onClick === onSave && labelOf(e) === "Retry")).toBe(false);
  });

  it("a save sends the schedule over the one it read (base), and a 409 keeps the edits and offers Reload", async () => {
    const ws = await import("@/app/(dashboard)/settings/locale/work-week-state");
    const bodies: unknown[] = [];
    let st = ws.workWeekReducer(ws.WORK_WEEK_START, { type: "loaded", schedule: REAL, canEdit: true });
    const dispatch = (a: Parameters<typeof ws.workWeekReducer>[1]) => { st = ws.workWeekReducer(st, a); };
    dispatch({ type: "edit", update: (s) => ({ ...s, hoursPerDay: 6 }) });
    expect(ws.workWeekDirty(st)).toBe(true);
    const conflict = async (b: unknown) => { bodies.push(b); return { ok: false as const, status: 409, error: "changed" }; };
    expect(await ws.saveWorkWeek(st, dispatch, conflict)).toBe(false);
    expect(bodies).toEqual([{ ...REAL, hoursPerDay: 6, base: REAL }]);
    expect(st.problem).toEqual({ kind: "conflict", message: "changed" });
    expect(st.schedule?.hoursPerDay).toBe(6);
    expect(ws.workWeekRetry(st.problem!)).toEqual({ label: "Reload", does: "reload" });
    // A plain failure is a save problem: its Retry saves again.
    const fail = async () => ({ ok: false as const, status: 500, error: "boom" });
    await ws.saveWorkWeek(st, dispatch, fail);
    expect(ws.workWeekRetry(st.problem!)).toEqual({ label: "Retry", does: "save" });
    // A good save makes what was sent the record.
    const good = async () => ({ ok: true as const, status: 200, data: {} });
    expect(await ws.saveWorkWeek(st, dispatch, good)).toBe(true);
    expect(st.saved?.hoursPerDay).toBe(6);
    expect(ws.workWeekDirty(st)).toBe(false);
  });
});

function viewProps() {
  return {
    schedule: REAL, canEdit: true, problem: null, dirty: false, saving: false, newHoliday: { date: null, name: "" }, wallDate: (d: string) => `day ${d}`,
    onDay: () => {}, onHours: () => {}, onRemoveHoliday: () => {}, onNewHoliday: () => {}, onAddHoliday: () => {}, onSave: () => {}, onReload: () => {},
  } as Parameters<typeof workWeekCard.WorkWeekView>[0];
}

describe("the H1 sweep: other cards that showed a failed read as a value they could save", () => {
  it("Public links: a failed read is ErrorState with Try again, never an Off switch", () => {
    expect(publicLinks.publicLinksAfterRead?.({ ok: false, error: "Something went wrong on our side" })).toEqual({ value: null, unset: false, loadError: "Something went wrong on our side" });
    expect(publicLinks.publicLinksAfterRead({ ok: true, data: { settings: { access: { publicLinks: "view" } } } })).toEqual({ value: "view", unset: false, loadError: null });
    expect(publicLinks.publicLinksAfterRead({ ok: true, data: { settings: {} } })).toEqual({ value: "off", unset: true, loadError: null });
    const retry = vi.fn();
    const props = { canEdit: true, value: null, unset: false, saving: false, savedAt: null, failure: null, loadError: "Something went wrong on our side", onRetryLoad: retry, onChange: () => {} };
    const m = html(h(publicLinks.PublicLinksCardView as ComponentType<typeof props>, props));
    expect(text(m)).toContain("Couldn't load the public links setting");
    expect(m).not.toContain('role="switch"');
    const tree = publicLinks.PublicLinksCardView(props);
    expect(elements(tree).find((e) => e.type === ErrorState)?.props.onRetry).toBe(retry);
  });

  it("Your calendar feed: a failed read keeps the feed last read, and none read is not 'No feed link yet'", async () => {
    const { feedAfterRead } = await import("@/components/account/calendar-feed");
    const live = { token: "t1", url: "http://x/api/calendar/ics/t1.ics" };
    expect(feedAfterRead(null, { ok: false, error: "boom" })).toEqual({ feed: null, feedError: "boom" });
    expect(feedAfterRead(live, { ok: false, error: "boom" })).toEqual({ feed: live, feedError: "boom" });
    expect(feedAfterRead(live, { ok: true, data: { token: null } })).toEqual({ feed: { token: null }, feedError: null });
    const src = read("src/app/(dashboard)/account/connections/page.tsx");
    expect(src).not.toContain("f.ok ? f.data : { token: null }");
    expect(src).toContain("setFeed((prev) => feedAfterRead(prev, f).feed);");
    // With nothing read the card draws the error, before the branch that offers Create a feed link.
    const card = src.slice(src.indexOf('id="connections.feed"'));
    expect(card.indexOf('<ErrorState compact what="your calendar feed"')).toBeGreaterThan(0);
    expect(card.indexOf('<ErrorState compact what="your calendar feed"')).toBeLessThan(card.indexOf("Create a feed link"));
    expect(card).toMatch(/\{feed === null \? \(/);
  });

  it("Organize lists: New is held until the list has arrived, and pressing it then writes nothing", async () => {
    state.promptAnswer = "Security";
    state.requests.length = 0;
    const press = async (items: string[] | null) => {
      const tree = treeOf(OrganizeListTab as (p: Parameters<typeof OrganizeListTab>[0]) => ReactNode, { kind: "policy-categories", items, counts: {}, onChanged: () => {} });
      const btn = elements(tree).find((e) => e.type === "button" && labelOf(e).startsWith("New"))!;
      (btn.props.onClick as () => void)();
      await tick(); await tick();
      return btn;
    };
    const held = await press(null);
    expect(held.props["aria-disabled"]).toBe(true);
    expect(state.requests).toEqual([]);
    // Loaded, the same press adds to the real list.
    const live = await press(["Finance"]);
    expect(live.props["aria-disabled"]).toBeUndefined();
    expect(state.requests).toEqual([{ url: "/api/settings", method: "PATCH", json: { section: "process", data: { policyCategories: ["Finance", "Security"] } } }]);
  });

  it("Branding (mounted nowhere today) refuses to save a form the record was never read into", () => {
    const src = read("src/components/settings/branding-manager.tsx");
    expect(src).toMatch(/async function save\(\) \{\s*\/\/[^\n]*\n\s*if \(!data\) return;/);
    expect(src).toContain('<ErrorState compact what="the branding"');
    expect(src).toMatch(/\} else \{\s*\/\/[^\n]*\n\s*setLoadError\(`status \$\{bRes\.status\}`\);/);
  });
});

describe("M1: the working-day chips' on state is a real cue, and the toolbar chips are unchanged", () => {
  it("outlined: an ink border when on, line-strong when off, and the on fill kept on hover", () => {
    const on = toggleChipClass(true, { outlined: true });
    const off = toggleChipClass(false, { outlined: true });
    expect(on).toContain("border border-ink");
    expect(on).toContain("hover:bg-active");
    expect(on).not.toContain("hover:bg-hover");
    expect(on).toContain("bg-active text-ink");
    expect(off).toContain("border border-line-strong");
    expect(off).not.toContain("border-ink");
    // The toolbar's chips (no option) are the same string as before: the old body, rebuilt here.
    const CHIP_36 = "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink";
    expect(toggleChipClass(true)).toBe(cn(CHIP_36, "h-8", "bg-active text-ink"));
    expect(toggleChipClass(false)).toBe(cn(CHIP_36, "h-8", false));
    expect(toggleChipClass(true, {})).toBe(toggleChipClass(true));
    // The seven days use it.
    const m = html(h(workWeekCard.WorkWeekView, viewProps()));
    const days = [...m.matchAll(/<button type="button" aria-pressed="(true|false)" class="([^"]+)">(\w+)<\/button>/g)];
    expect(days).toHaveLength(7);
    for (const d of days) expect(d[2]).toBe(toggleChipClass(d[1] === "true", { outlined: true }));
  });
});

describe("L1, L2, L6, L8: the permission grid", () => {
  const rows = [
    { mod: "sops" as const, action: "create", label: "Create SOPs" },
    { mod: "kras" as const, action: "assign", label: "Assign KRAs to people across every department" },
  ];

  it("L1: What is 180 and each level its header word plus 16, so the grid is 850 wide, not 1040", () => {
    // The words measured at 13/500 in Inter in the browser, rounded up to an even pixel; VP is "Yes" (26).
    const words: Record<string, number> = { SUPER_ADMIN: 42, COMPANY_ADMIN: 40, C_LEVEL: 62, VP: 26, DIRECTOR: 50, HR: 78, MANAGER: 56, TEAM_LEAD: 66, EMPLOYEE: 52, AGENT: 38 };
    expect(grid.WHAT_WIDE).toBe(180);
    for (const [k, w] of Object.entries(words)) expect(grid.LEVEL_WIDTH?.[k as keyof typeof grid.LEVEL_WIDTH], k).toBe(w + 16);
    const g = html(h(grid.PermissionGrid, { rows, ariaLabel: "Enforced permissions", allows: () => false, canEdit: true, onToggle: () => {} }));
    expect(g).toContain('<div style="min-width:850px">');
    expect(g).toContain("[scroll-padding-inline-start:180px]");
    // The level cells pad 8px a side, so the width above is the word plus 16.
    const owner = /<div role="columnheader" class="([^"]+)"[^>]*><span class="inline-flex min-w-0 items-center gap-1"><span class="truncate">Owner</.exec(g)?.[1] ?? "";
    expect(owner.split(" ")).toContain("px-2");
    expect(owner.split(" ")).not.toContain("px-3");
    // On a phone the room beside the narrow pin holds the last two columns whole, Member and Agent.
    expect(292 - 2 - grid.WHAT_NARROW).toBeGreaterThanOrEqual(grid.LEVEL_WIDTH.EMPLOYEE + grid.LEVEL_WIDTH.AGENT);
  });

  it("L1: while the grid can scroll further toward its end a fade sits on that edge, and none at the end", () => {
    expect(grid.canScrollFurther?.({ scrollLeft: 0, scrollWidth: 850, clientWidth: 758 })).toBe(true);
    expect(grid.canScrollFurther({ scrollLeft: 92, scrollWidth: 850, clientWidth: 758 })).toBe(false);
    expect(grid.canScrollFurther({ scrollLeft: 91.5, scrollWidth: 850, clientWidth: 758 })).toBe(false);
    expect(grid.canScrollFurther({ scrollLeft: 40, scrollWidth: 850, clientWidth: 758 })).toBe(true);
    // Right to left scrollLeft runs negative.
    expect(grid.canScrollFurther({ scrollLeft: -40, scrollWidth: 850, clientWidth: 758 })).toBe(true);
    expect(grid.canScrollFurther({ scrollLeft: -92, scrollWidth: 850, clientWidth: 758 })).toBe(false);
    // A grid that fits has nothing further.
    expect(grid.canScrollFurther({ scrollLeft: 0, scrollWidth: 758, clientWidth: 758 })).toBe(false);
    expect(grid.SCROLL_FADE).toContain("pointer-events-none absolute");
    expect(grid.SCROLL_FADE).toContain("end-px");
    const src = read("src/components/settings/permission-grid.tsx");
    expect(src).toContain('{further ? <div aria-hidden data-scroll-fade="" className={SCROLL_FADE} /> : null}');
    expect(src).toContain('<div ref={ref} className="relative">');
  });

  it("L2: a row grows to hold a two-line rule name instead of spilling out of its 32px Compact row", () => {
    const g = html(h(grid.PermissionGrid, { rows, ariaLabel: "Enforced permissions", allows: () => false, canEdit: true, onToggle: () => {} }));
    const styles = [...g.matchAll(/role="row" class="os-tc__row[^"]*" style="([^"]+)"/g)].map((m) => m[1]);
    expect(styles).toHaveLength(2);
    for (const s of styles) {
      expect(s).toContain("min-height:var(--os-row-h)");
      expect(s).not.toMatch(/(^|;)height:/);
    }
    expect(g).toMatch(/role="cell" class="[^"]*sticky start-0[^"]*py-0\.5/);
    // Any other TableCard keeps its rows one height.
    const plain = html(h(TableCard<{ id: string }>, { columns: [{ key: "a", label: "A", render: (r) => r.id }], rows: [{ id: "x" }], rowKey: (r) => r.id }));
    expect(plain).toMatch(/style="grid-template-columns:[^"]*;height:var\(--os-row-h\)"/);
  });

  it("L6 and L8: the always-can lock is ink-2, and a ticked cell calls onToggle with its level, module and action", () => {
    const onToggle = vi.fn();
    const cols = grid.permissionGridColumns({ allows: () => false, canEdit: true, readOnly: false, onToggle });
    const lock = cols.find((c) => c.key === "SUPER_ADMIN")!.render(rows[0], 0) as { props: { className: string } };
    expect(lock.props.className).toContain("text-ink-2");
    expect(lock.props.className).not.toContain("text-ink-3");
    for (const [level, row] of [["EMPLOYEE", rows[0]], ["AGENT", rows[1]], ["HR", rows[1]]] as const) {
      const box = cols.find((c) => c.key === level)!.render(row, 0) as { type: string; props: { type: string; onChange: () => void; "aria-label": string } };
      expect(box.type).toBe("input");
      expect(box.props.type).toBe("checkbox");
      box.props.onChange();
      expect(onToggle).toHaveBeenLastCalledWith(level, row.mod, row.action);
    }
    expect(onToggle).toHaveBeenCalledTimes(3);
    // The two levels that always can are never a checkbox.
    expect(cols.find((c) => c.key === "COMPANY_ADMIN")!.render(rows[0], 0)).not.toMatchObject({ type: "input" });
  });
});

describe("L3: Theme and Density are held while a save is in flight", () => {
  it("a held control draws held, and neither a click nor an arrow key picks", () => {
    const onChange = vi.fn();
    const options = [{ value: "LIGHT", label: "Light" }, { value: "DARK", label: "Dark" }];
    const run = (held: boolean) => {
      onChange.mockClear();
      const tree = treeOf(SegmentedControl as (p: Parameters<typeof SegmentedControl<string>>[0]) => ReactNode, { label: "Theme", value: "LIGHT", options, onChange, held });
      const els = elements(tree);
      const group = els.find((e) => e.props.role === "radiogroup")!;
      const dark = els.find((e) => e.props.role === "radio" && labelOf(e) === "Dark")!;
      (dark.props.onClick as () => void)();
      const prevent = vi.fn();
      (group.props.onKeyDown as (e: unknown) => void)({ key: "ArrowRight", preventDefault: prevent });
      return { disabled: group.props["aria-disabled"], cls: String(group.props.className), darkCls: String(dark.props.className), picks: onChange.mock.calls.length, prevented: prevent.mock.calls.length };
    };
    const held = run(true);
    expect(held.disabled).toBe(true);
    expect(held.cls).toContain("opacity-50");
    // A held segment does not light up under the pointer.
    expect(held.darkCls.split(" ")).toContain("hover:text-ink-2");
    expect(held.darkCls.split(" ")).not.toContain("hover:text-ink");
    expect(held.picks).toBe(0);
    // The key is spent, so the page does not scroll under it.
    expect(held.prevented).toBe(1);
    const free = run(false);
    expect(free.disabled).toBeUndefined();
    expect(free.picks).toBe(2);
  });

  it("the Appearance card holds both while saving", () => {
    const st: AppearanceState = { appearance: "AUTO", accent: "workwrk", density: "cozy", lockedKeys: [] };
    const card = (saving: boolean) => html(h(AppearanceDefaultsCard, { state: st, loadError: null, saving, onRetry: () => {}, onAppearance: () => {}, onAccent: () => {}, onDensity: () => {}, onLock: () => {} }));
    expect(card(true)).toMatch(/<div role="radiogroup" aria-label="Theme" aria-disabled="true"/);
    expect(card(true)).toMatch(/<div role="radiogroup" aria-label="Density" aria-disabled="true"/);
    expect(card(false)).not.toContain('role="radiogroup" aria-label="Theme" aria-disabled');
  });
});

describe("L4: a label's words focus or open its control", () => {
  it("Hours in a work day is a <label for> its input; read-only it is plain words", () => {
    const m = html(h(workWeekCard.WorkWeekView, viewProps()));
    expect(m).toContain('<label for="locale-hours-input">Hours in a work day</label>');
    expect(m).toMatch(/<input id="locale-hours-input" type="number"[^>]*aria-describedby="locale-hours-hint"/);
    const ro = html(h(workWeekCard.WorkWeekView, { ...viewProps(), canEdit: false }));
    expect(ro).not.toContain("<label");
  });

  it("each Locale picker's Field label is for its trigger, the Fiscal year's too", () => {
    state.section = { timezone: "Asia/Kolkata", currency: "USD", fiscalYearStart: 4, language: "en", weekStart: "MON", dateFormat: "DMY", timeFormat: "24h" };
    const p = html(h(LocaleSettingsPage));
    for (const [id, words] of [["locale-fiscal-year", "Fiscal year starts in"], ["locale-timezone", "Time zone"], ["locale-currency", "Currency"], ["locale-language", "Default language"]]) {
      expect(p, id).toContain(`<label id="${id}-label" for="${id}" class="mb-1.5 block text-sm font-medium text-ink">${words}</label>`);
      expect(p, id).toMatch(new RegExp(`<button type="button" id="${id}" aria-labelledby="${id}-name ${id}-value" aria-haspopup="listbox"`));
    }
  });
});

describe("L5: How access works says only what is new when opened, full width under its action", () => {
  it("a card's opened Show more text is on its own line under the title and actions; a card without one is unchanged", () => {
    const withMore = html(h(SettingsCard, { title: "A", description: "One line.", more: "The long paragraph.", actions: h("a", { href: "/x" }, "Go") }));
    const head = /<header class="([^"]+)">([\s\S]*)<\/header>/.exec(withMore)!;
    expect(head[1].split(" ")).toEqual(expect.arrayContaining(["flex", "flex-wrap", "gap-y-0"]));
    // The text is the header's last child, after the actions, full width; the link stays under the description.
    expect(head[2]).toMatch(/<a href="\/x">Go<\/a><\/div><div id="[^"]+" hidden="" class="mt-1 w-full flex-col gap-2 text-sm text-ink-2 \[&amp;:not\(\[hidden\]\)\]:flex">The long paragraph\.<\/div>$/);
    expect(head[2].indexOf("One line.")).toBeLessThan(head[2].indexOf("Show more"));
    expect(head[2].indexOf("Show more")).toBeLessThan(head[2].indexOf('href="/x"'));
    const without = html(h(SettingsCard, { title: "A", description: "Words.", actions: h("button", { type: "button" }, "Reset") }, "x"));
    expect(without).toContain('<header class="mb-4 flex items-start gap-3 max-[640px]:flex-col max-[640px]:gap-2">');
  });

  it("the opened text starts at the Owners and does not say again what Admins and Members do", () => {
    state.role = "ADMIN";
    const p = html(h(AccessSettingsPage));
    const ex = p.slice(p.indexOf('<section id="access.explainer"'), p.indexOf("</section>", p.indexOf('<section id="access.explainer"')));
    const opened = text((ex.match(/<div id="[^"]*" hidden=""[^>]*>[\s\S]*<\/div>/) ?? [""])[0]);
    expect(opened.trim().startsWith("Owners run the company account: billing, ownership and security.")).toBe(true);
    expect(opened).not.toContain("Admins run the workspace");
    expect(opened).not.toContain("Members work in the Spaces they are added to");
    expect(opened).toContain("Admins also invite people and use every Settings page");
    expect(opened).toContain("Each thing you share offers its own levels");
  });
});

describe("L7 and L9", () => {
  it("L7: each holiday's Remove is named with its date, so two that share a name are told apart", () => {
    const twins: WorkSchedule = { ...REAL, holidays: [{ date: "2026-12-25", name: "Holiday" }, { date: "2026-12-26", name: "Holiday" }] };
    const m = html(h(workWeekCard.WorkWeekView, { ...viewProps(), schedule: twins }));
    const names = [...m.matchAll(/aria-label="(Remove [^"]+)"/g)].map((x) => x[1]);
    expect(names).toEqual(["Remove Holiday, day 2026-12-25", "Remove Holiday, day 2026-12-26"]);
  });

  it("L9: the Access switches card has no whitespace-only line", () => {
    expect(read("src/components/settings/access-toggles-card.tsx")).not.toMatch(/\n[ \t]+\n/);
  });
});
