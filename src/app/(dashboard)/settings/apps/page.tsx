"use client";

// Workspace settings > Apps & modules (spec-settings-workspace
// `/settings/apps`, settings-architecture 5.3). Anchored sections, not tabs,
// because /settings/modules 308s to #modules.
//
// ONE HEADING PER SECTION (settings-cleanup B3, Phase 2): every card carries
// its own card title, and a section label only groups two or more cards
// (AI, Requests), never repeating a card's title. The cards with no label
// over them come before the first label, so none reads as part of a group
// it is not in (Phase 2 review, M2). In this order:
//
//   1. Modules     #modules: one ModuleCard per premium module
//                  (ProductInstallation via POST / DELETE
//                  /api/products/installations; confirm before turning off)
//   2. Rail apps   #rail: the org rail config at
//                  OrgPreference.sidebarDefault.apps { order, hidden,
//                  minAccess }, grouped as the 8 rail hubs and the apps
//                  inside hubs (captioned "in {Hub} sidebar"), autosaved PER
//                  ROW (only that row waits on its write)
//   3. Automations #apps.automations: "Pause all automations"
//                  (settings.work.automationsPaused, read by the automation
//                  engine) with this month's runs
//   4. AI          one label over the cards below, each drawn only once its
//                  answer is known and only for Owners and Admins; the label
//                  goes with them when none is drawn:
//      Google for AI teammates  #ai-google: the workspace switch per
//                  product, the counts and Disconnect everyone
//                  (teammate-google-section.tsx; ai-teammates-phase3.md step 2)
//      Computer for AI teammates  #ai-browser: the switch, teaching by
//                  showing, the sites teammates may open and the blocked
//                  sites, this month's usage and Stop every browser
//                  (teammate-browser-section.tsx; ai-teammates-phase4.md step 4)
//      AI apps (MCP)  #ai-apps: the switch that lets people connect their AI
//                  apps, the allowed apps and the counts (mcp-section.tsx;
//                  docs/plans/mcp-server.md 6.3), after the computer's card
//   5. Requests    #requests: Connector requests and App suggestions, what
//                  people here asked for; the label only over both cards
//
// Reads GET /api/org/preferences; writes PATCH /api/org/preferences with the
// complete apps object, and checks the response really holds it. Hidden and
// the floor change the RAIL; each page keeps its own access rules until the
// engine's enforcement flip (settings spec S7) makes the same rows gates.
// alwaysPinned apps (Work, Settings) can never be hidden or floored.
//
// No blue button: every control autosaves.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import {
  APPS,
  orderedCatalogForAdmin,
  parseOrgAppsConfig,
  type AccessTier,
  type AppEntry,
} from "@/lib/rail-apps";
import { Switch } from "@/components/ui/switch";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { formatRelative } from "@/lib/format/date";
import { HUB_LABELS } from "@/lib/nav/labels";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SettingsSection } from "@/components/settings/settings-section";
import { ConfirmDialog, NativeSelect } from "@/components/settings/settings-form";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useSettingsSection } from "@/hooks/use-settings-section";
import { ASKED_BY_SHOWN, askedByHasMore, askedByLine } from "./asked-by";
import { McpSection } from "./mcp-section";
import { ModulesSection } from "./modules-section";
import { TeammateBrowserSection } from "./teammate-browser-section";
import { TeammateGoogleSection } from "./teammate-google-section";

// The rail's own tier vocabulary (AccessTier), in plain words: a vocabulary
// drift here is a compile error, not a silent bug.
const TIER_OPTIONS: ReadonlyArray<{ value: AccessTier; label: string }> = [
  { value: "manager", label: "Managers and up" },
  { value: "hr-admin", label: "People team and Admins" },
  { value: "org-admin", label: "Admins only" },
];
const FLOOR_OPTIONS: ReadonlyArray<{ value: "" | AccessTier; label: string }> = [{ value: "", label: "Everyone" }, ...TIER_OPTIONS];

