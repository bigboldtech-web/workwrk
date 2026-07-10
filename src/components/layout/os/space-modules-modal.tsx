"use client";

// SpaceModulesModal — manage a Space's Modules ("ClickApps") any time, not just
// at creation. Reuses the wizard's ModulesSubScreen; loads the Space's current
// modules from GET /api/spaces/[id] and saves each toggle via PATCH (merged
// into settings.workflow.modules). Portaled to <body> so it escapes clips.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ModulesSubScreen } from "./space-wizard-step2";
import { MODULE_CATALOG } from "./space-wizard-presets";
import type { ModuleKey } from "./space-wizard-types";
import { readSpaceModules } from "@/lib/space-modules";

// Default-on set for a Space that has never configured modules (legacy) — every
// real (non-Soon) module. Matches the backward-compatible "all on" default, so
// opening + saving never silently disables a feature the Space already showed.
const DEFAULT_ON: ModuleKey[] = MODULE_CATALOG.filter((m) => m.shownInWizard && !m.soon).map((m) => m.key);

export function SpaceModulesModal({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const [modules, setModules] = useState<ModuleKey[] | null>(null);
  const [accent, setAccent] = useState<string>("var(--os-brand)");

  useEffect(() => {
    let alive = true;
    fetch(`/api/spaces/${spaceId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const space = d?.space;
        if (typeof space?.color === "string" && space.color) setAccent(space.color);
        setModules(readSpaceModules(space?.settings) ?? DEFAULT_ON);
      })
      .catch(() => { if (alive) setModules(DEFAULT_ON); });
    return () => { alive = false; };
  }, [spaceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = (next: ModuleKey[]) => {
    setModules(next);
    void fetch(`/api/spaces/${spaceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modules: next }),
    }).catch(() => {});
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
        {modules === null ? (
          <div className="p-8 text-center text-sm text-muted">Loading modules…</div>
        ) : (
          <ModulesSubScreen accent={accent} modules={modules} onChange={save} onClose={onClose} />
        )}
      </div>
    </div>,
    document.body,
  );
}
