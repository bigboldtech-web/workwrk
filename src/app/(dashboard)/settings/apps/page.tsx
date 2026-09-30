"use client";

// Workspace settings > Apps & modules (spec-settings-workspace
// `/settings/apps`, settings-architecture 5.3). Anchored sections, not tabs,
// because /settings/modules 308s to #modules:
//
//   1. Modules     one ModuleCard per premium module (ProductInstallation via
//                  POST / DELETE /api/products/installations; confirm before
//                  turning off)
//   2. Rail apps   the org rail config at OrgPreference.sidebarDefault.apps
//                  { order, hidden, minAccess }, grouped as the 8 rail hubs
//                  and the apps inside hubs (captioned "in {Hub} sidebar"),
//                  autosaved PER ROW (only that row waits on its write)
//   3. Automations "Pause all automations" (settings.work.automationsPaused,
//                  read by the automation engine) with this month's runs
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
import { ConfirmDialog, NativeSelect } from "@/components/settings/settings-form";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useSettingsSection } from "@/hooks/use-settings-section";
import { ModulesSection } from "./modules-section";

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

const SECTION_LABEL = "mb-2 flex items-center gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2";

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
  const [impact, setImpact] = useState<
    | { app: AppEntry; next: State; okMsg: string; sentence: string | null; names: string[]; count: number; error: string | null; checking: boolean; enforced?: boolean }
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
  const saveNarrowing = async (app: AppEntry, next: State, okMsg: string) => {
    setImpact({ app, next, okMsg, sentence: null, names: [], count: 0, error: null, checking: true });
    setSavingKey(app.key);
    const r = await apiFetch<{ count: number; names: string[]; sentence: string; rule?: string }>("/api/settings/apps/impact", {
      method: "POST",
      json: { app: app.key, hidden: next.hidden.includes(app.key), floor: next.minAccess[app.key] ?? null },
    });
    setSavingKey(null);
    if (r.ok && r.data.count === 0) {
      setImpact(null);
      void persist(next, app.key, okMsg);
      return;
    }
    setImpact({
      app, next, okMsg, checking: false,
      sentence: r.ok ? r.data.sentence : null,
      names: r.ok ? r.data.names : [],
      count: r.ok ? r.data.count : 0,
      enforced: r.ok && r.data.rule === "engine",
      error: r.ok ? null : r.error || "Couldn't count who loses access.",
    });
  };

  const setVisible = (app: AppEntry, visible: boolean) => {
    if (!state || app.alwaysPinned) return;
    const set = new Set(state.hidden);
    if (visible) set.delete(app.key);
    else set.add(app.key);
    const next = { ...state, hidden: [...set] };
    const okMsg = visible ? `${app.label} shows in the rail` : `${app.label} hidden from the rail`;
    if (visible) void persist(next, app.key, okMsg);
    else void saveNarrowing(app, next, okMsg);
  };

  const setFloor = (app: AppEntry, value: string) => {
    if (!state || app.alwaysPinned) return;
    const minAccess = { ...state.minAccess };
    if (isTier(value)) minAccess[app.key] = value;
    else delete minAccess[app.key];
    const next = { ...state, minAccess };
    const okMsg = isTier(value) ? `${app.label}: ${TIER_OPTIONS.find((t) => t.value === value)?.label.toLowerCase()}` : `${app.label}: everyone`;
    // Back to Everyone never takes the app from anyone.
    if (!isTier(value)) void persist(next, app.key, okMsg);
    else void saveNarrowing(app, next, okMsg);
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
    const caption = app.hubKey ? `in ${HUB_LABELS[app.hubKey]} sidebar` : "Rail hub";
    return (
      <li
        key={app.key}
        draggable={!busy && !always}
        onDragStart={(e) => { setDragKey(app.key); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", app.key); } catch {} }}
        onDragOver={(e) => { if (!dragKey || dragKey === app.key || !keys.includes(dragKey)) return; e.preventDefault(); setDragOverKey(app.key); }}
        onDrop={(e) => { e.preventDefault(); if (dragKey && dragKey !== app.key && keys.includes(dragKey)) moveWithin(dragKey, keys, i); setDragKey(null); setDragOverKey(null); }}
        onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
        className={`flex min-h-11 items-center gap-3 border-t border-line-soft px-3 py-1.5 first:border-t-0 ${dragKey === app.key ? "opacity-40" : ""} ${isDragOver ? "bg-hover" : ""}`}
      >
        <span className={`text-ink-3 ${always ? "invisible" : "cursor-grab active:cursor-grabbing"}`} title="Drag to reorder" aria-hidden>
          <GripVertical className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-hover text-ink-2 ${visible ? "" : "opacity-40"}`} aria-hidden>
          <app.Icon className="h-5 w-5" />
        </span>
        <div className={`min-w-0 flex-1 ${visible ? "" : "opacity-60"}`}>
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-medium text-ink">{app.label}</span>
            {always ? <span className="inline-flex h-6 items-center rounded-full border border-line px-2 text-xs font-medium text-ink-2">Always available</span> : null}
          </div>
          <div className="text-sm text-ink-2">{caption}</div>
        </div>
        {savedKey?.key === app.key ? <span className="text-xs font-medium text-success-text">Saved</span> : null}
        {always ? (
          <span className="w-[190px] text-base text-ink-2">Everyone</span>
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
        <div className="flex shrink-0 items-center">
          <button type="button" disabled={busy || always || i === 0} onClick={() => moveWithin(app.key, keys, i - 1)} aria-label={`Move ${app.label} up`}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink ${always || i === 0 ? "invisible" : ""}`}>
            <ChevronUp className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button type="button" disabled={busy || always || i === group.length - 1} onClick={() => moveWithin(app.key, keys, i + 1)} aria-label={`Move ${app.label} down`}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink ${always || i === group.length - 1 ? "invisible" : ""}`}>
            <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <span className="w-10 shrink-0 text-right" title={always ? "Always available" : undefined}>
          {always ? null : <Switch checked={visible} disabled={busy} onChange={(next) => setVisible(app, next)} aria-label={`Show ${app.label} in the rail`} />}
        </span>
      </li>
    );
  }

  return (
    <SettingsPage
      pageKey="apps"
      subtitle="Turn capabilities on, and decide what shows in everyone's rail."
    >
      <div className="flex flex-col gap-8">
        <section id="modules" className="scroll-mt-4">
          <h2 className={SECTION_LABEL}>Modules<span className="h-px flex-1 bg-line" aria-hidden /></h2>
          <ModulesSection />
        </section>

        <section>
          <h2 className={SECTION_LABEL}>Rail apps<span className="h-px flex-1 bg-line" aria-hidden /></h2>
          <SettingsCard
            id="rail"
            wide="apps.rail"
            actions={state ? <button type="button" onClick={() => setResetOpen(true)} className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Reset to the default order</button> : null}
            description="Everyone's rail shows the apps they can open, in this order. Hiding an app or raising who can see it removes it from people's rails; each page keeps its own access rules."
          >
            {loadError ? (
              <ErrorState compact what="the rail apps" hint={loadError} onRetry={() => { void load(); }} />
            ) : !state ? (
              <SkeletonRows rows={6} />
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1 flex items-center justify-between px-3 text-sm font-medium text-ink-2">
                    <span>Rail hubs</span>
                    <span className="flex items-center gap-[108px] pe-2"><span>Who can see it</span><span>Show in rail</span></span>
                  </div>
                  <ul className="rounded-lg border border-line">{hubs.map((a, i) => renderRow(a, hubs, i))}</ul>
                </div>
                <div>
                  <div className="mb-1 px-3 text-sm font-medium text-ink-2">Apps inside hubs</div>
                  <ul className="rounded-lg border border-line">{folded.map((a, i) => renderRow(a, folded, i))}</ul>
                </div>
                <p className="text-sm text-ink-2">
                  An app also stays off someone&apos;s rail when their access is below its own baseline. New apps join the end of their group.
                </p>
              </div>
            )}
          </SettingsCard>
        </section>

        <section>
          <h2 className={SECTION_LABEL}>Automations<span className="h-px flex-1 bg-line" aria-hidden /></h2>
          <AutomationsCard />
        </section>

        <RequestsSection />

        <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Link href="/build" className="font-medium text-brand-deep hover:underline">Build apps</Link>
          <Link href="/store" className="font-medium text-brand-deep hover:underline">Marketplace</Link>
          <Link href="/integrations" className="font-medium text-brand-deep hover:underline">Integrations</Link>
        </p>
      </div>

      <ConfirmDialog
        open={impact !== null && !impact.checking}
        onOpenChange={(v) => { if (!v) setImpact(null); }}
        title={impact ? `Change who sees ${impact.app.label}?` : "Change who sees this app?"}
        confirmLabel="Save"
        onConfirm={() => {
          const cur = impact;
          setImpact(null);
          if (cur) void persist(cur.next, cur.app.key, cur.okMsg);
        }}
      >
        {impact?.error ? (
          <p>{impact.error} Saving still works; the people it affects will not see {impact.app.label} in their rail.</p>
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
    <SettingsCard id="apps.automations">
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
      <p className="flex gap-4 text-sm">
        <Link href="/automation/health" className="font-medium text-brand-deep hover:underline">Health</Link>
        <Link href="/automation/usage" className="font-medium text-brand-deep hover:underline">Usage</Link>
        <Link href="/automation/logs" className="font-medium text-brand-deep hover:underline">Logs</Link>
      </p>
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

  return (
    <section id="requests" className="scroll-mt-6">
      <h2 className="mb-1 flex items-center gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2">
        Requests from people here<span className="h-px flex-1 bg-line" aria-hidden />
      </h2>
      <p className="mb-2.5 max-w-2xl text-sm text-ink-2">
        What people asked for with Request this and Request a connector on Integrations,
        and Suggest an app on Marketplace. Connectors are built in the order people ask for them.
      </p>

      {requests === null || suggestions === null ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="flex flex-col gap-4">
          {requests.state === "hidden" ? null : (
            <div className="overflow-hidden rounded-lg border border-line bg-raised">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="text-base font-semibold text-ink">Connector requests</span>
                {requests.state === "ok" ? (
                  <span className="text-sm text-ink-2">{requests.data.total} {requests.data.total === 1 ? "request" : "requests"}</span>
                ) : null}
                <Link href="/integrations" className="ms-auto text-sm font-medium text-brand-deep hover:underline">Integrations</Link>
              </div>
              {requests.state === "error" ? (
                <p className="border-t border-line-soft px-3 py-3 text-sm text-ink-2">
                  Couldn&apos;t load connector requests. {requests.message}{" "}
                  <button type="button" onClick={() => void load()} className="font-medium text-brand-deep hover:underline">Retry</button>
                </p>
              ) : requests.data.totals.length === 0 ? (
                <p className="border-t border-line-soft px-3 py-3 text-sm text-ink-2">Nobody has asked for a connector yet.</p>
              ) : (
                requests.data.totals.map((t) => (
                  <div key={t.key} className="border-t border-line-soft px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-base font-medium text-ink">{t.name}</span>
                      {t.custom ? (
                        <span className="rounded bg-hover px-1.5 py-0.5 text-xs font-medium text-ink-2">Not in the catalogue</span>
                      ) : null}
                      <span className="ms-auto text-sm text-ink-2">
                        {people(t.count)}
                        {t.lastAt ? ` · last asked ${formatRelative(t.lastAt)}` : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm text-ink-2">{t.askedBy.map((a) => a.name).join(", ")}</div>
                    {t.askedBy.filter((a) => a.note).map((a, i) => (
                      <p key={i} className="mt-1 text-sm leading-5 text-ink-2">
                        &ldquo;{a.note}&rdquo; <span className="text-ink-3">({a.name})</span>
                      </p>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}

          {suggestions.state === "hidden" ? null : (
            <div className="overflow-hidden rounded-lg border border-line bg-raised">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="text-base font-semibold text-ink">App suggestions</span>
                {suggestions.state === "ok" ? (
                  <span className="text-sm text-ink-2">{suggestions.data.total} {suggestions.data.total === 1 ? "suggestion" : "suggestions"}</span>
                ) : null}
                <Link href="/store" className="ms-auto text-sm font-medium text-brand-deep hover:underline">Marketplace</Link>
              </div>
              {suggestions.state === "error" ? (
                <p className="border-t border-line-soft px-3 py-3 text-sm text-ink-2">
                  Couldn&apos;t load app suggestions. {suggestions.message}{" "}
                  <button type="button" onClick={() => void load()} className="font-medium text-brand-deep hover:underline">Retry</button>
                </p>
              ) : suggestions.data.suggestions.length === 0 ? (
                <p className="border-t border-line-soft px-3 py-3 text-sm text-ink-2">Nobody has suggested an app yet.</p>
              ) : (
                <>
                  {suggestions.data.suggestions.map((s) => (
                    <div key={s.id} className="border-t border-line-soft px-3 py-2.5">
                      <p className="text-sm leading-5 text-ink">{s.text}</p>
                      <div className="mt-0.5 text-sm text-ink-2">{s.by} · {formatRelative(s.createdAt)}</div>
                    </div>
                  ))}
                  {suggestions.data.total > suggestions.data.suggestions.length ? (
                    <p className="border-t border-line-soft px-3 py-2 text-sm text-ink-2">
                      Showing the latest {suggestions.data.suggestions.length} of {suggestions.data.total}.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
