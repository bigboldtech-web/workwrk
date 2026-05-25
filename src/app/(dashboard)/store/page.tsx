"use client";

import { useEffect, useState } from "react";
import { Grid3x3, Check, Clock, ExternalLink, Sparkles, Loader2 } from "lucide-react";

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
  // Per-row install state so the user gets a visible spinner on the
  // exact card they clicked instead of an opaque list-wide loading.
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  async function installProduct(productSlug: string) {
    setInstalling(productSlug);
    setInstallError(null);
    try {
      const r = await fetch("/api/products/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productSlug }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setInstallError(d.error || "Install failed");
        return;
      }
      // Locally mark as ACTIVE so the card flips to "Open" without a
      // full refetch. The server is authoritative — the next mount
      // will re-sync via /api/products/installations.
      setInstalls((prev) => {
        const next = new Map(prev);
        next.set(productSlug, { productSlug, status: "ACTIVE", installedAt: new Date().toISOString() });
        return next;
      });
    } finally {
      setInstalling(null);
    }
  }
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

      {installError && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {installError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted text-sm">
          Loading catalog…
        </div>
      ) : (
        <>
          {SUITE_ORDER.filter((s) => grouped.has(s)).map((suite) => (
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
                          <span className="text-xs text-muted-2 italic">Not yet available</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => installProduct(p.slug)}
                            disabled={installing === p.slug}
                            className="px-3 py-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-60"
                          >
                            {installing === p.slug ? "Installing…" : "Install"}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

          <StarterTemplates products={products} />
        </>
      )}
    </div>
  );
}

// Starter templates — Phase B6. Lists every catalog template grouped by
// product. Clicking "Apply" hits POST /api/templates/[slug]/apply which
// plants sample data in the org so a fresh install isn't an empty
// page. Admin-only on the server side; we show the button to everyone
// but the POST will 403 for non-admins.

interface CatalogTemplate {
  slug: string;
  name: string;
  tagline: string;
  productSlug: string;
}

function StarterTemplates({ products }: { products: Product[] }) {
  const [templates, setTemplates] = useState<CatalogTemplate[]>([]);
  const [applyingSlug, setApplyingSlug] = useState<string | null>(null);
  const [appliedSlug, setAppliedSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.ok ? r.json() : { templates: [] })
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => {});
  }, []);

  if (templates.length === 0) return null;

  const productNameBySlug = new Map(products.map((p) => [p.slug, p.name]));

  async function apply(slug: string) {
    setApplyingSlug(slug);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${slug}/apply`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Apply failed");
        return;
      }
      setAppliedSlug(slug);
      setTimeout(() => setAppliedSlug((s) => (s === slug ? null : s)), 3000);
    } finally {
      setApplyingSlug(null);
    }
  }

  return (
    <section className="mt-12 pt-10 border-t border-border">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-2 mb-2 inline-flex items-center gap-1.5">
            <Sparkles size={12} /> Starter templates
          </h2>
          <p className="text-xs text-muted max-w-xl">
            One-click sample data so a fresh install isn&apos;t an empty page. Apply any template
            below to plant realistic starter records — accounts, leads, deals, tickets, articles,
            campaigns, sprints, contracts, macros — into the matching product.
          </p>
        </div>
      </div>
      {error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {templates.map((t) => {
          const productName = productNameBySlug.get(t.productSlug) ?? t.productSlug;
          const isApplying = applyingSlug === t.slug;
          const justApplied = appliedSlug === t.slug;
          return (
            <article
              key={t.slug}
              className="rounded-xl border border-border bg-surface p-4 hover:border-violet-300 transition-colors"
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-2 mb-1.5">
                {productName.replace(/^WorkwrK /, "")}
              </div>
              <h3 className="font-semibold text-sm mb-1">{t.name}</h3>
              <p className="text-xs text-muted mb-3 line-clamp-2">{t.tagline}</p>
              <button
                type="button"
                onClick={() => apply(t.slug)}
                disabled={isApplying || justApplied}
                className={
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors " +
                  (justApplied
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-violet-100 hover:bg-violet-200 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 disabled:opacity-50")
                }
              >
                {isApplying ? (
                  <><Loader2 size={11} className="animate-spin" /> Applying…</>
                ) : justApplied ? (
                  <><Check size={11} /> Applied</>
                ) : (
                  <><Sparkles size={11} /> Apply template</>
                )}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
