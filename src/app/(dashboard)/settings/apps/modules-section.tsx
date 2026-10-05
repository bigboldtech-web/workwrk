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
// The request counts the old page showed ("People here have sent N connector
// requests") point at the Requests card further down this same page.

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
  const [asked, setAsked] = useState<{ requests: number; suggestions: number } | null>(null);

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

  // Two real numbers; a count that did not load is not shown rather than shown as zero.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void Promise.all([
      apiFetch<{ total?: number }>("/api/integrations/requests", { cache: "no-store" }),
      apiFetch<{ total?: number }>("/api/marketplace/requests", { cache: "no-store" }),
    ]).then(([a, b]) => {
      if (cancelled || !a.ok || !b.ok) return;
      setAsked({ requests: typeof a.data.total === "number" ? a.data.total : 0, suggestions: typeof b.data.total === "number" ? b.data.total : 0 });
    });
    return () => { cancelled = true; };
  }, [canManage]);

  const bySlug = useMemo(() => new Map((products ?? []).map((p) => [p.slug, p])), [products]);
  const isOn = (slug: string) => override[slug] ?? bySlug.get(slug)?.installation?.status === "ACTIVE";

  return (
    <SettingsCard
      id="modules"
      wide="apps.modules"
      title="Modules"
      description={
        <>
          Premium modules extend your workspace. Turn one on to add it to every member&apos;s rail.
          {asked
            ? asked.requests + asked.suggestions === 0
              ? " Nobody here has requested a connector or suggested an app yet."
              : ` People here have sent ${asked.requests} connector ${asked.requests === 1 ? "request" : "requests"} and ${asked.suggestions} app ${asked.suggestions === 1 ? "suggestion" : "suggestions"}; they are listed under Requests below.`
            : ""}
        </>
      }
    >
      {error ? (
        <ErrorState compact what="modules" hint={error} onRetry={() => { void load(); }} />
      ) : products === null ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
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
