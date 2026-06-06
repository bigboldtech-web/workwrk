"use client";

/* BlockDocEditor — chrome around the BlockEditor for a /docs/[id] page.
 *
 * Adds Notion-grade page polish on top of the block editor:
 *   - Cover gradient or image at the top of the page
 *   - Emoji icon above the title (curated picker, no external deps)
 *   - Inline title input with debounced autosave
 *   - Legacy `{ html }` doc detection + lossless "convert to blocks"
 *   - Sticky chrome (back, copy link, summarise, extract table)
 *
 * Doc content shape (additive — older docs without `meta` still work):
 *   { blocks: Block[]; meta?: { icon?: string; coverGradient?: string; coverUrl?: string } }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Link as LinkIcon, Sparkles, Loader2, Table as TableIcon,
  ImagePlus, Smile, Trash2, MessageSquare, ListTree, X, Send, Star,
  ArrowDownLeft, FileText, BookCopy, BookOpen, History, RotateCcw,
  MoreHorizontal, Download,
} from "lucide-react";
import { BlockEditor, type Block, type Comment, type CommentsByBlock } from "./block-editor";
import { useOsToast } from "@/components/layout/os/toast";

type DocMeta = { icon?: string; coverGradient?: string; coverUrl?: string };

type DocPayload = {
  id: string;
  title: string;
  content: { blocks?: Block[]; html?: string; meta?: DocMeta; comments?: CommentsByBlock } | null;
  summary?: string | null;
  summarizedAt?: string | null;
  updatedAt: string;
  createdAt: string;
};

type MeUser = { id: string; firstName?: string | null; lastName?: string | null; email?: string; avatar?: string | null };

function newId() { return Math.random().toString(36).slice(2, 10); }

// Convert legacy HTML into a one-shot paragraph-per-line block array.
function htmlToBlocks(html: string): Block[] {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [{ id: newId(), kind: "paragraph", text: "" }];
  return lines.map((t) => ({ id: newId(), kind: "paragraph" as const, text: t }));
}

// Curated emoji palette — covers the 90% of cases a workspace note needs.
const EMOJI_SET = [
  "📝", "📌", "✅", "📊", "📈", "📉", "💡", "🎯", "🚀", "🔥",
  "⭐", "🛠️", "🧩", "📚", "📁", "📎", "🗓️", "🗒️", "🧭", "🔍",
  "💬", "🔔", "⚙️", "🧠", "🤝", "💼", "🏆", "✏️", "📢", "🛡️",
  "🌱", "🌟", "🪄", "📦", "🏷️", "📍", "🧷", "🎉", "💸", "🧾",
];

// Curated gradient palette — matches the rest of the OS shell tone-set.
const COVER_GRADIENTS: { key: string; label: string; css: string }[] = [
  { key: "indigo",  label: "Indigo",  css: "linear-gradient(135deg, #6366f1, #8b5cf6)" },
  { key: "blue",    label: "Blue",    css: "linear-gradient(135deg, #2563eb, #06b6d4)" },
  { key: "teal",    label: "Teal",    css: "linear-gradient(135deg, #14b8a6, #22c55e)" },
  { key: "amber",   label: "Amber",   css: "linear-gradient(135deg, #f59e0b, #ef4444)" },
  { key: "pink",    label: "Pink",    css: "linear-gradient(135deg, #ec4899, #f43f5e)" },
  { key: "slate",   label: "Slate",   css: "linear-gradient(135deg, #475569, #1e293b)" },
];

function gradientCSS(key?: string): string {
  return COVER_GRADIENTS.find((g) => g.key === key)?.css ?? COVER_GRADIENTS[0].css;
}

interface Props { docId: string }

export function BlockDocEditor({ docId }: Props) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [doc, setDoc] = useState<DocPayload | null>(null);
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [meta, setMeta] = useState<DocMeta>({});
  const [legacy, setLegacy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  // Single side-panel slot — only one of Ask/History/Comments can be
  // open at a time so they never overlap or fight for focus. The
  // Comments variant carries the block id it belongs to.
  const [panel, setPanel] = useState<null | { kind: "ask" } | { kind: "history" } | { kind: "comments"; blockId: string }>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [favorited, setFavorited] = useState<boolean | null>(null);
  const [readingMode, setReadingMode] = useState(false);
  const [comments, setComments] = useState<CommentsByBlock>({});
  const [me, setMe] = useState<MeUser | null>(null);

  // Load current user for the comment author identity.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled) setMe(d.user ?? null);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Dismiss the More menu when clicking elsewhere or hitting Esc.
  useEffect(() => {
    if (!moreOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Element | null;
      if (!t || !t.closest(".bdoc__more")) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setMoreOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Load whether this doc is in the user's favorites.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/preferences");
        if (!res.ok) return;
        const d = await res.json();
        const ids: string[] = d.effective?.home?.favoriteDocIds ?? [];
        if (!cancelled) setFavorited(ids.includes(docId));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  async function toggleFavorite() {
    const optimistic = !(favorited ?? false);
    setFavorited(optimistic);
    try {
      // Phase 82 — use the focused /api/me/favorites/docs endpoint so
      // we benefit from its atomic set semantics + the sidebar refresh
      // event. The old GET+PATCH dance via /api/preferences had a race
      // when multiple toggles fired simultaneously.
      const res = await fetch("/api/me/favorites/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId, on: optimistic }),
      });
      if (!res.ok) {
        setFavorited(!optimistic);
        toast("Couldn't update favorite");
        return;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      }
      toast(optimistic ? "Starred" : "Removed from favorites");
    } catch {
      setFavorited(!optimistic);
      toast("Couldn't update favorite");
    }
  }
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The doc's updatedAt as last observed by this tab. Each PUT echoes
  // the new value; the next PUT carries it back so the server can
  // reject (409) when another writer has moved on without us.
  const lastUpdatedAtRef = useRef<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const refetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/docs/${docId}/comments`);
      if (!res.ok) return;
      const d = await res.json();
      setComments((d.commentsByBlock ?? {}) as CommentsByBlock);
    } catch { /* ignore */ }
  }, [docId]);

  // Load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/docs/${docId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const d: DocPayload = data.doc ?? data;
        setDoc(d);
        setTitle(d.title ?? "");
        lastUpdatedAtRef.current = d.updatedAt ?? null;
        const c = d.content;
        setMeta((c?.meta as DocMeta) ?? {});
        if (c && Array.isArray((c as { blocks?: Block[] }).blocks)) {
          setBlocks((c as { blocks: Block[] }).blocks);
          setLegacy(null);
        } else if (c && typeof (c as { html?: string }).html === "string") {
          setLegacy((c as { html: string }).html);
          setBlocks(null);
        } else {
          setBlocks([]);
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "load failed");
      }
    })();
    void refetchComments();
    return () => { cancelled = true; };
  }, [docId, refetchComments]);

  const persist = useCallback(async (nextBlocks: Block[], nextMeta: DocMeta) => {
    try {
      const text = nextBlocks
        .map((b) => "text" in b ? (b as { text: string }).text : "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 400);
      const res = await fetch(`/api/docs/${docId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          // Conflict-detection precondition — server returns 409 when the
          // doc's current updatedAt differs from what we last observed.
          ...(lastUpdatedAtRef.current ? { "If-Unmodified-Since": lastUpdatedAtRef.current } : {}),
        },
        body: JSON.stringify({
          title: title.trim() || "Untitled note",
          content: { blocks: nextBlocks, meta: nextMeta },
          excerpt: text || null,
          knownUpdatedAt: lastUpdatedAtRef.current,
        }),
      });
      if (res.status === 409) {
        setConflict(true);
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json().catch(() => null);
      // Track the new server-side updatedAt so the next PUT can prove
      // the local view is still in sync.
      if (data?.doc?.updatedAt) lastUpdatedAtRef.current = data.doc.updatedAt;
    } catch { toast("Couldn't save"); }
  }, [docId, title, toast]);

  const saveBlocks = useCallback(async (next: Block[]) => {
    setBlocks(next);
    await persist(next, meta);
  }, [persist, meta]);

  const saveMeta = useCallback(async (patch: Partial<DocMeta>) => {
    const next = { ...meta, ...patch };
    setMeta(next);
    if (blocks) await persist(blocks, next);
  }, [persist, meta, blocks]);

  function saveTitle(next: string) {
    setTitle(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/docs/${docId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: next.trim() || "Untitled note" }),
        });
      } catch { /* ignore */ }
    }, 700);
  }

  function convertLegacy() {
    if (!legacy) return;
    const converted = htmlToBlocks(legacy);
    setBlocks(converted);
    setLegacy(null);
    void saveBlocks(converted);
    toast("Converted to blocks — old content preserved as paragraphs");
  }

  function copyLink() {
    const url = `${window.location.origin}/docs/${docId}`;
    navigator.clipboard.writeText(url).then(() => toast("Link copied"));
  }

  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => { if (doc) setSummary(doc.summary ?? null); }, [doc]);

  async function summarize() {
    setSummarizing(true);
    try {
      const res = await fetch(`/api/docs/${docId}/summarize`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toast(`Couldn't summarize: ${err.error ?? "unknown"}`);
        return;
      }
      const d = await res.json();
      setSummary(d.data?.summary ?? d.summary);
      toast("Summary ready");
    } catch { toast("Summarize failed"); }
    finally { setSummarizing(false); }
  }

  const [extracting, setExtracting] = useState(false);
  async function extractTable() {
    if (!confirm("Use AI to extract a table from this doc? A new table will be created in your org.")) return;
    setExtracting(true);
    try {
      const res = await fetch(`/api/docs/${docId}/extract-table`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toast(`Couldn't extract: ${err.error ?? "unknown"}`);
        return;
      }
      const d = await res.json();
      const r = d.data ?? d;
      toast(`Created table "${r.name}" with ${r.rowsCreated} row${r.rowsCreated === 1 ? "" : "s"}`);
      router.push(`/tables/${r.tableId}`);
    } catch { toast("Extract failed"); }
    finally { setExtracting(false); }
  }

  if (loadError) {
    return (
      <div className="bdoc__error">
        <p>Couldn&apos;t load doc: {loadError}</p>
        <button type="button" onClick={() => router.back()}>Back</button>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="bdoc__loading">
        <Loader2 className="bdoc__spin" /> Loading…
      </div>
    );
  }

  const hasCover = !!(meta.coverUrl || meta.coverGradient);
  const coverStyle: React.CSSProperties = meta.coverUrl
    ? { backgroundImage: `url(${meta.coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: gradientCSS(meta.coverGradient) };

  return (
    <div className={`bdoc ${readingMode ? "bdoc--reading" : ""}`}>
      <header className="bdoc__head">
        <button type="button" className="bdoc__back" onClick={() => router.back()} aria-label="Back">
          <ArrowLeft />
        </button>

        {/* Tight, icon-only action bar. Primary controls inline; the rest
            tuck under a More menu so the header never looks crowded. */}
        <div className="bdoc__head-actions">
          <button
            type="button"
            className={`bdoc__iact ${favorited ? "is-on" : ""}`}
            onClick={toggleFavorite}
            title={favorited ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={!!favorited}
            aria-label="Favorite"
          >
            <Star />
          </button>
          <button
            type="button"
            className={`bdoc__iact ${readingMode ? "is-on" : ""}`}
            onClick={() => setReadingMode((r) => !r)}
            title={readingMode ? "Switch back to editing" : "Reading mode"}
            aria-pressed={readingMode}
            aria-label="Reading mode"
          >
            <BookOpen />
          </button>
          <button
            type="button"
            className={`bdoc__iact ${outlineOpen ? "is-on" : ""}`}
            onClick={() => setOutlineOpen((s) => !s)}
            title={outlineOpen ? "Hide outline" : "Show outline"}
            aria-pressed={outlineOpen}
            aria-label="Outline"
          >
            <ListTree />
          </button>
          <span className="bdoc__iact-sep" aria-hidden />
          <button
            type="button"
            className={`bdoc__iact ${panel?.kind === "ask" ? "is-on" : ""}`}
            onClick={() => setPanel(panel?.kind === "ask" ? null : { kind: "ask" })}
            title="Chat with this note"
            aria-label="Ask"
          >
            <MessageSquare />
          </button>
          <button
            type="button"
            className={`bdoc__iact ${panel?.kind === "history" ? "is-on" : ""}`}
            onClick={() => setPanel(panel?.kind === "history" ? null : { kind: "history" })}
            title="Version history"
            aria-label="History"
          >
            <History />
          </button>
          <button
            type="button"
            className="bdoc__iact"
            onClick={copyLink}
            title="Copy link"
            aria-label="Copy link"
          >
            <LinkIcon />
          </button>

          {/* More menu: secondary AI + power-user actions go here so the
              header stays calm at first glance. */}
          <div className="bdoc__more">
            <button
              type="button"
              className={`bdoc__iact ${moreOpen ? "is-on" : ""}`}
              onClick={() => setMoreOpen((m) => !m)}
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label="More"
            >
              <MoreHorizontal />
            </button>
            {moreOpen && (
              <div className="bdoc__more-menu" role="menu" onMouseDown={(e) => e.preventDefault()}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMoreOpen(false); void summarize(); }}
                  disabled={summarizing}
                >
                  {summarizing ? <Loader2 className="bdoc__spin" /> : <Sparkles />}
                  <span>{summary ? "Re-summarize" : "Summarize with AI"}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMoreOpen(false); void extractTable(); }}
                  disabled={extracting}
                >
                  {extracting ? <Loader2 className="bdoc__spin" /> : <TableIcon />}
                  <span>Extract table</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    window.location.href = `/api/docs/${docId}/export?format=md`;
                  }}
                >
                  <Download />
                  <span>Export as markdown</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Cover */}
      {hasCover && (
        <div className="bdoc__cover" style={coverStyle}>
          <button
            type="button"
            className="bdoc__cover-edit"
            onClick={() => setCoverOpen((s) => !s)}
          >
            <ImagePlus /> Change cover
          </button>
          {coverOpen && (
            <CoverPicker
              meta={meta}
              onPick={(patch) => { void saveMeta(patch); setCoverOpen(false); }}
              onClear={() => { void saveMeta({ coverUrl: undefined, coverGradient: undefined }); setCoverOpen(false); }}
            />
          )}
        </div>
      )}

      {conflict && (
        <div className="bdoc__conflict" role="alert">
          <span>
            <strong>Edit conflict.</strong> Someone else updated this note while you were editing.
            Reload to see the latest version before saving again.
          </span>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
          <button type="button" className="bdoc__conflict-dismiss" onClick={() => setConflict(false)}>Dismiss</button>
        </div>
      )}
      <div className={`bdoc__page ${hasCover ? "has-cover" : ""}`}>
        {/* Emoji + add-cover-row */}
        <div className="bdoc__chrome">
          {meta.icon ? (
            <button
              type="button"
              className="bdoc__emoji"
              onClick={() => setEmojiOpen((s) => !s)}
              aria-label="Change emoji"
            >
              <span>{meta.icon}</span>
            </button>
          ) : (
            <button type="button" className="bdoc__add-emoji" onClick={() => setEmojiOpen((s) => !s)}>
              <Smile /> Add icon
            </button>
          )}

          {!hasCover && (
            <button type="button" className="bdoc__add-cover" onClick={() => setCoverOpen((s) => !s)}>
              <ImagePlus /> Add cover
            </button>
          )}
        </div>

        {emojiOpen && (
          <EmojiPicker
            current={meta.icon}
            onPick={(emoji) => { void saveMeta({ icon: emoji }); setEmojiOpen(false); }}
            onClear={() => { void saveMeta({ icon: undefined }); setEmojiOpen(false); }}
          />
        )}

        {!hasCover && coverOpen && (
          <CoverPicker
            meta={meta}
            onPick={(patch) => { void saveMeta(patch); setCoverOpen(false); }}
            onClear={() => { void saveMeta({ coverUrl: undefined, coverGradient: undefined }); setCoverOpen(false); }}
          />
        )}

        <input
          type="text"
          className="bdoc__title"
          value={title}
          onChange={(e) => saveTitle(e.target.value)}
          placeholder="Untitled note"
        />

        {blocks && <DocMetaStrip blocks={blocks} doc={doc} />}

        {summary && (
          <details className="bdoc__summary" open>
            <summary><Sparkles /> AI summary</summary>
            <p>{summary}</p>
          </details>
        )}

        {legacy !== null ? (
          <div className="bdoc__legacy">
            <div className="bdoc__legacy-banner">
              <Sparkles />
              <span>This note is in the old rich-text format.</span>
              <button type="button" onClick={convertLegacy}>Convert to blocks</button>
            </div>
            <div className="bdoc__legacy-body" dangerouslySetInnerHTML={{ __html: legacy }} />
          </div>
        ) : blocks === null ? (
          <div className="bdoc__loading"><Loader2 className="bdoc__spin" /> Loading content…</div>
        ) : (
          // Key by docId so a fresh BlockEditor mounts per document —
          // avoids stale useState lock-in across navigations. Reading
          // mode flips readonly so the toolbar/handles disappear.
          <BlockEditor
            key={`${docId}:${readingMode ? "r" : "e"}`}
            initialBlocks={blocks}
            onSave={saveBlocks}
            readonly={readingMode}
            comments={comments}
            onOpenComments={(blockId) => setPanel({ kind: "comments", blockId })}
          />
        )}

        <BacklinksPanel kind="doc" id={docId} />
      </div>

      {/* Outline rail only when no slide-over panel is open and not in
          reading mode — keeps the right edge calm. */}
      {outlineOpen && blocks && blocks.length > 0 && !readingMode && panel === null && (
        <OutlineRail blocks={blocks} onClose={() => setOutlineOpen(false)} />
      )}
      {panel?.kind === "ask" && (
        <AskDocPanel docId={docId} docTitle={title} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === "history" && (
        <VersionHistoryPanel
          docId={docId}
          onClose={() => setPanel(null)}
          onRestore={(restoredBlocks, restoredMeta, restoredTitle) => {
            setBlocks(restoredBlocks);
            setMeta(restoredMeta);
            setTitle(restoredTitle);
            void persist(restoredBlocks, restoredMeta);
            setPanel(null);
          }}
        />
      )}
      {panel?.kind === "comments" && (
        <CommentsPanel
          docId={docId}
          blockId={panel.blockId}
          initialThread={comments[panel.blockId] ?? []}
          me={me}
          onClose={() => setPanel(null)}
          onThreadChanged={() => { void refetchComments(); }}
        />
      )}
    </div>
  );
}

// ───────── Doc meta strip (word count · read time · last edited) ─────────
function DocMetaStrip({ blocks, doc }: { blocks: Block[]; doc: DocPayload }) {
  const stats = useMemo(() => {
    let words = 0;
    for (const b of blocks) {
      if (!("text" in b)) continue;
      const text = (b as { text: string }).text;
      // Strip HTML tags from text for an accurate word count.
      const plain = text.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
      words += plain.split(/\s+/).filter(Boolean).length;
    }
    const minutes = Math.max(1, Math.round(words / 220));
    return { words, minutes };
  }, [blocks]);

  const updated = useMemo(() => {
    const d = new Date(doc.updatedAt);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }, [doc.updatedAt]);

  return (
    <div className="bdoc__meta">
      <span>{stats.words.toLocaleString()} word{stats.words === 1 ? "" : "s"}</span>
      <span className="bdoc__meta-sep" aria-hidden>·</span>
      <span>{stats.minutes} min read</span>
      <span className="bdoc__meta-sep" aria-hidden>·</span>
      <span>Edited {updated}</span>
    </div>
  );
}

// ───────── Outline (TOC) right rail ─────────
function OutlineRail({ blocks, onClose }: { blocks: Block[]; onClose: () => void }) {
  const headings = useMemo(() => {
    return blocks
      .map((b, idx) => {
        if (b.kind === "h1" || b.kind === "h2" || b.kind === "h3") {
          return { id: b.id, kind: b.kind, text: (b as { text: string }).text || "Untitled section", idx };
        }
        return null;
      })
      .filter((x): x is { id: string; kind: "h1" | "h2" | "h3"; text: string; idx: number } => !!x);
  }, [blocks]);

  if (headings.length === 0) {
    return (
      <aside className="bdoc__outline">
        <header className="bdoc__outline-head">
          <ListTree /> <span>Outline</span>
          <button type="button" className="bdoc__outline-x" onClick={onClose} aria-label="Hide outline"><X /></button>
        </header>
        <div className="bdoc__outline-empty">Add headings (#, ##, ###) to build an outline.</div>
      </aside>
    );
  }

  return (
    <aside className="bdoc__outline">
      <header className="bdoc__outline-head">
        <ListTree /> <span>Outline</span>
        <button type="button" className="bdoc__outline-x" onClick={onClose} aria-label="Hide outline"><X /></button>
      </header>
      <ol className="bdoc__outline-list">
        {headings.map((h) => (
          <li key={h.id} className={`bdoc__outline-item bdoc__outline-item--${h.kind}`}>
            <a
              href={`#b-${h.id}`}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(`b-${h.id}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </aside>
  );
}

// ───────── Ask-this-note slide-over ─────────
type ChatTurn = { role: "user" | "assistant"; content: string };

function AskDocPanel({ docId, docTitle, onClose }: { docId: string; docTitle: string; onClose: () => void }) {
  const { toast } = useOsToast();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, running]);

  async function ask() {
    const q = input.trim();
    if (!q || running) return;
    const userTurn: ChatTurn = { role: "user", content: q };
    setTurns((t) => [...t, userTurn]);
    setInput("");
    setRunning(true);
    try {
      const res = await fetch(`/api/docs/${docId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history: turns,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toast(`Ask failed: ${err.error ?? "unknown"}`);
        return;
      }
      const d = await res.json();
      const answer = (d.data?.answer ?? d.answer ?? "").trim();
      setTurns((t) => [...t, { role: "assistant", content: answer || "(no answer)" }]);
    } catch {
      toast("Ask failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <aside className="bdoc__ask" role="dialog" aria-modal="false" aria-label="Ask this note">
      <header className="bdoc__ask-head">
        <Sparkles />
        <div>
          <h2>Ask this note</h2>
          <p>Chat about &ldquo;{docTitle || "Untitled note"}&rdquo;</p>
        </div>
        <button type="button" className="bdoc__ask-x" onClick={onClose} aria-label="Close"><X /></button>
      </header>
      <div className="bdoc__ask-scroll" ref={scrollRef}>
        {turns.length === 0 && (
          <div className="bdoc__ask-empty">
            <Sparkles />
            <p>Ask anything about this note. I&apos;ll answer using its content.</p>
            <ul>
              <li>What are the action items?</li>
              <li>Who owns each decision?</li>
              <li>Summarise the meeting outcome.</li>
            </ul>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bdoc__ask-turn bdoc__ask-turn--${t.role}`}>
            {t.content.split(/\n\n+/).map((p, j) => <p key={j}>{p}</p>)}
          </div>
        ))}
        {running && (
          <div className="bdoc__ask-turn bdoc__ask-turn--assistant bdoc__ask-loading">
            <Loader2 className="bdoc__spin" /> Reading the note…
          </div>
        )}
      </div>
      <form
        className="bdoc__ask-form"
        onSubmit={(e) => { e.preventDefault(); void ask(); }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything…"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <button type="submit" disabled={running || !input.trim()}>
          {running ? <Loader2 className="bdoc__spin" /> : <Send />}
        </button>
      </form>
    </aside>
  );
}

