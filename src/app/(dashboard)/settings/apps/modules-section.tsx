"use client";

// Apps & modules > Modules (the old /settings/modules 308s to
// /settings/apps#modules). The premium-module switches, one ModuleCard per
// module from the real registry (src/lib/modules.ts) with this workspace's
// real state from GET /api/products. ModuleCard writes ProductInstallation
// through POST / DELETE /api/products/installations, asks before turning a
// module off (it locks the module for everyone), and dispatches
// workwrk:prefs-changed so the rail updates in place. Non-admins see a
// status line where the switch would be.
//
// The card's description is about the modules alone (settings-cleanup
// Phase 2): what people asked for is the Requests section's, further down
// this same page, so this card no longer reads or repeats those counts.
// The tiles wrap to one column on a phone, never wider than the card.

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { MODULES } from "@/lib/modules";
import { ModuleCard } from "@/components/modules/module-card";
import { SettingsCard } from "@/components/settings/settings-card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";

type Product = { slug: string; tier: string; installation: { status: string } | null; needsUpgrade?: boolean };

export function ModulesSection() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [canChangePlan, setCanChangePlan] = useState(false);
  const [plan, setPlan] = useState("STARTER");
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<{ products: Product[]; canManage: boolean; canChangePlan?: boolean; plan?: string }>("/api/products", { cache: "no-store" });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setProducts(r.data.products);
    setCanManage(r.data.canManage);
    setCanChangePlan(r.data.canChangePlan ?? r.data.canManage);
    setPlan(r.data.plan ?? "STARTER");
    setOverride({});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const bySlug = useMemo(() => new Map((products ?? []).map((p) => [p.slug, p])), [products]);
  const isOn = (slug: string) => override[slug] ?? bySlug.get(slug)?.installation?.status === "ACTIVE";

  return (
    <SettingsCard
      id="modules"
      title="Modules"
      description="Premium modules extend your workspace. Turn one on to add it to every member's rail."
    >
      {error ? (
        <ErrorState compact what="modules" hint={error} onRetry={() => { void load(); }} />
      ) : products === null ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))]">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))]">
          {MODULES.map((m) => (
            <ModuleCard
              key={m.appKey}
              module={m}
              on={isOn(m.productSlug)}
              canManage={canManage}
              canChangePlan={canChangePlan}
              plan={plan}
              needsUpgrade={bySlug.get(m.productSlug)?.needsUpgrade ?? false}
              onChanged={(on) => setOverride((o) => ({ ...o, [m.productSlug]: on }))}
            />
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
