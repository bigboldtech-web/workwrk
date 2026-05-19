"use client";

import { useEffect, useState } from "react";
import { Grid3x3, Check, Clock, ExternalLink } from "lucide-react";

// Product Store — full-page version of the Apps Grid modal.
//
// Lists every product in the catalog grouped by suite. Each row shows
// install state (installed / available / coming soon). Install/uninstall
// hit /api/products/installations.
//
// Phase A: read-only catalog view + a link to the modal trigger in the
// topbar. Phase B adds the actual install flow + per-product mini-config
// wizards.

interface Product {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  iconKey: string | null;
  hue: string | null;
  suite: string;
  tier: string;
  status: string;
  defaultEnabled: boolean;
  pathPrefix: string | null;
}

interface Installation {
  productSlug: string;
  status: string;
  installedAt: string;
}

const SUITE_LABELS: Record<string, string> = {
  CROSS: "Cross-functional core",
  PEOPLE: "People",
  SALES: "Sales",
  OPERATIONS: "Operations",
  IT: "IT",
  MARKETING: "Marketing",
  FINANCE: "Finance",
  ENGINEERING: "Engineering",
  LEGAL: "Legal",
  SUPPORT: "Support",
};

const SUITE_ORDER = [
  "CROSS",
  "PEOPLE",
  "SALES",
  "OPERATIONS",
  "IT",
  "MARKETING",
  "ENGINEERING",
  "FINANCE",
  "LEGAL",
  "SUPPORT",
];

export default function ProductStorePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [installs, setInstalls] = useState<Map<string, Installation>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/products").then((r) => (r.ok ? r.json() : { products: [] })),
      fetch("/api/products/installations").then((r) =>
        r.ok ? r.json() : { installations: [] },
      ),
    ])
      .then(([catalog, my]) => {
        setProducts(catalog.products || []);
        const map = new Map<string, Installation>();
        for (const i of my.installations || []) map.set(i.productSlug, i);
        setInstalls(map);
      })
      .finally(() => setLoading(false));
  }, []);

  const grouped = new Map<string, Product[]>();
  for (const p of products) {
    if (!grouped.has(p.suite)) grouped.set(p.suite, []);
    grouped.get(p.suite)!.push(p);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium mb-3">
          <Grid3x3 size={12} />
          Product Store
        </div>
        <h1 className="text-3xl font-semibold mb-1">Explore products</h1>
        <p className="text-muted max-w-2xl">
          Add a department to your workspace. Each product ships with boards,
          AI agents, automations, and templates tuned for that team.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted text-sm">
          Loading catalog…
        </div>
      ) : (
        SUITE_ORDER.filter((s) => grouped.has(s)).map((suite) => (
          <section key={suite} className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-2 mb-3">
              {SUITE_LABELS[suite] ?? suite}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {grouped.get(suite)!.map((p) => {
                const install = installs.get(p.slug);
                const isInstalled = install?.status === "ACTIVE";
                const isComingSoon = p.status === "COMING_SOON";
                return (
                  <article
                    key={p.slug}
                    className="rounded-2xl border border-border bg-surface p-5 hover:border-violet-300 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div
                        className={`w-10 h-10 rounded-lg bg-${p.hue ?? "blue"}-100 text-${p.hue ?? "blue"}-600 flex items-center justify-center font-semibold`}
                        aria-hidden
                      >
                        {p.name.replace(/^WorkwrK /, "")[0]}
                      </div>
                      {isInstalled && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                          <Check size={12} /> Installed
                        </span>
                      )}
                      {isComingSoon && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                          <Clock size={12} /> Coming soon
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold mb-1">{p.name}</h3>
                    <p className="text-xs text-muted mb-2 line-clamp-2">{p.tagline}</p>
                    <p className="text-[11px] text-muted-2 mb-4 line-clamp-3">{p.description}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-2">{p.tier}</span>
                      {isInstalled && p.pathPrefix ? (
                        <a
                          href={p.pathPrefix}
                          className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-700 font-medium"
                        >
                          Open
                          <ExternalLink size={11} />
                        </a>
                      ) : isComingSoon ? (
                        <button type="button" disabled className="opacity-50">
                          Notify me
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="px-3 py-1 rounded-md border border-border text-muted disabled:opacity-60"
                        >
                          Install
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
