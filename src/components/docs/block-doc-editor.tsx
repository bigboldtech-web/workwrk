"use client";

/* BlockDocEditor — chrome around the BlockNote canvas for /docs/[id].
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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Link as LinkIcon, Sparkles, Loader2, Table as TableIcon,
  ImagePlus, Smile, Trash2, MessageSquare, ListTree, X, Send, Star,
  ArrowDownLeft, FileText, BookCopy, BookOpen, History, RotateCcw,
  MoreHorizontal, Download, Copy, PanelRightOpen, Search, ArrowUp, AtSign,
  ClipboardCopy, Type as TypeIcon, MoveHorizontal, Lock, ChevronRight,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { ImageLightbox, KeyboardShortcutsOverlay, LinkPromptOverlay, type Block, type Comment, type CommentsByBlock } from "./block-editor";
import dynamic from "next/dynamic";
import { BlockNoteCanvas } from "./blocknote-canvas";
import type { PartialBlock } from "@blocknote/core";
import { useOsToast } from "@/components/layout/os/toast";
import { renderNoteIcon } from "./note-icon";

// Lazy-load the full icon picker so its ~1MB emoji dataset only ships when
// the writer actually opens the picker — keeps the doc page light + fast.
const NoteIconPicker = dynamic(
  () => import("./note-icon-picker").then((m) => m.NoteIconPicker),
  { ssr: false },
);

type DocFont = "default" | "serif" | "mono";
type DocMeta = {
  icon?: string;
  coverGradient?: string;
  coverUrl?: string;
  // Notion-style page preferences (all additive — older docs default sensibly).
  font?: DocFont;
  smallText?: boolean;
  fullWidth?: boolean;
  locked?: boolean;
};

type DocPayload = {
  id: string;
  title: string;
  // Content shape evolves:
  //   v1 (legacy): { blocks: Block[] }            — custom editor
  //   v2:          { bnDoc: PartialBlock[], blocks: Block[] (mirror), version: 2 }
  // We read both shapes and migrate v1 → v2 lazily on first save.
  content: { bnDoc?: PartialBlock[]; blocks?: Block[]; html?: string; meta?: DocMeta; comments?: CommentsByBlock; version?: number } | null;
  summary?: string | null;
  summarizedAt?: string | null;
  updatedAt: string;
  createdAt: string;
};

type MeUser = { id: string; firstName?: string | null; lastName?: string | null; email?: string; avatar?: string | null };

function newId() { return Math.random().toString(36).slice(2, 10); }

// Legacy block kinds that BlockNote can't render natively. These are
// the kinds whose original data we preserve across BN edits — see
// preservedLegacyRef in BlockDocEditor. Anything in this set that
// survives in the BN doc as a paragraph proxy gets spliced back into
// the persisted `blocks` mirror so server-side readers (EntityLink
// sync, S3 presign) see the original embed, not the proxy.
// Note: kinds that BlockNote can now round-trip natively (e.g. "subpage")
// MUST NOT be in this set — otherwise the frozen original would mask any
// in-BN edits to the block's props.
const LEGACY_CUSTOM_EMBED_KINDS = new Set<Block["kind"]>([
  "sop_card", "task_card", "note_card", "entity_link", "ai_write",
  "tasks_view", "studio_board", "sops_list", "meetings_view", "form", "data_table",
  "embed", "image", "file",
  // NOTE: "callout" is intentionally absent — it round-trips as a native
  // BlockNote block now, so freezing the original would mask in-BN edits to
  // its emoji/color/text (same reasoning as "subpage").
]);

function collectLegacyCustomEmbeds(blocks: Block[]): Map<string, Block> {
  const m = new Map<string, Block>();
  for (const b of blocks) {
    if (LEGACY_CUSTOM_EMBED_KINDS.has(b.kind)) m.set(b.id, b);
  }
  return m;
}

// Splice preserved originals back into a BN-derived mirror. The mirror
// keeps block ordering; for each mirror entry whose id matches a
// preserved legacy block, we swap in the original. Mirror entries
// without a preserved match pass through untouched.
function rehydrateMirrorWithLegacyEmbeds(mirror: Block[], preserved: Map<string, Block>): Block[] {
  if (preserved.size === 0) return mirror;
  return mirror.map((b) => preserved.get(b.id) ?? b);
}

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

// Curated cover-image gallery. Seeded picsum URLs are stable + free (no API
// key) so the gallery always renders real photos as thumbnails — the full
// cover uses the wide variant, the picker shows a small one.
const COVER_SEEDS = [
  "ridge", "harbor", "dunes", "aurora", "canyon", "tide",
  "forest", "summit", "meadow", "city9", "coast4", "valley7",
];
const coverImageUrl = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

interface Props {
  docId: string;
  // "primary" (default) is the main pane. "peek" is the right pane in a
  // split view — its chrome hides the back button + open-side-panel button
  // because the surrounding DocSplitView owns those actions.
  pane?: "primary" | "peek";
}

export function BlockDocEditor({ docId, pane = "primary" }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useOsToast();
  // Peek picker — popover state + fetched recent docs for the picker list.
  const [peekPickerOpen, setPeekPickerOpen] = useState(false);
  const [peekQuery, setPeekQuery] = useState("");
  const [peekDocs, setPeekDocs] = useState<{ id: string; title: string; updatedAt: string }[] | null>(null);
  const [doc, setDoc] = useState<DocPayload | null>(null);
  const [title, setTitle] = useState("");
  // bnDoc is BlockNote's native JSON — the source of truth for editing.
  // `blocks` is a derived mirror (LegacyBlock[]) the surrounding chrome
  // reads for the outline / word count without rewriting those components.
  const [bnDoc, setBnDoc] = useState<PartialBlock[] | null>(null);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  // Preserved legacy custom-embed blocks. BlockNote can't render kinds
  // like sop_card / task_card / subpage / entity_link, so the migration
  // shadows them as paragraph proxies. We keep the originals keyed by
  // block id; on save, if the proxy still lives in the BN doc we splice
  // the original back into the persisted `blocks` mirror so the
  // EntityLink graph and other server-side readers don't see ghosts.
  const preservedLegacyRef = useRef<Map<string, Block>>(new Map());
  const [meta, setMeta] = useState<DocMeta>({});
  const [legacy, setLegacy] = useState<string | null>(null);
  // Bumps on history-restore so the BlockNote canvas force-remounts with
  // the restored content instead of holding the previous in-memory doc.
  const [restoreNonce, setRestoreNonce] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
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

  // Load the doc list when the peek picker opens. Lazy + once per open
  // is plenty — a workspace's doc count is small enough to filter client-side.
  useEffect(() => {
    if (!peekPickerOpen || peekDocs !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/docs");
        if (!res.ok) return;
        const d = await res.json();
        const rows: { id: string; title: string; updatedAt: string }[] = (d.docs ?? d.data ?? d ?? [])
          .filter((r: { id: string }) => r.id !== docId);
        if (!cancelled) setPeekDocs(rows);
      } catch { /* picker just stays empty */ }
    })();
    return () => { cancelled = true; };
  }, [peekPickerOpen, peekDocs, docId]);

  // Dismiss the peek picker on outside click / Esc.
  useEffect(() => {
    if (!peekPickerOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Element | null;
      if (!t || !t.closest(".bdoc__peek-picker, .bdoc__iact--peek")) {
        setPeekPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setPeekPickerOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [peekPickerOpen]);

  function openPeek(pickedId: string) {
    setPeekPickerOpen(false);
    setPeekQuery("");
    // If we're already in a split, the current URL is /docs/<docId>?peek=<existingPeek>.
    // Replacing peek with the picked id keeps us in split mode.
    router.push(`/docs/${docId}?peek=${pickedId}`);
  }

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

  // Register this note with the open-note tab strip (DocTabsBar). Fires on
  // load and whenever the title or icon changes, so the tab stays in sync.
  // Only the primary editor announces tabs — peek panes don't open a tab.
  useEffect(() => {
    if (!doc || pane === "peek") return;
    window.dispatchEvent(new CustomEvent("workwrk:doc-tab:open", {
      detail: { id: docId, title: title || "Untitled note", icon: meta.icon },
    }));
  }, [doc, pane, docId, title, meta.icon]);

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
        // v2: native BlockNote JSON. Preferred.
        // v1: legacy {blocks:[...]} — passed through to the canvas which
        //     converts it transparently. The next save persists v2 shape.
        // legacy html: still shows the convert-to-blocks banner.
        if (c && Array.isArray((c as { bnDoc?: PartialBlock[] }).bnDoc)) {
          setBnDoc((c as { bnDoc: PartialBlock[] }).bnDoc);
          const persistedBlocks = Array.isArray((c as { blocks?: Block[] }).blocks) ? (c as { blocks: Block[] }).blocks : [];
          setBlocks(persistedBlocks);
          preservedLegacyRef.current = collectLegacyCustomEmbeds(persistedBlocks);
          setLegacy(null);
        } else if (c && Array.isArray((c as { blocks?: Block[] }).blocks)) {
          setBnDoc(null);
          const persistedBlocks = (c as { blocks: Block[] }).blocks;
          setBlocks(persistedBlocks);
          preservedLegacyRef.current = collectLegacyCustomEmbeds(persistedBlocks);
          setLegacy(null);
        } else if (c && typeof (c as { html?: string }).html === "string") {
          setLegacy((c as { html: string }).html);
          setBnDoc(null);
          setBlocks(null);
        } else {
          setBnDoc(null);
          setBlocks([]);
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "load failed");
      }
    })();
    void refetchComments();
    return () => { cancelled = true; };
  }, [docId, refetchComments]);

  // Serialize content saves so a debounced PUT never overtakes one
  // that's still in flight. Without this, the second save sends a
  // pre-server-response lastUpdatedAtRef and the server 409s the
  // client against itself. We coalesce: while one save is running,
  // newer args overwrite a single "pending" slot; the in-flight
  // completion fires the latest pending with the now-fresh ref.
  const saveInFlightRef = useRef(false);
  const pendingPersistRef = useRef<
    null | { bnDoc: PartialBlock[] | null; blocks: Block[]; meta: DocMeta; excerpt?: string }
  >(null);

  // Persist accepts the full editor state: BlockNote doc (source of truth),
  // legacy mirror (for chrome + legacy readers), and the doc meta.
  const persist = useCallback(async (
    nextBnDoc: PartialBlock[] | null,
    nextBlocks: Block[],
    nextMeta: DocMeta,
    nextExcerpt?: string,
  ) => {
    if (saveInFlightRef.current) {
      pendingPersistRef.current = { bnDoc: nextBnDoc, blocks: nextBlocks, meta: nextMeta, excerpt: nextExcerpt };
      return;
    }
    saveInFlightRef.current = true;
    try {
      const text = (nextExcerpt ?? nextBlocks
        .map((b) => "text" in b ? (b as { text: string }).text : "")
        .filter(Boolean)
        .join(" "))
        .slice(0, 400);
      const content: { bnDoc?: PartialBlock[]; blocks: Block[]; meta: DocMeta; version: 2 } = {
        ...(nextBnDoc ? { bnDoc: nextBnDoc } : {}),
        blocks: nextBlocks,
        meta: nextMeta,
        version: 2,
      };
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
          content,
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
    finally {
      saveInFlightRef.current = false;
      // Drain a coalesced pending save with the now-fresh updatedAt.
      const queued = pendingPersistRef.current;
      pendingPersistRef.current = null;
      if (queued) void persist(queued.bnDoc, queued.blocks, queued.meta, queued.excerpt);
    }
  }, [docId, title, toast]);

  // Called by BlockNoteCanvas on every (debounced) edit. We update both the
  // BN source of truth and the derived legacy mirror, then persist.
  //
  // The mirror is BN→legacy and is lossy for custom embeds (sop_card,
  // task_card, subpage, entity_link, etc.) — BN renders those as plain
  // paragraphs. Before persisting, we splice the originals back in by
  // matching block ids. Result: as long as the writer keeps the proxy
  // paragraph in place, the EntityLink graph keeps pointing at the
  // original embed. If they delete the proxy, the original disappears
  // from the next save — exactly the right behavior.
  const handleEditorChange = useCallback((nextBnDoc: PartialBlock[], mirror: Block[], plainText: string) => {
    const enrichedMirror = rehydrateMirrorWithLegacyEmbeds(mirror, preservedLegacyRef.current);
    setBnDoc(nextBnDoc);
    setBlocks(enrichedMirror);
    void persist(nextBnDoc, enrichedMirror, meta, plainText);
  }, [persist, meta]);

  const saveBlocks = useCallback(async (next: Block[]) => {
    // Legacy entry point — still used by convertLegacy() for the v0 html flow.
    // We don't have a BN doc here; persist with bnDoc=null so the next edit
    // (which goes through the canvas) regenerates it.
    setBlocks(next);
    setBnDoc(null);
    await persist(null, next, meta);
  }, [persist, meta]);

  const saveMeta = useCallback(async (patch: Partial<DocMeta>) => {
    const next = { ...meta, ...patch };
    setMeta(next);
    if (blocks) await persist(bnDoc, blocks, next);
  }, [persist, meta, blocks, bnDoc]);

  function saveTitle(next: string) {
    setTitle(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      try {
        // Title saves must participate in the same optimistic-concurrency
        // protocol as content saves. Without this coordination, a title
        // PUT bumps the server's updatedAt while lastUpdatedAtRef stays
        // pinned — the next content save then trips 409 against itself.
        const res = await fetch(`/api/docs/${docId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: next.trim() || "Untitled note",
            knownUpdatedAt: lastUpdatedAtRef.current,
          }),
        });
        if (res.status === 409) {
          setConflict(true);
          return;
        }
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.doc?.updatedAt) lastUpdatedAtRef.current = data.doc.updatedAt;
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

  // Copy the whole page as Markdown — reuses the export endpoint so the
  // clipboard content matches an exported file exactly.
  async function copyContents() {
    try {
      const res = await fetch(`/api/docs/${docId}/export?format=md`);
      if (!res.ok) { toast("Couldn't copy contents"); return; }
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      toast("Page contents copied");
    } catch { toast("Couldn't copy contents"); }
  }

  // Soft-archive (DELETE = move to Trash; the row + versions persist).
  async function trashDoc() {
    if (!confirm("Move this note to Trash? You can restore it later.")) return;
    try {
      const res = await fetch(`/api/docs/${docId}`, { method: "DELETE" });
      if (!res.ok) { toast("Couldn't move to Trash"); return; }
      window.dispatchEvent(new CustomEvent("workwrk:docs-changed"));
      toast("Moved to Trash");
      router.push("/docs");
    } catch { toast("Couldn't move to Trash"); }
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
    <>
    <ImageLightbox />
    <KeyboardShortcutsOverlay />
    <LinkPromptOverlay />
    <div
      className={[
        "bdoc",
        readingMode ? "bdoc--reading" : "",
        meta.font === "serif" ? "bdoc--font-serif" : meta.font === "mono" ? "bdoc--font-mono" : "",
        meta.smallText ? "bdoc--small-text" : "",
        meta.fullWidth ? "bdoc--full-width" : "",
        meta.locked && !readingMode ? "bdoc--locked" : "",
      ].filter(Boolean).join(" ")}
    >
      <header className="bdoc__head">
        {/* Peek panes have no back button — the surrounding DocSplitView
            provides Close + Swap controls instead. */}
        {pane !== "peek" && (
          <button type="button" className="bdoc__back" onClick={() => router.back()} aria-label="Back">
            <ArrowLeft />
          </button>
        )}

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

          {/* Open another doc in a side pane. Hidden on peek panes — the
              surrounding DocSplitView's own toolbar already lets the
              writer swap or close from there. */}
          {pane !== "peek" && (
            <div className="bdoc__peek-wrap">
              <button
                type="button"
                className={`bdoc__iact bdoc__iact--peek ${peekPickerOpen ? "is-on" : ""}`}
                onClick={() => setPeekPickerOpen((s) => !s)}
                title="Open another note side-by-side"
                aria-haspopup="dialog"
                aria-expanded={peekPickerOpen}
                aria-label="Open side pane"
              >
                <PanelRightOpen />
              </button>
              {peekPickerOpen && (
                <div className="bdoc__peek-picker" role="dialog" aria-label="Pick a note to open in side pane">
                  <div className="bdoc__peek-search">
                    <Search />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search notes…"
                      value={peekQuery}
                      onChange={(e) => setPeekQuery(e.target.value)}
                    />
                  </div>
                  <div className="bdoc__peek-list">
                    {peekDocs === null ? (
                      <div className="bdoc__peek-empty"><Loader2 className="bdoc__spin" /> Loading notes…</div>
                    ) : (() => {
                      const q = peekQuery.trim().toLowerCase();
                      const rows = q
                        ? peekDocs.filter((d) => (d.title || "").toLowerCase().includes(q))
                        : peekDocs.slice(0, 12);
                      if (rows.length === 0) {
                        return <div className="bdoc__peek-empty">No matches</div>;
                      }
                      return rows.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className="bdoc__peek-row"
                          onClick={() => openPeek(d.id)}
                        >
                          <FileText />
                          <span className="bdoc__peek-title">{d.title || "Untitled note"}</span>
                        </button>
                      ));
                    })()}
                  </div>
                  {searchParams.get("peek") && (
                    <button
                      type="button"
                      className="bdoc__peek-close-current"
                      onClick={() => { setPeekPickerOpen(false); router.push(`/docs/${docId}`); }}
                    >
                      <X /> Close current side pane
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

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
              <PageActionsMenu
                meta={meta}
                blocks={blocks}
                doc={doc}
                me={me}
                summary={summary}
                summarizing={summarizing}
                extracting={extracting}
                onClose={() => setMoreOpen(false)}
                onSetMeta={(patch) => void saveMeta(patch)}
                onCopyLink={copyLink}
                onCopyContents={() => void copyContents()}
                onExport={() => { window.location.href = `/api/docs/${docId}/export?format=md`; }}
                onDuplicate={async () => {
                  try {
                    const res = await fetch(`/api/docs/${docId}/duplicate`, { method: "POST" });
                    if (!res.ok) { toast("Couldn't duplicate"); return; }
                    const d = await res.json();
                    const id = d.doc?.id ?? d.data?.id ?? d.id;
                    if (id) router.push(`/docs/${id}`);
                  } catch { toast("Couldn't duplicate"); }
                }}
                onTrash={() => void trashDoc()}
                onSummarize={() => void summarize()}
                onExtractTable={() => void extractTable()}
                onVersionHistory={() => setPanel({ kind: "history" })}
                onShortcuts={() => window.dispatchEvent(new CustomEvent("workwrk:notes:shortcuts"))}
              />
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
              aria-label="Change icon"
            >
              {renderNoteIcon(meta.icon)}
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

          <button type="button" className="bdoc__add-comment" onClick={() => setCommentOpen(true)}>
            <MessageSquare /> Add comment
          </button>
        </div>

        {emojiOpen && (
          <NoteIconPicker
            current={meta.icon}
            onPick={(value) => { void saveMeta({ icon: value }); setEmojiOpen(false); }}
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

        {!readingMode && (
          <PageComments docId={docId} me={me} open={commentOpen} onClose={() => setCommentOpen(false)} />
        )}

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
          // Key by docId + reading-mode + restoreNonce so the editor
          // force-remounts on doc switch, reading-mode toggle, or version
          // restore — never holds a stale in-memory document.
          <BlockNoteCanvas
            key={`${docId}:${readingMode ? "r" : "e"}:${meta.locked ? "l" : "u"}:${restoreNonce}`}
            initialBnDoc={bnDoc}
            legacyBlocks={blocks}
            readonly={readingMode || !!meta.locked}
            onChange={handleEditorChange}
            docId={docId}
            onComment={(blockId) => setPanel({ kind: "comments", blockId })}
            onAskAI={() => setPanel({ kind: "ask" })}
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
            // Restoring an old version: drop the live BN doc and let the
            // canvas re-convert from the legacy blocks. restoreNonce bump
            // force-remounts the editor with the restored content.
            setBlocks(restoredBlocks);
            setBnDoc(null);
            setMeta(restoredMeta);
            setTitle(restoredTitle);
            setRestoreNonce((n) => n + 1);
            void persist(null, restoredBlocks, restoredMeta);
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
    </>
  );
}

// ───────── Page-level comments (Notion-style "Add a comment" under title) ─────────
//
// A lightweight inline thread anchored to the whole page. Backed by the same
// ItemUpdate store as block comments (entityType="DOC_BLOCK") using the
// reserved blockId "__page__", so it reuses /api/item-updates with no schema
// changes. Existing comments render above an always-visible composer row that
// mirrors Notion's avatar + input + attach/mention/send layout.
function PageComments({ docId, me, open, onClose }: { docId: string; me: MeUser | null; open: boolean; onClose: () => void }) {
  const { toast } = useOsToast();
  const [thread, setThread] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const entityId = `${docId}:__page__`;

  // Focus the composer when it's opened from the hover "Add comment" button.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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
  const meInitials = meName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  async function post() {
    const text = draft.trim();
    if (!text || !me) return;
    setBusy(true);
    try {
      const res = await fetch("/api/item-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "DOC_BLOCK", entityId, body: text }),
      });
      if (res.ok) { setDraft(""); await refresh(); }
      else toast("Couldn't add comment");
    } finally { setBusy(false); }
  }

  async function attachImage(file: File) {
    if (!file.type.startsWith("image/")) { toast("Not an image"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) { toast("Upload failed"); return; }
      const d = await res.json();
      if (d.url) setDraft((prev) => (prev ? `${prev} ${d.url}` : d.url));
      inputRef.current?.focus();
    } catch { toast("Upload failed"); }
    finally { setUploading(false); }
  }

  async function deleteComment(id: string) {
    if (!confirm("Delete this comment?")) return;
    const res = await fetch(`/api/item-updates/${id}`, { method: "DELETE" });
    if (res.ok) await refresh();
  }

  // Nothing to show until there's a comment or the writer opened the
  // composer via the hover "Add comment" affordance.
  const showComposer = open || thread.length > 0;
  if (thread.length === 0 && !open) return null;

  return (
    <div className="bdoc__pcmts">
      {thread.length > 0 && (
        <ul className="bdoc__pcmts-list">
          {thread.map((c) => (
            <li key={c.id} className="bdoc__pcmt">
              {c.authorAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="bdoc__pcmt-av" src={c.authorAvatar} alt="" />
              ) : (
                <span className="bdoc__pcmt-av bdoc__pcmt-av--i">
                  {c.authorName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="bdoc__pcmt-body">
                <div className="bdoc__pcmt-meta">
                  <span className="bdoc__pcmt-name">{c.authorName}</span>
                  <span className="bdoc__pcmt-time">{relTimeShort(c.createdAt)}</span>
                  {me && c.authorId === me.id && (
                    <button type="button" className="bdoc__pcmt-del" onClick={() => deleteComment(c.id)} aria-label="Delete comment">
                      <Trash2 />
                    </button>
                  )}
                </div>
                <CommentText text={c.text} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {showComposer && (
      <div className="bdoc__pcmts-compose">
        {me?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bdoc__pcmt-av" src={me.avatar} alt="" />
        ) : (
          <span className="bdoc__pcmt-av bdoc__pcmt-av--i">{meInitials}</span>
        )}
        <textarea
          ref={inputRef}
          className="bdoc__pcmts-input"
          placeholder="Add a comment…"
          rows={1}
          value={draft}
          disabled={!me || busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void post(); }
            if (e.key === "Escape" && !draft.trim()) { e.preventDefault(); onClose(); }
          }}
        />
        <div className="bdoc__pcmts-actions">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachImage(f); }} />
          <button type="button" title="Attach image" aria-label="Attach image" disabled={!me || uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="bdoc__spin" /> : <ImagePlus />}
          </button>
          <button type="button" title="Mention" aria-label="Mention" disabled={!me} onClick={() => { setDraft((p) => `${p}@`); inputRef.current?.focus(); }}>
            <AtSign />
          </button>
          <button type="button" className="bdoc__pcmts-send" title="Comment" aria-label="Send comment" disabled={!me || busy || !draft.trim()} onClick={() => void post()}>
            {busy ? <Loader2 className="bdoc__spin" /> : <ArrowUp />}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

// Render comment text, linkifying bare image URLs into inline thumbnails so
// "attach image" reads as an image rather than a raw link.
function CommentText({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  const isImg = (s: string) => /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(s);
  const hasImg = parts.some(isImg);
  return (
    <div className="bdoc__pcmt-text">
      <span>
        {parts.map((p, i) =>
          /^https?:\/\/\S+$/.test(p) && !isImg(p)
            ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a>
            : isImg(p) ? "" : p,
        )}
      </span>
      {hasImg && (
        <div className="bdoc__pcmt-imgs">
          {parts.filter(isImg).map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={i} href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt="" /></a>
          ))}
        </div>
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

// A plain action row in the page menu: icon · label · optional shortcut hint.
function PamRow({ icon, label, kbd, onClick, danger, disabled }: {
  icon: ReactNode; label: string; kbd?: string; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button" role="menuitem" disabled={disabled}
      className={`bdoc-pam__row ${danger ? "is-danger" : ""}`}
      onClick={onClick}
    >
      <span className="bdoc-pam__ico">{icon}</span>
      <span className="bdoc-pam__lbl">{label}</span>
      {kbd && <span className="bdoc-pam__kbd">{kbd}</span>}
    </button>
  );
}

// A toggle row: icon · label · switch. Stays open after toggling.
function PamToggle({ icon, label, on, onToggle }: {
  icon: ReactNode; label: string; on: boolean; onToggle: () => void;
}) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={on} className="bdoc-pam__row" onClick={onToggle}>
      <span className="bdoc-pam__ico">{icon}</span>
      <span className="bdoc-pam__lbl">{label}</span>
      <span className={`bdoc-pam__sw ${on ? "is-on" : ""}`} aria-hidden><span /></span>
    </button>
  );
}

// ───────── Page actions menu (the top-right "…") ─────────
//
// Notion's page-level menu, in our own tone: a searchable list of page
// actions, a font switcher, view toggles (Small text / Full width / Lock),
// an inline "Use with AI" group, and a live word-count + last-edited footer.
// Every item is wired to something real — no decorative dead rows.
function PageActionsMenu({
  meta, blocks, doc, me, summary, summarizing, extracting,
  onClose, onSetMeta, onCopyLink, onCopyContents, onExport, onDuplicate,
  onTrash, onSummarize, onExtractTable, onVersionHistory, onShortcuts,
}: {
  meta: DocMeta;
  blocks: Block[] | null;
  doc: DocPayload;
  me: MeUser | null;
  summary: string | null;
  summarizing: boolean;
  extracting: boolean;
  onClose: () => void;
  onSetMeta: (patch: Partial<DocMeta>) => void;
  onCopyLink: () => void;
  onCopyContents: () => void;
  onExport: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
  onSummarize: () => void;
  onExtractTable: () => void;
  onVersionHistory: () => void;
  onShortcuts: () => void;
}) {
  const [q, setQ] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const needle = q.trim().toLowerCase();
  const match = (label: string) => !needle || label.toLowerCase().includes(needle);

  // Live word count (same logic as the meta strip) for the footer.
  const words = useMemo(() => {
    if (!blocks) return 0;
    let n = 0;
    for (const b of blocks) {
      if (!("text" in b)) continue;
      const plain = (b as { text: string }).text.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
      n += plain.split(/\s+/).filter(Boolean).length;
    }
    return n;
  }, [blocks]);

  const editorName = me
    ? [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email || "you"
    : "you";
  const editedAt = new Date(doc.updatedAt).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  const font: DocFont = meta.font ?? "default";
  const FONTS: { key: DocFont; label: string; cls: string }[] = [
    { key: "default", label: "Default", cls: "is-default" },
    { key: "serif", label: "Serif", cls: "is-serif" },
    { key: "mono", label: "Mono", cls: "is-mono" },
  ];

  // Wrap an action so selecting it also dismisses the menu (Notion behaviour
  // for actions; toggles stay open).
  const act = (fn: () => void) => () => { onClose(); fn(); };

  const grp1 = ["copy link", "copy page contents", "duplicate", "move to trash"].some(match);
  const grp2 = ["small text", "full width", "lock page"].some(match);
  const grp3 = ["use with ai", "summarize", "re-summarize", "extract table"].some(match);
  const grp4 = ["export", "version history", "keyboard shortcuts"].some(match);

  return (
    <div className="bdoc__more-menu bdoc-pam" role="menu" onMouseDown={(e) => e.preventDefault()}>
      <div className="bdoc-pam__search">
        <Search />
        <input
          type="text" autoFocus placeholder="Search actions…"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
        />
      </div>

      <div className="bdoc-pam__scroll">
        {!needle && (
          <div className="bdoc-pam__fonts">
            {FONTS.map((f) => (
              <button
                key={f.key} type="button"
                className={`bdoc-pam__font ${f.cls} ${font === f.key ? "is-active" : ""}`}
                onClick={() => onSetMeta({ font: f.key })}
              >
                <span className="bdoc-pam__font-ag">Ag</span>
                <span className="bdoc-pam__font-lbl">{f.label}</span>
              </button>
            ))}
          </div>
        )}

        {grp1 && (
          <div className="bdoc-pam__grp">
            {match("Copy link") && <PamRow icon={<LinkIcon />} label="Copy link" kbd="⌘L" onClick={act(onCopyLink)} />}
            {match("Copy page contents") && <PamRow icon={<ClipboardCopy />} label="Copy page contents" onClick={act(onCopyContents)} />}
            {match("Duplicate") && <PamRow icon={<Copy />} label="Duplicate" kbd="⌘D" onClick={act(onDuplicate)} />}
            {match("Move to Trash") && <PamRow icon={<Trash2 />} label="Move to Trash" danger onClick={act(onTrash)} />}
          </div>
        )}

        {grp2 && (
          <div className="bdoc-pam__grp">
            {match("Small text") && <PamToggle icon={<TypeIcon />} label="Small text" on={!!meta.smallText} onToggle={() => onSetMeta({ smallText: !meta.smallText })} />}
            {match("Full width") && <PamToggle icon={<MoveHorizontal />} label="Full width" on={!!meta.fullWidth} onToggle={() => onSetMeta({ fullWidth: !meta.fullWidth })} />}
            {match("Lock page") && <PamToggle icon={<Lock />} label="Lock page" on={!!meta.locked} onToggle={() => onSetMeta({ locked: !meta.locked })} />}
          </div>
        )}

        {grp3 && (
          <div className="bdoc-pam__grp">
            {match("Use with AI") && (
              <button type="button" className="bdoc-pam__row" aria-expanded={aiOpen} onClick={() => setAiOpen((s) => !s)}>
                <span className="bdoc-pam__ico"><Sparkles /></span>
                <span className="bdoc-pam__lbl">Use with AI</span>
                <ChevronRight className={`bdoc-pam__chev ${aiOpen ? "is-open" : ""}`} />
              </button>
            )}
            {(aiOpen || needle) && (
              <>
                {match("Summarize") && (
                  <PamRow
                    icon={summarizing ? <Loader2 className="bdoc__spin" /> : <Sparkles />}
                    label={summary ? "Re-summarize" : "Summarize with AI"}
                    disabled={summarizing} onClick={act(onSummarize)}
                  />
                )}
                {match("Extract table") && (
                  <PamRow
                    icon={extracting ? <Loader2 className="bdoc__spin" /> : <TableIcon />}
                    label="Extract table" disabled={extracting} onClick={act(onExtractTable)}
                  />
                )}
              </>
            )}
          </div>
        )}

        {grp4 && (
          <div className="bdoc-pam__grp">
            {match("Export") && <PamRow icon={<Download />} label="Export as Markdown" onClick={act(onExport)} />}
            {match("Version history") && <PamRow icon={<History />} label="Version history" onClick={act(onVersionHistory)} />}
            {match("Keyboard shortcuts") && <PamRow icon={<TypeIcon />} label="Keyboard shortcuts" kbd="?" onClick={act(onShortcuts)} />}
          </div>
        )}
      </div>

      <div className="bdoc-pam__foot">
        <span>{words.toLocaleString()} word{words === 1 ? "" : "s"}</span>
        <span className="bdoc-pam__foot-line">Last edited by {editorName}</span>
        <span className="bdoc-pam__foot-line">{editedAt}</span>
      </div>
    </div>
  );
}

// ───────── Outline minimap (Notion-style) ─────────
//
// Collapsed: a thin column of right-aligned tick lines (length by heading
// level), with the section currently in view highlighted. On hover the
// whole thing expands into a labeled, clickable panel. Scroll-spy is driven
// by an IntersectionObserver against the live heading DOM nodes (located by
// their BlockNote `data-id`). Renders nothing when there are no headings.
function OutlineRail({ blocks, onClose }: { blocks: Block[]; onClose: () => void }) {
  const headings = useMemo(() => {
    return blocks
      .map((b) =>
        b.kind === "h1" || b.kind === "h2" || b.kind === "h3"
          ? { id: b.id, kind: b.kind, text: (b as { text: string }).text || "Untitled section" }
          : null,
      )
      .filter((x): x is { id: string; kind: "h1" | "h2" | "h3"; text: string } => !!x);
  }, [blocks]);

  const [activeId, setActiveId] = useState<string | null>(null);

  // Scroll-spy. Re-runs whenever the heading set changes. rootMargin pins
  // the "active" band near the top of the viewport so the highlighted tick
  // tracks the heading you're reading. root:null works regardless of which
  // ancestor actually scrolls.
  useEffect(() => {
    if (headings.length === 0) return;
    const els = headings
      .map((h) => document.querySelector(`[data-id="${h.id}"]`))
      .filter((el): el is Element => !!el);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        );
        const id = topMost.target.getAttribute("data-id");
        if (id) setActiveId(id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  const scrollTo = (id: string) => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <aside className="bdoc__outline" aria-label="Document outline">
      <button
        type="button"
        className="bdoc__outline-hide"
        onClick={onClose}
        title="Hide outline"
        aria-label="Hide outline"
      >
        <X />
      </button>
      <nav className="bdoc__outline-map">
        {headings.map((h) => (
          <button
            key={h.id}
            type="button"
            className={`bdoc__outline-tick bdoc__outline-tick--${h.kind} ${activeId === h.id ? "is-active" : ""}`}
            onClick={() => scrollTo(h.id)}
            title={h.text}
          >
            <span className="bdoc__outline-line" aria-hidden />
            <span className="bdoc__outline-text">{h.text}</span>
          </button>
        ))}
      </nav>
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
                <BlockNoteCanvas initialBnDoc={null} legacyBlocks={preview.blocks} readonly onChange={() => {}} />
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
  const { toast } = useOsToast();
  const [url, setUrl] = useState(meta.coverUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function uploadFile(file: File) {
    if (!file.type.startsWith("image/")) { toast("Not an image"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) { toast("Upload failed"); return; }
      const d = await res.json();
      onPick({ coverUrl: d.url, coverGradient: undefined });
    } catch { toast("Upload failed"); }
    finally { setUploading(false); }
  }

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

      {/* Upload-from-file button + drag-drop zone */}
      <div
        className={`bdoc__cover-upload ${uploading ? "is-busy" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void uploadFile(f);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
          }}
        />
        {uploading ? <><Loader2 className="bdoc__spin" /> Uploading…</> : <><ImagePlus /> Upload from device</>}
      </div>

      {/* Image gallery — real photo thumbnails */}
      <div className="bdoc__cover-sec">Gallery</div>
      <div className="bdoc__cover-grid bdoc__cover-grid--img">
        {COVER_SEEDS.map((seed) => {
          const full = coverImageUrl(seed, 1600, 400);
          return (
            <button
              key={seed}
              type="button"
              className={`bdoc__cover-cell bdoc__cover-cell--img ${meta.coverUrl === full ? "is-current" : ""}`}
              onClick={() => onPick({ coverUrl: full, coverGradient: undefined })}
              aria-label={`Cover ${seed}`}
              title="Use this cover"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverImageUrl(seed, 240, 90)} alt="" loading="lazy" />
            </button>
          );
        })}
      </div>

      {/* Solid gradients */}
      <div className="bdoc__cover-sec">Gradients</div>
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
