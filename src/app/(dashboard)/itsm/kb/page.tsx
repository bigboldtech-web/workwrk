"use client";

/* ITSM · Knowledge Base — searchable article library.
 *
 * Notion-style three-pane layout:
 *   Left   — search box + category tree (counts per category)
 *   Middle — article list (title, excerpt, last-updated)
 *   Right  — selected article body, rendered as lightweight markdown
 *
 * Reads: GET /api/itsm/kb-articles
 * Write: POST /api/itsm/kb-articles  (quick-create with title prompt)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Search, Tag, Plus, Hash } from "lucide-react";
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
function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function KbPage() {
  const [articles, setArticles] = useState<ApiArticle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/kb-articles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiArticle[] = data.articles ?? data.data ?? (Array.isArray(data) ? data : []);
      setArticles(list);
      setSelectedId((cur) => cur ?? (list[0]?.id ?? null));
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
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [articles]);

  const filtered = useMemo(() => {
    let list = articles ?? [];
    if (activeCategory) {
      list = list.filter((a) => (a.category ?? "Uncategorized") === activeCategory);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        (a.excerpt ?? "").toLowerCase().includes(q) ||
        tagsOf(a).some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [articles, activeCategory, search]);

  const selected = useMemo(() => (articles ?? []).find((a) => a.id === selectedId) ?? null, [articles, selectedId]);

  async function createArticle() {
    const title = window.prompt("Article title?")?.trim();
    if (!title) return;
    try {
      const res = await fetch("/api/itsm/kb-articles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `article-${Date.now()}`,
          title,
          body: "# " + title + "\n\nWrite your article body here.",
          category: activeCategory ?? "General",
        }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't create article"); }
  }

  const totalCount = articles?.length ?? 0;
  const publishedCount = (articles ?? []).filter((a) => a.publishedAt).length;

  return (
    <div className="kb">
      <header className="kb__head">
        <div className="kb__head-l">
          <div className="kb__icon"><BookOpen /></div>
          <div>
            <h1 className="kb__title">Knowledge base</h1>
            <div className="kb__sub">{totalCount} article{totalCount === 1 ? "" : "s"} · {publishedCount} published · {categories.length} categor{categories.length === 1 ? "y" : "ies"}</div>
          </div>
        </div>
        <button type="button" className="kb__new" onClick={createArticle}>
          <Plus /> New article
        </button>
      </header>

      {loadError ? (
        <div className="kb__error">Couldn&apos;t load KB: {loadError}</div>
      ) : (
        <div className="kb__grid">
          <aside className="kb__rail">
            <div className="kb__search">
              <Search />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search articles…" />
            </div>
            <nav className="kb__cats">
              <button type="button" className={!activeCategory ? "is-active" : ""} onClick={() => setActiveCategory(null)}>
                <Hash /> All <span>{totalCount}</span>
              </button>
              {categories.map(([cat, count]) => (
                <button key={cat} type="button" className={activeCategory === cat ? "is-active" : ""} onClick={() => setActiveCategory(cat)}>
                  <Hash /> {cat} <span>{count}</span>
                </button>
              ))}
            </nav>
          </aside>

          <section className="kb__list">
            {filtered.length === 0 ? (
              <div className="kb__list-empty">
                {search ? `No articles match "${search}"` : "No articles in this category"}
              </div>
            ) : filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`kb-item ${selectedId === a.id ? "is-active" : ""}`}
                onClick={() => setSelectedId(a.id)}
              >
                <div className="kb-item__title">
                  {a.title}
                  {!a.publishedAt && <span className="kb-item__draft">draft</span>}
                </div>
                {a.excerpt ? <div className="kb-item__excerpt">{a.excerpt}</div> : null}
                <div className="kb-item__meta">
                  {a.category && <span className="kb-item__cat">{a.category}</span>}
                  <span>· {timeAgo(a.updatedAt)}</span>
                </div>
              </button>
            ))}
          </section>

          <article className="kb__article">
            {selected ? (
              <>
                <header className="kb__article-head">
                  <h1>{selected.title}</h1>
                  <div className="kb__article-meta">
                    {selected.category && <span><Tag /> {selected.category}</span>}
                    <span>Updated {timeAgo(selected.updatedAt)}</span>
                    {selected.publishedAt
                      ? <span className="kb__article-state kb__article-state--pub">Published</span>
                      : <span className="kb__article-state kb__article-state--draft">Draft</span>}
                  </div>
                  {tagsOf(selected).length > 0 && (
                    <div className="kb__article-tags">
                      {tagsOf(selected).map((t) => <span key={t} className="kb__article-tag">#{t}</span>)}
                    </div>
                  )}
                </header>
                <div className="kb__article-body">
                  {selected.body.split("\n").map((line, i) => {
                    if (line.startsWith("# "))      return <h2 key={i}>{line.slice(2)}</h2>;
                    if (line.startsWith("## "))     return <h3 key={i}>{line.slice(3)}</h3>;
                    if (line.startsWith("### "))    return <h4 key={i}>{line.slice(4)}</h4>;
                    if (line.startsWith("- "))      return <li key={i}>{line.slice(2)}</li>;
                    if (line.trim() === "") return <br key={i} />;
                    return <p key={i}>{line}</p>;
                  })}
                </div>
              </>
            ) : (
              <div className="kb__article-empty">
                <BookOpen />
                <h2>Select an article to read</h2>
                <p>Use the list on the left, or hit <kbd>⌘K</kbd> to search.</p>
              </div>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