function isTier(v: string): v is AccessTier {
  return TIER_OPTIONS.some((t) => t.value === v);
}

/**
 * The Rail apps grid (settings-cleanup Phase 2): ONE column template for the
 * header row and every app row, so each column header sits on its own
 * column (they were hand-aligned with fixed widths and missed). At the
 * desk: the grip, the icon, the name, Who can see it, the two arrows and
 * Show in rail. Below 640px the row wraps the B11 way, so nothing crosses
 * the card's edge on a phone: the name with its switch on top, and Who can
 * see it with the arrows under them.
 */
const RAIL_GRID =
  "grid items-center gap-x-3 [grid-template-columns:16px_32px_minmax(0,1fr)_190px_56px_40px] max-[640px]:gap-y-2 max-[640px]:[grid-template-columns:16px_32px_minmax(0,1fr)_56px]";
/** Where each cell sits below 640px (above it the cells fill the six columns in order). */
const RAIL_CELL = {
  grip: "max-[640px]:col-start-1 max-[640px]:row-start-1",
  icon: "max-[640px]:col-start-2 max-[640px]:row-start-1",
  name: "max-[640px]:col-start-3 max-[640px]:row-start-1",
  who: "max-[640px]:col-span-3 max-[640px]:col-start-1 max-[640px]:row-start-2",
  move: "max-[640px]:col-start-4 max-[640px]:row-start-2",
  show: "max-[640px]:col-start-4 max-[640px]:row-start-1",
} as const;

type State = {
  /** Complete effective order: every catalog app key, exactly once. */
  order: string[];
  hidden: string[];
  minAccess: Partial<Record<string, AccessTier>>;
};

type OrgPrefResponse = {
  preference: {
    sidebarDefault?: {
      apps?: {
        order?: string[];
        hidden?: string[];
        minAccess?: Record<string, string>;
      } | null;
    } | null;
  } | null;
};

