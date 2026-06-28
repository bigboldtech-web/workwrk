"use client";

/* Notes — Notion-killer notes index for WorkwrK.
 *
 *  GET  /api/docs               list
 *  POST /api/docs               { title, content }
 *  PUT  /api/docs/[id]          { title?, content? }
 *
 * Sections:
 *   1. Pinned (entityType === null && pinned)  — future hook
 *   2. Recent (touched in last 7 days)
 *   3. Attached to items (entityType !== null)
 *   4. Standalone notes
 *
 * Creating a note opens the Templates dialog — Blank, Meeting Notes,
 * 1:1, Project Brief, Weekly Review, Daily Standup, SOP Draft. Each
 * template injects an opinionated starting set of blocks + an emoji,
 * so the team can go from /new to writing in one click — the way
 * ClickUp Notes feels useful in day-one usage.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileText, Plus, Sparkles, Loader2, Search, Clock, Pin, ChevronRight,
  Type, X, ChevronDown, MoreHorizontal, LayoutGrid, List as ListIcon, ChevronUp, Star,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { NOTE_TEMPLATES, type NoteTemplate } from "@/components/docs/note-templates";
import { NoteActionMenu, useNoteMenu } from "@/components/docs/note-actions-menu";

type ApiDoc = {
  id: string;
  title: string;
  excerpt?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  createdById?: string | null;
  createdBy?: { name: string | null; avatar?: string | null } | null;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
};

const MS_DAY = 86400_000;

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function tintFor(title: string): string {
  const colors = [C.indigo, C.purple, C.blue, C.teal, C.green, C.orange, C.pink];
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

export default function NotesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ApiDoc[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/docs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.docs ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("docs");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // Right-click / "…" context menu shared across all cards.
  const noteMenu = useNoteMenu();
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("workwrk:docs-changed", onChange);
    return () => window.removeEventListener("workwrk:docs-changed", onChange);
  }, [load]);

  // Library-style filter tabs + the viewer's favorite ids.
  type DocTab = "all" | "recents" | "favorites";
  const [tab, setTab] = useState<DocTab>("all");
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const loadFavs = async () => {
      try {
        const res = await fetch("/api/preferences");
        if (!res.ok) return;
        const d = await res.json();
        setFavIds(new Set<string>(d.effective?.home?.favoriteDocIds ?? []));
      } catch { /* ignore */ }
    };
    void loadFavs();
    window.addEventListener("workwrk:favs-changed", loadFavs);
    return () => window.removeEventListener("workwrk:favs-changed", loadFavs);
  }, []);

  // Cards vs Library list view (persisted), with sortable columns.
  const [view, setView] = useState<"cards" | "list">(
    () => (typeof window !== "undefined" && localStorage.getItem("workwrk:docs-view") === "list" ? "list" : "cards"),
  );
  const setViewPersist = (v: "cards" | "list") => {
    setView(v);
    try { localStorage.setItem("workwrk:docs-view", v); } catch { /* ignore */ }
  };
  type SortCol = "title" | "createdBy" | "source" | "updated";
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" }>({ col: "updated", dir: "desc" });
  const toggleSort = (col: SortCol) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "updated" ? "desc" : "asc" }));

  // Expand/collapse state for the list view's nested rows (persisted).
  const LIST_EXPANDED_KEY = "workwrk:docs-list-expanded";
  const [listExpanded, setListExpanded] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set<string>(JSON.parse(localStorage.getItem(LIST_EXPANDED_KEY) || "[]")); } catch { return new Set(); }
  });
  const toggleListExpand = (id: string) =>
    setListExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LIST_EXPANDED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });

  async function createFromTemplate(t: NoteTemplate) {
    setCreating(true);
    setTemplatesOpen(false);
    try {
      const res = await fetch("/api/docs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t.title,
          content: { blocks: t.blocks(), meta: { icon: t.emoji } },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast(`Couldn't create note${err?.error ? ` — ${err.error}` : ""}`);
        return;
      }
      const data = await res.json();
      const d: ApiDoc = data.doc ?? data.data ?? data;
      router.push(`/docs/${d.id}`);
    } catch { toast("Couldn't create note"); }
    finally { setCreating(false); }
  }

  // One-click blank note creation — skips the templates dialog entirely.
  // Used by the title bar's primary "New note" button and the empty-state
  // CTA so the writer is never more than one click from typing.
  async function createBlankNote() {
    setCreating(true);
    try {
      const res = await fetch("/api/docs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New doc", content: { blocks: [] } }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast(`Couldn't create note${err?.error ? ` — ${err.error}` : ""}`);
        return;
      }
      const data = await res.json();
      const d: ApiDoc = data.doc ?? data.data ?? data;
      router.push(`/docs/${d.id}`);
    } catch { toast("Couldn't create note"); }
    finally { setCreating(false); }
  }

  const filtered = useMemo(() => {
    let base = rows ?? [];
    if (tab === "favorites") base = base.filter((d) => favIds.has(d.id));
    else if (tab === "recents") base = base.filter((d) => Date.now() - new Date(d.updatedAt).getTime() < 7 * MS_DAY);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((d) =>
      d.title.toLowerCase().includes(q) ||
      (d.excerpt ?? "").toLowerCase().includes(q),
    );
  }, [rows, search, tab, favIds]);

  const { recent, attached, standalone } = useMemo(() => {
    const cutoff = Date.now() - 7 * MS_DAY;
    const recent: ApiDoc[] = [];
    const attached: ApiDoc[] = [];
    const standalone: ApiDoc[] = [];
    for (const d of filtered) {
      if (new Date(d.updatedAt).getTime() >= cutoff) recent.push(d);
      else if (d.entityType) attached.push(d);
      else standalone.push(d);
    }
    return { recent, attached, standalone };
  }, [filtered]);

  const cmpDocs = useCallback((a: ApiDoc, b: ApiDoc) => {
    const sgn = sort.dir === "asc" ? 1 : -1;
    if (sort.col === "title") return sgn * (a.title || "").localeCompare(b.title || "");
    if (sort.col === "createdBy") return sgn * (a.createdBy?.name ?? "").localeCompare(b.createdBy?.name ?? "");
    if (sort.col === "source") return sgn * String(a.entityType ?? "").localeCompare(String(b.entityType ?? ""));
    return sgn * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  }, [sort]);

  const sortedRows = useMemo(() => [...filtered].sort(cmpDocs), [filtered, cmpDocs]);

  // Parent→children map for the nested list view (built from all rows so
  // nesting survives sorting; an orphan whose parent is missing → root).
  const listByParent = useMemo(() => {
    const m = new Map<string | null, ApiDoc[]>();
    const ids = new Set((rows ?? []).map((r) => r.id));
    for (const d of rows ?? []) {
      const k = d.parentId && ids.has(d.parentId) ? d.parentId : null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(d);
    }
    return m;
  }, [rows]);

  // Recursively render nested list rows (twisty + indent). Returns a flat
  // array of <div> rows so it slots straight into the table body.
  const renderTreeRows = (parentId: string | null, depth: number): React.ReactNode[] => {
    const kids = [...(listByParent.get(parentId) ?? [])].sort(cmpDocs);
    return kids.flatMap((d) => {
      const hasKids = (listByParent.get(d.id) ?? []).length > 0;
      const open = listExpanded.has(d.id);
      const out: React.ReactNode[] = [
        <div
          key={d.id}
          className="docs-tbl__row"
          onClick={() => router.push(`/docs/${d.id}`)}
          onContextMenu={(e) => noteMenu.open(e, { id: d.id, title: d.title })}
        >
          <div className="docs-tbl__name" style={{ paddingLeft: depth * 18 }}>
            <button
              type="button"
              className={`docs-tbl__tw ${hasKids ? "" : "is-empty"}`}
              aria-label={open ? "Collapse" : "Expand"}
              onClick={(e) => { e.stopPropagation(); if (hasKids) toggleListExpand(d.id); }}
            >
              {hasKids ? (open ? <ChevronDown /> : <ChevronRight />) : null}
            </button>
            <FileText />
            <span>{d.title || "Untitled note"}</span>
          </div>
          <CreatedBy doc={d} />
          <div className="docs-tbl__src">{d.entityType ? d.entityType.toLowerCase().replace(/_/g, " ") : "Note"}</div>
          <div className="docs-tbl__date">{relTime(d.updatedAt)}</div>
          <button
            type="button"
            className="docs-tbl__more"
            aria-label="Note actions"
            onClick={(e) => { e.stopPropagation(); noteMenu.open(e, { id: d.id, title: d.title }); }}
          >
            <MoreHorizontal />
          </button>
        </div>,
      ];
      if (open && hasKids) out.push(...renderTreeRows(d.id, depth + 1));
      return out;
    });
  };

  return (
    <>
      <OsTitleBar
        title="Notes"
        Icon={FileText}
        iconGradient={GRAD.tealGreen}
        description={rows === null ? "Loading…" : `${rows.length} note${rows.length === 1 ? "" : "s"} · live-synced · @-mention people, tasks, KRAs, SOPs`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={9}
      />

      <div className="docs__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "is-on" : ""} onClick={() => setTab("all")}>
          All notes
        </button>
        <button type="button" role="tab" aria-selected={tab === "recents"} className={tab === "recents" ? "is-on" : ""} onClick={() => setTab("recents")}>
          <Clock /> Recents
        </button>
        <button type="button" role="tab" aria-selected={tab === "favorites"} className={tab === "favorites" ? "is-on" : ""} onClick={() => setTab("favorites")}>
          <Star /> Favorites
        </button>
      </div>

      <div className="docs__toolbar">
        <div className="docs__search">
          <Search />
          <input
            type="search"
            placeholder="Search notes by title or excerpt…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="docs__viewtoggle" role="group" aria-label="View">
          <button type="button" className={view === "cards" ? "is-on" : ""} onClick={() => setViewPersist("cards")} title="Card view" aria-label="Card view" aria-pressed={view === "cards"}>
            <LayoutGrid />
          </button>
          <button type="button" className={view === "list" ? "is-on" : ""} onClick={() => setViewPersist("list")} title="List view" aria-label="List view" aria-pressed={view === "list"}>
            <ListIcon />
          </button>
        </div>
        <div className="docs__newgroup">
          <button type="button" className="docs__new" onClick={createBlankNote} disabled={creating}>
            {creating ? <><Loader2 className="docs__spin" /> Creating…</> : <><Plus /> New note</>}
          </button>
          <button
            type="button"
            className="docs__new-alt"
            onClick={() => setTemplatesOpen(true)}
            disabled={creating}
            aria-label="Pick a template"
            title="Pick a template"
          >
            <ChevronDown />
          </button>
        </div>
      </div>

      {loadError ? (
        <OsEmptyView Icon={FileText} iconGradient={GRAD.redPink} title="Couldn't load notes" subtitle={`API error: ${loadError}.`} cta="Retry" />
      ) : rows === null ? (
        <div className="docs__loading">Loading notes…</div>
      ) : rows.length === 0 && !templatesOpen ? (
        <div className="docs__empty-wrap">
          <OsEmptyView Icon={FileText} iconGradient={GRAD.tealGreen} title="No notes yet" subtitle="Pick a template, mention teammates with @, embed boards and tasks. Every save creates a version." chips={["Templates", "@ mentions", "AI Write", "Block editor"]} cta="New note" />
          <div className="docs__empty-ctas">
            <button type="button" className="docs__empty-cta" onClick={createBlankNote} disabled={creating}>
              <Plus /> {creating ? "Creating…" : "Blank note"}
            </button>
            <button type="button" className="docs__empty-cta docs__empty-cta--alt" onClick={() => setTemplatesOpen(true)} disabled={creating}>
              Pick a template
            </button>
          </div>
        </div>
      ) : rows.length === 0 ? null : filtered.length === 0 ? (
        <div className="docs__loading">
          {search.trim()
            ? `Nothing matches “${search}”.`
            : tab === "favorites"
              ? "No favorite notes yet — star a note to see it here."
              : tab === "recents"
                ? "No notes edited in the last 7 days."
                : "No notes."}
        </div>
      ) : view === "list" ? (
        <div className="docs-tbl">
          <div className="docs-tbl__head">
            <button type="button" className="docs-tbl__h docs-tbl__h--name" onClick={() => toggleSort("title")}>
              Name {sort.col === "title" && (sort.dir === "asc" ? <ChevronUp /> : <ChevronDown />)}
            </button>
            <button type="button" className="docs-tbl__h docs-tbl__h--by" onClick={() => toggleSort("createdBy")}>
              Created by {sort.col === "createdBy" && (sort.dir === "asc" ? <ChevronUp /> : <ChevronDown />)}
            </button>
            <button type="button" className="docs-tbl__h docs-tbl__h--src" onClick={() => toggleSort("source")}>
              Source {sort.col === "source" && (sort.dir === "asc" ? <ChevronUp /> : <ChevronDown />)}
            </button>
            <button type="button" className="docs-tbl__h" onClick={() => toggleSort("updated")}>
              Last edited {sort.col === "updated" && (sort.dir === "asc" ? <ChevronUp /> : <ChevronDown />)}
            </button>
            <span className="docs-tbl__h docs-tbl__h--act" aria-hidden />
          </div>
          {/* Searching or a tab filter → flat matches; otherwise a nested
              tree mirroring the sidebar (rows with children get a twisty). */}
          {search.trim() || tab !== "all"
            ? sortedRows.map((d) => (
                <div
                  key={d.id}
                  className="docs-tbl__row"
                  onClick={() => router.push(`/docs/${d.id}`)}
                  onContextMenu={(e) => noteMenu.open(e, { id: d.id, title: d.title })}
                >
                  <div className="docs-tbl__name">
                    <span className="docs-tbl__tw is-empty" />
                    <FileText />
                    <span>{d.title || "Untitled note"}</span>
                  </div>
                  <CreatedBy doc={d} />
                  <div className="docs-tbl__src">{d.entityType ? d.entityType.toLowerCase().replace(/_/g, " ") : "Note"}</div>
                  <div className="docs-tbl__date">{relTime(d.updatedAt)}</div>
                  <button
                    type="button"
                    className="docs-tbl__more"
                    aria-label="Note actions"
                    onClick={(e) => { e.stopPropagation(); noteMenu.open(e, { id: d.id, title: d.title }); }}
                  >
                    <MoreHorizontal />
                  </button>
                </div>
              ))
            : renderTreeRows(null, 0)}
        </div>
      ) : (
        <div className="docs">
          {recent.length > 0 && (
            <Section title="Recent" Icon={Clock} count={recent.length} accent={C.orange}>
              {recent.map((d) => <DocCard key={d.id} doc={d} onMenu={(e) => noteMenu.open(e, { id: d.id, title: d.title })} />)}
            </Section>
          )}
          {attached.length > 0 && (
            <Section title="Attached to items" Icon={Pin} count={attached.length} accent={C.purple}>
              {attached.map((d) => <DocCard key={d.id} doc={d} onMenu={(e) => noteMenu.open(e, { id: d.id, title: d.title })} />)}
            </Section>
          )}
          {standalone.length > 0 && (
            <Section title="Standalone notes" Icon={Type} count={standalone.length} accent={C.teal}>
              {standalone.map((d) => <DocCard key={d.id} doc={d} onMenu={(e) => noteMenu.open(e, { id: d.id, title: d.title })} />)}
            </Section>
          )}
        </div>
      )}

      {templatesOpen && (
        <TemplatesDialog
          onPick={createFromTemplate}
          onClose={() => setTemplatesOpen(false)}
        />
      )}

      {noteMenu.menu && (
        <NoteActionMenu
          target={noteMenu.menu.target}
          x={noteMenu.menu.x}
          y={noteMenu.menu.y}
          onClose={noteMenu.close}
          onChanged={() => void load()}
        />
      )}
    </>
  );
}

