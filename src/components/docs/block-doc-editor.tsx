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
 *
 * ONE EDITOR, THREE ADDRESSES. /docs/[id] (the Docs hub), and the Work
 * addresses /spaces/[slug]/docs/[id] and /work/docs/[id], which a doc opened
 * from Work uses so the person stays in Work (src/lib/nav/object-href.ts).
 * `inWork` is a value computed once at the top from the route's placement:
 * in Work the WorkPlacementProvider declares the crumb, Back and the error
 * states land on the Work crumb, a Move refreshes the route in place (the
 * editor stays mounted), and ?peek and "Close the pane" stay at the address
 * the doc is mounted at. Links to OTHER objects are built for the section
 * the person is in. Save, load, autosave, drafts and the unload flush do not
 * change with the address.
 */

import { Dots } from "@/components/ui/dots";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  ImagePlus,
  Smile,
  Trash2,
  MessageSquare,
  ListTree,
  X,
  Send,
  ArrowDownLeft,
  FileText,
  BookCopy,
  BookOpen,
  History,
  RotateCcw,
  MoreHorizontal,
  Download,
  PanelRightOpen,
  Search,
  ArrowUp,
  AtSign,
  ClipboardCopy,
  Type as TypeIcon,
  MoveHorizontal,
  Lock,
  Paperclip,
  FilePlus,
  ChevronUp,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { Block, Comment, CommentsByBlock } from "./block-types";
import { collectLegacyCustomEmbeds, rehydrateMirrorWithLegacyEmbeds } from "./legacy-embed-preserve";
import dynamic from "next/dynamic";
import { BlockNoteCanvas } from "./blocknote-canvas";
import { refreshSidebar, notifyDocsChanged } from "@/components/layout/os/sidebar-refresh";
import type { PartialBlock } from "@blocknote/core";
import { useOsToast } from "@/components/layout/os/toast";
import { BackButton } from "@/components/ui/back-button";
import { useConfirm } from "@/components/ui/dialog-provider";
import { renderNoteIcon } from "./note-icon";
import { DocShareModal } from "./doc-share-modal";
import { useDocTree, createChildPage } from "./doc-pages-panel";
import { MenuList, MenuItem, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useViewer } from "@/lib/access/use-access";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import type { AutosaveStatus } from "@/hooks/use-autosave";
import { ConflictStrip } from "@/components/ui/conflict-strip";
import { canSend, noConflict, onConflict, onDismissConflict } from "@/lib/save-conflict";
import { registerDocTitleWriter } from "@/lib/doc-title-handoff";
import { DraftRestoreStrip } from "@/components/ui/draft-restore-strip";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { ReadOnlyBanner } from "@/components/access/read-only-banner";
import { ShareOrRoleChip } from "@/components/access/share-or-role-chip";
import { DocRowMenu } from "./doc-row-menu";
import { EntityTile } from "@/components/ui/entity-tile";
import { useFormat } from "@/lib/format/use-date-prefs";
import { readDocsOutline } from "@/lib/docs-prefs";
import { formatRelative } from "@/lib/format/date";
import { apiFetch } from "@/lib/api-fetch";
import { useWorkPlacement, useWorkTitle } from "@/components/layout/os/work-placement";
import { copyObjectLink, objectHrefNow, useObjectHref } from "@/components/layout/os/use-object-href";
import { useHubBack } from "@/components/layout/os/use-hub-back";
import { canonicalHref } from "@/lib/nav/object-href";

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
  archivedAt?: string | null;
  updatedAt: string;
  createdAt: string;
  createdById?: string | null;
  parentId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

type DocLock = { byId: string; byName: string | null; at: string | null };
type DraftPayload = { title: string; bnDoc: PartialBlock[] | null; blocks: Block[]; meta: DocMeta };

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

// Covers (spec-docs-knowledge section 2, /docs/[id]): an uploaded image, or
// one of the eight pale hue washes from design-system 1.7 (the
// --os-status-user-N-bg tokens). No gradients and no Unsplash hotlinks: the
// twelve hardcoded photo ids are gone, and the six legacy gradient keys a
// saved doc may still carry each map to the nearest wash so no cover goes
// blank.
const COVER_HUES: { key: string; label: string; css: string }[] = Array.from({ length: 8 }, (_, i) => ({
  key: `hue-${i + 1}`,
  label: `Wash ${i + 1}`,
  css: `var(--os-status-user-${i + 1}-bg)`,
}));
const LEGACY_COVER_KEY: Record<string, string> = { indigo: "hue-1", blue: "hue-1", teal: "hue-2", amber: "hue-4", pink: "hue-6", slate: "hue-7" };

