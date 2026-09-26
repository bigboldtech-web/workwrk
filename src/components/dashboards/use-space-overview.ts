"use client";

// useSpaceOverview: a Space's shared widgets on its Overview tab.
//
// The widgets are the one Dashboard row whose id is spaceOverviewId(spaceId)
// (dashboard-access.ts), read and saved exactly like a dashboard, through the
// same save queue (useDashboard). A 404 means the Space has no widgets yet,
// and for a Guest or anyone who cannot read the Space it means the same, so
// the Overview simply shows its built-in cards.
//
// The FIRST card creates the row: POST /api/dashboards { overview: true,
// spaceId, name, widgets: [card] }, busy-locked. Two managers adding a first
// card at the same moment collide on the primary key; the one who loses gets
// 409 overview_exists, reads the row the other made and adds their card to it
// through the queue, so neither card is dropped. Only the Space's managers
// (canEditSpace) may create or edit it; a 403 space_manage_only becomes a
// sentence.

import { useCallback, useState } from "react";
import { spaceOverviewId } from "@/lib/dashboards/dashboard-access";
import { dashboardMessage } from "@/lib/dashboards/dashboard-messages";
import { layoutsOf, placeNewWidget } from "@/lib/dashboards/dashboard-editor";
import type { WidgetInput, WidgetLayout } from "@/lib/dashboards/widgets";
import { useDashboard, type PreviewSeed } from "./use-dashboard";

export type OverviewSaveResult = { ok: true } | { ok: false; message: string };

export function useSpaceOverview(overview: { spaceId: string; spaceName: string; canManage: boolean } | null | undefined) {
  const id = overview ? spaceOverviewId(overview.spaceId) : "sov_none";
  const d = useDashboard(id, { enabled: !!overview });
  const [creating, setCreating] = useState(false);

  const exists = d.load.kind === "ready";
  // A 403 means the widgets are not this person's to see at all (no widgets,
  // no Widgets section); any other failure is a read that can be retried.
  const refused = d.load.kind === "error" && d.load.status === 403;
  const failed = d.load.kind === "error" && !refused;
  // The server's answer once the row exists; the page's ladder before that.
  const canManage = !!overview && !refused && (exists ? d.meta?.canEdit === true : overview.canManage);

  /**
   * Save one card: into the existing row through the queue, or by creating
   * the row with it. Resolves once the card is stored, or with the sentence
   * that says why not (the editor stays open with its input).
   */
  const saveCard = useCallback(
    async (mode: "add" | "edit", input: WidgetInput, preview: PreviewSeed | null, placeAgainst: WidgetLayout[]): Promise<OverviewSaveResult> => {
      if (!overview) return { ok: false, message: "This Space isn't loaded yet." };
      const viaQueue = async (): Promise<OverviewSaveResult> => {
        if (mode === "add") {
          if (!d.actions.addWidget(input, preview)) return { ok: false, message: "This widget isn't complete yet." };
        } else {
          d.actions.updateWidget(input.id, input, preview);
        }
        const s = d.queue.getState().status;
        if (s === "stopped" || s === "error") d.queue.retry();
        const r = await d.queue.settle();
        if (!r.ok && r.conflict) return { ok: true };
        return r.ok ? { ok: true } : { ok: false, message: r.message };
      };
      if (exists) return viaQueue();
      if (creating) return { ok: false, message: "Still saving the first widget." };
      setCreating(true);
      try {
        const res = await fetch("/api/dashboards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ overview: true, spaceId: overview.spaceId, name: `${overview.spaceName} overview`.slice(0, 160), widgets: [input] }),
        });
        const body = await res.json().catch(() => null);
        if (res.status === 201) {
          await d.actions.reload();
          return { ok: true };
        }
        if (res.status === 409 && (body as { error?: unknown } | null)?.error === "overview_exists") {
          // Someone made it first: read theirs and add this card to it, placed
          // clear of what is already there.
          await d.actions.reload();
          const live = d.queue.getState().local?.widgets ?? [];
          const placed = { ...input, layout: placeNewWidget([...Object.values(layoutsOf(live)), ...placeAgainst], "layout" in input ? { w: input.layout.w, h: input.layout.h } : { w: 4, h: 4 }) } as WidgetInput;
          if (!d.queue.getState().base) return { ok: false, message: "Couldn't open this Space's widgets. Try again." };
          if (!d.actions.addWidget(placed, null)) return { ok: false, message: "This widget isn't complete yet." };
          const r = await d.queue.settle();
          return r.ok || r.conflict ? { ok: true } : { ok: false, message: r.message };
        }
        return { ok: false, message: dashboardMessage(body, "Couldn't add the widget.") };
      } catch {
        return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
      } finally {
        setCreating(false);
      }
    },
    [overview, exists, creating, d],
  );

  return { ...d, id, exists, failed, canManage, creating, saveCard };
}