function Section({ title, Icon, count, accent, children }: { title: string; Icon: typeof FileText; count: number; accent: string; children: React.ReactNode }) {
  return (
    <section className="docs__section">
      <header className="docs__section-head">
        <Icon className="docs__section-icon" style={{ color: accent }} />
        <h2>{title}</h2>
        <span className="docs__section-count">{count}</span>
      </header>
      <div className="docs__grid">{children}</div>
    </section>
  );
}

function CreatedBy({ doc }: { doc: ApiDoc }) {
  const name = doc.createdBy?.name;
  if (!name) return <div className="docs-tbl__by docs-tbl__by--empty">—</div>;
  const initials = name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="docs-tbl__by" title={name}>
      {doc.createdBy?.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="docs-tbl__avatar" src={doc.createdBy.avatar} alt="" />
      ) : (
        <span className="docs-tbl__avatar docs-tbl__avatar--i">{initials}</span>
      )}
      <span className="docs-tbl__by-name">{name}</span>
    </div>
  );
}

function DocCard({ doc, onMenu }: { doc: ApiDoc; onMenu?: (e: React.MouseEvent) => void }) {
  const color = tintFor(doc.title);
  const preview = doc.summary ?? doc.excerpt ?? "";
  const isAi = !!doc.summary;
  return (
    <Link href={`/docs/${doc.id}`} className="doc-card group/doc" onContextMenu={onMenu}>
      <header className="doc-card__head">
        <span className="doc-card__icon" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <FileText />
        </span>
        {doc.entityType && <span className="doc-card__attach">{doc.entityType.toLowerCase().replace(/_/g, " ")}</span>}
        {onMenu && (
          <button
            type="button"
            className="doc-card__more"
            aria-label="Note actions"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(e); }}
          >
            <MoreHorizontal />
          </button>
        )}
      </header>
      <h3 className="doc-card__title">{doc.title || "Untitled note"}</h3>
      {preview && (
        <p className="doc-card__excerpt">
          {isAi && <Sparkles className="doc-card__ai" />}
          {preview.length > 140 ? preview.slice(0, 140) + "…" : preview}
        </p>
      )}
      <footer className="doc-card__foot">
        <span>{relTime(doc.updatedAt)}</span>
        <ChevronRight />
      </footer>
    </Link>
  );
}

// ───────── Templates dialog ─────────
function TemplatesDialog({ onPick, onClose }: { onPick: (t: NoteTemplate) => void; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="notes-tdlg" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="notes-tdlg__panel" onClick={(e) => e.stopPropagation()}>
        <header className="notes-tdlg__head">
          <Sparkles />
          <div>
            <h2>Start a new note</h2>
            <p>Pick a template — or start blank.</p>
          </div>
          <button type="button" className="notes-tdlg__x" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <div className="notes-tdlg__grid">
          {NOTE_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              className="notes-tdlg__card"
              onClick={() => onPick(t)}
            >
              <span className="notes-tdlg__card-emoji">{t.emoji}</span>
              <span className="notes-tdlg__card-title">{t.label}</span>
              <span className="notes-tdlg__card-hint">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