export default function AppsSettingsPage() {
  const { toast } = useOsToast();
  const [state, setState] = useState<State | null>(null);
  // A failed read renders ErrorState: an editable default catalog here would
  // let the next autosave overwrite the workspace's real rail config.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<{ key: string; at: number } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  // "N people lose access to {app}" (settings-architecture 5.3, S7): a hide
  // or a raised minimum role is counted first and saved only after the Admin
  // has read who it takes the app away from. A change nobody loses to saves
  // straight away, as before.
  //
  // THE CHANGE IS KEPT AS AN EDIT, NOT A SNAPSHOT (`apply`), and applied to
  // the state as it is when the Admin confirms, so a reorder or another app
  // saved while the count ran or the dialog was open is never overwritten by
  // a copy taken at click time. While one count is in flight, another hide
  // or floor change is refused with a toast, never dropped without a word.
  const [impact, setImpact] = useState<
    | { app: AppEntry; apply: (s: State) => State; okMsg: string; sentence: string | null; names: string[]; count: number; error: string | null; checking: boolean; enforced?: boolean }
    | null
  >(null);

  const byKey = useMemo(() => new Map<string, AppEntry>(APPS.map((a) => [a.key, a])), []);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await apiFetch<OrgPrefResponse>("/api/org/preferences", { cache: "no-store" });
    if (!r.ok) { setLoadError(r.error); return; }
    // parseOrgAppsConfig is the tolerant reader; orderedCatalogForAdmin
    // resolves the effective order and reports alwaysPinned apps as never
    // hidden or floored, so stale config can't show an untrue state.
    const cfg = parseOrgAppsConfig(r.data.preference?.sidebarDefault?.apps);
    const rows = orderedCatalogForAdmin(cfg);
    const minAccess: Partial<Record<string, AccessTier>> = {};
    for (const row of rows) {
      if (row.minAccess && isTier(row.minAccess)) minAccess[row.app.key] = row.minAccess;
    }
    setState({
      order: rows.map((row) => row.app.key),
      hidden: rows.filter((row) => row.hidden).map((row) => row.app.key),
      minAccess,
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // PATCH the complete apps config; the response must really contain it
  // (zod strips unknown keys, so a missing `apps` means it did not stick).
  const persist = useCallback(
    async (next: State, rowKey: string, okMsg: string) => {
      const prev = state;
      setState(next);
      setSavingKey(rowKey);
      const r = await apiFetch<OrgPrefResponse>("/api/org/preferences", {
        method: "PATCH",
        json: { sidebarDefault: { apps: { order: next.order, hidden: next.hidden, minAccess: next.minAccess } } },
      });
      setSavingKey(null);
      if (!r.ok || !r.data?.preference?.sidebarDefault?.apps) {
        setState(prev);
        toast(r.ok ? "Couldn't save the rail. Try again." : r.error || "Couldn't save the rail. Try again.");
        return;
      }
      const at = Date.now();
      setSavedKey({ key: rowKey, at });
      // The "Saved" word shows for two seconds, then clears (no clock read in render).
      window.setTimeout(() => setSavedKey((cur) => (cur && cur.at === at ? null : cur)), 2000);
      toast(okMsg);
      window.dispatchEvent(new CustomEvent("workwrk:prefs-changed"));
    },
    [state, toast],
  );

  // Count who a narrowing change takes the app away from, then either save
  // (nobody loses it) or ask first. A failed count still lets the Admin save,
  // saying the count is unknown, so a broken preview never blocks the page.
  const saveNarrowing = async (app: AppEntry, apply: (s: State) => State, next: State, okMsg: string) => {
    setImpact({ app, apply, okMsg, sentence: null, names: [], count: 0, error: null, checking: true });
    setSavingKey(app.key);
    const r = await apiFetch<{ count: number; names: string[]; sentence: string; rule?: string }>("/api/settings/apps/impact", {
      method: "POST",
      json: { app: app.key, hidden: next.hidden.includes(app.key), floor: next.minAccess[app.key] ?? null },
    });
    setSavingKey(null);
    if (r.ok && r.data.count === 0) {
      setImpact(null);
      // The latest state, not the click-time copy (see `impact` above).
      setPendingApply({ apply, key: app.key, okMsg });
      return;
    }
    setImpact({
      app, apply, okMsg, checking: false,
      sentence: r.ok ? r.data.sentence : null,
      names: r.ok ? r.data.names : [],
      count: r.ok ? r.data.count : 0,
      enforced: r.ok && r.data.rule === "engine",
      error: r.ok ? null : r.error || "The count did not answer.",
    });
  };

  // A narrowing change that is cleared to save (nobody loses it, or the
  // Admin confirmed), applied to the state of the render that saves it.
  const [pendingApply, setPendingApply] = useState<{ apply: (s: State) => State; key: string; okMsg: string } | null>(null);
  useEffect(() => {
    if (!pendingApply || !state) return;
    const job = pendingApply;
    const t = setTimeout(() => {
      setPendingApply(null);
      void persist(job.apply(state), job.key, job.okMsg);
    }, 0);
    return () => clearTimeout(t);
  }, [pendingApply, state, persist]);

  // One narrowing change at a time: the second is refused out loud.
  const busyCounting = (): boolean => {
    if (!impact && !pendingApply) return false;
    toast(impact ? `Still checking who loses ${impact.app.label}. Try again in a moment.` : "Saving the last change. Try again in a moment.");
    return true;
  };

  const setVisible = (app: AppEntry, visible: boolean) => {
    if (!state || app.alwaysPinned || busyCounting()) return;
    const apply = (s: State): State => {
      const set = new Set(s.hidden);
      if (visible) set.delete(app.key);
      else set.add(app.key);
      return { ...s, hidden: [...set] };
    };
    const next = apply(state);
    const okMsg = visible ? `${app.label} shows in the rail` : `${app.label} hidden from the rail`;
    if (visible) void persist(next, app.key, okMsg);
    else void saveNarrowing(app, apply, next, okMsg);
  };

  const setFloor = (app: AppEntry, value: string) => {
    if (!state || app.alwaysPinned || busyCounting()) return;
    const apply = (s: State): State => {
      const minAccess = { ...s.minAccess };
      if (isTier(value)) minAccess[app.key] = value;
      else delete minAccess[app.key];
      return { ...s, minAccess };
    };
    const next = apply(state);
    const okMsg = isTier(value) ? `${app.label}: ${TIER_OPTIONS.find((t) => t.value === value)?.label.toLowerCase()}` : `${app.label}: everyone`;
    // Back to Everyone never takes the app from anyone.
    if (!isTier(value)) void persist(next, app.key, okMsg);
    else void saveNarrowing(app, apply, next, okMsg);
  };

  // Reorder inside one group (hubs among hubs, apps among apps); the saved
  // order is still one list, so the rail and the launcher read it unchanged.
  const moveWithin = (key: string, group: string[], toIdx: number) => {
    if (!state) return;
    const from = group.indexOf(key);
    if (from < 0 || toIdx < 0 || toIdx >= group.length || from === toIdx) return;
    const target = group[toIdx];
    const order = [...state.order];
    order.splice(order.indexOf(key), 1);
    const at = order.indexOf(target);
    order.splice(from < toIdx ? at + 1 : at, 0, key);
    void persist({ ...state, order }, key, "Rail order saved");
  };

  const resetOrder = () => {
    if (!state) return;
    const order = orderedCatalogForAdmin(parseOrgAppsConfig({})).map((r) => r.app.key);
    setResetOpen(false);
    void persist({ ...state, order }, "__reset__", "Rail order reset to the default");
  };

  const rows: AppEntry[] = state ? state.order.map((k) => byKey.get(k)).filter((a): a is AppEntry => Boolean(a)) : [];
  const hubs = rows.filter((a) => !a.hubKey);
  const folded = rows.filter((a) => !!a.hubKey);

  function renderRow(app: AppEntry, group: AppEntry[], i: number) {
    if (!state) return null;
    const keys = group.map((a) => a.key);
    const always = Boolean(app.alwaysPinned);
    const visible = always || !state.hidden.includes(app.key);
    const floor = state.minAccess[app.key] ?? "";
    const busy = savingKey === app.key;
    const isDragOver = dragOverKey === app.key && dragKey && dragKey !== app.key;
    // The hubs sit under their own "Rail hubs" heading, so only an app
    // inside a hub says where it lives.
    const caption = app.hubKey ? `in ${HUB_LABELS[app.hubKey]} sidebar` : null;
    return (
      <li
        key={app.key}
        draggable={!busy && !always}
        onDragStart={(e) => { setDragKey(app.key); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", app.key); } catch {} }}
        onDragOver={(e) => { if (!dragKey || dragKey === app.key || !keys.includes(dragKey)) return; e.preventDefault(); setDragOverKey(app.key); }}
        onDrop={(e) => { e.preventDefault(); if (dragKey && dragKey !== app.key && keys.includes(dragKey)) moveWithin(dragKey, keys, i); setDragKey(null); setDragOverKey(null); }}
        onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
        className={`${RAIL_GRID} min-h-12 border-b border-line-soft py-2 last:border-b-0 ${dragKey === app.key ? "opacity-40" : ""} ${isDragOver ? "bg-hover" : ""}`}
      >
        <span className={`${RAIL_CELL.grip} text-ink-3 ${always ? "invisible" : "cursor-grab active:cursor-grabbing"}`} title="Drag to reorder" aria-hidden>
          <GripVertical className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <span className={`${RAIL_CELL.icon} inline-flex h-8 w-8 items-center justify-center rounded-md bg-hover text-ink-2 ${visible ? "" : "opacity-40"}`} aria-hidden>
          <app.Icon className="h-5 w-5" />
        </span>
        <div className={`${RAIL_CELL.name} flex min-w-0 items-center gap-2`}>
          <div className={`min-w-0 flex-1 ${visible ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-base font-medium text-ink">{app.label}</span>
              {always ? <span className="inline-flex h-6 items-center rounded-full border border-line px-2 text-xs font-medium text-ink-2">Always available</span> : null}
            </div>
            {caption ? <div className="text-sm text-ink-2">{caption}</div> : null}
          </div>
          {savedKey?.key === app.key ? <span className="shrink-0 text-xs font-medium text-success-text">Saved</span> : null}
        </div>
        <div className={`${RAIL_CELL.who} min-w-0`}>
          {always ? (
            <span className="text-base text-ink-2">Everyone</span>
          ) : (
            <NativeSelect
              value={floor as "" | AccessTier}
              options={FLOOR_OPTIONS}
              disabled={busy}
              onChange={(v) => setFloor(app, v)}
              ariaLabel={`Who can see ${app.label}`}
              className="w-[190px]"
            />
          )}
        </div>
        <div className={`${RAIL_CELL.move} flex items-center`}>
          <button type="button" disabled={busy || always || i === 0} onClick={() => moveWithin(app.key, keys, i - 1)} aria-label={`Move ${app.label} up`}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink ${always || i === 0 ? "invisible" : ""}`}>
            <ChevronUp className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button type="button" disabled={busy || always || i === group.length - 1} onClick={() => moveWithin(app.key, keys, i + 1)} aria-label={`Move ${app.label} down`}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink ${always || i === group.length - 1 ? "invisible" : ""}`}>
            <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <span className={`${RAIL_CELL.show} flex justify-end`} title={always ? "Always available" : undefined}>
          {always ? null : <Switch checked={visible} disabled={busy} onChange={(next) => setVisible(app, next)} aria-label={`Show ${app.label} in the rail`} />}
        </span>
      </li>
    );
  }

  return (
    <SettingsPage pageKey="apps">
      <div className="flex flex-col gap-8">
        {/* The three cards with no label over them sit 24px apart, as cards
            do (B7), before the first label (Phase 2 review, M2: under the
            Requests label, Rail apps read as a third request card, and sank
            as the requests grew); the labelled sections below keep 32. The
            Modules card carries #modules itself: no section label repeats
            its title. */}
        <div className="flex flex-col gap-6">
          <ModulesSection />

          <SettingsCard
            id="rail"
            title="Rail apps"
            actions={state ? <button type="button" onClick={() => setResetOpen(true)} className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Reset to the default order</button> : null}
            description="Everyone's rail shows the apps they can open, in this order."
            more={
              <>
                <p>Hiding an app or raising who can see it removes it from people&apos;s rails; each page keeps its own access rules.</p>
                <p>An app also stays off someone&apos;s rail when their access is below its own baseline. New apps join the end of their group.</p>
              </>
            }
          >
            {loadError ? (
              <ErrorState compact what="the rail apps" hint={loadError} onRetry={() => { void load(); }} />
            ) : !state ? (
              <SkeletonRows rows={6} />
            ) : (
              <div>
                {/* The column headers are cells of the rows' own grid
                    (RAIL_GRID), so each sits on its column. Below 640px the
                    two column headers go (a phone's row wraps its controls
                    under the name); each select and switch is still named for
                    its app, and the group heading stays. */}
                <div className={`${RAIL_GRID} pb-1 text-sm font-medium`}>
                  <h3 className="col-span-3 text-ink">Rail hubs</h3>
                  <span className="text-ink-2 max-[640px]:hidden">Who can see it</span>
                  <span className="col-span-2 whitespace-nowrap text-end text-ink-2 max-[640px]:hidden">Show in rail</span>
                </div>
                <ul>{hubs.map((a, i) => renderRow(a, hubs, i))}</ul>
                <h3 className="mt-4 pb-1 text-sm font-medium text-ink">Apps inside hubs</h3>
                <ul>{folded.map((a, i) => renderRow(a, folded, i))}</ul>
              </div>
            )}
          </SettingsCard>

          <AutomationsCard />
        </div>

        {/* One label over the AI cards. Each draws nothing until its answer
            is known, for anyone its route refuses, or where this WorkwrK
            does not offer it. A section label groups two or more cards
            (settings-cleanup B3), so the label shows only while two are
            drawn (a lone "AI apps (MCP)" card needs none), and the group
            takes no room at all while none is: never a heading over one
            card or over nothing. */}
        <SettingsSection label="AI" className="[&:not(:has(section))]:hidden [&:not(:has(section~section))>h2]:hidden">
          <div className="flex flex-col gap-6">
            <TeammateGoogleSection />

            <TeammateBrowserSection />

            <McpSection />
          </div>
        </SettingsSection>

        <RequestsSection />
      </div>

      <ConfirmDialog
        open={impact !== null && !impact.checking}
        onOpenChange={(v) => { if (!v) setImpact(null); }}
        title={impact ? `Change who sees ${impact.app.label}?` : "Change who sees this app?"}
        confirmLabel="Save"
        onConfirm={() => {
          const cur = impact;
          setImpact(null);
          if (cur) setPendingApply({ apply: cur.apply, key: cur.app.key, okMsg: cur.okMsg });
        }}
      >
        {impact?.error ? (
          <>
            <p className="font-medium text-ink">We couldn&apos;t count who loses access to {impact.app.label}.</p>
            <p className="mt-1 text-ink-2">{/[.!?]$/.test(impact.error.trim()) ? impact.error.trim() : `${impact.error.trim()}.`}</p>
            <p className="mt-2 text-ink-2">
              If you save, everyone it affects stops seeing {impact.app.label} in their rail. Nothing is deleted, and you can turn it back on here at any time.
            </p>
          </>
        ) : impact ? (
          <>
            <p className="font-medium text-ink">{impact.sentence}</p>
            {impact.names.length > 0 ? (
              <p className="mt-1 text-ink-2">
                {impact.names.join(", ")}
                {impact.count > impact.names.length ? ` and ${impact.count - impact.names.length} more` : ""}.
              </p>
            ) : null}
            <p className="mt-2 text-ink-2">
              {impact.enforced ? "It leaves their rail and its pages close to them." : "It leaves their rail now."} Nothing is deleted, and you can turn it back on here at any time.
            </p>
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset the rail order?"
        confirmLabel="Reset order"
        onConfirm={resetOrder}
      >
        <p>Every app goes back to the default order. What is hidden and who can see each app stay as they are.</p>
      </ConfirmDialog>
    </SettingsPage>
  );
}

// ─── Automations ─────────────────────────────────────────────────────────
//
// "Pause all automations" writes settings.work.automationsPaused, which the
// engine reads before every run (src/lib/automation/engine.ts); the runs
// line comes from GET /api/automation/usage, the same meter that blocks new
// runs past the monthly allowance.

type Usage = { used: number; limit: number; paused: boolean };

function AutomationsCard() {
  const { toast } = useOsToast();
  const work = useSettingsSection("work", (b) => {
    const w = ((b.settings ?? {}) as { work?: { automationsPaused?: boolean } }).work;
    return { paused: w?.automationsPaused === true };
  });
  const [usage, setUsage] = useState<Usage | null | "error">(null);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    const r = await apiFetch<Usage>("/api/automation/usage", { cache: "no-store" });
    setUsage(r.ok ? r.data : "error");
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void loadUsage(); }, 0);
    return () => clearTimeout(t);
  }, [loadUsage]);

  const shown = paused ?? work.data?.paused ?? false;
  const toggle = async (next: boolean) => {
    setPaused(next);
    setRowError(null);
    const r = await work.save({ automationsPaused: next });
    if (!r.ok) {
      setPaused(!next);
      setRowError(r.error ?? "Couldn't save");
      return;
    }
    setSavedAt(Date.now());
    toast(next ? "Automations paused" : "Automations running again");
  };

  if (work.status === "error") return <ErrorState what="the automation settings" hint={work.error ?? undefined} onRetry={work.retry} />;
  return (
    <SettingsCard
      id="apps.automations"
      title="Automations"
      // The automation pages' door until the AI hub sidebar lists them (spec-settings-workspace /settings/apps 3).
      actions={
        <span className="flex gap-4 text-sm">
          <Link href="/automation/health" className="font-medium text-brand-deep hover:underline">Health</Link>
          <Link href="/automation/usage" className="font-medium text-brand-deep hover:underline">Usage</Link>
          <Link href="/automation/logs" className="font-medium text-brand-deep hover:underline">Logs</Link>
        </span>
      }
    >
      <SettingsRow
        label="Pause all automations"
        helper={
          usage && usage !== "error"
            ? `${usage.used} of ${usage.limit} runs this month`
            : usage === "error"
              ? "This month's runs are not available right now."
              : " "
        }
        savedAt={savedAt}
        error={rowError ? { message: rowError, onRetry: () => { void toggle(!shown); } } : null}
        control={work.status === "ready" ? <Switch checked={shown} onChange={(v) => { void toggle(v); }} aria-label="Pause all automations" /> : null}
      />
    </SettingsCard>
  );
}

// ─── Requests from people here ──────────────────────────────────────────
//
// The other half of "Thanks. We read every one of these." Every Member can
// Request this on a connector card, Request a connector by name and
// Suggest an app on Marketplace; until this section existed nothing in the
// product showed those to anyone, so the promise was empty. Owners and
// Admins read them here (spec-tools-misc 2.5 and 2.6: totals on Settings >
// Apps & modules, not a second page), from GET /api/integrations/requests
// and GET /api/marketplace/requests. A load that fails says so and offers
// Retry; a half the viewer may not read (403 or 404 from the app gate) is
// left out rather than shown empty.

type RequestTotal = {
  key: string;
  name: string;
  custom: boolean;
  count: number;
  lastAt: string | null;
  askedBy: { name: string; note: string | null; at: string }[];
};
type Suggestion = { id: string; text: string; by: string; createdAt: string };
type Half<T> = { state: "ok"; data: T } | { state: "hidden" } | { state: "error"; message: string };

function RequestsSection() {
  const [requests, setRequests] = useState<Half<{ totals: RequestTotal[]; total: number }> | null>(null);
  const [suggestions, setSuggestions] = useState<Half<{ suggestions: Suggestion[]; total: number }> | null>(null);

  const load = useCallback(async () => {
    setRequests(null);
    setSuggestions(null);
    const half = <T,>(r: Awaited<ReturnType<typeof apiFetch<T>>>): Half<T> =>
      r.ok ? { state: "ok", data: r.data } : r.status === 403 || r.status === 404 ? { state: "hidden" } : { state: "error", message: r.error };
    const [a, b] = await Promise.all([
      apiFetch<{ totals: RequestTotal[]; total: number }>("/api/integrations/requests", { cache: "no-store" }),
      apiFetch<{ suggestions: Suggestion[]; total: number }>("/api/marketplace/requests", { cache: "no-store" }),
    ]);
    setRequests(half(a));
    setSuggestions(half(b));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (requests?.state === "hidden" && suggestions?.state === "hidden") return null;

  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  // Each card's one link to where people ask: the card's action while it
  // lists something, the empty row's action while it lists nothing, so the
  // card never shows the same link twice (settings-cleanup B10, B12).
  const requestsEmpty = requests?.state === "ok" && requests.data.totals.length === 0;
  const suggestionsEmpty = suggestions?.state === "ok" && suggestions.data.suggestions.length === 0;

  return (
    // The label groups the two cards (B3), so it goes while one half is left
    // out (a 403 or 404) and only one card is drawn: the AI group's :has rule
    // (Phase 2 review, L7). While both load it stays over their skeleton,
    // where both cards are what an Owner or Admin is about to see.
    <SettingsSection id="requests" label="Requests" className="[&:has(section):not(:has(section~section))>h2]:hidden">
      {requests === null || suggestions === null ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="flex flex-col gap-6">
          {requests.state === "hidden" ? null : (
            <SettingsCard
              title="Connector requests"
              description="What people asked for with Request this and Request a connector on Integrations. Connectors are built in the order people ask for them."
              actions={requestsEmpty ? null : <Link href="/integrations" className={REQUEST_LINK}>Integrations</Link>}
            >
              {requests.state === "error" ? (
                <p className="text-base text-ink-2">
                  Couldn&apos;t load connector requests. {requests.message}{" "}
                  <button type="button" onClick={() => void load()} className="font-medium text-brand-deep hover:underline">Retry</button>
                </p>
              ) : requests.data.totals.length === 0 ? (
                <p className="text-base text-ink-2">
                  No connector requests yet · <Link href="/integrations" className="text-brand-deep hover:underline">Open Integrations</Link>
                </p>
              ) : (
                <div>
                  {requests.data.totals.map((t) => {
                    const notes = t.askedBy.filter((a) => a.note);
                    const names = t.askedBy.map((a) => a.name);
                    return (
                      <SettingsRow
                        key={t.key}
                        label={
                          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                            {t.name}
                            {t.custom ? (
                              <span className="rounded bg-hover px-1.5 py-0.5 text-xs font-medium text-ink-2">Not in the catalogue</span>
                            ) : null}
                          </span>
                        }
                        helper={askedByLine(names, t.count)}
                        // Everyone's name past the third, and what they wrote, one click away.
                        more={
                          askedByHasMore(names, t.count, notes.length) ? (
                            <>
                              {Math.max(t.count, names.length) > ASKED_BY_SHOWN ? <p>Asked by {names.join(", ")}{t.count > names.length ? ` and ${t.count - names.length} more` : ""}.</p> : null}
                              {notes.map((a, i) => (
                                <p key={i}>
                                  &ldquo;{a.note}&rdquo; <span className="text-ink-3">({a.name})</span>
                                </p>
                              ))}
                            </>
                          ) : undefined
                        }
                        control={
                          <span className="text-sm text-ink-2">
                            {people(t.count)}
                            {t.lastAt ? ` · last asked ${formatRelative(t.lastAt)}` : ""}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              )}
            </SettingsCard>
          )}

          {suggestions.state === "hidden" ? null : (
            <SettingsCard
              title="App suggestions"
              description="What people suggested with Suggest an app on Marketplace."
              actions={suggestionsEmpty ? null : <Link href="/store" className={REQUEST_LINK}>Marketplace</Link>}
            >
              {suggestions.state === "error" ? (
                <p className="text-base text-ink-2">
                  Couldn&apos;t load app suggestions. {suggestions.message}{" "}
                  <button type="button" onClick={() => void load()} className="font-medium text-brand-deep hover:underline">Retry</button>
                </p>
              ) : suggestions.data.suggestions.length === 0 ? (
                <p className="text-base text-ink-2">
                  No app suggestions yet · <Link href="/store" className="text-brand-deep hover:underline">Open Marketplace</Link>
                </p>
              ) : (
                <div>
                  {suggestions.data.suggestions.map((s) => (
                    <SettingsRow key={s.id} label={s.text} helper={`${s.by} · ${formatRelative(s.createdAt)}`} />
                  ))}
                  {suggestions.data.total > suggestions.data.suggestions.length ? (
                    <p className="pt-3 text-sm text-ink-2">
                      Showing the latest {suggestions.data.suggestions.length} of {suggestions.data.total}.
                    </p>
                  ) : null}
                </div>
              )}
            </SettingsCard>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

const REQUEST_LINK = "text-sm font-medium text-brand-deep hover:underline";
