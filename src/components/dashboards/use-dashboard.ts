"use client";

// useDashboard: one dashboard on screen. It reads the dashboard and its card
// data, and routes every edit through the dashboard's save queue
// (save-queue.ts), which outlives the page. The /dashboards/[id] canvas and a
// Space's Overview widgets both use it.
//
// DATA TIMING. Card numbers come from GET /api/dashboards/[id]/data?tz= on
// load and on Refresh (a Refresh pressed while a save is pending runs once
// the queue is idle). A card whose settings are saved from the editor shows
// the editor's last preview only when that preview was of exactly the saved
// settings (previewKey), else its skeleton, and is refetched on its own once
// the save carrying it has landed. A new card is never fetched before it is
// stored, and a move or a rename never refetches. A data answer for a card
// that has been edited since the request went out is dropped, so a slow load
// can never paint an old configuration's numbers over a new one.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useOsToast } from "@/components/layout/os/toast";
import {
  applyLayouts,
  dataKey,
  previewKey,
  readdWidgetLocal,
  removeWidgetLocal,
} from "@/lib/dashboards/dashboard-editor";
import { resolvePassthrough, type EditorWidget, type WidgetInput, type WidgetLayout } from "@/lib/dashboards/widgets";
import type { WidgetResult } from "@/lib/dashboards/widget-data";
import type { LocalDraft } from "@/hooks/use-local-draft";
import { dashboardQueue, type DraftPayload, type QueueState } from "./save-queue";

export type CardData = { state: "loading" } | { state: "ready"; result: WidgetResult } | { state: "failed" };

export type DashboardLoad =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "notfound"; archived: boolean }
  | { kind: "error"; status: number };

export interface DashboardMeta {
  id: string;
  description: string | null;
  ownerId: string | null;
  spaceId: string | null;
  spaceMissing: boolean;
  canEdit: boolean;
  owner: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
}