function gradientCSS(key?: string): string {
  const k = key && LEGACY_COVER_KEY[key] ? LEGACY_COVER_KEY[key] : key;
  return COVER_HUES.find((g) => g.key === k)?.css ?? COVER_HUES[0].css;
}

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
  const confirm = useConfirm();
  // Work mode is a value, read here before any early return. Only the
  // primary pane is the doc this Work address shows; a peek pane beside it
  // (and the List view's embedded editor) keeps its own rules.
  const place = useWorkPlacement();
  const hubBack = useHubBack();
  const inWork = pane === "primary" && place?.kind === "doc" && place.id === docId;
  const selfPath = inWork && place ? place.self : canonicalHref("doc", docId);
  // Peek picker — popover state + fetched recent docs for the picker list.
  const [peekPickerOpen, setPeekPickerOpen] = useState(false);
  const [peekQuery, setPeekQuery] = useState("");
  const [peekDocs, setPeekDocs] = useState<{ id: string; title: string; updatedAt: string }[] | null>(null);
  const [doc, setDoc] = useState<DocPayload | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [title, setTitle] = useState("");
  // The Work crumb's live title, once the doc has loaded (the gate's
  // placement already names it until then).
  useWorkTitle(inWork && doc ? (title || "Untitled doc") : null);
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
  // "Show outline" is remembered per user in home.docs.outline (off until
  // asked for). null = not toggled this session, so the preference decides.
  const [outlineOverride, setOutlineOverride] = useState<boolean | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [favorited, setFavorited] = useState<boolean | null>(null);
  const [readingMode, setReadingMode] = useState(false);
  const [comments, setComments] = useState<CommentsByBlock>({});
  const [me, setMe] = useState<MeUser | null>(null);
  // Per-doc role from GET /api/docs/[id] (settings.docSharing). Missing
  // myRole (older cached responses) defaults to "edit" — zero behavior
  // change for existing docs.
  // "comment" = a locked doc below Full access (change request A4): the
  // content is read-only, the comment composer stays.
  const [myRole, setMyRole] = useState<"edit" | "comment" | "view">("edit");
  const [shareOpen, setShareOpen] = useState(false);
  const shareBtnRef = useRef<HTMLButtonElement | null>(null);
  // Lock page (change request A4), Full access, the anchor and the owner,
  // all from GET /api/docs/[id].
  const [lock, setLock] = useState<DocLock | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [location, setLocation] = useState<{ type: string; name: string; icon: string | null; color: string | null; href: string | null } | null>(null);
  const [parentDoc, setParentDoc] = useState<{ id: string; title: string } | null>(null);
  const [owner, setOwner] = useState<{ id: string; name: string | null } | null>(null);
  // The AutosaveIndicator (design-system 5.17) observes persist(); it never
  // changes what persist() does. `saveStuck` holds the retry after the
  // budget is spent, so the word becomes "Not saved" with a Retry link.
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveStuck, setSaveStuck] = useState<(() => void) | null>(null);
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null);
  // The local draft mirror ("workwrk:draft:doc:<id>"), written before every
  // save and cleared on a 200; the restore strip renders when it is newer
  // than the server row.
  const draft = useLocalDraft<DraftPayload>("doc", docId, serverUpdatedAt);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const { railApps, prefs, patchPrefs } = useOsShell();
  const aiOn = railApps.some((a) => a.key === "ai");
  const outlineOpen = outlineOverride ?? readDocsOutline(prefs.home);
  const setOutlineOpen = useCallback((next: boolean) => {
    setOutlineOverride(next);
    void patchPrefs({ home: { docs: { outline: next } } });
  }, [patchPrefs]);
  const viewer = useViewer();
  const fmt = useFormat();
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const morePanelRef = useRef<HTMLDivElement | null>(null);
  // Subpage tree data: the "Docs inside" list under the body reads it, so it
  // loads in Work as well. The page tree itself lives in the DOCS SIDEBAR
  // (Notion-style nesting), not in a second in-editor panel. Peek panes
  // (null) skip the fetch.
  const tree = useDocTree(pane === "primary" ? docId : null);
  // Ref on the content column so the bottom word-count pill can pin
  // itself to the column's left edge.
  const contentColRef = useRef<HTMLDivElement | null>(null);

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
    // If we're already in a split, the current URL is <selfPath>?peek=<existingPeek>.
    // Replacing peek with the picked id keeps us in split mode, at the address
    // the doc is mounted at (a Work address stays a Work address).
    router.push(`${selfPath}?peek=${encodeURIComponent(pickedId)}`);
  }

  // Dismiss the More menu when clicking elsewhere or hitting Esc.
  useEffect(() => {
    if (!moreOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (moreBtnRef.current?.contains(t) || morePanelRef.current?.contains(t)) return;
      setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setMoreOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Register this doc with the open-doc strip (DocTabsBar). Fires on load and
  // whenever the title or icon changes, so the tab stays in sync. Only the
  // primary pane announces a tab: a peek pane never opens one.
  useEffect(() => {
    if (!doc || pane === "peek") return;
    window.dispatchEvent(new CustomEvent("workwrk:doc-tab:open", {
      detail: { id: docId, title: title || "Untitled doc", icon: meta.icon },
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

  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The doc's updatedAt as last observed by this tab. Each PUT echoes
  // the new value; the next PUT carries it back so the server can
  // reject (409) when another writer has moved on without us.
  const lastUpdatedAtRef = useRef<string | null>(null);
  // Last title we told the sidebar about — so we only re-fetch the tree when the
  // title actually changes, not on every body-autosave.
  const lastSyncedTitleRef = useRef<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // While a 409 is unanswered the editor stops sending. See
  // src/lib/save-conflict.ts for why: the old behaviour re-sent the buffer and
  // destroyed the other person's committed version without saying a word.
  const conflictHoldRef = useRef(noConflict);

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
        setMyRole(data.myRole === "view" ? "view" : data.myRole === "comment" ? "comment" : "edit");
        setLock(data.lock ?? null);
        setCanManage(!!data.canManage);
        setLocation(data.location ?? null);
        setParentDoc(data.parent ?? null);
        setOwner(data.owner ?? null);
        setServerUpdatedAt(d.updatedAt ?? null);
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
        } else if (c && (c as { type?: string }).type === "doc" && Array.isArray((c as { content?: unknown[] }).content)) {
          // TipTap shape (authored by the Notepad quick-tool / new-note create).
          // Convert its paragraphs straight to legacy blocks so the canvas
          // renders them normally (via legacyBlocksToBN) — NOT the "old
          // rich-text format / Convert to blocks" banner, which was wrongly
          // firing on every note. The next save rewrites it in v2 shape.
          const paras = ((c as { content: Array<{ content?: Array<{ text?: string }> }> }).content) ?? [];
          const converted: Block[] = paras.map((p) => ({
            id: Math.random().toString(36).slice(2, 10),
            kind: "paragraph",
            text: (p.content ?? []).map((n) => n.text ?? "").join(""),
          }));
          setBnDoc(null);
          setBlocks(converted.length ? converted : []);
          setLegacy(null);
        } else {
          setBnDoc(null);
          setBlocks([]);
        }
        // Record a recently-viewed marker (MRU list on UserPreference.home,
        // read by the Docs hub Recent tab + "Date viewed" column). Fire-and-
        // forget: entirely outside the autosave/persist path, never awaited.
        void fetch("/api/me/recent-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId }),
        }).catch(() => {});
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

  // Live refs so a title-triggered or debounced save always persists the LATEST
  // title + content regardless of stale closures. Title now flows through the
  // single persist() writer (below) so title + body can never fire two
  // concurrent PUTs that 409 each other against the same knownUpdatedAt.
  const titleRef = useRef(title);
  // Freshly created sub-pages arrive with ?new=1 — focus + select the title
  // so the writer names the page instead of re-clicking Add subpage.
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const focusedNewRef = useRef(false);
  useEffect(() => {
    if (focusedNewRef.current || !doc || searchParams.get("new") !== "1") return;
    focusedNewRef.current = true;
    const el = titleInputRef.current;
    if (el) { el.focus(); el.select(); }
  }, [doc, searchParams]);
  const bnDocRef = useRef(bnDoc);
  const blocksRef = useRef(blocks);
  const metaRef = useRef(meta);
  const myRoleRef = useRef(myRole);
  useEffect(() => {
    titleRef.current = title;
    bnDocRef.current = bnDoc;
    blocksRef.current = blocks;
    metaRef.current = meta;
    myRoleRef.current = myRole;
  });

  // Persist accepts the full editor state: BlockNote doc (source of truth),
  // legacy mirror (for chrome + legacy readers), and the doc meta.
  const persist = useCallback(async (
    nextBnDoc: PartialBlock[] | null,
    nextBlocks: Block[],
    nextMeta: DocMeta,
    nextExcerpt?: string,
    attempt = 0,
  ) => {
    // View-only members never fire PUTs — the server would 403 every
    // attempt and the retry loop would burn 4 tries + a scary save toast.
    // Ref read (not a closure) so the guard is never stale.
    if (myRoleRef.current !== "edit") return;
    // A 409 nobody has answered yet: keep mirroring to the local draft so not
    // one keystroke is lost, but do not overwrite the version that beat us.
    // The ConflictStrip is on screen and the indicator reads unsaved, so this
    // is a visible hold, never a silent drop.
    if (!canSend(conflictHoldRef.current)) {
      draftRef.current.write({ title: titleRef.current, bnDoc: nextBnDoc, blocks: nextBlocks, meta: nextMeta });
      setSaveStatus("dirty");
      return;
    }
    if (saveInFlightRef.current) {
      pendingPersistRef.current = { bnDoc: nextBnDoc, blocks: nextBlocks, meta: nextMeta, excerpt: nextExcerpt };
      return;
    }
    saveInFlightRef.current = true;
    // The indicator and the draft mirror observe the save; nothing below
    // changes the retry, keepalive or 409 behaviour of the path itself.
    setSaveStatus("saving");
    if (attempt === 0) draftRef.current.write({ title: titleRef.current, bnDoc: nextBnDoc, blocks: nextBlocks, meta: nextMeta });
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
        // keepalive (first attempt only) lets a save-on-nav complete across the
        // unload. If the body exceeds the 64KB keepalive cap the fetch rejects →
        // caught below → retried WITHOUT keepalive (attempt>0), so large pasted
        // notes still save.
        keepalive: attempt === 0,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleRef.current.trim() || "Untitled doc",
          content,
          excerpt: text || null,
          knownUpdatedAt: lastUpdatedAtRef.current,
        }),
      });
      if (res.status === 409) {
        // Somebody else committed a version while this one was being typed.
        // Every save of ours updates lastUpdatedAtRef and only one is ever in
        // flight, so a 409 here is always a real peer, never our own stale
        // timestamp. It is NOT re-sent: re-sending is what silently destroyed
        // the peer's version. Hold the writes, raise the strip, keep the draft.
        try {
          const fresh = await fetch(`/api/docs/${docId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          const live = fresh?.doc?.updatedAt ?? fresh?.updatedAt ?? null;
          if (live) { lastUpdatedAtRef.current = live; setServerUpdatedAt(live); }
        } catch { /* the strip does not need the timestamp to be right */ }
        conflictHoldRef.current = onConflict();
        setConflict(true);
        setSaveStatus("dirty");
        // The header's Retry is the same deliberate "mine wins" the strip's
        // Dismiss is, so the person always has a way through.
        setSaveStuck(() => () => {
          conflictHoldRef.current = onDismissConflict();
          setConflict(false);
          void persist(nextBnDoc, nextBlocks, nextMeta, nextExcerpt, 0);
        });
        return;
      }
      if (res.status === 403) {
        // Read-only, or locked since the page loaded: retrying cannot help,
        // and the draft holds the typed text. Say so once.
        setSaveStatus("error");
        setSaveStuck(() => () => { void persist(nextBnDoc, nextBlocks, nextMeta, nextExcerpt, 0); });
        const err = await res.json().catch(() => null);
        toast(err?.message ?? "You need Can edit for that. Ask the owner.", { tone: "danger" });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      if (data?.doc?.updatedAt) { lastUpdatedAtRef.current = data.doc.updatedAt; setServerUpdatedAt(data.doc.updatedAt); }
      setSaveStatus("saved");
      setLastSavedAt(new Date());
      setSaveStuck(null);
      draftRef.current.clear();
      const savedTitle = titleRef.current.trim() || "Untitled doc";
      if (savedTitle !== lastSyncedTitleRef.current) {
        lastSyncedTitleRef.current = savedTitle;
        refreshSidebar();
      }
    } catch {
      // Network failure or a >64KB keepalive rejection — retry with backoff
      // (dropping keepalive won't matter for in-editor autosaves) so a
      // transient failure never silently loses the edit. Mandate: never drop.
      setSaveStatus("error");
      if (attempt < 3) {
        setTimeout(() => { void persist(nextBnDoc, nextBlocks, nextMeta, nextExcerpt, attempt + 1); }, 800 * Math.pow(2, attempt));
      } else {
        const retry = () => { void persist(nextBnDoc, nextBlocks, nextMeta, nextExcerpt, 0); };
        setSaveStuck(() => retry);
        toast("Not saved. Check your connection and keep this tab open.", { tone: "danger", action: { label: "Retry", onClick: retry } });
      }
    }
    finally {
      saveInFlightRef.current = false;
      // Drain a coalesced pending save with the now-fresh updatedAt.
      const queued = pendingPersistRef.current;
      pendingPersistRef.current = null;
      if (queued) void persist(queued.bnDoc, queued.blocks, queued.meta, queued.excerpt);
    }
  }, [docId, toast]);

  // The updatedAt check that feeds the conflict strip (spec-docs-knowledge
  // section 2, Realtime): every 30 s while the tab is visible, a read of the
  // row's updatedAt; when it has moved past what this tab last saw and no
  // save of ours is in flight, someone else saved. It never writes.
  useEffect(() => {
    if (pane !== "primary" || !doc) return;
    const iv = setInterval(async () => {
      if (document.visibilityState !== "visible" || saveInFlightRef.current || !lastUpdatedAtRef.current) return;
      const r = await apiFetch<{ doc?: { updatedAt?: string } }>(`/api/docs/${docId}`, { cache: "no-store" });
      if (!r.ok) return;
      const live = r.data.doc?.updatedAt;
      if (live && lastUpdatedAtRef.current && new Date(live).getTime() > new Date(lastUpdatedAtRef.current).getTime()) {
        setConflict(true);
      }
    }, 30_000);
    return () => clearInterval(iv);
  }, [docId, pane, doc]);

  // Lock page (change request A4): POST /api/docs/[id]/lock, Full access
  // only. Unlocking also clears the legacy content flag so a doc locked the
  // old way opens again for everyone the server allows.
  async function toggleLock() {
    const next = !lock;
    const r = await apiFetch<{ lockedById: string | null; lockedAt: string | null }>(`/api/docs/${docId}/lock`, { method: "POST", json: { locked: next } });
    if (!r.ok) { toast(r.error || "Couldn't change the lock", { tone: "danger" }); return; }
    setLock(next ? { byId: r.data.lockedById ?? (me?.id ?? ""), byName: me ? [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email || null : null, at: r.data.lockedAt } : null);
    if (!next && meta.locked) void saveMeta({ locked: undefined });
    toast(next ? "Page locked" : "Page unlocked");
  }

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
    titleRef.current = next; // so the coalesced persist() below sends the fresh title
    if (titleTimer.current) clearTimeout(titleTimer.current);
    // Route the title save through the SAME persist() writer as the body, so
    // the two can never issue concurrent PUTs racing the same knownUpdatedAt
    // (the old independent title PUT is what silently 409-dropped note bodies).
    titleTimer.current = setTimeout(() => {
      void persist(bnDocRef.current, blocksRef.current ?? [], metaRef.current);
    }, 700);
  }

  // A rename made from this doc's row somewhere else on screen (its Work tree
  // row, a Docs sidebar row, a list row) arrives HERE instead of as a PUT
  // behind this editor's back (lib/doc-title-handoff.ts has the whole why).
  // The title input, the crumb and titleRef take the new name at once, so no
  // later save or a conflict's Dismiss can send the old one. An editor that
  // can write saves it through persist(), with its own updatedAt; one that
  // cannot (view-only, or holding a real peer's conflict) answers false and
  // the menu saves the title-only PUT itself, as it always did.
  const docLoaded = doc !== null;
  useEffect(() => {
    if (!docLoaded) return;
    return registerDocTitleWriter(docId, async (next) => {
      setTitle(next);
      titleRef.current = next;
      if (myRoleRef.current !== "edit" || !canSend(conflictHoldRef.current)) return false;
      if (titleTimer.current) { clearTimeout(titleTimer.current); titleTimer.current = null; }
      await persist(bnDocRef.current, blocksRef.current ?? [], metaRef.current);
      // A 409 inside that save raised the hold: the peer's version won, the
      // new title is only in this editor, and the menu must not toast
      // "Renamed" over a server that kept the other person's title.
      return canSend(conflictHoldRef.current) ? true : "conflict";
    });
  }, [docId, docLoaded, persist]);

  function convertLegacy() {
    if (!legacy) return;
    const converted = htmlToBlocks(legacy);
    setBlocks(converted);
    setLegacy(null);
    void saveBlocks(converted);
    toast("Converted to blocks — old content preserved as paragraphs");
  }

  function copyLink() {
    // The share form: the Work door from Work (never a Space's slug), the
    // canonical /docs/<id> elsewhere.
    const url = copyObjectLink("doc", docId);
    navigator.clipboard.writeText(url).then(() => toast("Link copied"));
  }

  // Create a child page under this doc and jump into it. Chrome-only: the
  // canvas flushes any pending debounced save on unmount and persist() uses
  // keepalive, so navigating away mid-edit is already safe.
  async function addSubpage() {
    const id = await createChildPage(docId);
    // ?new=1 → the destination editor focuses the title so the natural next
    // action is NAMING the page, not clicking Add subpage again (which
    // nested a child-of-a-child on every click).
    if (id) router.push(`${objectHrefNow("doc", id, place?.spaceSlug)}?new=1`);
    else toast("Couldn't create page");
  }

  // The doc page chords (spec-docs-knowledge section 2, Keyboard): cmd L copy
  // link, cmd D duplicate, cmd S save now, cmd shift C comments, cmd shift A
  // Ask AI. cmd 1..9 no longer switch doc tabs; the hubs own G 1..8.
  useEffect(() => {
    if (pane !== "primary") return;
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "l" && !e.shiftKey) { e.preventDefault(); copyLink(); }
      else if (k === "s" && !e.shiftKey) { e.preventDefault(); if (myRoleRef.current === "edit") void persist(bnDocRef.current, blocksRef.current ?? [], metaRef.current); }
      else if (k === "d" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void (async () => {
          const r = await apiFetch<{ doc?: { id: string } }>(`/api/docs/${docId}/duplicate`, { method: "POST" });
          if (r.ok && r.data.doc?.id) router.push(objectHrefNow("doc", r.data.doc.id, place?.spaceSlug)); else toast("Couldn't duplicate", { tone: "danger" });
        })();
      }
      else if (k === "c" && e.shiftKey) { e.preventDefault(); setCommentOpen(true); }
      else if (k === "a" && e.shiftKey && aiOn) { e.preventDefault(); setPanel((p) => (p?.kind === "ask" ? null : { kind: "ask" })); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane, docId, aiOn]);

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
    if (!(await confirm({ title: "Extract table with AI", description: "Use AI to extract a table from this doc? A new table will be created in your org.", confirmLabel: "Extract" }))) return;
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
      router.push(objectHrefNow("table", r.tableId));
    } catch { toast("Extract failed"); }
    finally { setExtracting(false); }
  }

  // The BackButton target (spec-docs-knowledge section 1, Back / close):
  // /docs/[parentId] for a sub-doc, else the anchor page for an anchored
  // doc, else /docs. The label is the parent's name.
  // In Work it is the Work crumb's (the nearest crumb left of the doc).
  const backTarget = inWork && place
    ? place.back
    : parentDoc
      ? { href: `/docs/${parentDoc.id}`, label: parentDoc.title || "Untitled doc" }
      : location?.href
        ? { href: location.href, label: location.name }
        : { href: "/docs", label: "Docs" };
  // Where the load-error and trashed states lead: the Work crumb in Work;
  // Work's landing when the editor is embedded in a Work page (a List's doc
  // view) so it never ejects to Docs; the Docs list elsewhere.
  const exitBack = inWork && place
    ? place.back
    : hubBack.hub === "home"
      ? { href: hubBack.fallbackHref, label: hubBack.label }
      : { href: "/docs", label: "Docs" };

  if (loadError) {
    return (
      <div className="os-chrome mx-auto flex max-w-md flex-col items-center gap-3 px-6 pt-16 text-center">
        <p className="text-row text-ink-2">Couldn&apos;t open this doc</p>
        <button type="button" onClick={() => window.location.reload()} className="text-base font-medium text-brand-deep hover:underline">Retry</button>
        <BackButton fallbackHref={exitBack.href} label={exitBack.label} />
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="os-prose-col os-chrome flex flex-col gap-3 px-6 pt-10" aria-busy="true" aria-label="Loading">
        <span className="h-6 w-[60%] rounded bg-skeleton os-skeleton-pulse" />
        {["80%", "60%", "40%", "80%", "60%", "70%"].map((w, i) => <span key={i} className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />)}
      </div>
    );
  }

  // Trashed docs never render their content — stale sub-page links used to
  // open deleted pages as if nothing happened. Offer restore or a way out.
  if (doc.archivedAt) {
    return (
      <div className="os-chrome flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <Trash2 className="h-8 w-8 text-ink-3" strokeWidth={1.5} aria-hidden />
        <p className="text-row font-medium text-ink">This doc is in the Trash</p>
        <p className="max-w-sm text-base leading-snug text-ink-2">
          &ldquo;{doc.title || "Untitled doc"}&rdquo; was moved to Trash. Restore it to keep editing.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={restoring}
            onClick={async () => {
              setRestoring(true);
              try {
                const res = await fetch(`/api/docs/${docId}/restore`, { method: "POST" });
                if (!res.ok) throw new Error();
                notifyDocsChanged();
                window.location.reload();
              } catch {
                toast("Couldn't restore the page");
                setRestoring(false);
              }
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {restoring ? <Dots variant="pending" /> : null}
            Restore
          </button>
          <BackButton fallbackHref={exitBack.href} label={exitBack.label} />
        </div>
      </div>
    );
  }

  const hasCover = !!(meta.coverUrl || meta.coverGradient);
  const coverStyle: React.CSSProperties = meta.coverUrl
    ? { backgroundImage: `url(${meta.coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: gradientCSS(meta.coverGradient) };

  return (
    <>
    {/* The bar's location row (spec-shell 2.1): "Docs › {anchor or parent
        doc} › {title}"; anchored docs read "Work › {Space} › {doc}" through
        the anchor's own href. The last crumb is the title, not clickable. */}
    {pane === "primary" && !inWork ? (
      <Breadcrumb
        items={[
          // The bar prepends the hub crumb ("Docs") itself, so this declares
          // only what comes after it: the anchor or the parent doc, then the
          // title. A "Docs" crumb here read as "Docs > Docs > {title}".
          ...(location?.href
            ? [{ label: location.name, href: location.href }]
            : parentDoc
              ? [{ label: parentDoc.title || "Untitled doc", href: `/docs/${parentDoc.id}` }]
              : []),
          { label: title || "Untitled doc" },
        ]}
      />
    ) : null}
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
      <header className="bdoc__head os-chrome">
        {/* Title row (design-system 4.4, doc pages): BackButton + the
            AutosaveIndicator at the left; Ask AI, Share or the role chip,
            Comments and the bordered "..." at the right. Peek panes keep the
            indicator only; DocSplitView owns their header. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {pane !== "peek" ? <BackButton fallbackHref={backTarget.href} label={backTarget.label} /> : null}
          <AutosaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} onRetry={saveStuck ?? undefined} />
        </div>

        <div className="bdoc__head-actions">
          {pane !== "peek" && aiOn ? (
            <button
              type="button"
              onClick={() => setPanel(panel?.kind === "ask" ? null : { kind: "ask" })}
              title="Ask AI (⌘⇧A)"
              aria-pressed={panel?.kind === "ask"}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Ask AI
            </button>
          ) : null}
          {pane !== "peek" ? (
            <span ref={shareBtnRef as React.RefObject<HTMLSpanElement | null>} className="inline-flex">
              <ShareOrRoleChip role={canManage ? "FULL" : myRole === "view" ? "VIEW" : myRole === "comment" ? "COMMENT" : "EDIT"} onOpen={() => setShareOpen(true)} />
            </span>
          ) : null}
          <DocShareModal
            docId={docId}
            docTitle={title || "Untitled doc"}
            createdById={doc.createdById ?? null}
            meId={me?.id ?? null}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            anchorRef={shareBtnRef}
            // The modal writes the member map only for Full access, the same
            // rule the chip above renders (Can edit shares only under toggle
            // 4, which no surface reads yet); everyone else gets it read-only.
            viewerRole={canManage ? "edit" : "view"}
          />
          <button
            type="button"
            onClick={() => setCommentOpen(true)}
            title="Comments (⌘⇧C)"
            aria-label="Comments"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
          <button
            ref={moreBtnRef}
            type="button"
            onClick={() => setMoreOpen((m) => !m)}
            title="More"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label="More"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-line-strong text-ink-2 hover:bg-hover hover:text-ink ${moreOpen ? "bg-active text-ink" : ""}`}
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
          <MorePortal anchorRef={moreBtnRef} panelRef={morePanelRef} width={260} open={moreOpen} placement="below">
            <DocRowMenu
              doc={{ id: docId, title, parentId: doc.parentId ?? null, entityType: doc.entityType ?? null, entityId: doc.entityId ?? null, favorite: !!favorited, role: canManage ? "full" : myRole, own: !!doc.createdById && doc.createdById === me?.id, spaceSlug: place?.spaceSlug ?? null }}
              context="editor"
              onClose={() => setMoreOpen(false)}
              // A Move in Work refreshes the route: the gate re-places the doc
              // (new crumb, new tree branch) and this editor stays mounted. In
              // the Docs hub it reloads, as it always did; a rename reloads in both.
              onChanged={(kind) => {
                if (kind === "favorited") setFavorited((f) => !(f ?? false));
                if (kind === "moved" && inWork) router.refresh();
                else if (kind === "renamed" || kind === "moved") window.location.reload();
              }}
              onShare={() => setShareOpen(true)}
              onRenameInline={() => { titleInputRef.current?.focus(); titleInputRef.current?.select(); }}
              extraRows={
                <>
                  <MenuItem icon={ClipboardCopy} label="Copy page contents" onClick={() => { setMoreOpen(false); void copyContents(); }} />
                  {pane !== "peek" ? <MenuItem icon={PanelRightOpen} label="Open another doc beside" onClick={() => { setMoreOpen(false); setPeekPickerOpen(true); }} /> : null}
                  <MenuItem icon={ListTree} label="Show outline" selected={outlineOpen} onClick={() => { setOutlineOpen(!outlineOpen); }} />
                  <MenuItem icon={BookOpen} label="Reading mode" selected={readingMode} onClick={() => { setMoreOpen(false); setReadingMode((r) => !r); }} />
                  <MenuSeparator />
                  {myRole === "edit" ? (
                    <MenuSubmenu icon={TypeIcon} label="Page options" width={220}>
                      <MenuItem label="System" leading={<span className="w-4 text-center text-xs font-medium text-ink-2">Aa</span>} selected={(meta.font ?? "default") === "default"} onClick={() => void saveMeta({ font: "default" })} />
                      <MenuItem label="Serif" leading={<span className="w-4 text-center font-serif text-xs font-medium text-ink-2">Ss</span>} selected={meta.font === "serif"} onClick={() => void saveMeta({ font: "serif" })} />
                      <MenuItem label="Mono" leading={<span className="w-4 text-center font-mono text-xs font-medium text-ink-2">00</span>} selected={meta.font === "mono"} onClick={() => void saveMeta({ font: "mono" })} />
                      <MenuSeparator />
                      <MenuItem icon={TypeIcon} label="Small text" selected={!!meta.smallText} onClick={() => void saveMeta({ smallText: !meta.smallText })} />
                      <MenuItem icon={MoveHorizontal} label="Full width" selected={!!meta.fullWidth} onClick={() => void saveMeta({ fullWidth: !meta.fullWidth })} />
                      {canManage ? <MenuItem icon={Lock} label="Lock page" selected={!!lock || !!meta.locked} onClick={() => { setMoreOpen(false); void toggleLock(); }} /> : null}
                    </MenuSubmenu>
                  ) : null}
                  {!viewer.isAgent && viewer.orgRole !== "GUEST" ? <MenuItem icon={Download} label="Export as Markdown" onClick={() => { setMoreOpen(false); window.location.href = `/api/docs/${docId}/export?format=md`; }} /> : null}
                  {/* Version history is FULL and EDIT only (spec-docs-knowledge section 2, /docs/[id]); a Can comment or Can view holder never sees the row. */}
                  {myRole === "edit" ? <MenuItem icon={History} label="Version history" onClick={() => { setMoreOpen(false); setPanel({ kind: "history" }); }} /> : null}
                </>
              }
            />
          </MorePortal>

          {/* "Open another doc beside": the picker the menu row opens. */}
          {pane !== "peek" && peekPickerOpen && (
            <div className="bdoc__peek-wrap">
              <div className="bdoc__peek-picker" role="dialog" aria-label="Pick a doc to open beside this one">
                <div className="bdoc__peek-search">
                  <Search />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search docs"
                    value={peekQuery}
                    onChange={(e) => setPeekQuery(e.target.value)}
                  />
                </div>
                <div className="bdoc__peek-list">
                  {peekDocs === null ? (
                    <div className="flex flex-col gap-2 px-3 py-2" aria-busy="true" aria-label="Loading">{["70%", "50%", "60%"].map((w, i) => <span key={i} className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />)}</div>
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
                        <span className="bdoc__peek-title">{d.title || "Untitled doc"}</span>
                      </button>
                    ));
                  })()}
                </div>
                {searchParams.get("peek") && (
                  <button
                    type="button"
                    className="bdoc__peek-close-current"
                    onClick={() => { setPeekPickerOpen(false); router.push(selfPath); }}
                  >
                    <X /> Close the pane
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Read-only (access 5.4) and the lock (change request A4): one slim
          strip under the title row instead of a silently read-only editor. */}
      {pane !== "peek" && lock && !canManage ? (
        <ReadOnlyBanner message={`Locked by ${lock.byName ?? "someone"}. Ask them to unlock.`} />
      ) : pane !== "peek" && lock && canManage ? (
        <ReadOnlyBanner message={`Locked by ${lock.byId === me?.id ? "you" : lock.byName ?? "someone"}. Everyone else can read and comment.`} onRequest={() => void toggleLock()} requestLabel="Unlock" />
      ) : pane !== "peek" && myRole === "view" ? (
        <ReadOnlyBanner ownerName={owner?.name} onRequest={() => setShareOpen(true)} />
      ) : null}
      {conflict ? (
        <ConflictStrip
          noun="doc"
          onReload={() => window.location.reload()}
          onDismiss={() => {
            // "I have read it, keep going": writes resume and this version
            // wins from here. Their version is still in the doc's history.
            conflictHoldRef.current = onDismissConflict();
            setConflict(false);
            setSaveStuck(null);
            void persist(bnDocRef.current, blocksRef.current ?? [], metaRef.current);
          }}
        />
      ) : null}
      {myRole === "edit" ? (
        <DraftRestoreStrip
          draft={draft}
          onRestore={(p) => {
            setTitle(p.title);
            titleRef.current = p.title;
            setBlocks(p.blocks);
            setBnDoc(p.bnDoc);
            setMeta(p.meta);
            setRestoreNonce((n) => n + 1);
            void persist(p.bnDoc, p.blocks, p.meta);
          }}
        />
      ) : null}

      {/* Content column. The page tree lives in the docs sidebar now
          (Notion-style); the editor keeps only breadcrumbs + Add subpage. */}
      <div className="flex items-start">
      <div className="flex-1 min-w-0" ref={contentColRef}>

      {/* Cover. The picker is a SIBLING of the clipped cover (not a child):
          .bdoc__cover has overflow:hidden + a fixed height, so a picker inside
          it gets clipped and stuck behind the image. The wrapper is the
          positioning context; the picker floats above everything. */}
      {hasCover && (
        <div className="bdoc__cover-wrap">
          <div className="bdoc__cover" style={coverStyle}>
            <button
              type="button"
              className="bdoc__cover-edit"
              onClick={() => setCoverOpen((s) => !s)}
            >
              <ImagePlus /> Change cover
            </button>
          </div>
          {coverOpen && (
            <>
              <div className="bdoc__cover-scrim" onClick={() => setCoverOpen(false)} aria-hidden="true" />
              <div className="bdoc__cover-pop-anchor">
                <CoverPicker
                  meta={meta}
                  onPick={(patch) => { void saveMeta(patch); setCoverOpen(false); }}
                  onClear={() => { void saveMeta({ coverUrl: undefined, coverGradient: undefined }); setCoverOpen(false); }}
                />
              </div>
            </>
          )}
        </div>
      )}

      <div className={`bdoc__page os-prose-col ${hasCover ? "has-cover" : ""} ${meta.icon ? "has-icon" : ""}`}>
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
          ref={titleInputRef}
          className="bdoc__title text-xl! font-semibold! leading-7! pt-1! pb-1!"
          value={title}
          onChange={(e) => saveTitle(e.target.value)}
          placeholder="Untitled doc"
          readOnly={readingMode || !!meta.locked || myRole !== "edit"}
        />

        {blocks && <DocMetaStrip blocks={blocks} doc={doc} ownerName={owner?.name ?? null} />}

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
              <span>This doc is in the old rich-text format.</span>
              <button type="button" onClick={convertLegacy}>Convert to blocks</button>
            </div>
            <div className="bdoc__legacy-body" dangerouslySetInnerHTML={{ __html: legacy }} />
          </div>
        ) : blocks === null ? (
          <div className="flex flex-col gap-3 py-4" aria-busy="true" aria-label="Loading">{["80%", "60%", "40%"].map((w, i) => <span key={i} className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />)}</div>
        ) : (
          // Key by docId + reading-mode + restoreNonce so the editor
          // force-remounts on doc switch, reading-mode toggle, or version
          // restore — never holds a stale in-memory document.
          <div className="os-prose">
            <BlockNoteCanvas
              key={`${docId}:${readingMode ? "r" : "e"}:${meta.locked ? "l" : "u"}:${myRole}:${restoreNonce}`}
              initialBnDoc={bnDoc}
              legacyBlocks={blocks}
              readonly={readingMode || !!meta.locked || myRole !== "edit"}
              onChange={handleEditorChange}
              docId={docId}
              onComment={(blockId) => setPanel({ kind: "comments", blockId })}
              onAskAI={() => setPanel({ kind: "ask" })}
            />
          </div>
        )}

        {/* Empty-doc hint row (ClickUp parity) — shown until the first real
            edit; both chips are backed (Ask panel / child-page create). It
            disappears automatically because `blocks` mirrors the canvas. */}
        {pane === "primary" && !readingMode && !meta.locked && myRole === "edit" && legacy === null && blocks !== null &&
          (blocks.length === 0 ||
            (blocks.length === 1 && blocks[0].kind === "paragraph" && !(blocks[0] as { text: string }).text.trim())) && (
          <div
            // Just the Ask chip — the editor placeholder already says
            // "type / for commands" (no duplicate line), and Add subpage
            // lives in the header; keeping it here invited accidental
            // child-of-child chains on every fresh page.
            className="mt-1 flex flex-wrap items-center gap-1.5"
          >
            {aiOn ? (
              <button
                type="button"
                onClick={() => setPanel({ kind: "ask" })}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
              >
                <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Help me write
              </button>
            ) : null}
          </div>
        )}

        {pane === "primary" ? (
          <SubDocsList
            rows={tree.childrenOf(docId)}
            canEdit={myRole === "edit" && !readingMode}
            onNew={() => void addSubpage()}
            fmt={fmt}
            spaceSlug={place?.spaceSlug ?? null}
          />
        ) : null}

        <BacklinksPanel kind="doc" id={docId} />
      </div>
      </div>
      </div>

      {/* Outline rail only when no slide-over panel is open and not in
          reading mode — keeps the right edge calm. */}
      {outlineOpen && blocks && blocks.length > 0 && !readingMode && panel === null && (
        <OutlineRail blocks={blocks} onClose={() => setOutlineOpen(false)} />
      )}
      {panel?.kind === "ask" && (
        <AskDocPanel
          docId={docId}
          docTitle={title}
          onClose={() => setPanel(null)}
          quick={{
            summarize: { label: summary ? "Re-summarize this doc" : "Summarize this doc", busy: summarizing, onClick: () => void summarize() },
            extract: { label: "Extract a table", busy: extracting, onClick: () => void extractTable() },
          }}
        />
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
  const confirm = useConfirm();
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

  async function attachFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) { toast("Upload failed"); return; }
      const d = await res.json();
      // Images linkify into inline thumbnails; other files post as a link.
      if (d.url) setDraft((prev) => (prev ? `${prev} ${d.url}` : d.url));
      inputRef.current?.focus();
    } catch { toast("Upload failed"); }
    finally { setUploading(false); }
  }

  async function deleteComment(id: string) {
    if (!(await confirm({ title: "Delete comment", description: "Delete this comment?", destructive: true, confirmLabel: "Delete" }))) return;
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
          <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachFile(f); }} />
          <button type="button" title="Attach file" aria-label="Attach file" disabled={!me || uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Dots variant="pending" /> : <Paperclip />}
          </button>
          <button type="button" title="Mention" aria-label="Mention" disabled={!me} onClick={() => { setDraft((p) => `${p}@`); inputRef.current?.focus(); }}>
            <AtSign />
          </button>
          <button type="button" className="bdoc__pcmts-send" title="Comment" aria-label="Send comment" disabled={!me || busy || !draft.trim()} onClick={() => void post()}>
            {busy ? <Dots variant="pending" /> : <ArrowUp />}
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

// ───────── Meta line: "{owner} · Updated {smart date} · {n} words" ─────────
//
// The word count is a button: it opens the small stats popover (words,
// characters, read time) that used to live in a floating pill at the bottom
// of the page. One count on the page, not two, and the toast corner stays
// free (design-system 5.7).
function DocMetaStrip({ blocks, doc, ownerName }: { blocks: Block[]; doc: DocPayload; ownerName: string | null }) {
  const fmt = useFormat();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const stats = useMemo(() => {
    let words = 0;
    let chars = 0;
    for (const b of blocks) {
      if (!("text" in b)) continue;
      const plain = (b as { text: string }).text.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
      words += plain.split(/\s+/).filter(Boolean).length;
      chars += plain.replace(/\s+/g, " ").trim().length;
    }
    const minutes = Math.max(1, Math.round(words / 220));
    return { words, chars, minutes };
  }, [blocks]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="bdoc__meta mb-6!">
      {ownerName ? <><span>{ownerName}</span><span className="bdoc__meta-sep" aria-hidden>·</span></> : null}
      <span title={fmt.title(doc.updatedAt)}>Updated {fmt.date(doc.updatedAt)}</span>
      <span className="bdoc__meta-sep" aria-hidden>·</span>
      <span ref={wrapRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="true"
          title="Doc stats"
          className="inline-flex items-center gap-1 rounded-md hover:text-ink"
        >
          {fmt.count(stats.words)} word{stats.words === 1 ? "" : "s"}
          <ChevronUp className={`h-3 w-3 transition-transform ${open ? "" : "rotate-180"}`} aria-hidden />
        </button>
        {open && (
          <div className="absolute start-0 top-full z-30 mt-1.5">
            <MenuList className="w-[200px]">
              <div className="flex items-center justify-between px-3 py-1.5 text-sm text-ink-2">
                <span>Words</span><span>{fmt.count(stats.words)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5 text-sm text-ink-2">
                <span>Characters</span><span>{fmt.count(stats.chars)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5 text-sm text-ink-2">
                <span>Read time</span><span>{stats.minutes} min</span>
              </div>
            </MenuList>
          </div>
        )}
      </span>
    </div>
  );
}

// ───────── "Docs inside": the sub-docs list under the body ─────────
function SubDocsList({ rows, canEdit, onNew, fmt, spaceSlug }: { rows: { id: string; title: string; emoji: string | null; updatedAt: string }[]; canEdit: boolean; onNew: () => void; fmt: ReturnType<typeof useFormat>; spaceSlug: string | null }) {
  // A sub-page opens in the section this doc is in (its parent's Space in Work).
  const { href } = useObjectHref();
  if (rows.length === 0 && !canEdit) return null;
  return (
    <section className="os-chrome mt-8" aria-label="Docs inside">
      {rows.length > 0 ? <h2 className="mb-1 text-lg font-semibold text-ink">Docs inside</h2> : null}
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={href("doc", r.id, spaceSlug)} className="flex h-9 items-center gap-3 rounded-md px-2 text-row text-ink hover:bg-hover">
              <span className="grid h-5 w-5 shrink-0 place-items-center [&_svg]:h-4 [&_svg]:w-4">{r.emoji ? renderNoteIcon(r.emoji) : <EntityTile size="sm" name={r.title} fallback="doc" />}</span>
              <span className="min-w-0 flex-1 truncate">{r.title || "Untitled doc"}</span>
              {r.updatedAt ? <span className="shrink-0 text-xs text-ink-2" title={fmt.title(r.updatedAt)}>{fmt.date(r.updatedAt)}</span> : null}
            </Link>
          </li>
        ))}
        {canEdit ? (
          <li>
            <button type="button" onClick={onNew} className="flex h-9 items-center gap-2 rounded-md px-2 text-row text-ink-2 hover:bg-hover hover:text-ink">
              <FilePlus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> New doc inside
            </button>
          </li>
        ) : null}
      </ul>
    </section>
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

  const scrollTo = (id: string, text?: string) => {
    // data-id first; fall back to matching the heading's TEXT among rendered
    // heading blocks — the mirror's ids can drift from the DOM after
    // conversions, and a stale id used to land the scroll on the wrong
    // section entirely.
    let el = document.querySelector(`[data-id="${id}"]`);
    if (!el && text) {
      const target = text.trim();
      el = Array.from(document.querySelectorAll('[data-content-type="heading"]'))
        .find((h) => (h.textContent ?? "").trim() === target) ?? null;
    }
    if (!el) return;
    // The clicked entry is the truth for the highlight — don't let the
    // scroll-spy flicker through intermediate sections mid-scroll.
    setActiveId(id);
    // scroll-margin keeps the heading below the sticky chrome instead of
    // vanishing under it (which read as "it jumped to the next section").
    (el as HTMLElement).style.scrollMarginTop = "96px";
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Smooth scrolls drift when content shifts mid-flight — verify the
    // landing once settled and correct in one instant hop if needed.
    const check = () => {
      const rect = el!.getBoundingClientRect();
      if (rect.top < 40 || rect.top > 200) el!.scrollIntoView({ behavior: "auto", block: "start" });
      setActiveId(id);
    };
    window.setTimeout(check, 450);
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
            onClick={() => scrollTo(h.id, h.text)}
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

function AskDocPanel({ docId, docTitle, onClose, quick }: {
  docId: string;
  docTitle: string;
  onClose: () => void;
  /** The three quick actions as 36px rows above the thread (design-system 4.5 Ask AI). */
  quick?: { summarize: { label: string; busy: boolean; onClick: () => void }; extract: { label: string; busy: boolean; onClick: () => void } };
}) {
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
          <h2>Ask AI</h2>
          <p>About &ldquo;{docTitle || "Untitled doc"}&rdquo;</p>
        </div>
        <button type="button" className="bdoc__ask-x" onClick={onClose} aria-label="Close"><X /></button>
      </header>
      {quick ? (
        <div className="os-chrome flex flex-col border-b border-line px-2 py-1">
          <button type="button" onClick={quick.summarize.onClick} disabled={quick.summarize.busy} className="flex h-9 items-center gap-2 rounded-md px-2 text-base text-ink hover:bg-hover disabled:opacity-60">
            {quick.summarize.busy ? <Dots variant="pending" /> : <Sparkles className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />} {quick.summarize.label}
          </button>
          <button type="button" onClick={quick.extract.onClick} disabled={quick.extract.busy} className="flex h-9 items-center gap-2 rounded-md px-2 text-base text-ink hover:bg-hover disabled:opacity-60">
            {quick.extract.busy ? <Dots variant="pending" /> : <Sparkles className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />} {quick.extract.label}
          </button>
        </div>
      ) : null}
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
            <Dots variant="pending" /> Reading the note…
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
          {running ? <Dots variant="pending" /> : <Send />}
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
  const confirm = useConfirm();
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
    if (!(await confirm({ title: "Delete comment", description: "Delete this comment?", destructive: true, confirmLabel: "Delete" }))) return;
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
          placeholder={me ? `Comment as ${meName}…` : "Add a comment…"}
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
          {busy ? <Dots variant="pending" /> : <Send />}
        </button>
      </form>
    </aside>
  );
}

function relTimeShort(iso: string): string {
  return formatRelative(iso);
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
  const fmt = useFormat();
  const confirm = useConfirm();
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
    if (!(await confirm({ title: "Restore version", description: "Restore this version? Your current content will be saved as a new version, and the restored version will become the live content.", confirmLabel: "Restore" }))) return;
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
            <div className="bdoc__hist-loading"><SkeletonLines lines={3} /></div>
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
                      {v.authorName ?? "Unknown"} · <span title={fmt.title(v.createdAt)}>{fmt.date(v.createdAt, "datetime")}</span>
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
            <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading">{["60%", "90%", "75%", "80%"].map((w, i) => <span key={i} className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />)}</div>
          ) : preview.blocks ? (
            <>
              <div className="bdoc__hist-preview-title">{preview.title || "Untitled"}</div>
              <div className="bdoc__hist-preview-body">
                <BlockNoteCanvas initialBnDoc={null} legacyBlocks={preview.blocks} readonly onChange={() => {}} />
              </div>
              <footer className="bdoc__hist-foot">
                <button type="button" className="bdoc__hist-restore" onClick={restore} disabled={restoring}>
                  {restoring ? <Dots variant="pending" /> : <RotateCcw />}
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
  // Each reference opens in the section this page is in.
  const { href } = useObjectHref();
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
          <Link key={`d:${h.id}`} href={href("doc", h.id)} className="bdoc__backlink">
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
          <Link key={`s:${h.id}`} href={href("sop", h.id)} className="bdoc__backlink">
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
        {uploading ? <><Dots variant="pending" /> Uploading…</> : <><ImagePlus /> Upload from device</>}
      </div>

      {/* The eight pale washes (design-system 1.7). */}
      <div className="bdoc__cover-sec">Colours</div>
      <div className="bdoc__cover-grid">
        {COVER_HUES.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`bdoc__cover-cell ${gradientCSS(meta.coverGradient) === g.css && !meta.coverUrl ? "is-current" : ""}`}
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
