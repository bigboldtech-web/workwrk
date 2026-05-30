"use client";

/* Helpdesk · Macros — canned response library.
 *
 *  GET  /api/helpdesk/macros
 *  POST /api/helpdesk/macros  { slug, title, body, category?, resolves? }
 *
 * Layout:
 *   OsTitleBar with back + nav + New macro in actions.
 *   4-tile KPI strip: Total · Categories · Most-used · Auto-resolve.
 *   Toolbar: search + category chips + sort.
 *   Card grid: title + category + resolves badge + slug trigger + body preview + usage.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot, Plus, Search, ArrowLeft, Tag, ChevronDown, CheckCircle2,
  Hash, Activity, Copy, Layers, Zap,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiMacro = {
  id: string;
  slug: string;
  title: string;
  body: string;
  category?: string | null;
  resolves: boolean;
  archivedAt?: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

const CAT_COLORS = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
function categoryColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CAT_COLORS[h % CAT_COLORS.length];
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function bodyPreview(body: string, max = 220): string {
  const txt = body.replace(/\r\n/g, "\n").trim();
  return txt.length > max ? txt.slice(0, max).trim() + "…" : txt;
}

type SortKey = "popular" | "recent" | "name";

export default function MacrosPage() {
  const [macros, setMacros] = useState<ApiMacro[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showResolvesOnly, setShowResolvesOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("popular");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/helpdesk/macros");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMacros(data.macros ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("helpdesk");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function createMacro() {
    try {
      const slug = `macro-${Date.now().toString(36)}`;
      const res = await fetch("/api/helpdesk/macros", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          title: "Untitled macro",
          body: "Hi {{customer.name}},\n\nThanks for reaching out. …",
          category: activeCategory ?? "General",
        }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Macro created");
      void load();
    } catch { toast("Couldn't create macro"); }
  }

  function copySlug(slug: string) {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(`/${slug}`).then(
      () => toast(`Trigger /${slug} copied`),
      () => toast("Couldn't copy"),
    );
  }

  // ─── Categories ──────────────────────────────────────────
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of macros ?? []) {
      const k = x.category ?? "Uncategorized";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count, color: categoryColor(name) }));
  }, [macros]);

  // ─── Filter + sort ───────────────────────────────────────
  const filtered = useMemo(() => {
    let list = macros ?? [];
    if (activeCategory) list = list.filter((m) => (m.category ?? "Uncategorized") === activeCategory);
    if (showResolvesOnly) list = list.filter((m) => m.resolves);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((m) =>
        m.title.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        (m.category ?? "").toLowerCase().includes(q));
    }
    const sorted = list.slice();
    if (sortKey === "popular") sorted.sort((a, b) => b.usageCount - a.usageCount);
    else if (sortKey === "name") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sorted;
  }, [macros, activeCategory, showResolvesOnly, search, sortKey]);

  // ─── KPIs ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = macros ?? [];
    const totalUsage = list.reduce((acc, m) => acc + m.usageCount, 0);
    const topMacro = list.slice().sort((a, b) => b.usageCount - a.usageCount)[0];
    const autoResolve = list.filter((m) => m.resolves).length;
    return {
      total: list.length,
      categories: categories.length,
      topMacro,
      autoResolve,
      totalUsage,
    };
  }, [macros, categories.length]);

  return (
    <>
      <OsTitleBar
        title="Macros"
        Icon={Bot}
        iconGradient={GRAD.bluePurple}
        description={macros === null
          ? "Loading macros…"
          : `${stats.total} macro${stats.total === 1 ? "" : "s"} · ${stats.totalUsage} use${stats.totalUsage === 1 ? "" : "s"} total`}
        people={[PEOPLE.pr, PEOPLE.mk, PEOPLE.sc]}
        morePeople={4}
        actions={
          <div className="hdm__head-actions">
            <button type="button" className="hdm__back" onClick={() => history.back()}>
              <ArrowLeft /> Inbox
            </button>
            <Link href="/helpdesk/tickets" className="hdm__nav-link">Tickets</Link>
            <Link href="/helpdesk/customers" className="hdm__nav-link">Customers</Link>
            <button type="button" className="hdm__btn-primary" onClick={createMacro}>
              <Plus /> New macro
            </button>
          </div>
        }
      />

      <div className="hdm">
        {/* KPIs */}
        <div className="hdm__kpis">
          <KpiTile accent="var(--os-c-blue)"   Icon={Layers}      label="Total macros"     value={`${stats.total}`}        sub="in your library" />
          <KpiTile accent="var(--os-c-purple)" Icon={Tag}         label="Categories"       value={`${stats.categories}`}   sub="topic groups" />
          <KpiTile accent="var(--os-c-orange)" Icon={Zap}         label="Total uses"       value={`${stats.totalUsage.toLocaleString()}`} sub={stats.topMacro ? `top: ${stats.topMacro.title.slice(0, 24)}${stats.topMacro.title.length > 24 ? "…" : ""}` : "no usage yet"} />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Auto-resolve"    value={`${stats.autoResolve}`}  sub="close ticket on apply" />
        </div>

        {/* Toolbar */}
        <div className="hdm__toolbar">
          <div className="hdm__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, slug, body, category…"
              aria-label="Search macros"
            />
          </div>
          <label className="hdm__resolves-toggle">
            <input type="checkbox" checked={showResolvesOnly} onChange={(e) => setShowResolvesOnly(e.target.checked)} />
            <span>Auto-resolve only</span>
          </label>
          <div className="hdm__sort">
            <span>Sort</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="hdm__sort-select">
              <option value="popular">Most used</option>
              <option value="recent">Recently updated</option>
              <option value="name">A–Z</option>
            </select>
            <ChevronDown />
          </div>
        </div>

        {categories.length > 0 && (
          <div className="hdm__cats">
            <button
              type="button"
              className={`hdm__cat${activeCategory === null ? " is-active" : ""}`}
              onClick={() => setActiveCategory(null)}
            >
              <Hash /> All <span className="hdm__cat-count">{stats.total}</span>
            </button>
            {categories.map((cat) => (
              <button
                key={cat.name}
                type="button"
                className={`hdm__cat${activeCategory === cat.name ? " is-active" : ""}`}
                style={{ ["--cat-c" as unknown as string]: cat.color }}
                onClick={() => setActiveCategory(cat.name)}
              >
                <span className="hdm__cat-dot" />
                {cat.name}
                <span className="hdm__cat-count">{cat.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={Bot} iconGradient={GRAD.redPink} title="Couldn't load macros" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : macros === null ? (
          <div className="hdm__loading">Loading macros…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Bot}
            iconGradient={GRAD.bluePurple}
            title="No macros yet"
            subtitle="Macros are canned responses + action templates. One click on a ticket can paste a reply, change status, set tags — saves hours on common questions."
            chips={["Welcome", "Password reset", "Refund", "Escalate"]}
            cta="New macro"
          />
        ) : filtered.length === 0 ? (
          <div className="hdm__empty">
            <Search />
            <div>No macros match these filters.</div>
            <button type="button" className="hdm__empty-reset" onClick={() => { setActiveCategory(null); setSearch(""); setShowResolvesOnly(false); }}>Clear filters</button>
          </div>
        ) : (
          <div className="hdm__grid">
            {filtered.map((m) => <MacroCard key={m.id} macro={m} onCopy={() => copySlug(m.slug)} />)}
          </div>
        )}
      </div>
    </>
  );
}

function MacroCard({ macro: m, onCopy }: { macro: ApiMacro; onCopy: () => void }) {
  const catColor = m.category ? categoryColor(m.category) : C.gray;
  return (
    <article className="hdm__card">
      <header className="hdm__card-head">
        <div className="hdm__card-title-row">
          <h3 className="hdm__card-title">{m.title}</h3>
          {m.resolves && (
            <span className="hdm__card-resolves" title="Applying this macro also resolves the ticket">
              <CheckCircle2 /> Auto-resolve
            </span>
          )}
        </div>
        <div className="hdm__card-meta">
          {m.category && (
            <span className="hdm__card-cat" style={{ ["--cat-c" as unknown as string]: catColor }}>
              {m.category}
            </span>
          )}
          <button type="button" className="hdm__card-slug" onClick={onCopy} title="Copy trigger">
            /{m.slug} <Copy />
          </button>
        </div>
      </header>

      <pre className="hdm__card-body">{bodyPreview(m.body)}</pre>

      <footer className="hdm__card-foot">
        <span className="hdm__card-usage">
          <Activity /> {m.usageCount.toLocaleString()} use{m.usageCount === 1 ? "" : "s"}
        </span>
        <span className="hdm__card-time">Updated {fmtRelative(m.updatedAt)}</span>
      </footer>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Layers; label: string; value: string; sub: string }) {
  return (
    <div className="hdm__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="hdm__kpi-accent" aria-hidden="true" />
      <div className="hdm__kpi-row">
        <div className="hdm__kpi-icon"><Icon /></div>
        <div className="hdm__kpi-label">{label}</div>
      </div>
      <div className="hdm__kpi-value">{value}</div>
      <div className="hdm__kpi-sub">{sub}</div>
    </div>
  );
}
