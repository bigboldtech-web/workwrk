"use client";

/* Settings · Apps: the Super Admin surface for the ACCESS-based left rail.
 *
 * Personal pinning is gone. Every member's rail shows every app they can
 * access, in the order set here. This page edits the org rail config at
 * OrgPreference.sidebarDefault.apps:
 *
 *   { order?: string[];                    full desired order of app keys
 *     hidden?: string[];                   apps the org switched off
 *     minAccess?: Record<string, tier> }   per-app access floor ON TOP of
 *                                          the catalog's requiredAccess
 *
 * Reads GET  /api/org/preferences  → { preference: OrgPreference | null }
 * Writes PATCH /api/org/preferences (admin-gated) on every change, always
 * sending the COMPLETE apps object. setOrgPreference shallow-merges
 * sidebarDefault's top-level keys, so `apps` replaces wholesale while the
 * legacy keys (pinned / iconsOnly / sectionsOrder / ...) survive untouched.
 *
 * v1 scope, on purpose: hidden and minAccess are DISPLAY-level. They remove
 * rail icons; the routes stay reachable by URL, and the catalog's
 * requiredAccess plus the server page-gates (src/lib/page-gates.ts) keep
 * doing the real enforcement. The floor here can only ADD restriction on
 * top of the catalog baseline, never weaken it.
 *
 * alwaysPinned apps (Home) can never be hidden or floored: they are the
 * escape hatch that guarantees the rail is never empty for any member.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronUp, ChevronDown, GripVertical, Lock,
} from "lucide-react";
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
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard } from "@/components/settings/settings-card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ModulesSection } from "./modules-section";

// The select reuses the catalog's own tier vocabulary (AccessTier), not a
// second copy: a vocabulary drift here is a compile error, not a silent bug.
const TIER_OPTIONS: ReadonlyArray<{ value: AccessTier; label: string }> = [
  { value: "manager",   label: "Managers and up" },
  { value: "hr-admin",  label: "HR and org admins" },
  { value: "org-admin", label: "Org admins only" },
];

const TIER_SHORT: Record<AccessTier, string> = {
  "manager": "Managers+",
  "hr-admin": "HR admins",
  "org-admin": "Org admins",
};

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

export default function AppsSettingsPage() {
  const { toast } = useOsToast();
  const [state, setState] = useState<State | null>(null);
  // A failed read renders ErrorState: an editable default catalog here would
  // let the next autosave overwrite the workspace's real rail config.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Key → catalog entry, for rendering rows from the order array and for
  // pruning stale keys (apps removed from the catalog) out of saved config.
  const byKey = useMemo(() => new Map<string, AppEntry>(APPS.map((a) => [a.key, a])), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/org/preferences", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as OrgPrefResponse;
      // parseOrgAppsConfig is the tolerant reader (drops malformed keys and
      // unknown tiers); orderedCatalogForAdmin resolves the effective order
      // (org order first, then new catalog apps appended in catalog order)
      // and reports alwaysPinned apps as never hidden / never floored, so
      // stale config can't make this page show an untrue state.
      const cfg = parseOrgAppsConfig(data.preference?.sidebarDefault?.apps);
      const rows = orderedCatalogForAdmin(cfg);
      const minAccess: Partial<Record<string, AccessTier>> = {};
      for (const r of rows) {
        if (r.minAccess && isTier(r.minAccess)) minAccess[r.app.key] = r.minAccess;
      }
      setState({
        order: rows.map((r) => r.app.key),
        hidden: rows.filter((r) => r.hidden).map((r) => r.app.key),
        minAccess,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Network error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // PATCH the complete apps config. Local state is set optimistically by the
  // caller; on failure we resync truth from the server (same contract as
  // settings/defaults). One extra integrity check: /api/org/preferences
  // validates with zod, and zod strips keys it doesn't know, so if the
  // response row came back WITHOUT sidebarDefault.apps the save silently
  // didn't stick. Surface that instead of lying (data integrity rule).
  const patch = useCallback(
    async (next: State, okMsg: string) => {
      setSaving(true);
      try {
        const res = await fetch("/api/org/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sidebarDefault: {
              apps: { order: next.order, hidden: next.hidden, minAccess: next.minAccess },
            },
          }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json().catch(() => null)) as OrgPrefResponse | null;
        if (!data?.preference?.sidebarDefault?.apps) {
          throw new Error("apps key not persisted");
        }
        toast(okMsg);
        // Nudge the admin's own shell to re-resolve the rail immediately.
        window.dispatchEvent(new CustomEvent("workwrk:prefs-changed"));
      } catch {
        toast("Couldn't save, try again");
        void load();
      } finally {
        setSaving(false);
      }
    },
    [toast, load],
  );

  const persist = useCallback(
    (next: State, okMsg: string) => {
      setState(next);
      void patch(next, okMsg);
    },
    [patch],
  );

  const setVisible = (app: AppEntry, visible: boolean) => {
    if (!state || app.alwaysPinned) return;
    const set = new Set(state.hidden);
    if (visible) set.delete(app.key);
    else set.add(app.key);
    persist(
      { ...state, hidden: [...set] },
      visible ? `${app.label} shown in the rail` : `${app.label} hidden from the rail`,
    );
  };

  const setFloor = (app: AppEntry, value: string) => {
    if (!state || app.alwaysPinned) return;
    const minAccess = { ...state.minAccess };
    if (isTier(value)) minAccess[app.key] = value;
    else delete minAccess[app.key];
    persist(
      { ...state, minAccess },
      isTier(value)
        ? `${app.label} limited to ${TIER_OPTIONS.find((t) => t.value === value)?.label.toLowerCase()}`
        : `${app.label} open to everyone with access`,
    );
  };

  const moveKey = (key: string, toIdx: number) => {
    if (!state) return;
    const from = state.order.indexOf(key);
    if (from < 0 || toIdx < 0 || toIdx >= state.order.length || from === toIdx) return;
    const order = [...state.order];
    order.splice(from, 1);
    order.splice(toIdx, 0, key);
    persist({ ...state, order }, "App order saved");
  };

  // ─── Drag-and-drop reorder: same HTML5 pattern the old rail used ───
  const onDragStart = (e: React.DragEvent, key: string) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", key); } catch {}
  };
  const onDragOverRow = (e: React.DragEvent, key: string) => {
    if (!dragKey || dragKey === key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverKey(key);
  };
  const onDropRow = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    if (dragKey && dragKey !== key && state) {
      moveKey(dragKey, state.order.indexOf(key));
    }
    setDragKey(null);
    setDragOverKey(null);
  };
  const onDragEndRow = () => {
    setDragKey(null);
    setDragOverKey(null);
  };

  const loading = state === null;
  const rows: AppEntry[] = state
    ? state.order.map((k) => byKey.get(k)).filter((a): a is AppEntry => Boolean(a))
    : [];

  return (
    <SettingsPage pageKey="apps">
      <div className="flex flex-col gap-6">
      <ModulesSection />
      <SettingsCard
        id="rail"
        wide="apps.rail"
        title="Rail apps"
        description={
          <>
            The left rail shows every app a person has access to, in the order below.
            There is no personal pinning: what you arrange here is what everyone sees.
            Hiding an app or raising its access floor changes the rail only; the pages
            themselves stay gated by their own access rules.
          </>
        }
      >

      {loadError ? (
        <ErrorState compact what="the rail apps" hint={loadError} onRetry={() => { void load(); }} />
      ) : loading ? (
        <SkeletonRows rows={6} />
      ) : (
        <section>
          <ul className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {rows.map((app, i) => {
              const always = Boolean(app.alwaysPinned);
              const visible = always || !state.hidden.includes(app.key);
              const floor = state.minAccess[app.key] ?? "";
              const isDragOver = dragOverKey === app.key && dragKey && dragKey !== app.key;
              return (
                <li
                  key={app.key}
                  draggable={!saving}
                  onDragStart={(e) => onDragStart(e, app.key)}
                  onDragOver={(e) => onDragOverRow(e, app.key)}
                  onDrop={(e) => onDropRow(e, app.key)}
                  onDragEnd={onDragEndRow}
                  className={`flex items-center gap-3 px-3 py-2.5 ${i > 0 ? "border-t border-zinc-100" : ""} ${
                    dragKey === app.key ? "opacity-40" : ""
                  } ${isDragOver ? "bg-[#0073EA]/[0.05]" : ""}`}
                >
                  <span
                    className="cursor-grab text-zinc-300 hover:text-zinc-500 active:cursor-grabbing"
                    title="Drag to reorder"
                    aria-hidden
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>

                  <div
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-600 ${
                      visible ? "" : "opacity-40"
                    }`}
                  >
                    <app.Icon className="h-4 w-4" />
                  </div>

                  <div className={`min-w-0 flex-1 ${visible ? "" : "opacity-50"}`}>
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-zinc-900">
                        {app.label}
                      </span>
                      {always && (
                        <span className="inline-flex items-center gap-1 rounded bg-[#0073EA]/10 px-1.5 py-0.5 text-xs font-semibold text-[#0073EA]">
                          <Lock className="h-2.5 w-2.5" /> Always available
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-400">
                      {app.category ?? "Other"}
                      {app.requiredAccess ? (
                        <span> · Baseline: {TIER_SHORT[app.requiredAccess]}</span>
                      ) : null}
                    </div>
                  </div>

                  {/* Access floor. "Everyone" = catalog baseline only; a tier
                      here can only tighten, never loosen, requiredAccess. */}
                  <select
                    value={floor}
                    disabled={saving || always}
                    onChange={(e) => setFloor(app, e.target.value)}
                    aria-label={`Minimum access for ${app.label}`}
                    title={always ? "Always available to everyone" : undefined}
                    style={{ border: "1px solid #e4e4e7", background: "#fff" }}
                    className={`h-7 shrink-0 rounded-md px-1.5 text-xs text-zinc-700 ${
                      saving || always ? "opacity-50" : ""
                    }`}
                  >
                    <option value="">Everyone</option>
                    {TIER_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>

                  {/* Keyboard fallback for reordering: up/down beside the drag
                      handle, so the order is editable without a pointer. */}
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      disabled={saving || i === 0}
                      onClick={() => moveKey(app.key, i - 1)}
                      aria-label={`Move ${app.label} up`}
                      className={`grid h-4 w-6 place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 ${
                        saving || i === 0 ? "invisible" : ""
                      }`}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={saving || i === rows.length - 1}
                      onClick={() => moveKey(app.key, i + 1)}
                      aria-label={`Move ${app.label} down`}
                      className={`grid h-4 w-6 place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 ${
                        saving || i === rows.length - 1 ? "invisible" : ""
                      }`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* alwaysPinned apps can't be hidden: they guarantee the
                      rail is never empty for any member. */}
                  <span
                    className="shrink-0"
                    title={always ? "Always available" : visible ? `Hide ${app.label}` : `Show ${app.label}`}
                  >
                    <Switch
                      checked={visible}
                      disabled={saving || always}
                      onChange={(next) => setVisible(app, next)}
                      aria-label={`Show ${app.label} in the rail`}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-zinc-400">
            An app also stays off a person&apos;s rail when their access level is below
            its baseline, no matter what is set here. New apps added to the catalog
            appear at the end of this list automatically.
          </p>
        </section>
      )}
      </SettingsCard>
      <RequestsSection />
      </div>
    </SettingsPage>
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
    <section id="requests" className="mt-8 scroll-mt-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Requests from people here
      </h2>
      <p className="mb-2.5 max-w-2xl text-xs leading-relaxed text-zinc-400">
        What people asked for with Request this and Request a connector on Integrations,
        and Suggest an app on Marketplace. Connectors are built in the order people ask for them.
      </p>

      {requests === null || suggestions === null ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="flex flex-col gap-4">
          {requests.state === "hidden" ? null : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="text-base font-semibold text-zinc-900">Connector requests</span>
                {requests.state === "ok" ? (
                  <span className="text-xs text-zinc-400">{requests.data.total} {requests.data.total === 1 ? "request" : "requests"}</span>
                ) : null}
                <Link href="/integrations" className="ms-auto text-xs font-medium text-[#0073EA] hover:underline">Integrations</Link>
              </div>
              {requests.state === "error" ? (
                <p className="border-t border-zinc-100 px-3 py-3 text-sm text-zinc-500">
                  Couldn&apos;t load connector requests. {requests.message}{" "}
                  <button type="button" onClick={() => void load()} className="font-medium text-[#0073EA] hover:underline">Retry</button>
                </p>
              ) : requests.data.totals.length === 0 ? (
                <p className="border-t border-zinc-100 px-3 py-3 text-sm text-zinc-400">Nobody has asked for a connector yet.</p>
              ) : (
                requests.data.totals.map((t) => (
                  <div key={t.key} className="border-t border-zinc-100 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-base font-medium text-zinc-900">{t.name}</span>
                      {t.custom ? (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500">Not in the catalogue</span>
                      ) : null}
                      <span className="ms-auto text-xs text-zinc-400">
                        {people(t.count)}
                        {t.lastAt ? ` · last asked ${formatRelative(t.lastAt)}` : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">{t.askedBy.map((a) => a.name).join(", ")}</div>
                    {t.askedBy.filter((a) => a.note).map((a, i) => (
                      <p key={i} className="mt-1 text-sm leading-5 text-zinc-600">
                        &ldquo;{a.note}&rdquo; <span className="text-zinc-400">({a.name})</span>
                      </p>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}

          {suggestions.state === "hidden" ? null : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="text-base font-semibold text-zinc-900">App suggestions</span>
                {suggestions.state === "ok" ? (
                  <span className="text-xs text-zinc-400">{suggestions.data.total} {suggestions.data.total === 1 ? "suggestion" : "suggestions"}</span>
                ) : null}
                <Link href="/store" className="ms-auto text-xs font-medium text-[#0073EA] hover:underline">Marketplace</Link>
              </div>
              {suggestions.state === "error" ? (
                <p className="border-t border-zinc-100 px-3 py-3 text-sm text-zinc-500">
                  Couldn&apos;t load app suggestions. {suggestions.message}{" "}
                  <button type="button" onClick={() => void load()} className="font-medium text-[#0073EA] hover:underline">Retry</button>
                </p>
              ) : suggestions.data.suggestions.length === 0 ? (
                <p className="border-t border-zinc-100 px-3 py-3 text-sm text-zinc-400">Nobody has suggested an app yet.</p>
              ) : (
                <>
                  {suggestions.data.suggestions.map((s) => (
                    <div key={s.id} className="border-t border-zinc-100 px-3 py-2.5">
                      <p className="text-sm leading-5 text-zinc-800">{s.text}</p>
                      <div className="mt-0.5 text-xs text-zinc-400">{s.by} · {formatRelative(s.createdAt)}</div>
                    </div>
                  ))}
                  {suggestions.data.total > suggestions.data.suggestions.length ? (
                    <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-400">
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
