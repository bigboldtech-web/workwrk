"use client";

// Settings → Modules — the org-level premium-module toggles. Lists each
// module (Talk, Tables) with a live switch that writes ProductInstallation:
// on → POST /api/products/installations, off → DELETE. Flipping it updates
// the rail immediately (we dispatch workwrk:prefs-changed, which the shell
// refetches /api/preferences on). The old 9-key enabledModules UI is gone —
// it gated nothing. Admin-only edit (SUPER_ADMIN / COMPANY_ADMIN), matching
// the installations API authz; everyone else sees it read-only.

import { useEffect, useState } from "react";
import { Boxes, Loader2 } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { useOsToast } from "@/components/layout/os/toast";
import { Switch } from "@/components/ui/switch";
import { MODULES } from "@/lib/modules";

export default function ModulesSettingsPage() {
  const { accessLevel } = useRole();
  const canEdit = ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(accessLevel);
  const { toast } = useOsToast();

  // Active product slugs; null until the installations fetch answers.
  const [active, setActive] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/products/installations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const rows: { productSlug?: string; status?: string }[] = Array.isArray(d?.installations)
          ? d.installations
          : [];
        setActive(new Set(rows.filter((x) => x.status === "ACTIVE" && x.productSlug).map((x) => x.productSlug as string)));
      })
      .catch(() => setActive(new Set()));
  }, []);

  const setModule = async (slug: string, on: boolean) => {
    if (!canEdit || busy) return;
    setBusy(slug);
    // Optimistic flip so the switch feels instant.
    setActive((prev) => {
      const next = new Set(prev ?? []);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
    try {
      const res = await fetch("/api/products/installations", {
        method: on ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productSlug: slug }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Couldn't update the module");
      }
      // Refresh the rail (and any other prefs consumer) in this tab.
      window.dispatchEvent(new CustomEvent("workwrk:prefs-changed"));
      toast(on ? "Module turned on" : "Module turned off");
    } catch (e) {
      // Revert the optimistic flip.
      setActive((prev) => {
        const next = new Set(prev ?? []);
        if (on) next.delete(slug);
        else next.add(slug);
        return next;
      });
      toast(e instanceof Error ? e.message : "Couldn't update the module");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Boxes className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Modules</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[14px] text-zinc-500">
        Premium modules extend your workspace. Turn one on to add it to every member&apos;s rail.
        {canEdit ? "" : " You need admin access to change these."}
      </p>

      {active === null ? (
        <div className="flex items-center gap-2 text-[14px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading modules…
        </div>
      ) : (
        <div className="max-w-2xl overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {MODULES.map((m, i) => {
            const on = active.has(m.productSlug);
            return (
              <div
                key={m.productSlug}
                className={`flex items-center gap-4 px-4 py-3.5 ${
                  i < MODULES.length - 1 ? "border-b border-zinc-100" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14.5px] font-medium text-zinc-900">{m.label}</span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                      {m.competesWith}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[13px] leading-5 text-zinc-500">{m.blurb}</div>
                </div>
                {busy === m.productSlug ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                ) : (
                  <Switch
                    checked={on}
                    disabled={!canEdit}
                    onChange={(next) => void setModule(m.productSlug, next)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}
