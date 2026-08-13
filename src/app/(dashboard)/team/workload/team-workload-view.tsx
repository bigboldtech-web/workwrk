"use client";

// TeamWorkloadView — thin client wrapper around the SAME WorkloadGrid
// the board WORKLOAD view renders (no parallel renderer). The server
// page already excluded done/closed rows against each board's OWN
// status set; the grid's re-check runs against DEFAULT_STATUS_OPTIONS
// where isDoneStatus falls back to the shared cross-board name rule
// (the /api/me/items rule), so both layers agree. Settings persist
// migration-free in localStorage; read in an effect (not the
// initializer) so the SSR pass and the first client render agree.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_STATUS_OPTIONS, type BoardItemRow } from "@/lib/board-items-shared";
import {
  DEFAULT_WORKLOAD_SETTINGS,
  WorkloadGrid,
  sanitizeWorkloadSettings,
  type WorkloadPerson,
  type WorkloadSettings,
} from "@/components/board-view/workload-grid";

const STORE_KEY = "workwrk:team-workload:v1";

export function TeamWorkloadView({ items, people }: { items: BoardItemRow[]; people: WorkloadPerson[] }) {
  const router = useRouter();
  const [settings, setSettings] = useState<WorkloadSettings>(DEFAULT_WORKLOAD_SETTINGS);

  useEffect(() => {
    // Deferred a tick (the click-sidebar width pattern) so hydration
    // completes on the SSR markup before stored settings apply.
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setSettings(sanitizeWorkloadSettings(parsed as Partial<Record<keyof WorkloadSettings, unknown>>));
        }
      } catch {
        // Corrupt blob → keep defaults.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const handleSettingsChange = useCallback((patch: Partial<WorkloadSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        // Storage full/blocked → settings stay session-local.
      }
      return next;
    });
  }, []);

  return (
    <WorkloadGrid
      items={items}
      people={people}
      statuses={[...DEFAULT_STATUS_OPTIONS]}
      settings={settings}
      canEdit
      onSettingsChange={handleSettingsChange}
      onOpenItem={(id) => router.push(`/item/${id}`)}
    />
  );
}