// ───────── Emoji picker (curated set) ─────────
function EmojiPicker({ current, onPick, onClear }: { current?: string; onPick: (e: string) => void; onClear: () => void }) {
  return (
    <div className="bdoc__emoji-pop" onClick={(e) => e.stopPropagation()}>
      <header className="bdoc__emoji-head">
        <Smile /> <span>Pick an icon</span>
        {current && (
          <button type="button" className="bdoc__emoji-clear" onClick={onClear}>
            <Trash2 /> Remove
          </button>
        )}
      </header>
      <div className="bdoc__emoji-grid">
        {EMOJI_SET.map((e) => (
          <button
            key={e}
            type="button"
            className={`bdoc__emoji-cell ${current === e ? "is-current" : ""}`}
            onClick={() => onPick(e)}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────── Block comments thread slide-over (real endpoints) ─────────
//
// Backed by ItemUpdate (entityType="DOC_BLOCK", entityId="<docId>:<blockId>").
// Every action is a real API call against /api/item-updates and
// /api/item-updates/[id] — no more last-write-wins on in-content JSON.
// `initialThread` seeds the UI from the per-doc aggregator so the panel
// opens instantly; we then refetch the live thread to be safe.
function CommentsPanel({ docId, blockId, initialThread, me, onClose, onThreadChanged }: {
  docId: string;
  blockId: string;
  initialThread: Comment[];
  me: MeUser | null;
  onClose: () => void;
  onThreadChanged: () => void;
}) {
  const [thread, setThread] = useState<Comment[]>(initialThread);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const entityId = `${docId}:${blockId}`;

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Scroll the target block into view so the user can see what they're
  // commenting on alongside the panel.
  useEffect(() => {
    const el = document.getElementById(`b-${blockId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [blockId]);

  // Pull the live thread for this block.
  const refresh = useCallback(async () => {
    try {
      const url = new URL("/api/item-updates", window.location.origin);
      url.searchParams.set("entityType", "DOC_BLOCK");
      url.searchParams.set("entityId", entityId);
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const d = await res.json();
      const rows = (d.updates ?? []) as Array<{
        id: string; body: string; authorId: string | null; authorName: string | null;
        authorImage: string | null; createdAt: string;
      }>;
      // API returns desc; UI flows oldest → newest.
      setThread(rows.slice().reverse().map((u) => ({
        id: u.id,
        authorId: u.authorId ?? "",
        authorName: u.authorName ?? "Unknown",
        authorAvatar: u.authorImage,
        text: u.body,
        createdAt: u.createdAt,
        resolved: false,
      })));
    } catch { /* ignore */ }
  }, [entityId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const meName = me ? (`${me.firstName ?? ""} ${me.lastName ?? ""}`.trim() || me.email || "You") : "You";

  async function postComment() {
    if (!me) return;
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await fetch("/api/item-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "DOC_BLOCK", entityId, body: text }),
      });
      if (res.ok) {
        setDraft("");
        await refresh();
        onThreadChanged();
      }
    } finally { setBusy(false); }
  }

  async function deleteComment(id: string) {
    if (!confirm("Delete this comment?")) return;
    const res = await fetch(`/api/item-updates/${id}`, { method: "DELETE" });
    if (res.ok) {
      await refresh();
      onThreadChanged();
    }
  }

  return (
    <aside className="bdoc__cmts" role="dialog" aria-modal="false" aria-label="Block comments">
      <header className="bdoc__cmts-head">
        <MessageSquare />
        <div>
          <h2>Comments</h2>
          <p>On the highlighted block</p>
        </div>
        <button type="button" className="bdoc__cmts-x" onClick={onClose} aria-label="Close"><X /></button>
      </header>
      <div className="bdoc__cmts-scroll">
        {thread.length === 0 ? (
          <div className="bdoc__cmts-empty">
            <MessageSquare />
            <p>No comments yet. Start a thread.</p>
          </div>
        ) : (
          <ul className="bdoc__cmts-list">
            {thread.map((c) => (
              <li key={c.id} className="bdoc__cmt">
                <div className="bdoc__cmt-head">
                  {c.authorAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="bdoc__cmt-avatar" src={c.authorAvatar} alt="" />
                  ) : (
                    <span className="bdoc__cmt-avatar bdoc__cmt-avatar--initials">
                      {c.authorName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="bdoc__cmt-name">{c.authorName}</span>
                  <span className="bdoc__cmt-time">{relTimeShort(c.createdAt)}</span>
                </div>
                <div className="bdoc__cmt-body">{c.text}</div>
                <footer className="bdoc__cmt-foot">
                  {me && c.authorId === me.id && (
                    <button type="button" className="bdoc__cmt-del" onClick={() => deleteComment(c.id)}>Delete</button>
                  )}
                </footer>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="bdoc__cmts-form"
        onSubmit={(e) => { e.preventDefault(); void postComment(); }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={me ? `Comment as ${meName}…` : "Loading user…"}
          rows={2}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void postComment();
            }
          }}
          disabled={busy || !me}
        />
        <button type="submit" disabled={busy || !me || !draft.trim()}>
          {busy ? <Loader2 className="bdoc__spin" /> : <Send />}
        </button>
      </form>
    </aside>
  );
}

function relTimeShort(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ───────── Version history slide-over ─────────
type VersionMeta = {
  id: string;
  version: number;
  title: string;
  createdAt: string;
  authorName?: string | null;
};

function VersionHistoryPanel({ docId, onClose, onRestore }: {
  docId: string;
  onClose: () => void;
  onRestore: (blocks: Block[], meta: DocMeta, title: string) => void;
}) {
  const { toast } = useOsToast();
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blocks: Block[] | null; meta: DocMeta; title: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/docs/${docId}/versions`);
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled) setVersions(d.versions ?? []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  useEffect(() => {
    if (!selectedId) { setPreview(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/docs/${docId}/versions/${selectedId}`);
        if (!res.ok) return;
        const d = await res.json();
        const v = d.version;
        const c = v.content as { blocks?: Block[]; meta?: DocMeta } | null;
        if (cancelled) return;
        setPreview({
          blocks: Array.isArray(c?.blocks) ? c!.blocks! : null,
          meta: c?.meta ?? {},
          title: v.title ?? "",
        });
      } catch { /* ignore */ }
      finally { if (!cancelled) setPreviewLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedId, docId]);

  async function restore() {
    if (!selectedId || !preview?.blocks) return;
    if (!confirm("Restore this version? Your current content will be saved as a new version, and the restored version will become the live content.")) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/docs/${docId}/versions/${selectedId}`, { method: "POST" });
      if (!res.ok) { toast("Restore failed"); return; }
      onRestore(preview.blocks, preview.meta, preview.title);
      toast("Version restored");
    } catch { toast("Restore failed"); }
    finally { setRestoring(false); }
  }

  return (
    <aside className="bdoc__hist" role="dialog" aria-modal="false" aria-label="Version history">
      <header className="bdoc__hist-head">
        <History />
        <div>
          <h2>Version history</h2>
          <p>Every save creates an immutable snapshot.</p>
        </div>
        <button type="button" className="bdoc__hist-x" onClick={onClose} aria-label="Close"><X /></button>
      </header>

      <div className="bdoc__hist-body">
        <div className="bdoc__hist-list">
          {versions === null ? (
            <div className="bdoc__hist-loading"><Loader2 className="bdoc__spin" /> Loading…</div>
          ) : versions.length === 0 ? (
            <div className="bdoc__hist-empty">No versions yet.</div>
          ) : (
            <ul>
              {versions.map((v, idx) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className={`bdoc__hist-item ${selectedId === v.id ? "is-sel" : ""}`}
                    onClick={() => setSelectedId(v.id)}
                  >
                    <span className="bdoc__hist-num">v{v.version}{idx === 0 ? " · current" : ""}</span>
                    <span className="bdoc__hist-title">{v.title || "Untitled"}</span>
                    <span className="bdoc__hist-meta">
                      {v.authorName ?? "Unknown"} · {new Date(v.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bdoc__hist-preview">
          {!selectedId ? (
            <div className="bdoc__hist-hint">Pick a version on the left to preview it here.</div>
          ) : previewLoading || !preview ? (
            <div className="bdoc__hist-loading"><Loader2 className="bdoc__spin" /> Loading preview…</div>
          ) : preview.blocks ? (
            <>
              <div className="bdoc__hist-preview-title">{preview.title || "Untitled"}</div>
              <div className="bdoc__hist-preview-body">
                <BlockEditor initialBlocks={preview.blocks} onSave={() => {}} readonly />
              </div>
              <footer className="bdoc__hist-foot">
                <button type="button" className="bdoc__hist-restore" onClick={restore} disabled={restoring}>
                  {restoring ? <Loader2 className="bdoc__spin" /> : <RotateCcw />}
                  Restore this version
                </button>
              </footer>
            </>
          ) : (
            <div className="bdoc__hist-hint">This version is in the legacy rich-text format. Open it from the timeline to inspect.</div>
          )}
        </div>
      </div>
    </aside>
  );
}

// ───────── Backlinks panel ("Linked from") ─────────
type BacklinkHit = {
  type: "doc" | "sop";
  id: string;
  title: string;
  icon?: string;
  excerpt?: string | null;
  updatedAt: string;
};

export function BacklinksPanel({ kind, id }: { kind: "doc" | "sop"; id: string }) {
  const [docs, setDocs] = useState<BacklinkHit[] | null>(null);
  const [sops, setSops] = useState<BacklinkHit[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/backlinks?kind=${kind}&id=${id}`);
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        setDocs(d.docs ?? []);
        setSops(d.sops ?? []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [kind, id]);

  if (docs === null || sops === null) return null;
  if (docs.length === 0 && sops.length === 0) return null;

  return (
    <section className="bdoc__backlinks">
      <header className="bdoc__backlinks-head">
        <ArrowDownLeft />
        <span>Linked from</span>
        <em>{docs.length + sops.length} reference{docs.length + sops.length === 1 ? "" : "s"}</em>
      </header>
      <div className="bdoc__backlinks-list">
        {docs.map((h) => (
          <Link key={`d:${h.id}`} href={`/docs/${h.id}`} className="bdoc__backlink">
            <span className="bdoc__backlink-icon bdoc__backlink-icon--doc">
              {h.icon ?? <FileText />}
            </span>
            <span className="bdoc__backlink-body">
              <span className="bdoc__backlink-title">{h.title}</span>
              {h.excerpt && (
                <span className="bdoc__backlink-excerpt">
                  {h.excerpt.slice(0, 110)}{h.excerpt.length > 110 ? "…" : ""}
                </span>
              )}
            </span>
            <span className="bdoc__backlink-chip bdoc__backlink-chip--doc">Note</span>
          </Link>
        ))}
        {sops.map((h) => (
          <Link key={`s:${h.id}`} href={`/sops/${h.id}`} className="bdoc__backlink">
            <span className="bdoc__backlink-icon bdoc__backlink-icon--sop">
              <BookCopy />
            </span>
            <span className="bdoc__backlink-body">
              <span className="bdoc__backlink-title">{h.title}</span>
            </span>
            <span className="bdoc__backlink-chip bdoc__backlink-chip--sop">SOP</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ───────── Cover picker (gradient + URL) ─────────
function CoverPicker({ meta, onPick, onClear }: { meta: DocMeta; onPick: (m: Partial<DocMeta>) => void; onClear: () => void }) {
  const [url, setUrl] = useState(meta.coverUrl ?? "");
  return (
    <div className="bdoc__cover-pop" onClick={(e) => e.stopPropagation()}>
      <header className="bdoc__cover-head">
        <ImagePlus /> <span>Pick a cover</span>
        {(meta.coverUrl || meta.coverGradient) && (
          <button type="button" className="bdoc__emoji-clear" onClick={onClear}>
            <Trash2 /> Remove
          </button>
        )}
      </header>
      <div className="bdoc__cover-grid">
        {COVER_GRADIENTS.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`bdoc__cover-cell ${meta.coverGradient === g.key && !meta.coverUrl ? "is-current" : ""}`}
            onClick={() => onPick({ coverGradient: g.key, coverUrl: undefined })}
            style={{ background: g.css }}
            aria-label={g.label}
            title={g.label}
          />
        ))}
      </div>
      <div className="bdoc__cover-url">
        <input
          type="url"
          placeholder="…or paste an image URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          disabled={!url.trim()}
          onClick={() => onPick({ coverUrl: url.trim(), coverGradient: undefined })}
        >
          Use image
        </button>
      </div>
    </div>
  );
}
