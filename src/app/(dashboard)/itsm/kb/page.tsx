"use client";

/* ITSM · Knowledge base — article grid.
 *
 *  GET   /api/itsm/kb-articles
 *  POST  /api/itsm/kb-articles  { slug, title, body, category? }
 *
 * Layout:
 *   OsTitleBar with nav links + New article in actions.
 *   4-tile KPI strip: Articles · Published · Drafts · Categories.
 *   Featured strip: 3 recently-updated articles in oversized cards.
 *   Search bar + category chip row.
 *   Grouped grid (by category) with bespoke cards: gradient banner, title,
 *     excerpt (clamped), category chip, tags, last-updated.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen, Plus, Search, ArrowLeft, FileText, Sparkles,
  CheckCircle2, Edit3, Hash, ExternalLink, Clock,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiArticle = {
  id: string;
  slug: string;
  title: string;
  body: string;
  excerpt?: string | null;
  category?: string | null;
  tags?: unknown;
  publishedAt?: string | null;
  updatedAt: string;
  createdAt: string;
};

function tagsOf(a: ApiArticle): string[] {
  if (Array.isArray(a.tags)) return a.tags as string[];
  return [];
}

const COVER_GRADIENTS = [
  GRAD.bluePurple, GRAD.greenTeal, GRAD.pinkPurple, GRAD.indigoBlue,
  GRAD.orangePink, GRAD.purpleIndigo, GRAD.tealGreen, GRAD.yellowOrange,
];
function coverGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length];
}
const CAT_COLORS = [C.blue, C.green, C.orange, C.pink, C.teal, C.indigo, C.purple, C.red];
function categoryColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CAT_COLORS[h % CAT_COLORS.length];
}

function fmtRelative(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function excerptFor(a: ApiArticle, max = 160): string {
  if (a.excerpt && a.excerpt.trim()) return a.excerpt;
  // Pull first non-heading lines from the body
  const lines = a.body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const txt = lines.slice(0, 3).join(" ").replace(/[*_`>-]/g, "").trim();
  return txt.length > max ? txt.slice(0, max).trim() + "…" : txt;
}

export default function KbPage() {
  const [articles, setArticles] = useState<ApiArticle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "published" | "draft">("all");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/kb-articles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiArticle[] = data.articles ?? data.data ?? (Array.isArray(data) ? data : []);
      setArticles(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("itsm");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles ?? []) {
      const k = a.category ?? "Uncategorized";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([cat, count]) => ({ name: cat, count, color: categoryColor(cat) }));
  }, [articles]);

  const filtered = useMemo(() => {
    let list = articles ?? [];
    if (activeCategory) list = list.filter((a) => (a.category ?? "Uncategorized") === activeCategory);
    if (filter === "published") list = list.filter((a) => !!a.publishedAt);
    if (filter === "draft") list = list.filter((a) => !a.publishedAt);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        (a.excerpt ?? "").toLowerCase().includes(q) ||
        tagsOf(a).some((t) => t.toLowerCase().includes(q)));
    }
    return list;
  }, [articles, activeCategory, filter, search]);

  // Group filtered articles by category for the grid sections
  const grouped = useMemo(() => {
    const map = new Map<string, ApiArticle[]>();
    for (const a of filtered) {
      const k = a.category ?? "Uncategorized";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    // Sort each group by updatedAt desc
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, list]) => ({ name: cat, color: categoryColor(cat), articles: list }));
  }, [filtered]);

  const featured = useMemo(() => {
    return (articles ?? [])
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 3);
  }, [articles]);

  async function createArticle() {
    const baseTitle = "Untitled article";
    try {
      const res = await fetch("/api/itsm/kb-articles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: `article-${Date.now()}`,
          title: baseTitle,
          body: "# " + baseTitle + "\n\nWrite your article here.",
          category: activeCategory ?? "General",
        }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Article created");
      void load();
    } catch { toast("Couldn't create article"); }
  }

  const total = articles?.length ?? 0;
  const published = (articles ?? []).filter((a) => !!a.publishedAt).length;
  const drafts = total - published;

  return (
    <>
      <OsTitleBar
        title="Knowledge base"
        Icon={BookOpen}
        iconGradient={GRAD.purpleIndigo}
        description={articles === null
          ? "Loading articles…"
          : `${total} article${total === 1 ? "" : "s"} · ${published} published · ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`}
        people={[PEOPLE.ak, PEOPLE.vn, PEOPLE.rj]}
        morePeople={4}
        actions={
          <div className="kbg__head-actions">
            <button type="button" className="kbg__back" onClick={() => history.back()}>
              <ArrowLeft /> Service desk
            </button>
            <Link href="/itsm/tickets" className="kbg__nav-link">Tickets</Link>
            <button type="button" className="kbg__btn-primary" onClick={createArticle}>
              <Plus /> New article
            </button>
          </div>
        }
      />

      <div className="kbg">
        {/* KPI strip */}
        <div className="kbg__kpis">
          <KpiTile accent="var(--os-c-purple)" Icon={FileText}      label="Articles"   value={`${total}`}              sub={total === 0 ? "start your KB" : "across all categories"} />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2}  label="Published"  value={`${published}`}          sub={total > 0 ? `${Math.round((published / total) * 100)}% of articles` : "—"} />
          <KpiTile accent="var(--os-c-orange)" Icon={Edit3}         label="Drafts"     value={`${drafts}`}             sub="in progress" />
          <KpiTile accent="var(--os-c-blue)"   Icon={Hash}          label="Categories" value={`${categories.length}`}  sub="topic areas" />
        </div>

        {/* Featured strip (most recent) */}
        {featured.length > 0 && (
          <section className="kbg__featured">
            <header className="kbg__section-head">
              <Sparkles /> Recently updated
              <span className="kbg__section-sub">last {featured.length} edited</span>
            </header>
            <div className="kbg__featured-grid">
              {featured.map((a) => <FeaturedCard key={a.id} article={a} />)}
            </div>
          </section>
        )}

        {/* Toolbar */}
        <div className="kbg__toolbar">
          <div className="kbg__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search articles, tags, body text…"
              aria-label="Search KB"
            />
          </div>
          <div className="kbg__state-toggle">
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All <span>{total}</span></button>
            <button type="button" className={filter === "published" ? "is-active" : ""} onClick={() => setFilter("published")}>Published <span>{published}</span></button>
            <button type="button" className={filter === "draft" ? "is-active" : ""} onClick={() => setFilter("draft")}>Drafts <span>{drafts}</span></button>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="kbg__cats">
            <button
              type="button"
              className={`kbg__cat${activeCategory === null ? " is-active" : ""}`}
              onClick={() => setActiveCategory(null)}
            >
              <Hash /> All categories <span className="kbg__cat-count">{total}</span>
            </button>
            {categories.map((cat) => (
              <button
                key={cat.name}
                type="button"
                className={`kbg__cat${activeCategory === cat.name ? " is-active" : ""}`}
                style={{ ["--cat-c" as unknown as string]: cat.color }}
                onClick={() => setActiveCategory(cat.name)}
              >
                <span className="kbg__cat-dot" />
                {cat.name}
                <span className="kbg__cat-count">{cat.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={BookOpen} iconGradient={GRAD.redPink} title="Couldn't load articles" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : articles === null ? (
          <div className="kbg__loading">Loading articles…</div>
        ) : total === 0 ? (
          <OsEmptyView
            Icon={BookOpen}
            iconGradient={GRAD.purpleIndigo}
            title="Start your knowledge base"
            subtitle="Document common issues, runbooks, and how-tos. Users self-serve before opening tickets — less load on the queue."
            chips={["How-to", "Runbook", "Policy", "FAQ"]}
            cta="New article"
          />
        ) : filtered.length === 0 ? (
          <div className="kbg__empty">
            <Search />
            <div>No articles match your filters.</div>
            <button type="button" className="kbg__empty-reset" onClick={() => { setActiveCategory(null); setSearch(""); setFilter("all"); }}>Clear filters</button>
          </div>
        ) : activeCategory ? (
          // Single-category view — flat grid
          <div className="kbg__grid">
            {filtered.map((a) => <ArticleCard key={a.id} article={a} />)}
          </div>
        ) : (
          // Grouped by category
          grouped.map((g) => (
            <section key={g.name} className="kbg__group" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="kbg__group-head">
                <span className="kbg__group-dot" />
                <h2 className="kbg__group-title">{g.name}</h2>
                <span className="kbg__group-count">{g.articles.length}</span>
                <span className="kbg__group-line" />
              </header>
              <div className="kbg__grid">
                {g.articles.map((a) => <ArticleCard key={a.id} article={a} />)}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function FeaturedCard({ article: a }: { article: ApiArticle }) {
  const cover = coverGradient(a.title);
  const tags = tagsOf(a);
  return (
    <Link href={`/itsm/kb/${a.id}`} className="kbg__feat" style={{ ["--feat-cover" as unknown as string]: cover }}>
      <div className="kbg__feat-cover" aria-hidden="true">
        <BookOpen />
      </div>
      <div className="kbg__feat-body">
        <div className="kbg__feat-meta">
          {a.category && <span className="kbg__feat-cat" style={{ ["--cat-c" as unknown as string]: categoryColor(a.category) }}>{a.category}</span>}
          {a.publishedAt ? <span className="kbg__feat-state kbg__feat-state--pub">Published</span> : <span className="kbg__feat-state kbg__feat-state--draft">Draft</span>}
        </div>
        <h3 className="kbg__feat-title">{a.title}</h3>
        <p className="kbg__feat-excerpt">{excerptFor(a, 140)}</p>
        <div className="kbg__feat-foot">
          <span className="kbg__feat-time"><Clock /> {fmtRelative(a.updatedAt)}</span>
          {tags.length > 0 && <span className="kbg__feat-tags">#{tags.slice(0, 2).join(" #")}</span>}
          <span className="kbg__feat-arrow">Read <ExternalLink /></span>
        </div>
      </div>
    </Link>
  );
}

function ArticleCard({ article: a }: { article: ApiArticle }) {
  const cover = coverGradient(a.title);
  const tags = tagsOf(a);
  return (
    <Link href={`/itsm/kb/${a.id}`} className="kbg__card">
      <div className="kbg__card-cover" style={{ background: cover }} aria-hidden="true">
        <BookOpen />
      </div>
      <div className="kbg__card-body">
        <div className="kbg__card-meta-top">
          {a.category && <span className="kbg__card-cat" style={{ ["--cat-c" as unknown as string]: categoryColor(a.category) }}>{a.category}</span>}
          {!a.publishedAt && <span className="kbg__card-draft">Draft</span>}
        </div>
        <div className="kbg__card-title">{a.title}</div>
        <p className="kbg__card-excerpt">{excerptFor(a)}</p>
        <div className="kbg__card-foot">
          <span className="kbg__card-time">{fmtRelative(a.updatedAt)}</span>
          {tags.length > 0 && (
            <span className="kbg__card-tags">
              {tags.slice(0, 2).map((t) => <span key={t}>#{t}</span>)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof FileText; label: string; value: string; sub: string }) {
  return (
    <div className="kbg__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="kbg__kpi-accent" aria-hidden="true" />
      <div className="kbg__kpi-row">
        <div className="kbg__kpi-icon"><Icon /></div>
        <div className="kbg__kpi-label">{label}</div>
      </div>
      <div className="kbg__kpi-value">{value}</div>
      <div className="kbg__kpi-sub">{sub}</div>
    </div>
  );
}
