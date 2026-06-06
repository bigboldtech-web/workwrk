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
  Type, X,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { NOTE_TEMPLATES, type NoteTemplate } from "@/components/docs/note-templates";

type ApiDoc = {
  id: string;
  title: string;
  excerpt?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  createdById?: string | null;
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
      if (!res.ok) throw new Error();
      const data = await res.json();
      const d: ApiDoc = data.doc ?? data.data ?? data;
      router.push(`/docs/${d.id}`);
    } catch { toast("Couldn't create note"); }
    finally { setCreating(false); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((d) =>
      d.title.toLowerCase().includes(q) ||
      (d.excerpt ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

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
        <button type="button" className="docs__new" onClick={() => setTemplatesOpen(true)} disabled={creating}>
          {creating ? <><Loader2 className="docs__spin" /> Creating…</> : <><Plus /> New note</>}
        </button>
      </div>

      {loadError ? (
        <OsEmptyView Icon={FileText} iconGradient={GRAD.redPink} title="Couldn't load notes" subtitle={`API error: ${loadError}.`} cta="Retry" />
      ) : rows === null ? (
        <div className="docs__loading">Loading notes…</div>
      ) : rows.length === 0 ? (
        <div className="docs__empty-wrap">
          <OsEmptyView Icon={FileText} iconGradient={GRAD.tealGreen} title="No notes yet" subtitle="Pick a template, mention teammates with @, embed boards and tasks. Every save creates a version." chips={["Templates", "@ mentions", "AI Write", "Block editor"]} cta="New note" />
          <button type="button" className="docs__empty-cta" onClick={() => setTemplatesOpen(true)}>
            <Plus /> Pick a template
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="docs__loading">Nothing matches &ldquo;{search}&rdquo;.</div>
      ) : (
        <div className="docs">
          {recent.length > 0 && (
            <Section title="Recent" Icon={Clock} count={recent.length} accent={C.orange}>
              {recent.map((d) => <DocCard key={d.id} doc={d} />)}
            </Section>
          )}
          {attached.length > 0 && (
            <Section title="Attached to items" Icon={Pin} count={attached.length} accent={C.purple}>
              {attached.map((d) => <DocCard key={d.id} doc={d} />)}
            </Section>
          )}
          {standalone.length > 0 && (
            <Section title="Standalone notes" Icon={Type} count={standalone.length} accent={C.teal}>
              {standalone.map((d) => <DocCard key={d.id} doc={d} />)}
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

function DocCard({ doc }: { doc: ApiDoc }) {
  const color = tintFor(doc.title);
  const preview = doc.summary ?? doc.excerpt ?? "";
  const isAi = !!doc.summary;
  return (
    <Link href={`/docs/${doc.id}`} className="doc-card">
      <header className="doc-card__head">
        <span className="doc-card__icon" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <FileText />
        </span>
        {doc.entityType && <span className="doc-card__attach">{doc.entityType.toLowerCase().replace(/_/g, " ")}</span>}
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
