"use client";

/* Marketing · Content — flexible content library.
 *
 * Type field surfaces as a free-form chip (Blog post / Video / Podcast /
 * White paper / your-internal-format). Channel field is also free-text.
 * Cards group by content type, with status pill + scheduled-for date.
 *
 * GET  /api/marketing/content
 * POST /api/marketing/content  { title, type?, channel? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Plus, Search, Calendar, ExternalLink, Globe } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Type =
  | "BLOG_POST" | "SOCIAL_POST" | "VIDEO" | "PODCAST" | "EMAIL"
  | "WHITE_PAPER" | "CASE_STUDY" | "EBOOK" | "WEBINAR" | "OTHER";
type Status = "IDEA" | "BRIEFED" | "IN_PRODUCTION" | "REVIEW" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";

type ApiContent = {
  id: string; title: string; type: Type; status: Status;
  channel?: string | null;
  briefUrl?: string | null; draftUrl?: string | null; publishedUrl?: string | null;
  scheduledFor?: string | null; publishedAt?: string | null;
};

const STATUS_HUE: Record<Status, string> = {
  IDEA: "var(--os-c-indigo)", BRIEFED: "var(--os-c-blue)",
  IN_PRODUCTION: "var(--os-c-orange)", REVIEW: "var(--os-c-purple)",
  SCHEDULED: "var(--os-c-pink)", PUBLISHED: "var(--os-c-green)", ARCHIVED: "var(--os-c-darkgray)",
};
const STATUS_LABEL: Record<Status, string> = {
  IDEA: "Idea", BRIEFED: "Briefed", IN_PRODUCTION: "In production",
  REVIEW: "In review", SCHEDULED: "Scheduled", PUBLISHED: "Published", ARCHIVED: "Archived",
};
function typeLabel(t: string) { return t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()); }

export default function ContentLibrary() {
  const [items, setItems] = useState<ApiContent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/content");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.content ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("marketing");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const title = window.prompt("Content title?")?.trim();
    if (!title) return;
    try {
      const res = await fetch("/api/marketing/content", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, type: "BLOG_POST", status: "IDEA" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't add content"); }
  }

  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items ?? []) m.set(i.type, (m.get(i.type) ?? 0) + 1);
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (activeType) list = list.filter((i) => i.type === activeType);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        i.title.toLowerCase().includes(q) ||
        (i.channel ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, activeType, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiContent[]>();
    for (const i of filtered) {
      if (!m.has(i.type)) m.set(i.type, []);
      m.get(i.type)!.push(i);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const total = items?.length ?? 0;
  const published = (items ?? []).filter((i) => i.status === "PUBLISHED").length;
  const inFlight = (items ?? []).filter((i) => i.status !== "PUBLISHED" && i.status !== "ARCHIVED" && i.status !== "IDEA").length;

  return (
    <div className="lib">
      <header className="lib__head">
        <div className="lib__head-l">
          <div className="lib__icon" style={{ background: "linear-gradient(135deg, var(--os-c-pink), var(--os-c-purple))" }}><FileText /></div>
          <div>
            <h1 className="lib__title">Content library</h1>
            <div className="lib__sub">
              {items === null ? "Loading…" : `${total} piece${total === 1 ? "" : "s"} · ${inFlight} in flight · ${published} published`}
            </div>
          </div>
        </div>
        <div className="lib__actions">
          <div className="lib__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, channel…" />
          </div>
          <button type="button" className="lib__new" onClick={quickAdd}><Plus /> New piece</button>
        </div>
      </header>

      {types.length > 0 && (
        <nav className="lib__types">
          <button type="button" className={!activeType ? "is-active" : ""} onClick={() => setActiveType(null)}>All <em>{total}</em></button>
          {types.map(([t, n]) => (
            <button key={t} type="button" className={activeType === t ? "is-active" : ""} onClick={() => setActiveType(t)}>
              {typeLabel(t)} <em>{n}</em>
            </button>
          ))}
        </nav>
      )}

      {loadError ? (
        <div className="lib__error">{loadError}</div>
      ) : items === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="lib__empty">
          <FileText />
          <div>
            <h3>{search ? "Nothing matches that search." : "No content yet"}</h3>
            <p>Drop ideas here — blog posts, videos, webinars, anything. Group them however your team thinks.</p>
          </div>
        </div>
      ) : (
        <div className="lib__sections">
          {grouped.map(([type, items]) => (
            <section key={type} className="lib__section">
              <header><h2>{typeLabel(type)}</h2><span>{items.length}</span></header>
              <div className="lib__grid">
                {items.map((c) => (
                  <article key={c.id} className="lib-card">
                    <header className="lib-card__head">
                      <h3>{c.title}</h3>
                      <span className="lib-card__status" style={{ background: STATUS_HUE[c.status] }}>{STATUS_LABEL[c.status]}</span>
                    </header>
                    {c.channel && <div className="lib-card__sub"><Globe /> {c.channel}</div>}
                    <div className="lib-card__meta">
                      {c.scheduledFor && <span><Calendar /> Scheduled {new Date(c.scheduledFor).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                      {c.publishedAt && <span style={{ color: "var(--os-c-green)" }}>✓ Published {new Date(c.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                    </div>
                    <footer className="lib-card__foot">
                      {c.briefUrl && <a href={c.briefUrl} target="_blank" rel="noopener" className="lib-card__link"><ExternalLink /> Brief</a>}
                      {c.draftUrl && <a href={c.draftUrl} target="_blank" rel="noopener" className="lib-card__link"><ExternalLink /> Draft</a>}
                      {c.publishedUrl && <a href={c.publishedUrl} target="_blank" rel="noopener" className="lib-card__link"><ExternalLink /> Live</a>}
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