export interface PreviewSeed {
  key: string;
  result: WidgetResult;
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A write input as a stored card, the way the server will normalise it. */
export function widgetFromInput(input: WidgetInput, existing?: EditorWidget): EditorWidget | null {
  const r = resolvePassthrough([input], []);
  if (!r.ok) return null;
  const w = r.widgets[0] as EditorWidget;
  // A partly readable card stays partial: the editor holds only the part it
  // can see, and the server appends the rest on save.
  if (existing && "partial" in existing && existing.partial && w.kind !== "notes" && w.kind !== "passthrough") {
    return { ...w, partial: true } as EditorWidget;
  }
  return w;
}

export function useDashboard(id: string, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const queue = useMemo(() => dashboardQueue(id), [id]);
  const qs: QueueState = useSyncExternalStore(queue.subscribe, queue.getState, queue.getState);
  const { toast } = useOsToast();
  const zone = useMemo(() => browserZone(), []);

  const [load, setLoad] = useState<DashboardLoad>({ kind: "loading" });
  const [meta, setMeta] = useState<DashboardMeta | null>(null);
  const [data, setData] = useState<Record<string, CardData>>({});
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [refreshWanted, setRefreshWanted] = useState(false);


  useEffect(() => queue.attach(toast), [queue, toast]);

  const fetchData = useCallback(
    async (only?: string[]) => {
      // Read from the queue, not from render: the first load asks right after
      // the dashboard lands, before React has drawn it.
      const current = () => queue.getState().local?.widgets ?? [];
      const keysAtRequest = new Map(current().map((w) => [w.id, dataKey(w)] as const));
      const ids = only ?? null;
      // A card already showing a result (the editor's preview of exactly
      // these settings) keeps it until the stored answer lands, so a save
      // never flashes a skeleton over the right numbers; a failed or empty
      // one shows its skeleton while it is asked again.
      if (ids) {
        setData((prev) => {
          const next = { ...prev };
          for (const i of ids) if (prev[i]?.state !== "ready") next[i] = { state: "loading" };
          return next;
        });
      } else setDataLoading(true);
      const urls = ids
        ? ids.map((w) => `/api/dashboards/${encodeURIComponent(id)}/data?widget=${encodeURIComponent(w)}&tz=${encodeURIComponent(zone)}`)
        : [`/api/dashboards/${encodeURIComponent(id)}/data?tz=${encodeURIComponent(zone)}`];
      const answers = await Promise.all(
        urls.map(async (u) => {
          try {
            const res = await fetch(u, { cache: "no-store" });
            if (!res.ok) return null;
            return (await res.json()) as { widgets: Record<string, WidgetResult>; computedAt: string };
          } catch {
            return null;
          }
        }),
      );
      const fresh = new Map(current().map((w) => [w.id, dataKey(w)] as const));
      setData((prev) => {
        const next = { ...prev };
        const targetIds = ids ?? current().map((w) => w.id);
        answers.forEach((a, i) => {
          const scope = ids ? [ids[i]] : targetIds;
          for (const wid of scope) {
            // Edited since this request went out: its own refetch will come.
            if (keysAtRequest.get(wid) !== fresh.get(wid)) continue;
            if (!a) {
              next[wid] = { state: "failed" };
              continue;
            }
            const r = a.widgets?.[wid];
            next[wid] = r ? { state: "ready", result: r } : { state: "failed" };
          }
        });
        return next;
      });
      const stamp = answers.find((a) => a?.computedAt)?.computedAt;
      if (stamp) setComputedAt(stamp);
      if (!ids) setDataLoading(false);
    },
    [id, zone, queue],
  );

  const loadDashboard = useCallback(async () => {
    let status = 0;
    let body: unknown = null;
    try {
      const res = await fetch(`/api/dashboards/${encodeURIComponent(id)}`, { cache: "no-store" });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    if (status === 404) {
      setLoad({ kind: "notfound", archived: (body as { archived?: unknown } | null)?.archived === true });
      return;
    }
    const b = body as {
      dashboard?: { id: string; name: string; description: string | null; ownerId: string | null; spaceId: string | null; spaceMissing?: boolean; widgets: EditorWidget[]; updatedAt: string };
      canEdit?: boolean;
      owner?: DashboardMeta["owner"];
    } | null;
    if (status < 200 || status >= 300 || !b?.dashboard) {
      setLoad({ kind: "error", status });
      return;
    }
    const d = b.dashboard;
    queue.hydrate({ updatedAt: d.updatedAt, name: d.name, widgets: Array.isArray(d.widgets) ? d.widgets : [] });
    setMeta({
      id: d.id,
      description: d.description ?? null,
      ownerId: d.ownerId ?? null,
      spaceId: d.spaceId ?? null,
      spaceMissing: d.spaceMissing === true,
      canEdit: b.canEdit === true,
      owner: b.owner ?? null,
    });
    setLoad({ kind: "ready" });
  }, [id, queue]);

  // First load: the dashboard, then its numbers.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const t = setTimeout(() => {
      void (async () => {
        await loadDashboard();
        if (live) await fetchData();
      })();
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [enabled, loadDashboard, fetchData]);

  // A save landed: refetch exactly the cards whose data it changed.
  useEffect(() => queue.onSaved((changed) => void fetchData(changed)), [queue, fetchData]);
  // The server said this person can no longer edit: read the dashboard again
  // so the canvas turns read-only, keeping the draft.
  useEffect(
    () =>
      queue.onForbidden(() => {
        void (async () => {
          const res = await fetch(`/api/dashboards/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
          const body = res && res.ok ? ((await res.json().catch(() => null)) as { canEdit?: boolean } | null) : null;
          setMeta((m) => (m ? { ...m, canEdit: body?.canEdit === true } : m));
        })();
      }),
    [queue, id],
  );

  // Refresh waits for an idle queue, so it never computes a half-saved state.
  const busy = qs.inFlight || qs.status === "saving" || qs.status === "retrying";
  useEffect(() => {
    if (!refreshWanted || busy) return;
    const t = setTimeout(() => {
      setRefreshWanted(false);
      void fetchData();
    }, 0);
    return () => clearTimeout(t);
  }, [refreshWanted, busy, fetchData]);

  const refresh = useCallback(() => setRefreshWanted(true), []);

  // ── edits ──────────────────────────────────────────────────────────

  const seed = useCallback((widgetId: string, input: WidgetInput, preview?: PreviewSeed | null) => {
    setData((prev) => ({
      ...prev,
      [widgetId]: preview && preview.key === previewKey(input) ? { state: "ready", result: preview.result } : { state: "loading" },
    }));
  }, []);

  const rename = useCallback((name: string) => queue.mutate((s) => ({ ...s, name })), [queue]);

  const addWidget = useCallback(
    (input: WidgetInput, preview?: PreviewSeed | null): EditorWidget | null => {
      const w = widgetFromInput(input);
      if (!w) return null;
      queue.mutate((s) => ({ ...s, widgets: [...s.widgets.filter((x) => x.id !== w.id), w] }), { immediate: true });
      if (w.kind !== "notes") seed(w.id, input, preview);
      return w;
    },
    [queue, seed],
  );

  const updateWidget = useCallback(
    (widgetId: string, input: WidgetInput, preview?: PreviewSeed | null) => {
      const existing = queue.getState().local?.widgets.find((w) => w.id === widgetId);
      const w = widgetFromInput(input, existing);
      if (!w) return;
      const settingsChanged = !existing || dataKey(existing) !== dataKey(w);
      queue.mutate((s) => ({ ...s, widgets: s.widgets.map((x) => (x.id === widgetId ? w : x)) }), { immediate: true });
      if (settingsChanged && w.kind !== "notes") seed(widgetId, input, preview);
    },
    [queue, seed],
  );

  const renameWidget = useCallback(
    (widgetId: string, title: string) =>
      queue.mutate((s) => ({ ...s, widgets: s.widgets.map((x) => (x.id === widgetId && "title" in x ? ({ ...x, title } as EditorWidget) : x)) })),
    [queue],
  );

  const setNotesText = useCallback(
    (widgetId: string, text: string) =>
      queue.mutate((s) => ({ ...s, widgets: s.widgets.map((x) => (x.id === widgetId && x.kind === "notes" ? { ...x, text } : x)) })),
    [queue],
  );

  const removeWidget = useCallback(
    (widgetId: string): { card: EditorWidget; index: number } | null => {
      const cards = queue.getState().local?.widgets ?? [];
      const index = cards.findIndex((w) => w.id === widgetId);
      if (index < 0) return null;
      const card = cards[index];
      const baseIds = new Set(queue.getState().base?.widgets.map((w) => w.id) ?? []);
      queue.mutate((s) => ({ ...s, ...removeWidgetLocal({ widgets: s.widgets, removedIds: s.removedIds, baseIds }, widgetId) }), { immediate: true });
      return { card, index };
    },
    [queue],
  );

  const undoRemove = useCallback(
    (card: EditorWidget, index: number) => queue.mutate((s) => ({ ...s, ...readdWidgetLocal({ widgets: s.widgets, removedIds: s.removedIds }, card, index) }), { immediate: true }),
    [queue],
  );

  const moveLayouts = useCallback(
    (layouts: Record<string, WidgetLayout>) => queue.mutate((s) => ({ ...s, widgets: applyLayouts(s.widgets, layouts) })),
    [queue],
  );

  // ── conflict and draft ──────────────────────────────────────────────

  // The toast's "Try again" calls the latest reloadLive through this ref,
  // which an effect keeps current after every render.
  const reloadLiveRef = useRef<(() => Promise<void>) | null>(null);
  const reloadLive = useCallback(async () => {
    const r = await queue.reloadLive();
    if (!r.ok) {
      toast(r.message, { tone: "danger", action: { label: "Try again", onClick: () => void reloadLiveRef.current?.() } });
      return;
    }
    setMeta((m) => (m ? { ...m, canEdit: r.canEdit } : m));
    void fetchData();
  }, [queue, toast, fetchData]);
  useEffect(() => {
    reloadLiveRef.current = reloadLive;
  });

  const keepMine = useCallback(async () => {
    const r = await queue.keepMine();
    if (!r.ok) toast(r.message, { tone: "danger", action: { label: "Try again", onClick: () => void queue.keepMine() } });
  }, [queue, toast]);

  const draft: LocalDraft<DraftPayload> = useMemo(
    () => ({
      pending: qs.draftOffer,
      write: () => {},
      clear: () => queue.discardDraft(),
      discard: () => queue.discardDraft(),
      consume: () => {},
      key: `dashboard:${id}`,
    }),
    [qs.draftOffer, queue, id],
  );

  return {
    queue,
    save: qs,
    load,
    meta,
    name: qs.local?.name ?? "",
    widgets: qs.local?.widgets ?? [],
    data,
    dataLoading,
    computedAt,
    refreshPending: refreshWanted,
    busy,
    draft,
    actions: {
      reload: async () => {
        await loadDashboard();
        await fetchData();
      },
      refresh,
      refetchCard: (widgetId: string) => void fetchData([widgetId]),
      rename,
      addWidget,
      updateWidget,
      renameWidget,
      setNotesText,
      removeWidget,
      undoRemove,
      moveLayouts,
      retry: () => queue.retry(),
      reloadLive,
      keepMine,
      restoreDraft: (p: DraftPayload) => queue.restoreDraft(p),
    },
  };
}

export type DashboardHandle = ReturnType<typeof useDashboard>;
