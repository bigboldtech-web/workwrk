"use client";

// Enabled modules — the org-level feature-flag surface. Lists the 9
// canonical product modules and lets an admin toggle each on/off. The
// enabled set lives in Organization.settings.enabledModules and drives
// sidebar nav + feature gating elsewhere. Backed by GET /api/settings
// (settings.enabledModules) + PATCH { section:"modules" } — both already
// exist; the PATCH is admin-gated server-side, so non-admins see this
// read-only.

import { useEffect, useState } from "react";
import { Boxes, Loader2 } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { useOsToast } from "@/components/layout/os/toast";

// The 9 canonical module keys, in display order, with friendly copy.
const MODULES: { key: string; label: string; desc: string }[] = [
  { key: "people", label: "People", desc: "HR directory, departments & org chart" },
  { key: "kra-kpi", label: "KRAs & KPIs", desc: "Alignment, scoring & the performance loop" },
  { key: "tasks", label: "Tasks", desc: "Projects, boards & to-dos" },
  { key: "sops", label: "SOPs", desc: "Standard operating procedures & docs" },
  { key: "reviews", label: "Reviews", desc: "Performance review cycles" },
  { key: "meetings", label: "Meetings", desc: "Agendas, notes & action items" },
  { key: "checkins", label: "Check-ins", desc: "1:1s and recurring check-ins" },
  { key: "ai", label: "AI", desc: "Sidekick assistant & agents" },
  { key: "analytics", label: "Analytics", desc: "Dashboards & reporting" },
];

export default function ModulesSettingsPage() {
  const { accessLevel } = useRole();
  const canEdit = ["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL"].includes(accessLevel);
  const { toast } = useOsToast();

  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: string[] = Array.isArray(d?.settings?.enabledModules)
          ? d.settings.enabledModules
          : [];
        setEnabled(new Set(list));
      })
      .catch(() => setEnabled(new Set()));
  }, []);

  const toggle = (key: string) => {
    if (!canEdit) return;
    setEnabled((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    if (!enabled) return;
    setSaving(true);
    // Preserve canonical order; only keys the org has on are sent.
    const enabledModules = MODULES.map((m) => m.key).filter((k) => enabled.has(k));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section: "modules", data: { enabledModules } }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Save failed");
      }
      toast("Modules updated");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Boxes className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Enabled modules</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[13px] text-zinc-500">
        Turn product modules on or off for your whole organization.
        {canEdit ? "" : " You need admin access to change these."}
      </p>

      {enabled === null ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading modules…
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {MODULES.map((m, i) => {
              const on = enabled.has(m.key);
              return (
                <div
                  key={m.key}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    i < MODULES.length - 1 ? "border-b border-zinc-100" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-zinc-900">{m.label}</div>
                    <div className="truncate text-[12px] text-zinc-500">{m.desc}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Toggle ${m.label}`}
                    disabled={!canEdit}
                    onClick={() => toggle(m.key)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      on ? "bg-zinc-900" : "bg-zinc-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        on ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!canEdit || saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[12px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save changes
            </button>
          </div>
        </>
      )}
      <div className="h-10" />
    </div>
  );
}
