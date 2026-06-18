"use client";

/* Block editor — Notion-grade page composer.
 *
 * A Doc's content is `{ blocks: Block[] }`. Each block is a focused
 * unit (heading, paragraph, list, todo, code, embed, file …). Editing
 * is contentEditable but uncontrolled: text is written once on mount,
 * then user input flows DOM → state via onInput. The DOM is only
 * re-synced when the block's kind changes (via key={id+kind} remount),
 * which is why typing is jitter-free.
 *
 * Features:
 *   - Slash menu (type `/` in any text block) with filter + arrows
 *   - Drag handle to reorder (HTML5 native DnD with drop indicator)
 *   - Markdown shortcuts: # ## ### / - * / 1. / [] / > / ``` / ---
 *   - Smart Enter / Backspace / ArrowUp / ArrowDown
 *   - Bullet / numbered / quote / code blocks
 *   - Per-row action menu (turn-into, duplicate, delete, copy link)
 *
 * Legacy `{ html }` docs render in read-only compat mode upstream.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Plus, GripVertical, Trash2, Type, Hash, Heading2, Heading3, ListChecks,
  Minus, Link2, FileText as FileIcon, AlertCircle, Sparkles, Loader2, Check,
  CheckSquare, LayoutGrid, BookCopy, CalendarClock, FormInput, ChevronRight,
  Table as TableIcon, List as ListIcon, ListOrdered, Quote, Code, Copy,
  ArrowRightLeft, ChevronDown, Wand2, AtSign, Target, User as UserIcon, X, RefreshCw,
  Bold, Italic, Strikethrough, Underline, Image as ImageIcon, Upload,
  FilePlus, Star, Highlighter, Palette, MessageCircle,
} from "lucide-react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useOsToast } from "@/components/layout/os/toast";

// ───────── Block shape ─────────
export type BlockKind =
  | "h1" | "h2" | "h3" | "paragraph"
  | "bullet" | "numbered" | "todo" | "quote" | "code"
  | "divider" | "embed" | "file" | "image" | "callout"
  | "toggle" | "ai_write" | "entity_link" | "subpage"
  | "sop_card" | "task_card" | "note_card"
  | "tasks_view" | "studio_board" | "sops_list" | "meetings_view" | "form" | "data_table";

export type EntityKind = "user" | "task" | "board" | "sop" | "kra" | "space";

export type Block =
  | { id: string; kind: "h1" | "h2" | "h3" | "paragraph" | "bullet" | "numbered" | "quote"; text: string }
  | { id: string; kind: "todo"; text: string; done: boolean }
  | { id: string; kind: "code"; text: string; lang?: string }
  | { id: string; kind: "divider" }
  | { id: string; kind: "embed"; url: string; title?: string }
  | { id: string; kind: "file"; name: string; url: string; size?: number; mimeType?: string; s3Key?: string | null }
  | { id: string; kind: "image"; url: string; alt?: string; caption?: string; width?: number; s3Key?: string | null }
  | { id: string; kind: "subpage"; childDocId: string; title: string; emoji?: string }
  | { id: string; kind: "sop_card"; sopId: string }
  | { id: string; kind: "task_card"; taskId: string }
  | { id: string; kind: "note_card"; noteId: string }
  | { id: string; kind: "callout"; text: string; tone: "info" | "warn" | "success" }
  | { id: string; kind: "toggle"; text: string; open: boolean; body: string }
  | { id: string; kind: "ai_write"; prompt: string; result: string; locked: boolean; tone: "expand" | "summarise" | "rewrite" | "actions" }
  | { id: string; kind: "entity_link"; entityKind: EntityKind; entityId: string; label: string; subtitle?: string; href?: string }
  | { id: string; kind: "tasks_view"; window: "today" | "week" | "overdue"; title?: string }
  | { id: string; kind: "studio_board"; boardId: string; boardName?: string }
  | { id: string; kind: "sops_list"; category?: string }
  | { id: string; kind: "meetings_view"; window: "upcoming" | "past" }
  | { id: string; kind: "form"; formId: string; formName?: string }
  | { id: string; kind: "data_table"; tableId: string; tableName?: string };

type ApiFile = { id: string; name: string; mimeType: string; size: number; url: string };

const TEXT_KINDS: BlockKind[] = ["paragraph", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "callout", "toggle"];
const LIST_KINDS: BlockKind[] = ["bullet", "numbered", "todo"];

function newId() { return Math.random().toString(36).slice(2, 10); }
function emptyParagraph(): Block { return { id: newId(), kind: "paragraph", text: "" }; }

function getBlockText(b: Block): string {
  if ("text" in b) return b.text;
  return "";
}

// Serialize blocks to light-markdown plaintext for copy/cut of a whole-doc
// selection. Strips inline formatting tags; keeps structural prefixes so a
// pasted copy reads like the original outline.
function serializeBlocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      const t = getBlockText(b).replace(/<[^>]+>/g, "").trim();
      switch (b.kind) {
        case "h1": return `# ${t}`;
        case "h2": return `## ${t}`;
        case "h3": return `### ${t}`;
        case "bullet": return `- ${t}`;
        case "numbered": return `1. ${t}`;
        case "quote": return `> ${t}`;
        case "todo": return `- [ ] ${t}`;
        case "divider": return "---";
        default: return t;
      }
    })
    .join("\n");
}

// Build a new block of the requested kind, optionally seeded with text.
function buildBlock(kind: BlockKind, text = ""): Block {
  switch (kind) {
    case "h1": case "h2": case "h3":
    case "paragraph": case "bullet": case "numbered": case "quote":
      return { id: newId(), kind, text };
    case "todo":    return { id: newId(), kind: "todo", text, done: false };
    case "code":    return { id: newId(), kind: "code", text, lang: "" };
    case "divider": return { id: newId(), kind: "divider" };
    case "callout": return { id: newId(), kind: "callout", text, tone: "info" };
    case "embed":   return { id: newId(), kind: "embed", url: "", title: "" };
    case "file":    return { id: newId(), kind: "file", name: "", url: "" };
    case "image":   return { id: newId(), kind: "image", url: "", alt: "", caption: "" };
    case "subpage": return { id: newId(), kind: "subpage", childDocId: "", title: "" };
    case "sop_card":  return { id: newId(), kind: "sop_card", sopId: "" };
    case "task_card": return { id: newId(), kind: "task_card", taskId: "" };
    case "note_card": return { id: newId(), kind: "note_card", noteId: "" };
    case "toggle":  return { id: newId(), kind: "toggle", text, open: true, body: "" };
    case "ai_write":return { id: newId(), kind: "ai_write", prompt: text, result: "", locked: false, tone: "expand" };
    case "entity_link": return { id: newId(), kind: "entity_link", entityKind: "user", entityId: "", label: "", subtitle: "" };
    case "tasks_view":    return { id: newId(), kind: "tasks_view", window: "today" };
    case "studio_board":  return { id: newId(), kind: "studio_board", boardId: "" };
    case "sops_list":     return { id: newId(), kind: "sops_list" };
    case "meetings_view": return { id: newId(), kind: "meetings_view", window: "upcoming" };
    case "form":          return { id: newId(), kind: "form", formId: "" };
    case "data_table":    return { id: newId(), kind: "data_table", tableId: "" };
  }
}

// ───────── Slash-menu catalog ─────────
type MenuGroup = "Basic" | "AI" | "Workspace" | "Embed";
type MenuItem = { kind: BlockKind; label: string; hint: string; keywords: string; Icon: React.ComponentType<{ className?: string }>; group: MenuGroup };

const MENU: MenuItem[] = [
  { kind: "paragraph", label: "Text",            hint: "Plain paragraph",      keywords: "text para plain p",     Icon: Type,       group: "Basic" },
  { kind: "h1",        label: "Heading 1",       hint: "Big section title",    keywords: "h1 heading title big",  Icon: Hash,       group: "Basic" },
  { kind: "h2",        label: "Heading 2",       hint: "Medium section title", keywords: "h2 heading",            Icon: Heading2,   group: "Basic" },
  { kind: "h3",        label: "Heading 3",       hint: "Small section title",  keywords: "h3 heading",            Icon: Heading3,   group: "Basic" },
  { kind: "bullet",    label: "Bulleted list",   hint: "• line",               keywords: "bullet ul list",        Icon: ListIcon,   group: "Basic" },
  { kind: "numbered",  label: "Numbered list",   hint: "1. line",              keywords: "numbered ol list",      Icon: ListOrdered,group: "Basic" },
  { kind: "todo",      label: "To-do",           hint: "Checkable task",       keywords: "todo task checkbox",    Icon: ListChecks, group: "Basic" },
  { kind: "quote",     label: "Quote",           hint: "Stylised pull quote",  keywords: "quote blockquote",      Icon: Quote,      group: "Basic" },
  { kind: "code",      label: "Code",            hint: "Monospaced block",     keywords: "code snippet pre",      Icon: Code,       group: "Basic" },
  { kind: "callout",   label: "Callout",         hint: "Info / warn / success",keywords: "callout note info",     Icon: AlertCircle,group: "Basic" },
  { kind: "toggle",    label: "Toggle",          hint: "Collapsible section",  keywords: "toggle collapse fold",  Icon: ChevronDown,group: "Basic" },
  { kind: "subpage",   label: "Sub-page",        hint: "A nested note",        keywords: "subpage child page sub nested wiki", Icon: FilePlus, group: "Basic" },
  { kind: "divider",   label: "Divider",         hint: "Horizontal rule",      keywords: "divider hr line break", Icon: Minus,      group: "Basic" },

  { kind: "ai_write",  label: "AI Write",        hint: "Draft text with AI",   keywords: "ai write draft assistant claude expand", Icon: Wand2, group: "AI" },

  { kind: "entity_link",   label: "Mention",     hint: "@ a person / task / KRA / SOP / board", keywords: "mention link person user task kra sop board space at", Icon: AtSign, group: "Workspace" },
  { kind: "sop_card",      label: "Embed SOP",   hint: "Pick an SOP to embed inline", keywords: "sop process procedure embed",   Icon: BookCopy,   group: "Workspace" },
  { kind: "task_card",     label: "Embed Task",  hint: "Pick a task with full detail", keywords: "task todo embed",              Icon: CheckSquare,group: "Workspace" },
  { kind: "note_card",     label: "Embed Note",  hint: "Link an existing note inline", keywords: "note doc embed link",           Icon: FileIcon,   group: "Workspace" },
  { kind: "tasks_view",    label: "Tasks view",  hint: "Today / week / overdue", keywords: "tasks",               Icon: CheckSquare,group: "Workspace" },
  { kind: "studio_board",  label: "Studio board",hint: "Live board embed",     keywords: "board studio kanban",   Icon: LayoutGrid, group: "Workspace" },
  { kind: "sops_list",     label: "SOPs",        hint: "List SOPs by category",keywords: "sop process",           Icon: BookCopy,   group: "Workspace" },
  { kind: "meetings_view", label: "Meetings",    hint: "Upcoming / past",      keywords: "meetings calendar",     Icon: CalendarClock,group: "Workspace" },
  { kind: "form",          label: "Form",        hint: "Embed a form",         keywords: "form survey",           Icon: FormInput,  group: "Workspace" },
  { kind: "data_table",    label: "Table",       hint: "Embed a data table",   keywords: "table data sheet",      Icon: TableIcon,  group: "Workspace" },

  { kind: "image",     label: "Image",           hint: "Upload or paste",      keywords: "image picture photo upload", Icon: ImageIcon, group: "Embed" },
  { kind: "embed",     label: "Embed URL",       hint: "Linkable preview",     keywords: "embed url link iframe", Icon: Link2,      group: "Embed" },
  { kind: "file",      label: "File",            hint: "Pick from your drive", keywords: "file upload attach",    Icon: FileIcon,   group: "Embed" },
];

function filterMenu(query: string): MenuItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return MENU;
  return MENU.filter((m) =>
    m.label.toLowerCase().includes(q) ||
    m.keywords.includes(q) ||
    m.kind.includes(q),
  );
}

// ───────── Markdown shortcut detection ─────────
type MdShortcut = { kind: BlockKind; remainder: string };
function detectMarkdownShortcut(text: string): MdShortcut | null {
  if (text === "# " || text.startsWith("# "))   return text === "# " ? { kind: "h1", remainder: "" } : null;
  if (text === "## ")    return { kind: "h2", remainder: "" };
  if (text === "### ")   return { kind: "h3", remainder: "" };
  if (text === "- " || text === "* ")  return { kind: "bullet", remainder: "" };
  if (text === "1. ")    return { kind: "numbered", remainder: "" };
  if (text === "[] " || text === "[ ] ") return { kind: "todo", remainder: "" };
  if (text === "> ")     return { kind: "quote", remainder: "" };
  if (text === "```" || text === "``` ") return { kind: "code", remainder: "" };
  if (text === "--- " || text === "---") return { kind: "divider", remainder: "" };
  return null;
}

// ───────── Editor ─────────
// A single comment attached to a specific block. Lives inside the doc's
// content JSON (`content.comments[blockId] = Comment[]`) so we don't
// need a separate table. Multi-author safe within the doc's autosave
// debounce — concurrent writers would still need a real model later.
export type Comment = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string | null;
  text: string;
  createdAt: string;
  resolved?: boolean;
};

export type CommentsByBlock = Record<string, Comment[]>;

export interface BlockEditorProps {
  initialBlocks: Block[] | null;
  onSave: (blocks: Block[]) => Promise<void> | void;
  readonly?: boolean;
  /** Comments keyed by block id. Each block row shows a count badge if non-empty. */
  comments?: CommentsByBlock;
  /** Called when the user clicks a block's comment badge or the menu item. */
  onOpenComments?: (blockId: string) => void;
}

export function BlockEditor({ initialBlocks, onSave, readonly = false, comments, onOpenComments }: BlockEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(() =>
    initialBlocks && initialBlocks.length > 0 ? initialBlocks : [emptyParagraph()]
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null);
  // Whole-document selection (the 2nd Ctrl+A). The 1st Ctrl+A selects the
  // current block natively; the 2nd escalates to selecting every block.
  const [selectAll, setSelectAll] = useState(false);

  // Slash menu state — anchored at the row that owns the slash query.
  const [slashFor, setSlashFor] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState("");

  // @ mention picker — same trigger pattern but a different source list.
  const [mentionFor, setMentionFor] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: "above" | "below" } | null>(null);

  // Focus signal — when set, the matching block's content node will focus + place caret at the requested offset on next mount/effect.
  const [focusSignal, setFocusSignal] = useState<{ id: string; offset: "start" | "end" } | null>(null);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Auto-focus the first block ONLY when the doc is functionally empty
  // (a single blank paragraph). Existing docs with content don't get
  // their caret hijacked — the user can scroll and read first.
  const initialFocusFired = useRef(false);
  useEffect(() => {
    if (initialFocusFired.current || readonly || blocks.length !== 1) return;
    const only = blocks[0];
    if (only.kind !== "paragraph") return;
    const t = (only as { text?: string }).text ?? "";
    const isEmpty = !t || t.replace(/<[^>]+>/g, "").trim().length === 0;
    if (!isEmpty) return;
    initialFocusFired.current = true;
    setFocusSignal({ id: only.id, offset: "start" });
  }, [blocks, readonly]);

  // Debounced save. Before persisting, prune trailing empty paragraphs
  // back to a single blank — so a doc with N accidentally-piled-up
  // empty rows always lands as ".. + one trailing blank" rather than
  // accumulating forever.
  useEffect(() => {
    if (!dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      const trimmed = trimTrailingEmptyParagraphs(blocks);
      await onSave(trimmed);
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => s === "saved" ? "idle" : s), 1200);
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [blocks, onSave]);

  // ───────── Undo / redo history ─────────
  // `blocks` is the single source of truth, so we own undo/redo by keeping a
  // stack of prior snapshots. Native contentEditable undo can't span block
  // add/delete/reorder and gets clobbered by React re-seeding the DOM, so we
  // intercept Ctrl/⌘+Z (and Shift+Z / Ctrl+Y for redo) and block the native one.
  // Rapid text edits COALESCE into one step (debounced commit) so a single
  // Ctrl+Z doesn't crawl back one character at a time.
  const HIST_LIMIT = 120;
  const histPast = useRef<Block[][]>([]);
  const histFuture = useRef<Block[][]>([]);
  const histPresent = useRef<Block[]>(blocks); // last snapshot folded into history
  const histRestoring = useRef(false);
  const histTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fold the prior snapshot into the past stack after a typing pause.
  useEffect(() => {
    if (histRestoring.current) { histRestoring.current = false; histPresent.current = blocks; return; }
    if (blocks === histPresent.current) return; // mount / no-op
    if (histTimer.current) clearTimeout(histTimer.current);
    histTimer.current = setTimeout(() => {
      histPast.current.push(histPresent.current);
      if (histPast.current.length > HIST_LIMIT) histPast.current.shift();
      histFuture.current = [];
      histPresent.current = blocks;
      histTimer.current = null;
    }, 400);
    return () => { if (histTimer.current) clearTimeout(histTimer.current); };
  }, [blocks]);

  const undo = useCallback(() => {
    // A pending (un-folded) edit burst: the first Ctrl+Z cancels it back to
    // the last committed snapshot, and that burst becomes redoable.
    if (histTimer.current) {
      clearTimeout(histTimer.current); histTimer.current = null;
      if (blocks !== histPresent.current) {
        histFuture.current.push(blocks);
        histRestoring.current = true;
        setBlocks(histPresent.current);
        dirty.current = true;
        return;
      }
    }
    const prev = histPast.current.pop();
    if (prev === undefined) return;
    histFuture.current.push(histPresent.current);
    histPresent.current = prev;
    histRestoring.current = true;
    setBlocks(prev);
    dirty.current = true;
  }, [blocks]);

  const redo = useCallback(() => {
    if (histTimer.current) { // fold any pending burst first
      clearTimeout(histTimer.current); histTimer.current = null;
      if (blocks !== histPresent.current) { histPast.current.push(histPresent.current); histPresent.current = blocks; }
    }
    const next = histFuture.current.pop();
    if (next === undefined) return;
    histPast.current.push(histPresent.current);
    histPresent.current = next;
    histRestoring.current = true;
    setBlocks(next);
    dirty.current = true;
  }, [blocks]);

  // ───────── Whole-document selection ops ─────────
  const copyDocSelection = useCallback(async () => {
    try { await navigator.clipboard.writeText(serializeBlocksToText(blocks)); } catch { /* clipboard blocked */ }
  }, [blocks]);

  const deleteDocSelection = useCallback(() => {
    const p = emptyParagraph();
    setBlocks([p]);
    dirty.current = true;
    setSelectAll(false);
    setFocusSignal({ id: p.id, offset: "start" });
  }, []);

  // Capture phase so we beat both the per-block handler and the browser's
  // native handling. Owns: 2-stage Ctrl+A (block → whole doc), ops on a
  // whole-doc selection, and undo/redo (native contentEditable undo is
  // broken for our multi-block model, so we cancel it with preventDefault).
  const onEditorKeyDownCapture = useCallback((e: React.KeyboardEvent) => {
    if (readonly) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    // ── Whole-document selection mode (after the 2nd Ctrl+A) ──
    if (selectAll) {
      if (k === "escape") { e.preventDefault(); setSelectAll(false); return; }
      if (k === "backspace" || k === "delete") { e.preventDefault(); deleteDocSelection(); return; }
      if (mod && k === "c") { e.preventDefault(); void copyDocSelection(); return; }
      if (mod && k === "x") { e.preventDefault(); void copyDocSelection(); deleteDocSelection(); return; }
      if (mod && k === "a") { e.preventDefault(); return; } // already everything
      if (mod && k === "z" && !e.altKey) { e.preventDefault(); setSelectAll(false); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === "y" && !e.altKey) { e.preventDefault(); setSelectAll(false); redo(); return; }
      // A printable character replaces the whole doc with a fresh paragraph.
      if (!mod && !e.altKey && e.key.length === 1) { e.preventDefault(); deleteDocSelection(); return; }
      // Anything else (arrows, tab…) just exits selection mode and proceeds.
      setSelectAll(false);
      return;
    }

    // ── Ctrl/⌘+A: 1st selects the block (native), 2nd selects the doc ──
    if (mod && k === "a" && !e.altKey) {
      const el = (e.target as HTMLElement | null)?.closest?.(".brow__text") as HTMLElement | null;
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      const blockLen = (el?.textContent ?? "").length;
      const fullySelected = !!el && !!sel && !sel.isCollapsed && blockLen > 0 && sel.toString().length >= blockLen;
      // Escalate when the block is already fully selected, or it's empty
      // (nothing to select within it first).
      if (fullySelected || blockLen === 0) {
        e.preventDefault();
        sel?.removeAllRanges();
        setSelectAll(true);
      }
      // else: let the browser select-all WITHIN the block (the 1st press).
      return;
    }

    // ── Undo / redo ──
    if (mod && !e.altKey) {
      if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
    }
  }, [readonly, selectAll, blocks, undo, redo, copyDocSelection, deleteDocSelection]);

  // ───────── Mutators ─────────
  const update = useCallback((id: string, patch: Partial<Block>) => {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, ...patch } as Block : b));
    dirty.current = true;
  }, []);

  const insertAfter = useCallback((afterId: string | null, b: Block, focus: "start" | "end" = "start") => {
    setBlocks((prev) => {
      if (afterId === null) return [...prev, b];
      const i = prev.findIndex((x) => x.id === afterId);
      if (i < 0) return [...prev, b];
      const next = [...prev]; next.splice(i + 1, 0, b);
      return next;
    });
    dirty.current = true;
    setActiveId(b.id);
    setFocusSignal({ id: b.id, offset: focus });
  }, []);

  const remove = useCallback((id: string) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      const next = prev.filter((b) => b.id !== id);
      if (next.length === 0) {
        const p = emptyParagraph();
        setFocusSignal({ id: p.id, offset: "end" });
        return [p];
      }
      // Focus the previous block, or the new first.
      const focusId = idx > 0 ? next[idx - 1].id : next[0].id;
      setFocusSignal({ id: focusId, offset: "end" });
      return next;
    });
    dirty.current = true;
  }, []);

  const duplicate = useCallback((id: string) => {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      if (i < 0) return prev;
      const clone = { ...prev[i], id: newId() } as Block;
      const next = [...prev]; next.splice(i + 1, 0, clone);
      return next;
    });
    dirty.current = true;
  }, []);

  // Replace one block with a new block of a different kind, preserving text.
  const turnInto = useCallback((id: string, kind: BlockKind, seedText?: string) => {
    // Mint the converted block's id ONCE and reuse it for the focus signal.
    // The bug: buildBlock() generates its own fresh id, but the focus signal
    // was keyed on the OLD id — so after a slash-convert / "turn into" the
    // caret had nowhere to land and vanished (you had to click back in).
    // Changing the id (vs. preserving it) is deliberate: it remounts the row,
    // which re-runs BOTH the content-seed effect (so existing text survives a
    // turn-into-heading) and the focus effect (so the caret lands).
    const freshId = newId();
    setBlocks((prev) => prev.map((b) => {
      if (b.id !== id) return b;
      const text = seedText ?? getBlockText(b);
      return { ...buildBlock(kind, text), id: freshId };
    }));
    dirty.current = true;
    setFocusSignal({ id: freshId, offset: "end" });
  }, []);

  // Reorder: move sourceId above/below targetId.
  const moveBlock = useCallback((sourceId: string, targetId: string, pos: "above" | "below") => {
    if (sourceId === targetId) return;
    setBlocks((prev) => {
      const from = prev.findIndex((b) => b.id === sourceId);
      if (from < 0) return prev;
      const moving = prev[from];
      const without = [...prev.slice(0, from), ...prev.slice(from + 1)];
      const to = without.findIndex((b) => b.id === targetId);
      if (to < 0) return prev;
      const insertAt = pos === "above" ? to : to + 1;
      const next = [...without.slice(0, insertAt), moving, ...without.slice(insertAt)];
      return next;
    });
    dirty.current = true;
  }, []);

  // Merge: take this block's text, append to previous text block, delete this.
  const mergeIntoPrev = useCallback((id: string) => {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      if (i <= 0) return prev;
      const me = prev[i];
      const prevBlk = prev[i - 1];
      const myText = "text" in me ? me.text : "";
      const prevText = "text" in prevBlk ? prevBlk.text : "";
      // Only merge into text-bearing previous blocks.
      if (!("text" in prevBlk)) return prev;
      const combined = prevText + myText;
      const next = [...prev];
      next[i - 1] = { ...prevBlk, text: combined } as Block;
      next.splice(i, 1);
      setFocusSignal({ id: prevBlk.id, offset: "end" });
      return next;
    });
    dirty.current = true;
  }, []);

  // ───────── Per-row callbacks ─────────
  function handleTextChange(id: string, text: string) {
    // `text` is now HTML — strip tags for markdown / slash / mention
    // detection. The block stores the original HTML.
    const plain = htmlToPlain(text);

    const shortcut = detectMarkdownShortcut(plain);
    if (shortcut) {
      const me = blocks.find((b) => b.id === id);
      if (me && (me.kind === "paragraph" || me.kind === "bullet" || me.kind === "numbered" || me.kind === "todo")) {
        if (shortcut.kind === "divider") {
          setBlocks((prev) => {
            const i = prev.findIndex((b) => b.id === id);
            if (i < 0) return prev;
            const next = [...prev];
            next.splice(i, 1, { id: newId(), kind: "divider" } as Block, emptyParagraph());
            const focusId = next[i + 1].id;
            setFocusSignal({ id: focusId, offset: "start" });
            return next;
          });
          dirty.current = true;
          return;
        }
        turnInto(id, shortcut.kind, shortcut.remainder);
        return;
      }
    }

    if (plain.startsWith("/")) {
      setSlashFor(id);
      setSlashQuery(plain.slice(1));
      setMentionFor(null); setMentionQuery("");
    } else if (slashFor === id) {
      setSlashFor(null);
      setSlashQuery("");
    }

    // `@` no longer opens a block-level picker — see InlineMentionPicker
    // inside EditableText. The "Mention" slash entry still creates the
    // heavier entity_link block when the writer wants a card preview.

    update(id, { text } as Partial<Block>);
  }

  // Editor-level paste — captures image files anywhere in the editor and
  // turns them into a fresh image block after the currently-active row.
  function handleEditorPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData.items;
    if (!items) return;
    const imageItem = Array.from(items).find((it) => it.type.startsWith("image/"));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    uploadAndInsertAfter(file, activeId);
  }

  // Drag-and-drop — accept any file dropped onto the editor and create
  // the appropriate block (image vs generic file) after the currently
  // active row. Images go into an image block; everything else lands
  // as a file attachment block.
  const [isDropping, setIsDropping] = useState(false);
  function handleEditorDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDropping(true);
  }
  function handleEditorDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (e.currentTarget === e.target) setIsDropping(false);
  }
  function handleEditorDrop(e: React.DragEvent<HTMLDivElement>) {
    setIsDropping(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    // Insert files in order, anchoring each new block to the previous
    // insertion so they land in the order the user dropped them.
    let anchor: string | null = activeId;
    for (const file of files) {
      anchor = uploadAndInsertAfter(file, anchor);
    }
  }
  // Returns the id of the newly inserted block so the caller can chain.
  function uploadAndInsertAfter(file: File, after: string | null): string {
    const isImage = file.type.startsWith("image/");
    const placeholder = isImage
      ? (buildBlock("image") as Extract<Block, { kind: "image" }>)
      : (buildBlock("file") as Extract<Block, { kind: "file" }>);
    insertAfter(after, placeholder, "start");
    (async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) return;
        const d = await res.json();
        if (isImage) {
          update(placeholder.id, { url: d.url, alt: file.name, s3Key: d.s3Key ?? null });
        } else {
          update(placeholder.id, {
            url: d.url, name: file.name, size: file.size,
            mimeType: file.type || undefined,
            s3Key: d.s3Key ?? null,
          });
        }
      } catch { /* ignore */ }
    })();
    return placeholder.id;
  }

  function pickMention(entity: MentionResult) {
    if (!mentionFor) return;
    // Replace the mentionFor block with an entity_link, then insert a
    // fresh paragraph after it so the writer can keep going.
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === mentionFor);
      if (i < 0) return prev;
      const linkId = mentionFor;
      const link: Block = {
        id: linkId, kind: "entity_link",
        entityKind: entity.kind, entityId: entity.id,
        label: entity.label, subtitle: entity.subtitle, href: entity.href,
      };
      const p = emptyParagraph();
      const next = [...prev]; next.splice(i, 1, link, p);
      setFocusSignal({ id: p.id, offset: "start" });
      return next;
    });
    dirty.current = true;
    setMentionFor(null);
    setMentionQuery("");
  }

  function pickFromSlash(item: MenuItem) {
    if (!slashFor) return;
    if (item.kind === "divider") {
      setBlocks((prev) => {
        const i = prev.findIndex((b) => b.id === slashFor);
        if (i < 0) return prev;
        const next = [...prev];
        next.splice(i, 1, { id: newId(), kind: "divider" } as Block, emptyParagraph());
        setFocusSignal({ id: next[i + 1].id, offset: "start" });
        return next;
      });
      dirty.current = true;
    } else if (item.kind === "entity_link") {
      // /Mention is a shortcut to the @ picker — flip into mention mode
      // for the same block, with an empty query.
      turnInto(slashFor, "paragraph", "");
      setMentionFor(slashFor);
      setMentionQuery("");
    } else {
      turnInto(slashFor, item.kind, "");
    }
    setSlashFor(null);
    setSlashQuery("");
  }

  useEffect(() => {
    if (!slashFor && !mentionFor) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSlashFor(null); setSlashQuery("");
        setMentionFor(null); setMentionQuery("");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [slashFor, mentionFor]);

  const filteredMenu = useMemo(() => filterMenu(slashQuery), [slashQuery]);

  // ───────── Render ─────────
  return (
    <div
      className={`bedit ${readonly ? "is-readonly" : ""} ${isDropping ? "is-dropping" : ""}`}
      onKeyDownCapture={readonly ? undefined : onEditorKeyDownCapture}
      onMouseDownCapture={selectAll ? () => setSelectAll(false) : undefined}
      onPaste={readonly ? undefined : handleEditorPaste}
      onDragOver={readonly ? undefined : handleEditorDragOver}
      onDragLeave={readonly ? undefined : handleEditorDragLeave}
      onDrop={readonly ? undefined : handleEditorDrop}
    >
      {!readonly && (
        <div className="bedit__status" aria-live="polite">
          {saveState === "saving" && <><Loader2 className="bedit__spin" /> Saving…</>}
          {saveState === "saved"  && <><Check /> Saved</>}
        </div>
      )}

      <div className={`bedit__stack ${selectAll ? "is-all-selected" : ""}`}>
        {blocks.map((b, idx) => (
          <BlockRow
            key={b.id}
            block={b}
            index={idx}
            readonly={readonly}
            isActive={activeId === b.id}
            actionMenuOpen={actionMenuFor === b.id}
            slashOpen={slashFor === b.id}
            slashQuery={slashQuery}
            filteredMenu={filteredMenu}
            mentionOpen={mentionFor === b.id}
            mentionQuery={mentionQuery}
            focusSignal={focusSignal && focusSignal.id === b.id ? focusSignal.offset : null}
            onFocusConsumed={() => setFocusSignal(null)}
            onActivate={() => setActiveId(b.id)}
            onTextChange={(t) => handleTextChange(b.id, t)}
            onUpdate={(patch) => update(b.id, patch)}
            onRemove={() => remove(b.id)}
            onDuplicate={() => duplicate(b.id)}
            onTurnInto={(kind) => turnInto(b.id, kind)}
            onInsertBelow={() => insertAfter(b.id, emptyParagraph(), "start")}
            onToggleActionMenu={() => setActionMenuFor(actionMenuFor === b.id ? null : b.id)}
            onCloseActionMenu={() => setActionMenuFor(null)}
            onEnterAtEnd={(splitTail) => {
              // Lists / todos: empty Enter → exit to paragraph.
              const isList = LIST_KINDS.includes(b.kind);
              if (isList && (!("text" in b) || b.text.trim() === "")) {
                turnInto(b.id, "paragraph", "");
                return;
              }
              // Headings: Enter creates a paragraph next.
              const nextKind: BlockKind = isList ? b.kind : (b.kind === "h1" || b.kind === "h2" || b.kind === "h3" ? "paragraph" : "paragraph");
              insertAfter(b.id, buildBlock(nextKind, splitTail ?? ""), "start");
            }}
            onBackspaceAtStart={(currentText) => {
              // Empty list/todo/heading/quote: turn into paragraph (Notion behaviour).
              if (b.kind === "bullet" || b.kind === "numbered" || b.kind === "todo" || b.kind === "quote" || b.kind === "h1" || b.kind === "h2" || b.kind === "h3") {
                turnInto(b.id, "paragraph", currentText);
                return;
              }
              // Plain paragraph: merge with previous (if first block + empty, delete leaves at least the first paragraph alone).
              if (b.kind === "paragraph") {
                if (idx === 0) return; // nothing to merge into
                mergeIntoPrev(b.id);
              }
            }}
            onArrowOut={(dir) => {
              const target = dir === "up" ? blocks[idx - 1] : blocks[idx + 1];
              if (!target) return;
              setFocusSignal({ id: target.id, offset: dir === "up" ? "end" : "start" });
            }}
            onPickSlash={pickFromSlash}
            onCloseSlash={() => { setSlashFor(null); setSlashQuery(""); }}
            onPickMention={pickMention}
            onCloseMention={() => { setMentionFor(null); setMentionQuery(""); }}
            commentCount={(comments?.[b.id] ?? []).filter((c) => !c.resolved).length}
            onOpenComments={onOpenComments ? () => onOpenComments(b.id) : undefined}

            dragId={dragId}
            dropTarget={dropTarget}
            onDragStart={(id) => setDragId(id)}
            onDragOverRow={(id, pos) => setDropTarget({ id, pos })}
            onDragEnd={() => { setDragId(null); setDropTarget(null); }}
            onDrop={(targetId, pos) => {
              if (dragId) moveBlock(dragId, targetId, pos);
              setDragId(null); setDropTarget(null);
            }}
          />
        ))}

        {/* Notion doesn't show an "Add a block" button — Enter at the
            end of the last block does it. We mirror that minimal chrome,
            and give the writer ~120px of vertical click target below the
            last block so a tap-in-empty-space still drops a paragraph. */}
        {!readonly && (
          <div
            className="bedit__tail"
            onClick={() => {
              // If the last block is already an empty paragraph, just
              // focus it. Otherwise add a fresh one. Stops accidental
              // double-clicks from piling up empty rows.
              const last = blocks[blocks.length - 1];
              if (last && last.kind === "paragraph" && isVisuallyEmpty((last as { text: string }).text)) {
                setFocusSignal({ id: last.id, offset: "end" });
              } else {
                insertAfter(null, emptyParagraph(), "start");
              }
            }}
            aria-label="Click to focus or add a block"
          />
        )}
      </div>
      {!readonly && <InlineFormatToolbar />}
    </div>
  );
}

// ───────── Inline-format floating toolbar ─────────
// Mounts at the editor root; tracks document selectionchange and renders
// above any non-collapsed selection inside a .brow__text. Uses a portal
// to escape ancestor overflow/transform constraints.
function InlineFormatToolbar() {
  const [state, setState] = useState<null | {
    x: number; y: number;
    bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  }>(null);
  // Which color-family popover is open ("hi", "tc", or none). Lifted to
  // the toolbar so the two ColorMenu buttons are mutually exclusive —
  // opening one closes the other automatically.
  const [openMenu, setOpenMenu] = useState<"hi" | "tc" | null>(null);

  useEffect(() => {
    function update() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setState(null); return; }
      const range = sel.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const el = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element);
      if (!el || !el.closest(".brow__text")) { setState(null); return; }
      const rect = range.getBoundingClientRect();
      // Some selections (collapsed/empty rects) come back as 0x0.
      if (rect.width === 0 && rect.height === 0) { setState(null); return; }
      setState({
        x: rect.left + rect.width / 2,
        y: rect.top,
        bold:      docCmdState("bold"),
        italic:    docCmdState("italic"),
        underline: docCmdState("underline"),
        strike:    docCmdState("strikeThrough"),
      });
    }
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  if (!state || typeof document === "undefined") return null;

  function getEditableEl(): HTMLElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    return (el?.closest(".brow__text") as HTMLElement) ?? null;
  }

  function fireInput() {
    const el = getEditableEl();
    if (!el) return;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function run(cmd: string) {
    document.execCommand(cmd);
    fireInput();
    // Refresh active state pill colors.
    setState((s) => s ? ({ ...s,
      bold: docCmdState("bold"), italic: docCmdState("italic"),
      underline: docCmdState("underline"), strike: docCmdState("strikeThrough"),
    }) : s);
  }

  function inlineCode() {
    toggleInlineWrap("code");
    fireInput();
  }

  function makeLink() {
    openLinkPrompt();
  }

  function applyMark(family: "hi" | "tc", color: string | null) {
    // family hi=highlight bg, tc=text color. `null` clears.
    const prefix = family + "-";
    // Strip any existing mark in this family from the selection first.
    clearSelectionMarks(prefix);
    if (color) {
      const wrapper = document.createElement("span");
      wrapper.className = `${prefix}${color}`;
      wrapSelectionInElement(wrapper);
    }
    fireInput();
  }

  return createPortal(
    <div
      className="bfmt workwrk-os"
      role="toolbar"
      style={{ left: Math.max(40, state.x), top: Math.max(8, state.y - 44) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className={state.bold ? "is-active" : ""} title="Bold (⌘B)" onClick={() => run("bold")}><Bold /></button>
      <button type="button" className={state.italic ? "is-active" : ""} title="Italic (⌘I)" onClick={() => run("italic")}><Italic /></button>
      <button type="button" className={state.underline ? "is-active" : ""} title="Underline (⌘U)" onClick={() => run("underline")}><Underline /></button>
      <button type="button" className={state.strike ? "is-active" : ""} title="Strikethrough" onClick={() => run("strikeThrough")}><Strikethrough /></button>
      <span className="bfmt__sep" aria-hidden />
      <button type="button" title="Inline code (⌘E)" onClick={inlineCode}><Code /></button>
      <button type="button" title="Link (⌘K)" onClick={makeLink}><Link2 /></button>
      <span className="bfmt__sep" aria-hidden />
      <ColorMenu
        family="hi"
        Icon={Highlighter}
        isOpen={openMenu === "hi"}
        onToggle={() => setOpenMenu((m) => m === "hi" ? null : "hi")}
        onPick={(c) => { applyMark("hi", c); setOpenMenu(null); }}
      />
      <ColorMenu
        family="tc"
        Icon={Palette}
        isOpen={openMenu === "tc"}
        onToggle={() => setOpenMenu((m) => m === "tc" ? null : "tc")}
        onPick={(c) => { applyMark("tc", c); setOpenMenu(null); }}
      />
    </div>,
    document.body,
  );
}

const COLOR_SWATCHES: Array<{ key: string; label: string }> = [
  { key: "yellow", label: "Yellow" },
  { key: "green",  label: "Green" },
  { key: "blue",   label: "Blue" },
  { key: "pink",   label: "Pink" },
  { key: "red",    label: "Red" },
  { key: "orange", label: "Orange" },
];

function ColorMenu({ family, Icon, isOpen, onToggle, onPick }: { family: "hi" | "tc"; Icon: React.ComponentType<{ className?: string }>; isOpen: boolean; onToggle: () => void; onPick: (color: string | null) => void }) {
  return (
    <span className="bfmt__cmenu">
      <button type="button" className={isOpen ? "is-active" : ""} title={family === "hi" ? "Highlight" : "Text color"} onClick={onToggle}>
        <Icon />
      </button>
      {isOpen && (
        <div className="bfmt__cmenu-pop" onMouseDown={(e) => e.preventDefault()}>
          <div className="bfmt__cmenu-grid">
            {COLOR_SWATCHES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`bfmt__cmenu-cell bfmt__cmenu-cell--${family}-${s.key}`}
                title={s.label}
                onClick={() => onPick(s.key)}
              />
            ))}
          </div>
          <button type="button" className="bfmt__cmenu-clear" onClick={() => onPick(null)}>
            Clear
          </button>
        </div>
      )}
    </span>
  );
}

// Wrap the current selection in the given element (extracted helper for
// reuse beyond toggleInlineWrap which expects a tag string).
function wrapSelectionInElement(wrapper: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  try {
    range.surroundContents(wrapper);
  } catch {
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
  }
  const r = document.createRange();
  r.selectNodeContents(wrapper);
  sel.removeAllRanges();
  sel.addRange(r);
}

// Unwrap any spans inside the current selection whose className starts
// with `prefix` (e.g. "hi-" for highlight family, "tc-" for text color).
function clearSelectionMarks(prefix: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? (range.commonAncestorContainer as Element)
    : range.commonAncestorContainer.parentElement;
  if (!root) return;
  root.querySelectorAll(`span[class^="${prefix}"], span[class*=" ${prefix}"]`).forEach((span) => {
    if (!range.intersectsNode(span)) return;
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  });
}

function docCmdState(cmd: string): boolean {
  try { return document.queryCommandState(cmd); } catch { return false; }
}

// ───────── Block row ─────────
type RowProps = {
  block: Block;
  index: number;
  readonly: boolean;
  isActive: boolean;
  actionMenuOpen: boolean;
  slashOpen: boolean;
  slashQuery: string;
  filteredMenu: MenuItem[];
  mentionOpen: boolean;
  mentionQuery: string;
  focusSignal: "start" | "end" | null;
  onFocusConsumed: () => void;

  onActivate: () => void;
  onTextChange: (t: string) => void;
  onUpdate: (patch: Partial<Block>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onTurnInto: (kind: BlockKind) => void;
  onInsertBelow: () => void;
  onToggleActionMenu: () => void;
  onCloseActionMenu: () => void;
  onEnterAtEnd: (splitTail?: string) => void;
  onBackspaceAtStart: (currentText: string) => void;
  onArrowOut: (dir: "up" | "down") => void;
  onPickSlash: (item: MenuItem) => void;
  onCloseSlash: () => void;
  onPickMention: (m: MentionResult) => void;
  onCloseMention: () => void;

  dragId: string | null;
  dropTarget: { id: string; pos: "above" | "below" } | null;
  onDragStart: (id: string) => void;
  onDragOverRow: (id: string, pos: "above" | "below") => void;
  onDragEnd: () => void;
  onDrop: (id: string, pos: "above" | "below") => void;

  commentCount: number;
  onOpenComments?: () => void;
};

function BlockRow(props: RowProps) {
  const {
    block, index, readonly, isActive, actionMenuOpen,
    slashOpen, slashQuery, filteredMenu,
    mentionOpen, mentionQuery,
    focusSignal, onFocusConsumed,
    onActivate, onTextChange, onUpdate, onRemove, onDuplicate, onTurnInto,
    onInsertBelow,
    onToggleActionMenu, onCloseActionMenu,
    onEnterAtEnd, onBackspaceAtStart, onArrowOut, onPickSlash, onCloseSlash,
    onPickMention, onCloseMention,
    dragId, dropTarget, onDragStart, onDragOverRow, onDragEnd, onDrop,
    commentCount, onOpenComments,
  } = props;

  const isDragging = dragId === block.id;
  const dropAbove = dropTarget?.id === block.id && dropTarget.pos === "above";
  const dropBelow = dropTarget?.id === block.id && dropTarget.pos === "below";

  return (
    <div
      className={[
        "brow", `brow--${block.kind}`,
        isActive ? "is-active" : "",
        isDragging ? "is-dragging" : "",
        dropAbove ? "is-drop-above" : "",
        dropBelow ? "is-drop-below" : "",
      ].filter(Boolean).join(" ")}
      onClick={(e) => {
        onActivate();
        // If the user clicks anywhere on the row body (not a button, link,
        // card, or the editable itself), forward focus to the contained
        // contentEditable. Notion-style "click in the gutter still lands
        // me in the writer" behaviour.
        const t = e.target as Element;
        if (t.closest("button, a, [contenteditable='true'], input, textarea, select, .bcard, .bslash, .bment")) return;
        const editable = e.currentTarget.querySelector<HTMLElement>(".brow__text[contenteditable='true']");
        if (!editable) return;
        editable.focus({ preventScroll: true });
        const sel = window.getSelection();
        if (!sel) return;
        const r = document.createRange();
        r.selectNodeContents(editable);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }}
      onDragOver={(e) => {
        if (!dragId || dragId === block.id) return;
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos: "above" | "below" = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
        onDragOverRow(block.id, pos);
      }}
      onDrop={(e) => {
        if (!dragId || dragId === block.id) return;
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos: "above" | "below" = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
        onDrop(block.id, pos);
      }}
    >
      {!readonly && (
        <div className="brow__gutter">
          <button
            type="button"
            className="brow__handle brow__handle--add"
            title="Add a paragraph below"
            onClick={(e) => { e.stopPropagation(); onCloseActionMenu(); onInsertBelow(); }}
            onMouseDown={(e) => { e.preventDefault(); }}
          >
            <Plus />
          </button>
          <button
            type="button"
            className="brow__handle brow__handle--drag"
            title="Drag to reorder · click for actions"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", block.id);
              onDragStart(block.id);
            }}
            onDragEnd={onDragEnd}
            onClick={(e) => { e.stopPropagation(); onToggleActionMenu(); }}
          >
            <GripVertical />
          </button>
          {/* Comment icon stays out of the gutter until a thread exists
              — keeps the row clean on first run. Starting a new thread
              goes through the action menu's "Comment" item below. */}
          {onOpenComments && commentCount > 0 && (
            <button
              type="button"
              className="brow__handle brow__handle--comment is-on"
              title={`${commentCount} comment${commentCount === 1 ? "" : "s"}`}
              onClick={(e) => { e.stopPropagation(); onOpenComments(); }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <MessageCircle />
              <span className="brow__comment-count">{commentCount}</span>
            </button>
          )}
        </div>
      )}

      <div className="brow__body">
        <BlockContent
          block={block}
          readonly={readonly}
          isActive={isActive}
          focusSignal={focusSignal}
          onFocusConsumed={onFocusConsumed}
          onTextChange={onTextChange}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onEnterAtEnd={onEnterAtEnd}
          onBackspaceAtStart={onBackspaceAtStart}
          onArrowOut={onArrowOut}
          slashOpen={slashOpen}
          mentionOpen={mentionOpen}
          onCloseSlash={onCloseSlash}
          onCloseMention={onCloseMention}
          index={index}
        />

        {/* Slash menu — anchored beneath the text */}
        {slashOpen && !readonly && (
          <SlashMenu
            query={slashQuery}
            items={filteredMenu}
            onPick={onPickSlash}
            onClose={onCloseSlash}
          />
        )}

        {mentionOpen && !readonly && (
          <MentionPicker
            query={mentionQuery}
            onPick={onPickMention}
            onClose={onCloseMention}
          />
        )}
      </div>

      {/* Per-row action menu (turn into / duplicate / delete / copy link / comment) */}
      {actionMenuOpen && !readonly && (
        <RowActionMenu
          block={block}
          onClose={onCloseActionMenu}
          onTurnInto={onTurnInto}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          onOpenComments={onOpenComments}
        />
      )}
    </div>
  );
}

// ───────── Slash menu ─────────
function SlashMenu({ query, items, onPick, onClose }: { query: string; items: MenuItem[]; onPick: (i: MenuItem) => void; onClose: () => void }) {
  const [sel, setSel] = useState(0);
  useEffect(() => { setSel(0); }, [query]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (items.length === 0) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % items.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + items.length) % items.length); }
      else if (e.key === "Enter") { e.preventDefault(); onPick(items[sel]); }
      else if (e.key === "Tab")   { e.preventDefault(); onPick(items[sel]); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [items, sel, onPick]);

  if (items.length === 0) {
    return (
      <div className="bslash" role="listbox" onClick={(e) => e.stopPropagation()}>
        <div className="bslash__empty">No blocks match &ldquo;{query}&rdquo;. Esc to dismiss.</div>
      </div>
    );
  }

  const groups: { label: string; items: { item: MenuItem; absIdx: number }[] }[] = [];
  items.forEach((item, absIdx) => {
    let g = groups.find((x) => x.label === item.group);
    if (!g) { g = { label: item.group, items: [] }; groups.push(g); }
    g.items.push({ item, absIdx });
  });

  return (
    <div className="bslash" role="listbox" onClick={(e) => e.stopPropagation()}>
      <header className="bslash__head">
        <Sparkles /> <span>Insert block</span>
        <em>↑↓ select · Enter insert · Esc close</em>
      </header>
      <div className="bslash__scroll">
        {groups.map((g) => (
          <div key={g.label} className="bslash__group">
            <div className="bslash__group-label">{g.label}</div>
            {g.items.map(({ item, absIdx }) => (
              <button
                key={item.kind}
                type="button"
                role="option"
                aria-selected={sel === absIdx}
                className={`bslash__item ${sel === absIdx ? "is-sel" : ""}`}
                onMouseEnter={() => setSel(absIdx)}
                onClick={() => onPick(item)}
              >
                <span className="bslash__icon"><item.Icon /></span>
                <span className="bslash__txt">
                  <span className="bslash__label">{item.label}</span>
                  <span className="bslash__hint">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <button type="button" className="bslash__close" onClick={onClose}>Close</button>
    </div>
  );
}

// ───────── Row action menu ─────────
function RowActionMenu({ block, onClose, onTurnInto, onDuplicate, onRemove, onOpenComments }: { block: Block; onClose: () => void; onTurnInto: (k: BlockKind) => void; onDuplicate: () => void; onRemove: () => void; onOpenComments?: () => void }) {
  const { toast } = useOsToast();
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function copyBlockLink() {
    const url = `${window.location.href.split("#")[0]}#b-${block.id}`;
    navigator.clipboard.writeText(url).then(() => toast("Block link copied"));
    onClose();
  }

  // Turn-into options (only text-style blocks can convert).
  const canTurnInto = TEXT_KINDS.includes(block.kind);
  const turnOptions: BlockKind[] = canTurnInto
    ? ["paragraph", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "callout", "code", "toggle"]
    : [];

  return (
    <div className="brow__action" onClick={(e) => e.stopPropagation()}>
      {canTurnInto && (
        <>
          <div className="brow__action-label"><ArrowRightLeft /> Turn into</div>
          <div className="brow__action-grid">
            {turnOptions.map((k) => {
              const item = MENU.find((m) => m.kind === k);
              if (!item) return null;
              return (
                <button key={k} type="button" className={`brow__action-into ${block.kind === k ? "is-current" : ""}`} onClick={() => { onTurnInto(k); onClose(); }}>
                  <item.Icon />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="brow__action-sep" />
        </>
      )}
      {onOpenComments && (
        <button type="button" className="brow__action-row" onClick={() => { onOpenComments(); onClose(); }}>
          <MessageCircle /> <span>Comment</span>
        </button>
      )}
      <button type="button" className="brow__action-row" onClick={() => { onDuplicate(); onClose(); }}>
        <Copy /> <span>Duplicate</span>
      </button>
      <button type="button" className="brow__action-row" onClick={copyBlockLink}>
        <Link2 /> <span>Copy link to block</span>
      </button>
      <button type="button" className="brow__action-row brow__action-row--danger" onClick={() => { onRemove(); onClose(); }}>
        <Trash2 /> <span>Delete</span>
      </button>
    </div>
  );
}

// ───────── Block content (per-type) ─────────
type ContentProps = {
  block: Block;
  readonly: boolean;
  isActive: boolean;
  focusSignal: "start" | "end" | null;
  onFocusConsumed: () => void;
  onTextChange: (t: string) => void;
  onUpdate: (patch: Partial<Block>) => void;
  onRemove: () => void;
  onEnterAtEnd: (splitTail?: string) => void;
  onBackspaceAtStart: (currentText: string) => void;
  onArrowOut: (dir: "up" | "down") => void;
  slashOpen: boolean;
  mentionOpen: boolean;
  onCloseSlash: () => void;
  onCloseMention: () => void;
  index: number;
};

function BlockContent(p: ContentProps) {
  const { block, readonly } = p;

  if (block.kind === "paragraph" || block.kind === "h1" || block.kind === "h2" || block.kind === "h3"
      || block.kind === "bullet" || block.kind === "numbered" || block.kind === "quote") {
    // Notion-style: placeholder is rendered only on the active block.
    // Inactive empty rows show nothing — keeps a doc full of blank
    // paragraphs from looking like a wall of "Type / for blocks…".
    const showPlaceholder = !p.readonly && p.isActive && isVisuallyEmpty(block.text);
    return (
      <div className={`brow__text-wrap brow__text-wrap--${block.kind}`} id={`b-${block.id}`}>
        {block.kind === "bullet" && <span className="brow__list-marker">•</span>}
        {block.kind === "numbered" && <span className="brow__list-marker brow__list-marker--num">{p.index + 1}.</span>}
        <div className="brow__text-host">
          <EditableText
            {...p}
            text={block.text}
            tag={block.kind === "paragraph" ? "p" : block.kind === "bullet" || block.kind === "numbered" ? "div" : block.kind === "quote" ? "div" : block.kind}
            placeholder={placeholderFor(block.kind)}
            nativePlaceholder={false}
          />
          {showPlaceholder && (
            <span className="brow__text-ph" aria-hidden>{placeholderFor(block.kind)}</span>
          )}
        </div>
      </div>
    );
  }

  if (block.kind === "todo") {
    return (
      <div className={`brow__todo ${block.done ? "is-done" : ""}`} id={`b-${block.id}`}>
        <button
          type="button"
          className="brow__todo-check"
          onClick={(e) => { e.stopPropagation(); p.onUpdate({ done: !block.done }); }}
          disabled={readonly}
          aria-label={block.done ? "Mark not done" : "Mark done"}
        >
          {block.done ? "✓" : ""}
        </button>
        <EditableText {...p} text={block.text} tag="div" placeholder="To-do" />
      </div>
    );
  }

  if (block.kind === "callout") {
    return (
      <div className={`brow__callout brow__callout--${block.tone}`} id={`b-${block.id}`}>
        <AlertCircle />
        <EditableText {...p} text={block.text} tag="div" placeholder="Callout text" />
        {!readonly && (
          <select
            value={block.tone}
            onChange={(e) => p.onUpdate({ tone: e.target.value as "info" | "warn" | "success" })}
            onClick={(e) => e.stopPropagation()}
            className="brow__callout-tone"
          >
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="success">Success</option>
          </select>
        )}
      </div>
    );
  }

  if (block.kind === "toggle")     return <ToggleBlock block={block} readonly={readonly} onUpdate={p.onUpdate} />;
  if (block.kind === "ai_write")   return <AiWriteBlock block={block} readonly={readonly} onUpdate={p.onUpdate} />;
  if (block.kind === "entity_link")return <EntityLinkBlock block={block} readonly={readonly} onRemove={p.onRemove} />;

  if (block.kind === "code") {
    return <CodeBlock block={block} readonly={readonly} onUpdate={p.onUpdate} focusSignal={p.focusSignal} onFocusConsumed={p.onFocusConsumed} onArrowOut={p.onArrowOut} />;
  }

  if (block.kind === "divider") {
    return <hr className="brow__divider" id={`b-${block.id}`} />;
  }

  if (block.kind === "embed") {
    return (
      <div className="brow__embed" id={`b-${block.id}`}>
        {!readonly && (
          <input
            type="url"
            className="brow__embed-input"
            placeholder="https://…"
            defaultValue={block.url}
            onBlur={(e) => p.onUpdate({ url: e.target.value.trim() })}
          />
        )}
        {block.url && (
          <a href={block.url} target="_blank" rel="noopener" className="brow__embed-card">
            <Link2 />
            <span className="brow__embed-host">{safeHost(block.url)}</span>
            <span className="brow__embed-url">{block.url}</span>
          </a>
        )}
      </div>
    );
  }

  if (block.kind === "image")         return <ImageBlock block={block} readonly={readonly} onUpdate={p.onUpdate} onRemove={p.onRemove} />;
  if (block.kind === "subpage")       return <SubpageBlock block={block} readonly={readonly} onUpdate={p.onUpdate} onRemove={p.onRemove} />;
  if (block.kind === "sop_card")      return <SopCardBlock block={block} readonly={readonly} onUpdate={p.onUpdate} onRemove={p.onRemove} />;
  if (block.kind === "task_card")     return <TaskCardBlock block={block} readonly={readonly} onUpdate={p.onUpdate} onRemove={p.onRemove} />;
  if (block.kind === "note_card")     return <NoteCardBlock block={block} readonly={readonly} onUpdate={p.onUpdate} onRemove={p.onRemove} />;
  if (block.kind === "file")          return <FileBlock block={block} readonly={readonly} onUpdate={p.onUpdate} />;
  if (block.kind === "tasks_view")    return <TasksViewBlock block={block} readonly={readonly} onUpdate={p.onUpdate} />;
  if (block.kind === "studio_board")  return <StudioBoardBlock block={block} readonly={readonly} onUpdate={p.onUpdate} />;
  if (block.kind === "sops_list")     return <SopsListBlock block={block} readonly={readonly} onUpdate={p.onUpdate} />;
  if (block.kind === "meetings_view") return <MeetingsViewBlock block={block} readonly={readonly} onUpdate={p.onUpdate} />;
  if (block.kind === "form")          return <FormBlock block={block} readonly={readonly} onUpdate={p.onUpdate} />;
  if (block.kind === "data_table")    return <DataTableBlock block={block} readonly={readonly} onUpdate={p.onUpdate} />;

  return null;
}

// Drop runs of trailing empty paragraphs back to at most one. The doc
// editor's "click below the last block to add a paragraph" UX and
// accidental Enter presses can pile up empties; this stops them from
// being persisted forever.
function trimTrailingEmptyParagraphs(blocks: Block[]): Block[] {
  let end = blocks.length;
  while (end > 1) {
    const b = blocks[end - 1];
    if (b.kind !== "paragraph") break;
    if (!isVisuallyEmpty((b as { text: string }).text)) break;
    // Keep at most one trailing empty paragraph (so the writer always
    // has something to type into when they reopen the doc).
    const prev = blocks[end - 2];
    if (prev.kind === "paragraph" && isVisuallyEmpty((prev as { text: string }).text)) {
      end--;
    } else {
      break;
    }
  }
  return end === blocks.length ? blocks : blocks.slice(0, end);
}

function isVisuallyEmpty(text: string | undefined): boolean {
  if (!text) return true;
  const plain = text
    .replace(/<br\s*\/?\s*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
  return plain.length === 0;
}

function placeholderFor(kind: BlockKind): string {
  switch (kind) {
    case "h1": return "Heading 1";
    case "h2": return "Heading 2";
    case "h3": return "Heading 3";
    case "bullet": return "List item";
    case "numbered": return "List item";
    case "quote": return "Quote";
    case "paragraph": return "Type \"/\" for blocks · \"@\" to mention · or just write…";
    default: return "";
  }
}

// ───────── EditableText (uncontrolled contentEditable with focus signal) ─────────
type EditableProps = ContentProps & {
  text: string;
  tag: string;
  placeholder: string;
  /** When false, the contentEditable does NOT emit `data-placeholder`, so the
   *  CSS `:empty::before` placeholder won't render. Used by block kinds that
   *  draw their own active-only placeholder span (brow__text-ph) instead —
   *  otherwise both fire and the placeholder text doubles up / shows on every
   *  empty row. Defaults true for kinds (todo/callout) that rely on the CSS. */
  nativePlaceholder?: boolean;
};

// ───────── HTML sanitizer ─────────
const ALLOWED_TAGS = new Set(["b","strong","i","em","u","s","del","code","a","br","span"]);

function looksLikeHtml(s: string): boolean {
  return /<(?:b|strong|i|em|u|s|del|code|a|br|span)\b/i.test(s);
}

function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  walkSanitize(tpl.content);
  return tpl.innerHTML;
}

function walkSanitize(node: Node) {
  const kids = Array.from(node.childNodes);
  for (const child of kids) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap unknown tag — keep its text so we don't lose user data.
      const text = document.createTextNode(el.textContent ?? "");
      el.parentNode?.replaceChild(text, el);
      continue;
    }
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (tag === "a") {
        // Keep href/title; allow class for the inline mention pill style;
        // keep data-* hooks; keep contenteditable so the mention pill
        // stays atomic (single backspace deletes the whole pill).
        if (name !== "href" && name !== "title" && name !== "class" && name !== "contenteditable" && !name.startsWith("data-")) {
          el.removeAttribute(attr.name);
        }
      } else if (tag === "span") {
        // Allow class for highlight/color marks + data-* for mentions.
        if (!name.startsWith("data-") && name !== "class") el.removeAttribute(attr.name);
      } else {
        el.removeAttribute(attr.name);
      }
    });
    if (tag === "a") {
      const href = el.getAttribute("href") || "";
      if (!/^(https?:|mailto:|\/)/i.test(href)) {
        el.removeAttribute("href");
      } else {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
    walkSanitize(el);
  }
}

// Write text-or-HTML into the editable element safely. Plain text content
// (no allowed tags present) uses textContent so we never accidentally
// parse a stray "<" as an unfinished tag. Anything that looks like our
// formatting HTML gets sanitized + innerHTML'd.
function setEditorContent(el: HTMLElement, text: string): void {
  if (!text) { el.innerHTML = ""; return; }
  if (looksLikeHtml(text)) {
    el.innerHTML = sanitizeHtml(text);
  } else {
    el.textContent = text;
  }
}

// Wrap the current selection in a tag (or unwrap if already wrapped).
function toggleInlineWrap(tagName: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);

  // If the selection is entirely inside a matching tag, unwrap it.
  const startEl = (range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : range.startContainer as Element);
  const ancestor = startEl?.closest(tagName);
  if (ancestor && ancestor.contains(range.endContainer)) {
    const parent = ancestor.parentNode;
    if (!parent) return;
    while (ancestor.firstChild) parent.insertBefore(ancestor.firstChild, ancestor);
    parent.removeChild(ancestor);
    return;
  }

  const wrapper = document.createElement(tagName);
  try {
    range.surroundContents(wrapper);
  } catch {
    const contents = range.extractContents();
    wrapper.appendChild(contents);
    range.insertNode(wrapper);
  }
  // Re-select the now-wrapped content so further toggles work.
  const newRange = document.createRange();
  newRange.selectNodeContents(wrapper);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

function EditableText({
  text, tag, placeholder, nativePlaceholder = true, readonly, focusSignal, onFocusConsumed,
  onTextChange, onEnterAtEnd, onBackspaceAtStart, onArrowOut,
  slashOpen, mentionOpen, onCloseSlash, onCloseMention,
}: EditableProps) {
  const ref = useRef<HTMLElement | null>(null);
  // Last HTML the user typed (or that we wrote into the DOM). Lets us
  // tell user-driven changes from external prop updates so we don't
  // clobber the caret on every state tick.
  const lastTextRef = useRef<string>(text);

  const cbRef = useRef({
    onTextChange, onEnterAtEnd, onBackspaceAtStart, onArrowOut,
    onCloseSlash, onCloseMention,
  });
  cbRef.current = {
    onTextChange, onEnterAtEnd, onBackspaceAtStart, onArrowOut,
    onCloseSlash, onCloseMention,
  };

  // Seed/re-sync the DOM. LAYOUT effect, fires before paint and before
  // the focus effect below.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML === text) return; // already in sync — don't clobber the caret while typing
    // Seed when the text changed externally (undo, turn-into), OR when the
    // node is freshly mounted and still empty. The empty-node case is the
    // important one: turn-into gives the block a NEW id → a NEW empty node,
    // but lastTextRef was initialized to `text`, so the first check alone
    // misses it and the block's text would render blank (the disappearing
    // text on a heading change).
    if (text !== lastTextRef.current || el.innerHTML === "") {
      setEditorContent(el, text);
      lastTextRef.current = text;
    }
  }, [text]);

  // Focus signal — see fix history for why we sync-focus + setTimeout.
  useLayoutEffect(() => {
    if (!focusSignal || !ref.current) return;
    const el = ref.current;
    const place = () => {
      if (!el.isConnected) return;
      el.focus({ preventScroll: false });
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(focusSignal === "start");
      sel.removeAllRanges();
      sel.addRange(range);
    };
    place();
    const t = setTimeout(() => {
      place();
      onFocusConsumed();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  // Inline mention state: present whenever the caret is sitting at the
  // end of an active `@<query>` sequence inside this block. Re-checked
  // on every input + selectionchange. Closing it just sets to null.
  const [inlineMention, setInlineMention] = useState<{ query: string; anchorRect: DOMRect; atNode: Node; atOffset: number } | null>(null);

  function flushHtml() {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
    lastTextRef.current = html;
    cbRef.current.onTextChange(html);
  }

  function checkInlineMention() {
    const el = ref.current;
    if (!el || readonly) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) { setInlineMention(null); return; }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) { setInlineMention(null); return; }
    const found = findActiveAtTrigger(el, range);
    if (!found) { setInlineMention(null); return; }
    const rect = range.getBoundingClientRect();
    setInlineMention({ ...found, anchorRect: rect });
  }

  function onInput() {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
    lastTextRef.current = html;
    cbRef.current.onTextChange(html);
    checkInlineMention();
  }

  function insertMentionPill(entity: MentionResult) {
    const el = ref.current;
    if (!el || !inlineMention) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const caretRange = sel.getRangeAt(0);

    // Build the replacement: a range from `@` up to the caret.
    const deleteRange = document.createRange();
    deleteRange.setStart(inlineMention.atNode, inlineMention.atOffset);
    deleteRange.setEnd(caretRange.endContainer, caretRange.endOffset);
    deleteRange.deleteContents();

    const pill = document.createElement("a");
    pill.className = `bmen-inline bmen-inline--${entity.kind}`;
    pill.setAttribute("data-kind", entity.kind);
    pill.setAttribute("data-id", entity.id);
    pill.setAttribute("contenteditable", "false");
    if (entity.href) pill.setAttribute("href", entity.href);
    pill.textContent = `@${entity.label}`;
    deleteRange.insertNode(pill);

    // Trailing non-breaking space so the next caret lands on text, not
    // on the link element (which Safari/Chrome both prefer to grow).
    const space = document.createTextNode(" ");
    pill.parentNode?.insertBefore(space, pill.nextSibling);

    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);

    setInlineMention(null);
    flushHtml();
  }

  function onPaste(e: React.ClipboardEvent<HTMLElement>) {
    e.preventDefault();
    const data = e.clipboardData;
    const html = data.getData("text/html");
    if (html) {
      const clean = sanitizeHtml(html);
      document.execCommand("insertHTML", false, clean);
    } else {
      const plain = data.getData("text/plain");
      document.execCommand("insertText", false, plain);
    }
    // execCommand fires `input` for us, but be explicit so React sees it
    // in the same tick.
    queueMicrotask(flushHtml);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    // Inline-format shortcuts: Cmd/Ctrl + B / I / U / E (code) / K (link).
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); document.execCommand("bold"); flushHtml(); return; }
      if (k === "i") { e.preventDefault(); document.execCommand("italic"); flushHtml(); return; }
      if (k === "u") { e.preventDefault(); document.execCommand("underline"); flushHtml(); return; }
      if (k === "e") { e.preventDefault(); toggleInlineWrap("code"); flushHtml(); return; }
      if (k === "k") {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) openLinkPrompt();
        return;
      }
    }

    // Inline mention picker steals Esc / Enter / Tab / Arrows when open.
    if (inlineMention) {
      if (e.key === "Escape") { e.preventDefault(); setInlineMention(null); return; }
      if (e.key === "Enter" || e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        // The InlineMentionPicker listens on document.keydown in capture
        // phase and handles these itself — but we still preventDefault
        // here so the contentEditable doesn't insert a newline.
        e.preventDefault();
        return;
      }
    }

    // Slash / mention pickers own Enter / Tab / Arrows when open.
    if (slashOpen || mentionOpen) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab") {
        e.preventDefault(); return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (slashOpen) cbRef.current.onCloseSlash();
        if (mentionOpen) cbRef.current.onCloseMention();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const el = ref.current;
      let headHtml = "", tailHtml = "";
      let hasTail = false;
      if (el) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const headRange = document.createRange();
          headRange.selectNodeContents(el);
          headRange.setEnd(range.startContainer, range.startOffset);
          const headDiv = document.createElement("div");
          headDiv.appendChild(headRange.cloneContents());
          headHtml = headDiv.innerHTML;

          const tailRange = document.createRange();
          tailRange.selectNodeContents(el);
          tailRange.setStart(range.endContainer, range.endOffset);
          const tailDiv = document.createElement("div");
          tailDiv.appendChild(tailRange.cloneContents());
          tailHtml = tailDiv.innerHTML;
          hasTail = (tailDiv.textContent ?? "").length > 0;
        } else {
          headHtml = el.innerHTML;
        }
      }
      if (el && hasTail) {
        setEditorContent(el, headHtml);
        lastTextRef.current = headHtml;
        cbRef.current.onTextChange(headHtml);
      }
      cbRef.current.onEnterAtEnd(hasTail ? tailHtml : "");
      return;
    }

    if (e.key === "Backspace") {
      const sel = window.getSelection();
      const el = ref.current;
      if (sel && el && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        const atStart = r.collapsed && r.startOffset === 0 && (
          r.startContainer === el ||
          (el.firstChild != null && r.startContainer === el.firstChild)
        );
        if (atStart) {
          e.preventDefault();
          cbRef.current.onBackspaceAtStart(el.innerHTML);
          return;
        }
      }
      return;
    }

    if (e.key === "ArrowUp") {
      const sel = window.getSelection();
      const el = ref.current;
      if (sel && el && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        if (r.startOffset === 0) {
          e.preventDefault();
          cbRef.current.onArrowOut("up");
        }
      }
      return;
    }
    if (e.key === "ArrowDown") {
      const sel = window.getSelection();
      const el = ref.current;
      if (sel && el && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        const len = el.innerText.length;
        if (r.startOffset >= len) {
          e.preventDefault();
          cbRef.current.onArrowOut("down");
        }
      }
      return;
    }
  }

  const common = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ref: ref as any,
    className: "brow__text",
    contentEditable: !readonly,
    suppressContentEditableWarning: true,
    ...(nativePlaceholder ? { "data-placeholder": placeholder } : {}),
    onInput,
    onKeyDown,
    onPaste,
  } as const;

  const mentionPicker = inlineMention ? (
    <InlineMentionPicker
      query={inlineMention.query}
      anchorRect={inlineMention.anchorRect}
      onPick={insertMentionPill}
      onClose={() => setInlineMention(null)}
    />
  ) : null;

  if (tag === "h1") return <>{mentionPicker}<h1 {...common} /></>;
  if (tag === "h2") return <>{mentionPicker}<h2 {...common} /></>;
  if (tag === "h3") return <>{mentionPicker}<h3 {...common} /></>;
  if (tag === "p")  return <>{mentionPicker}<p  {...common} /></>;
  return <>{mentionPicker}<div {...common} /></>;
}

// ───────── Find the active @-trigger in the current text node ─────────
// Walks back from the caret looking for a `@` that's preceded by start
// of text or whitespace (so we don't trigger on "email@domain.com").
function findActiveAtTrigger(root: HTMLElement, range: Range): { query: string; atNode: Node; atOffset: number } | null {
  const node = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  if (!root.contains(node)) return null;
  const text = node.textContent ?? "";
  let i = offset - 1;
  let query = "";
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      // Treat the `@` as a trigger only if it sits at the start of the
      // text node or just after whitespace — keeps "email@" from popping.
      const before = i > 0 ? text[i - 1] : "";
      if (before === "" || /\s/.test(before)) {
        // Also bail out on absurdly long queries — probably not a mention.
        if (query.length > 80) return null;
        return { query, atNode: node, atOffset: i };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    query = ch + query;
    i--;
  }
  return null;
}

// ───────── Inline mention picker (caret-anchored portal) ─────────
function InlineMentionPicker({ query, anchorRect, onPick, onClose }: {
  query: string;
  anchorRect: DOMRect;
  onPick: (r: MentionResult) => void;
  onClose: () => void;
}) {
  const [results, setResults] = useState<MentionResult[] | null>(null);
  const [sel, setSel] = useState(0);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    (async () => {
      const all: MentionResult[] = [];
      const safe = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
      const [usersRes, krasRes, sopsRes, tasksRes, boardsRes] = await Promise.all([
        safe(fetch("/api/users").then((r) => r.ok ? r.json() : null)),
        safe(fetch("/api/me/kras").then((r) => r.ok ? r.json() : null)),
        safe(fetch("/api/sops?limit=50").then((r) => r.ok ? r.json() : null)),
        safe(fetch(`/api/tasks?limit=50`).then((r) => r.ok ? r.json() : null)),
        safe(fetch("/api/studio/boards").then((r) => r.ok ? r.json() : null)),
      ]);
      extractArray(usersRes).slice(0, 30).forEach((u) => {
        if (typeof u.id === "string") all.push({ kind: "user", id: u.id as string, label: (u.name as string) || (u.email as string) || "Unnamed", subtitle: (u.role as string) || (u.email as string), href: `/team` });
      });
      extractArray(krasRes).slice(0, 30).forEach((k) => {
        if (typeof k.id === "string") all.push({ kind: "kra", id: k.id as string, label: (k.title as string) || (k.name as string) || "KRA", subtitle: "Key Result Area", href: `/team/alignment` });
      });
      extractArray(sopsRes).slice(0, 30).forEach((s) => {
        if (typeof s.id === "string") all.push({ kind: "sop", id: s.id as string, label: (s.title as string) || "SOP", subtitle: (s.category as string) || "SOP", href: `/sops/${s.id}` });
      });
      extractArray(tasksRes).slice(0, 50).forEach((t) => {
        if (typeof t.id === "string") all.push({ kind: "task", id: t.id as string, label: (t.title as string) || "Task", subtitle: t.date ? new Date(t.date as string).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Task", href: `/tasks` });
      });
      extractArray(boardsRes).slice(0, 30).forEach((b) => {
        if (typeof b.id === "string") all.push({ kind: "board", id: b.id as string, label: (b.name as string) || "Board", subtitle: ((b.layout as string) || "").toLowerCase() || "Board", href: `/studio/boards/${b.id}` });
      });
      if (!cancelled) setResults(all);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!results) return [];
    if (!q) return results.slice(0, 8);
    return results.filter((r) =>
      r.label.toLowerCase().includes(q) ||
      (r.subtitle ?? "").toLowerCase().includes(q) ||
      r.kind.includes(q),
    ).slice(0, 10);
  }, [results, query]);

  useEffect(() => { setSel(0); }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % filtered.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + filtered.length) % filtered.length); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); onPick(filtered[sel]); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [filtered, sel, onPick, onClose]);

  if (typeof document === "undefined") return null;

  // Position below the caret, flipping above if there's not enough room.
  const PICKER_HEIGHT = 320;
  const PICKER_WIDTH = 340;
  const flipUp = anchorRect.bottom + PICKER_HEIGHT > window.innerHeight;
  const top = flipUp ? anchorRect.top - PICKER_HEIGHT - 6 : anchorRect.bottom + 6;
  const left = Math.max(12, Math.min(anchorRect.left, window.innerWidth - PICKER_WIDTH - 12));

  return createPortal(
    <div className="bmen bmen--inline" role="listbox" style={{ position: "fixed", top, left, width: PICKER_WIDTH }} onMouseDown={(e) => e.preventDefault()}>
      <header className="bmen__head">
        <AtSign /> <span>Mention</span>
        <em>↑↓ Enter</em>
      </header>
      {results === null ? (
        <div className="bmen__loading"><Loader2 className="bedit__spin" /> Loading mentions…</div>
      ) : filtered.length === 0 ? (
        <div className="bmen__empty">No matches for &ldquo;{query}&rdquo;</div>
      ) : (
        <div className="bmen__scroll">
          {filtered.map((r, i) => (
            <button
              key={`${r.kind}:${r.id}`}
              type="button"
              role="option"
              aria-selected={sel === i}
              className={`bmen__row ${sel === i ? "is-sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => onPick(r)}
            >
              <EntityKindIcon kind={r.kind} />
              <span className="bmen__txt">
                <span className="bmen__label">{r.label}</span>
                {r.subtitle && <span className="bmen__hint">{r.subtitle}</span>}
              </span>
              <span className={`bmen__chip bmen__chip--${r.kind}`}>{r.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

// ───────── Code block ─────────
function CodeBlock({ block, readonly, onUpdate, focusSignal, onFocusConsumed, onArrowOut }: {
  block: Extract<Block, { kind: "code" }>;
  readonly: boolean;
  onUpdate: (p: Partial<Block>) => void;
  focusSignal: "start" | "end" | null;
  onFocusConsumed: () => void;
  onArrowOut: (dir: "up" | "down") => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!focusSignal || !ref.current) return;
    const el = ref.current;
    el.focus();
    el.selectionStart = el.selectionEnd = focusSignal === "start" ? 0 : el.value.length;
    onFocusConsumed();
  }, [focusSignal, onFocusConsumed]);

  return (
    <div className="brow__code" id={`b-${block.id}`}>
      <header className="brow__code-head">
        <Code />
        {!readonly ? (
          <input
            type="text"
            className="brow__code-lang"
            placeholder="language (e.g. typescript)"
            defaultValue={block.lang ?? ""}
            onBlur={(e) => onUpdate({ lang: e.target.value.trim() || undefined })}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="brow__code-lang-text">{block.lang || "code"}</span>
        )}
      </header>
      <textarea
        ref={ref}
        className="brow__code-area"
        readOnly={readonly}
        defaultValue={block.text}
        spellCheck={false}
        onInput={(e) => onUpdate({ text: (e.target as HTMLTextAreaElement).value })}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart, end = ta.selectionEnd;
            ta.value = ta.value.slice(0, start) + "  " + ta.value.slice(end);
            ta.selectionStart = ta.selectionEnd = start + 2;
            onUpdate({ text: ta.value });
          } else if (e.key === "ArrowUp" && e.currentTarget.selectionStart === 0) {
            e.preventDefault(); onArrowOut("up");
          } else if (e.key === "ArrowDown" && e.currentTarget.selectionStart >= e.currentTarget.value.length) {
            e.preventDefault(); onArrowOut("down");
          }
        }}
        placeholder="// code…"
        rows={Math.max(3, (block.text || "").split("\n").length)}
      />
    </div>
  );
}

// ───────── File block (with picker) ─────────
function FileBlock({ block, readonly, onUpdate }: { block: Extract<Block, { kind: "file" }>; readonly: boolean; onUpdate: (patch: Partial<Block>) => void }) {
  const [picking, setPicking] = useState(false);
  const [files, setFiles] = useState<ApiFile[] | null>(null);

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/files?folderId=root");
      if (res.ok) {
        const d = await res.json();
        setFiles(d.data ?? (Array.isArray(d) ? d : []));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (picking && !files) void loadFiles(); }, [picking, files, loadFiles]);

  if (block.url) {
    return (
      <a href={block.url} target="_blank" rel="noopener" className="brow__file">
        <FileIcon />
        <div>
          <div className="brow__file-name">{block.name}</div>
          {block.size && <div className="brow__file-meta">{fmtSize(block.size)}{block.mimeType ? ` · ${block.mimeType}` : ""}</div>}
        </div>
      </a>
    );
  }

  if (readonly) return <div className="brow__file brow__file--empty">No file attached</div>;

  return (
    <div className="brow__file-pick">
      <button type="button" className="brow__file-trigger" onClick={(e) => { e.stopPropagation(); setPicking(true); }}>
        <FileIcon /> Pick a file from your drive…
      </button>
      {picking && (
        <div className="brow__file-modal" onClick={(e) => e.stopPropagation()}>
          <header>
            <span>Pick a file</span>
            <button type="button" onClick={() => setPicking(false)}>✕</button>
          </header>
          {files === null ? <div style={{ padding: 16, fontSize: 12, color: "var(--os-ink-3)" }}>Loading…</div> : files.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: "var(--os-ink-3)" }}>No files in your drive yet. Upload some at <a href="/files">/files</a>.</div>
          ) : (
            <div className="brow__file-list">
              {files.slice(0, 40).map((f) => (
                <button key={f.id} type="button" onClick={() => { onUpdate({ name: f.name, url: f.url, size: f.size, mimeType: f.mimeType }); setPicking(false); }}>
                  <FileIcon />
                  <span>{f.name}</span>
                  <em>{fmtSize(f.size)}</em>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────── helpers ─────────
function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return "—"; }
}
// ───────── Link prompt (styled replacement for window.prompt) ─────────
// Fires via a window event so any editor on the page can request it
// without prop drilling. Captures the current selection up front so
// the link applies to what the user had highlighted, even though the
// modal's input steals focus.

const LINK_PROMPT_EVENT = "workwrk:notes:link-prompt";

function openLinkPrompt() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LINK_PROMPT_EVENT));
}

export function LinkPromptOverlay() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("https://");
  const savedRangeRef = useRef<Range | null>(null);
  const savedTargetRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onOpen() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        savedRangeRef.current = sel.getRangeAt(0).cloneRange();
        const anchor = sel.anchorNode;
        const el = anchor && (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor as Element);
        savedTargetRef.current = (el?.closest(".brow__text") as HTMLElement) ?? null;
      } else {
        savedRangeRef.current = null;
        savedTargetRef.current = null;
      }
      setUrl("https://");
      setOpen(true);
      // Focus the input on next tick so it's ready to type.
      setTimeout(() => inputRef.current?.focus(), 30);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener(LINK_PROMPT_EVENT, onOpen);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(LINK_PROMPT_EVENT, onOpen);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!open || typeof document === "undefined") return null;

  function apply() {
    const value = url.trim();
    if (!value || !/^(https?:|mailto:|\/)/i.test(value)) { setOpen(false); return; }
    const range = savedRangeRef.current;
    const target = savedTargetRef.current;
    if (target && range) {
      target.focus();
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand("createLink", false, value);
      target.querySelectorAll("a[href]").forEach((a) => {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      });
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setOpen(false);
  }

  return createPortal(
    <div className="lnkpr" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
      <div className="lnkpr__panel" onClick={(e) => e.stopPropagation()}>
        <header className="lnkpr__head">
          <Link2 />
          <span>Insert link</span>
          <button type="button" className="lnkpr__x" onClick={() => setOpen(false)} aria-label="Close"><X /></button>
        </header>
        <form
          className="lnkpr__form"
          onSubmit={(e) => { e.preventDefault(); apply(); }}
        >
          <input
            ref={inputRef}
            type="url"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit">Add</button>
        </form>
        <p className="lnkpr__hint">https:// · mailto: · or /relative-path</p>
      </div>
    </div>,
    document.body,
  );
}

// ───────── Keyboard shortcuts cheat-sheet ─────────
// Press `?` outside any input/textarea/contentEditable to open. Lives
// here next to ImageLightbox because both are page-level overlays
// triggered by document events, not local component state.

const SHORTCUTS_EVENT = "workwrk:notes:shortcuts";

function openShortcuts() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT));
}

export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onOpen() { setOpen(true); }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        const t = e.target as Element | null;
        // Don't trigger inside text inputs / contentEditable — `?` is
        // a legitimate character there.
        if (t && (
          t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
          (t as HTMLElement).isContentEditable
        )) return;
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener(SHORTCUTS_EVENT, onOpen);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(SHORTCUTS_EVENT, onOpen);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="kbsc" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setOpen(false)}>
      <div className="kbsc__panel" onClick={(e) => e.stopPropagation()}>
        <header className="kbsc__head">
          <Sparkles />
          <div>
            <h2>Keyboard shortcuts</h2>
            <p>Press <kbd>Esc</kbd> to close</p>
          </div>
          <button type="button" className="kbsc__x" onClick={() => setOpen(false)} aria-label="Close"><X /></button>
        </header>
        <div className="kbsc__grid">
          <Group label="Writing">
            <Row keys={["⌘", "B"]} desc="Bold" />
            <Row keys={["⌘", "I"]} desc="Italic" />
            <Row keys={["⌘", "U"]} desc="Underline" />
            <Row keys={["⌘", "E"]} desc="Inline code" />
            <Row keys={["⌘", "K"]} desc="Insert link" />
          </Group>
          <Group label="Blocks">
            <Row keys={["/"]} desc="Open slash menu" />
            <Row keys={["@"]} desc="Mention a person, task, KRA, SOP, or board" />
            <Row keys={["# ", "Space"]} desc="Heading 1" />
            <Row keys={["## ", "Space"]} desc="Heading 2" />
            <Row keys={["- ", "Space"]} desc="Bullet list" />
            <Row keys={["1. "]} desc="Numbered list" />
            <Row keys={["[] "]} desc="To-do" />
            <Row keys={["> "]} desc="Quote" />
            <Row keys={["```"]} desc="Code block" />
            <Row keys={["---"]} desc="Divider" />
          </Group>
          <Group label="Navigation">
            <Row keys={["↑", "↓"]} desc="Move between blocks" />
            <Row keys={["Enter"]} desc="New block / pick slash item" />
            <Row keys={["Backspace"]} desc="Merge with previous block" />
            <Row keys={["Tab"]} desc="Pick slash / mention selection" />
            <Row keys={["Esc"]} desc="Close pickers, dialogs" />
          </Group>
          <Group label="Doc">
            <Row keys={["?"]} desc="Open this shortcuts sheet" />
            <Row keys={["⌘", "K"]} desc="Universal search palette" />
          </Group>
          <Group label="Open-note tabs">
            <Row keys={["⌥", "1–9"]} desc="Jump to the Nth open note tab" />
            <Row keys={["⌥", "]"]} desc="Next tab" />
            <Row keys={["⌥", "["]} desc="Previous tab" />
          </Group>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="kbsc__group">
      <h3>{label}</h3>
      <ul>{children}</ul>
    </section>
  );
}
function Row({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <li>
      <span className="kbsc__keys">
        {keys.map((k, i) => (
          <span key={i}>{i > 0 && <span className="kbsc__plus">+</span>}<kbd>{k}</kbd></span>
        ))}
      </span>
      <span className="kbsc__desc">{desc}</span>
    </li>
  );
}

// ───────── Image lightbox ─────────
// Fires a window event so any image block in any editor on the page
// can request the lightbox without needing parent prop drilling. The
// listener is mounted exactly once in <ImageLightbox/> below.
const IMAGE_LIGHTBOX_EVENT = "workwrk:notes:image-lightbox";

function openImageLightbox(url: string, alt: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(IMAGE_LIGHTBOX_EVENT, { detail: { url, alt } }));
}

export function ImageLightbox() {
  const [open, setOpen] = useState<{ url: string; alt: string } | null>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { url?: string; alt?: string } | null;
      if (!detail?.url) return;
      setOpen({ url: detail.url, alt: detail.alt ?? "" });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
    }
    window.addEventListener(IMAGE_LIGHTBOX_EVENT, onOpen);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(IMAGE_LIGHTBOX_EVENT, onOpen);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="imglb" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
      <button type="button" className="imglb__x" onClick={() => setOpen(null)} aria-label="Close"><X /></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={open.url} alt={open.alt} className="imglb__img" onClick={(e) => e.stopPropagation()} />
      {open.alt && <div className="imglb__alt">{open.alt}</div>}
    </div>,
    document.body,
  );
}

function escapeHTML(s: string): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Strip HTML tags and decode entities — used for markdown / slash / mention
// detection on user-typed content that may now include <b>/<i>/etc.
function htmlToPlain(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined") return html.replace(/<[^>]+>/g, "");
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return (tpl.content.textContent ?? "").replace(/ /g, " ");
}

// ───────── Tasks-view embed ─────────
type ApiTask = { id: string; title: string; date: string; status: string; priority: string };

function TasksViewBlock({ block, readonly, onUpdate }: { block: Extract<Block, { kind: "tasks_view" }>; readonly: boolean; onUpdate: (p: Partial<Block>) => void }) {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const MS = 86_400_000;
        const from = new Date(Date.now() - 14 * MS).toISOString().slice(0, 10);
        const to   = new Date(Date.now() + 30 * MS).toISOString().slice(0, 10);
        const res = await fetch(`/api/tasks?startDate=${from}&endDate=${to}`);
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        setTasks(Array.isArray(d) ? d : (d.data ?? []));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const list = (tasks ?? []).filter((t) => {
    if (t.status === "COMPLETED") return false;
    const due = new Date(t.date); due.setHours(0, 0, 0, 0);
    const diffDays = (due.getTime() - today0.getTime()) / 86_400_000;
    if (block.window === "today") return diffDays === 0;
    if (block.window === "overdue") return diffDays < 0;
    return diffDays >= 0 && diffDays <= 7;
  }).slice(0, 12);

  return (
    <div className="bembed bembed--tasks">
      <header className="bembed__head">
        <CheckSquare />
        <strong>Tasks · {block.window === "today" ? "Today" : block.window === "overdue" ? "Overdue" : "Next 7 days"}</strong>
        {!readonly && (
          <select className="bembed__select" value={block.window} onChange={(e) => onUpdate({ window: e.target.value as "today" | "week" | "overdue" })} onClick={(e) => e.stopPropagation()}>
            <option value="today">Today</option>
            <option value="week">Next 7 days</option>
            <option value="overdue">Overdue</option>
          </select>
        )}
        <Link href="/tasks" className="bembed__open">Open <ChevronRight /></Link>
      </header>
      {tasks === null ? (
        <div className="bembed__loading">Loading…</div>
      ) : list.length === 0 ? (
        <div className="bembed__empty">Nothing in this window.</div>
      ) : (
        <ul className="bembed__list">
          {list.map((t) => (
            <li key={t.id}>
              <span className={`bembed__dot bembed__dot--${t.priority.toLowerCase()}`} />
              <span className="bembed__title">{t.title}</span>
              <span className="bembed__chip">{new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────── Studio board embed ─────────
type ApiStudioBoard = { id: string; name: string; slug: string; layout: string; _count?: { items?: number } };

function StudioBoardBlock({ block, readonly, onUpdate }: { block: Extract<Block, { kind: "studio_board" }>; readonly: boolean; onUpdate: (p: Partial<Block>) => void }) {
  const [boards, setBoards] = useState<ApiStudioBoard[] | null>(null);
  const [picking, setPicking] = useState(!block.boardId);

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/studio/boards");
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        setBoards(d.boards ?? d.data ?? []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [picking]);

  if (!block.boardId || picking) {
    return (
      <div className="bembed bembed--pick">
        <header className="bembed__head">
          <LayoutGrid />
          <strong>Embed a Studio board</strong>
          {block.boardId && (
            <button type="button" className="bembed__cancel" onClick={() => setPicking(false)}>Cancel</button>
          )}
        </header>
        {boards === null ? (
          <div className="bembed__loading">Loading boards…</div>
        ) : boards.length === 0 ? (
          <div className="bembed__empty">No Studio boards yet. Create one at <Link href="/studio">/studio</Link>.</div>
        ) : (
          <div className="bembed__pick-list">
            {boards.map((b) => (
              <button key={b.id} type="button" onClick={() => { onUpdate({ boardId: b.id, boardName: b.name }); setPicking(false); }}>
                <LayoutGrid />
                <span>{b.name}</span>
                <em>{b.layout.toLowerCase()} · {b._count?.items ?? 0} items</em>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bembed bembed--studio">
      <header className="bembed__head">
        <LayoutGrid />
        <strong>{block.boardName ?? "Studio board"}</strong>
        {!readonly && (
          <button type="button" className="bembed__cancel" onClick={() => setPicking(true)}>Change</button>
        )}
        <Link href={`/studio/boards/${block.boardId}`} className="bembed__open">Open <ChevronRight /></Link>
      </header>
      <div className="bembed__placeholder">
        <span>Live board view embeds when opened in full.</span>
      </div>
    </div>
  );
}

// ───────── SOPs list embed ─────────
type ApiSop = { id: string; title: string; category?: string | null; status: string };

function SopsListBlock({ block, readonly, onUpdate }: { block: Extract<Block, { kind: "sops_list" }>; readonly: boolean; onUpdate: (p: Partial<Block>) => void }) {
  const [sops, setSops] = useState<ApiSop[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sops?limit=200");
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        const list: ApiSop[] = d?.data?.items ?? d?.data ?? [];
        setSops(list);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = (sops ?? []).filter((s) => block.category ? (s.category ?? "") === block.category : true).slice(0, 12);
  const categories = Array.from(new Set((sops ?? []).map((s) => s.category).filter(Boolean) as string[]));

  return (
    <div className="bembed bembed--sops">
      <header className="bembed__head">
        <BookCopy />
        <strong>SOPs{block.category ? ` · ${block.category}` : ""}</strong>
        {!readonly && categories.length > 0 && (
          <select className="bembed__select" value={block.category ?? ""} onChange={(e) => onUpdate({ category: e.target.value || undefined })} onClick={(e) => e.stopPropagation()}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <Link href="/sops" className="bembed__open">Open <ChevronRight /></Link>
      </header>
      {sops === null ? (
        <div className="bembed__loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bembed__empty">No SOPs in this view.</div>
      ) : (
        <ul className="bembed__list">
          {filtered.map((s) => (
            <li key={s.id}>
              <BookCopy style={{ width: 12, height: 12, color: "var(--os-c-teal)" }} />
              <Link href={`/sops/${s.id}`} className="bembed__title bembed__title--link">{s.title}</Link>
              {s.category && <span className="bembed__chip">{s.category}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────── Meetings view embed ─────────
type ApiMeeting = { id: string; title: string; type: string; scheduledAt: string };

function MeetingsViewBlock({ block, readonly, onUpdate }: { block: Extract<Block, { kind: "meetings_view" }>; readonly: boolean; onUpdate: (p: Partial<Block>) => void }) {
  const [meetings, setMeetings] = useState<ApiMeeting[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/meetings?limit=30");
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        setMeetings(d?.data?.items ?? d?.data ?? []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const now = Date.now();
  const filtered = (meetings ?? []).filter((m) => {
    const t = new Date(m.scheduledAt).getTime();
    return block.window === "upcoming" ? t >= now : t < now;
  }).slice(0, 8);

  return (
    <div className="bembed bembed--meetings">
      <header className="bembed__head">
        <CalendarClock />
        <strong>Meetings · {block.window}</strong>
        {!readonly && (
          <select className="bembed__select" value={block.window} onChange={(e) => onUpdate({ window: e.target.value as "upcoming" | "past" })} onClick={(e) => e.stopPropagation()}>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
          </select>
        )}
        <Link href="/meetings" className="bembed__open">Open <ChevronRight /></Link>
      </header>
      {meetings === null ? (
        <div className="bembed__loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bembed__empty">Nothing scheduled.</div>
      ) : (
        <ul className="bembed__list">
          {filtered.map((m) => (
            <li key={m.id}>
              <CalendarClock style={{ width: 12, height: 12, color: "var(--os-c-pink)" }} />
              <Link href={`/meetings/${m.id}`} className="bembed__title bembed__title--link">{m.title}</Link>
              <span className="bembed__chip">{new Date(m.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────── Form embed ─────────
type ApiForm = { id: string; name: string; fields?: unknown; submissionCount?: number };

function FormBlock({ block, readonly, onUpdate }: { block: Extract<Block, { kind: "form" }>; readonly: boolean; onUpdate: (p: Partial<Block>) => void }) {
  const [forms, setForms] = useState<ApiForm[] | null>(null);
  const [picking, setPicking] = useState(!block.formId);

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/forms");
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        setForms(d.data ?? (Array.isArray(d) ? d : []));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [picking]);

  if (!block.formId || picking) {
    return (
      <div className="bembed bembed--pick">
        <header className="bembed__head">
          <FormInput />
          <strong>Embed a Form</strong>
          {block.formId && <button type="button" className="bembed__cancel" onClick={() => setPicking(false)}>Cancel</button>}
        </header>
        {forms === null ? (
          <div className="bembed__loading">Loading forms…</div>
        ) : forms.length === 0 ? (
          <div className="bembed__empty">No forms yet. Build one at <Link href="/forms">/forms</Link>.</div>
        ) : (
          <div className="bembed__pick-list">
            {forms.map((f) => (
              <button key={f.id} type="button" onClick={() => { onUpdate({ formId: f.id, formName: f.name }); setPicking(false); }}>
                <FormInput />
                <span>{f.name}</span>
                <em>{f.submissionCount ?? 0} submissions</em>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bembed bembed--form">
      <header className="bembed__head">
        <FormInput />
        <strong>{block.formName ?? "Form"}</strong>
        {!readonly && <button type="button" className="bembed__cancel" onClick={() => setPicking(true)}>Change</button>}
        <Link href={`/forms/${block.formId}`} className="bembed__open">Open <ChevronRight /></Link>
      </header>
      <Link href={`/forms/${block.formId}/respond`} className="bembed__form-cta">
        <FormInput /> Click to fill this form →
      </Link>
    </div>
  );
}

// ───────── Data Table embed ─────────
type ApiDataTable = { id: string; name: string; rowCount?: number; columns?: unknown };

function DataTableBlock({ block, readonly, onUpdate }: { block: Extract<Block, { kind: "data_table" }>; readonly: boolean; onUpdate: (p: Partial<Block>) => void }) {
  const [tables, setTables] = useState<ApiDataTable[] | null>(null);
  const [picking, setPicking] = useState(!block.tableId);

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tables");
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        setTables(d.data ?? (Array.isArray(d) ? d : []));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [picking]);

  if (!block.tableId || picking) {
    return (
      <div className="bembed bembed--pick">
        <header className="bembed__head">
          <TableIcon />
          <strong>Embed a Table</strong>
          {block.tableId && <button type="button" className="bembed__cancel" onClick={() => setPicking(false)}>Cancel</button>}
        </header>
        {tables === null ? (
          <div className="bembed__loading">Loading tables…</div>
        ) : tables.length === 0 ? (
          <div className="bembed__empty">No tables yet. Create one at <Link href="/tables">/tables</Link>.</div>
        ) : (
          <div className="bembed__pick-list">
            {tables.map((t) => (
              <button key={t.id} type="button" onClick={() => { onUpdate({ tableId: t.id, tableName: t.name }); setPicking(false); }}>
                <TableIcon />
                <span>{t.name}</span>
                <em>{t.rowCount ?? 0} rows</em>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bembed bembed--form">
      <header className="bembed__head">
        <TableIcon />
        <strong>{block.tableName ?? "Table"}</strong>
        {!readonly && <button type="button" className="bembed__cancel" onClick={() => setPicking(true)}>Change</button>}
        <Link href={`/tables/${block.tableId}`} className="bembed__open">Open <ChevronRight /></Link>
      </header>
      <Link href={`/tables/${block.tableId}`} className="bembed__form-cta">
        <TableIcon /> Open this table →
      </Link>
    </div>
  );
}

// ───────── Mention picker (people / tasks / KRAs / SOPs / boards) ─────────
type MentionResult = { kind: EntityKind; id: string; label: string; subtitle?: string; href?: string };

function MentionPicker({ query, onPick, onClose }: { query: string; onPick: (r: MentionResult) => void; onClose: () => void }) {
  const [results, setResults] = useState<MentionResult[] | null>(null);
  const [sel, setSel] = useState(0);
  const fetchedRef = useRef(false);

  // Fetch all mentionable entities once — five endpoints in parallel.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    (async () => {
      const all: MentionResult[] = [];
      const safe = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

      const [usersRes, krasRes, sopsRes, tasksRes, boardsRes] = await Promise.all([
        safe(fetch("/api/users").then((r) => r.ok ? r.json() : null)),
        safe(fetch("/api/me/kras").then((r) => r.ok ? r.json() : null)),
        safe(fetch("/api/sops?limit=50").then((r) => r.ok ? r.json() : null)),
        safe(fetch(`/api/tasks?limit=50`).then((r) => r.ok ? r.json() : null)),
        safe(fetch("/api/studio/boards").then((r) => r.ok ? r.json() : null)),
      ]);

      extractArray(usersRes).slice(0, 30).forEach((u) => {
        if (typeof u.id === "string") {
          all.push({
            kind: "user", id: u.id as string,
            label: (u.name as string) || (u.email as string) || "Unnamed",
            subtitle: (u.role as string) || (u.email as string),
            href: `/team`,
          });
        }
      });
      extractArray(krasRes).slice(0, 30).forEach((k) => {
        if (typeof k.id === "string") {
          all.push({
            kind: "kra", id: k.id as string,
            label: (k.title as string) || (k.name as string) || "KRA",
            subtitle: "Key Result Area",
            href: `/team/alignment`,
          });
        }
      });
      extractArray(sopsRes).slice(0, 30).forEach((s) => {
        if (typeof s.id === "string") {
          all.push({
            kind: "sop", id: s.id as string,
            label: (s.title as string) || "SOP",
            subtitle: (s.category as string) || "SOP",
            href: `/sops/${s.id}`,
          });
        }
      });
      extractArray(tasksRes).slice(0, 50).forEach((t) => {
        if (typeof t.id === "string") {
          all.push({
            kind: "task", id: t.id as string,
            label: (t.title as string) || "Task",
            subtitle: t.date ? new Date(t.date as string).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Task",
            href: `/tasks`,
          });
        }
      });
      extractArray(boardsRes).slice(0, 30).forEach((b) => {
        if (typeof b.id === "string") {
          all.push({
            kind: "board", id: b.id as string,
            label: (b.name as string) || "Board",
            subtitle: ((b.layout as string) || "").toLowerCase() || "Board",
            href: `/studio/boards/${b.id}`,
          });
        }
      });

      if (!cancelled) setResults(all);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!results) return [];
    if (!q) return results.slice(0, 12);
    return results.filter((r) =>
      r.label.toLowerCase().includes(q) ||
      (r.subtitle ?? "").toLowerCase().includes(q) ||
      r.kind.includes(q),
    ).slice(0, 14);
  }, [results, query]);

  useEffect(() => { setSel(0); }, [query]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % filtered.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + filtered.length) % filtered.length); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); onPick(filtered[sel]); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [filtered, sel, onPick]);

  return (
    <div className="bment" role="listbox" onClick={(e) => e.stopPropagation()}>
      <header className="bment__head">
        <AtSign /> <span>Link a person, task, KRA, SOP or board</span>
        <em>↑↓ Enter</em>
      </header>
      {results === null ? (
        <div className="bment__loading"><Loader2 className="bedit__spin" /> Loading mentions…</div>
      ) : filtered.length === 0 ? (
        <div className="bment__empty">Nothing matches &ldquo;{query}&rdquo;.</div>
      ) : (
        <div className="bment__scroll">
          {filtered.map((r, i) => (
            <button
              key={`${r.kind}:${r.id}`}
              type="button"
              role="option"
              aria-selected={sel === i}
              className={`bment__row ${sel === i ? "is-sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(r)}
            >
              <EntityKindIcon kind={r.kind} />
              <span className="bment__txt">
                <span className="bment__label">{r.label}</span>
                {r.subtitle && <span className="bment__hint">{r.subtitle}</span>}
              </span>
              <span className={`bment__chip bment__chip--${r.kind}`}>{r.kind}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="bment__close" onClick={onClose}><X /> Close</button>
    </div>
  );
}

function extractArray(payload: unknown): Record<string, unknown>[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  const o = payload as Record<string, unknown>;
  if (Array.isArray(o.data)) return o.data as Record<string, unknown>[];
  if (Array.isArray(o.items)) return o.items as Record<string, unknown>[];
  if (Array.isArray(o.users)) return o.users as Record<string, unknown>[];
  if (Array.isArray(o.boards)) return o.boards as Record<string, unknown>[];
  if (Array.isArray(o.kras)) return o.kras as Record<string, unknown>[];
  if (Array.isArray(o.sops)) return o.sops as Record<string, unknown>[];
  if (Array.isArray(o.tasks)) return o.tasks as Record<string, unknown>[];
  const nested = (o.data ?? o.result) as Record<string, unknown> | undefined;
  if (nested && Array.isArray(nested.items)) return nested.items as Record<string, unknown>[];
  return [];
}

function EntityKindIcon({ kind }: { kind: EntityKind }) {
  const Icon =
    kind === "user" ? UserIcon :
    kind === "task" ? CheckSquare :
    kind === "board" ? LayoutGrid :
    kind === "sop" ? BookCopy :
    kind === "kra" ? Target :
    LayoutGrid;
  return <span className={`bment__icon bment__icon--${kind}`}><Icon /></span>;
}

// ───────── Toggle block ─────────
function ToggleBlock({ block, readonly, onUpdate }: { block: Extract<Block, { kind: "toggle" }>; readonly: boolean; onUpdate: (p: Partial<Block>) => void }) {
  const headRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const lastHeadRef = useRef(block.text);
  const lastBodyRef = useRef(block.body);

  // Seed DOM once on mount; re-sync only on external prop changes.
  useEffect(() => {
    const el = headRef.current;
    if (el && el.textContent !== block.text) el.textContent = block.text;
    lastHeadRef.current = block.text;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (block.text !== lastHeadRef.current && headRef.current) {
      headRef.current.textContent = block.text;
      lastHeadRef.current = block.text;
    }
  }, [block.text]);

  useEffect(() => {
    if (!block.open) return;
    const el = bodyRef.current;
    if (el && el.textContent !== block.body) el.textContent = block.body;
    lastBodyRef.current = block.body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.open]);
  useEffect(() => {
    if (block.body !== lastBodyRef.current && bodyRef.current) {
      bodyRef.current.textContent = block.body;
      lastBodyRef.current = block.body;
    }
  }, [block.body]);

  return (
    <div className="brow__toggle" id={`b-${block.id}`}>
      <header className="brow__toggle-head">
        <button
          type="button"
          className={`brow__toggle-arrow ${block.open ? "is-open" : ""}`}
          onClick={(e) => { e.stopPropagation(); onUpdate({ open: !block.open }); }}
          aria-label={block.open ? "Collapse toggle" : "Expand toggle"}
        >
          <ChevronRight />
        </button>
        <div
          ref={headRef}
          className="brow__text brow__toggle-title"
          contentEditable={!readonly}
          suppressContentEditableWarning
          data-placeholder="Toggle"
          onInput={() => {
            const t = headRef.current?.innerText ?? "";
            lastHeadRef.current = t;
            onUpdate({ text: t });
          }}
        />
      </header>
      {block.open && (
        <div
          ref={bodyRef}
          className="brow__text brow__toggle-body"
          contentEditable={!readonly}
          suppressContentEditableWarning
          data-placeholder="Hidden content — visible when the toggle is open."
          onInput={() => {
            const t = bodyRef.current?.innerText ?? "";
            lastBodyRef.current = t;
            onUpdate({ body: t });
          }}
        />
      )}
    </div>
  );
}

// ───────── AI Write block ─────────
function AiWriteBlock({ block, readonly, onUpdate }: { block: Extract<Block, { kind: "ai_write" }>; readonly: boolean; onUpdate: (p: Partial<Block>) => void }) {
  const { toast } = useOsToast();
  const [running, setRunning] = useState(false);
  const [localPrompt, setLocalPrompt] = useState(block.prompt);

  async function run() {
    const prompt = localPrompt.trim();
    if (!prompt) { toast("Tell the AI what to write."); return; }
    setRunning(true);
    try {
      const res = await fetch("/api/docs/ai/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, tone: block.tone }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toast(`AI failed: ${err.error ?? "unknown"}`);
        return;
      }
      const d = await res.json();
      const result = d.data?.text ?? d.text ?? "";
      onUpdate({ prompt, result, locked: true });
    } catch { toast("AI request failed"); }
    finally { setRunning(false); }
  }

  if (block.locked && block.result) {
    return (
      <div className="brow__ai brow__ai--locked" id={`b-${block.id}`}>
        <header className="brow__ai-head">
          <Wand2 />
          <span className="brow__ai-title">AI · {toneLabel(block.tone)}</span>
          <span className="brow__ai-prompt" title={block.prompt}>“{block.prompt.slice(0, 80)}{block.prompt.length > 80 ? "…" : ""}”</span>
          {!readonly && (
            <button type="button" className="brow__ai-btn" onClick={(e) => { e.stopPropagation(); onUpdate({ locked: false }); }}>
              <RefreshCw /> Redo
            </button>
          )}
        </header>
        <div className="brow__ai-result">
          {block.result.split(/\n\n+/).map((para, i) => <p key={i}>{para}</p>)}
        </div>
      </div>
    );
  }

  return (
    <div className="brow__ai" id={`b-${block.id}`}>
      <header className="brow__ai-head">
        <Wand2 />
        <span className="brow__ai-title">AI Write</span>
        {!readonly && (
          <select
            className="brow__ai-tone"
            value={block.tone}
            onChange={(e) => onUpdate({ tone: e.target.value as Extract<Block, { kind: "ai_write" }>["tone"] })}
            onClick={(e) => e.stopPropagation()}
          >
            <option value="expand">Expand</option>
            <option value="summarise">Summarise</option>
            <option value="rewrite">Rewrite cleaner</option>
            <option value="actions">Extract actions</option>
          </select>
        )}
      </header>
      <textarea
        className="brow__ai-prompt-input"
        value={localPrompt}
        onChange={(e) => setLocalPrompt(e.target.value)}
        onBlur={() => onUpdate({ prompt: localPrompt })}
        onClick={(e) => e.stopPropagation()}
        placeholder="Tell the AI what to write — e.g. “3 bullet points on why we're rolling out KRAs across the org”"
        rows={Math.max(2, localPrompt.split("\n").length)}
        disabled={readonly}
      />
      {!readonly && (
        <footer className="brow__ai-foot">
          <button type="button" className="brow__ai-btn brow__ai-btn--go" onClick={(e) => { e.stopPropagation(); void run(); }} disabled={running}>
            {running ? <><Loader2 className="bedit__spin" /> Writing…</> : <><Sparkles /> Generate</>}
          </button>
          <span className="brow__ai-foot-hint">Powered by your org&apos;s Claude key.</span>
        </footer>
      )}
    </div>
  );
}

function toneLabel(t: Extract<Block, { kind: "ai_write" }>["tone"]): string {
  switch (t) {
    case "expand":    return "Expand";
    case "summarise": return "Summarise";
    case "rewrite":   return "Rewrite";
    case "actions":   return "Extract actions";
  }
}

// ───────── Entity link block ─────────
// ───────── SOP card block ─────────
// Picks a specific SOP and renders a rich card inline: title, type chip,
// step count for checklist/recorded, and an Open button. Connects notes
// and SOPs the way ClickUp does — full preview, one click to dive in.
type ApiSopCard = {
  id: string;
  title: string;
  type?: "WRITTEN" | "RECORDED" | "CHECKLIST" | string | null;
  status?: string;
  category?: string | null;
  content?: {
    type?: string;
    sections?: Array<{ steps?: unknown[] }>;
    steps?: unknown[];
  } | null;
  updatedAt?: string;
};

function SopCardBlock({ block, readonly, onUpdate, onRemove }: {
  block: Extract<Block, { kind: "sop_card" }>;
  readonly: boolean;
  onUpdate: (p: Partial<Block>) => void;
  onRemove: () => void;
}) {
  const [meta, setMeta] = useState<ApiSopCard | null>(null);
  const [picking, setPicking] = useState(!block.sopId);
  const [list, setList] = useState<ApiSopCard[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!block.sopId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sops/${block.sopId}`);
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled) setMeta(d.data ?? d);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [block.sopId]);

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sops?limit=200");
        if (!res.ok) return;
        const d = await res.json();
        const items: ApiSopCard[] = d?.data?.items ?? d?.data ?? d?.items ?? [];
        if (!cancelled) setList(items);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [picking]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!list) return [];
    return list.filter((s) =>
      !q ||
      s.title.toLowerCase().includes(q) ||
      (s.category ?? "").toLowerCase().includes(q),
    ).slice(0, 40);
  }, [list, query]);

  if (picking || !block.sopId) {
    return (
      <div className="bcard bcard--picker" id={`b-${block.id}`} onClick={(e) => e.stopPropagation()}>
        <header className="bcard-pick__head">
          <BookCopy />
          <strong>Pick an SOP to embed</strong>
          {!readonly && (
            <button type="button" className="bcard-pick__x" onClick={onRemove} aria-label="Remove"><X /></button>
          )}
        </header>
        <input
          type="search"
          className="bcard-pick__search"
          placeholder="Search SOPs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {list === null ? (
          <div className="bcard-pick__loading"><Loader2 className="bedit__spin" /> Loading SOPs…</div>
        ) : filtered.length === 0 ? (
          <div className="bcard-pick__empty">No SOPs match. Create one at <Link href="/sops/new">/sops/new</Link>.</div>
        ) : (
          <ul className="bcard-pick__list">
            {filtered.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => { onUpdate({ sopId: s.id }); setPicking(false); }}>
                  <BookCopy />
                  <span className="bcard-pick__title">{s.title}</span>
                  <em className="bcard-pick__type">{(s.type ?? "WRITTEN").toLowerCase()}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const stepCount = (() => {
    if (!meta?.content) return null;
    const c = meta.content;
    if (Array.isArray(c.steps)) return c.steps.length;
    if (Array.isArray(c.sections)) {
      return c.sections.reduce((sum, sec) => sum + (sec.steps?.length ?? 0), 0);
    }
    return null;
  })();
  const typeLabel = (meta?.type ?? "WRITTEN").toLowerCase().replace(/_/g, " ");

  return (
    <div className="bcard bcard--sop" id={`b-${block.id}`} onClick={(e) => e.stopPropagation()}>
      <div className="bcard__icon"><BookCopy /></div>
      <div className="bcard__body">
        <div className="bcard__title">{meta?.title ?? "Loading…"}</div>
        <div className="bcard__meta">
          <span className="bcard__chip">{typeLabel}</span>
          {meta?.category && <span className="bcard__chip bcard__chip--muted">{meta.category}</span>}
          {stepCount !== null && <span className="bcard__chip bcard__chip--muted">{stepCount} step{stepCount === 1 ? "" : "s"}</span>}
          {meta?.status && <span className="bcard__chip bcard__chip--muted">{meta.status.toLowerCase()}</span>}
        </div>
      </div>
      <div className="bcard__actions">
        {!readonly && (
          <button type="button" className="bcard__alt" onClick={() => setPicking(true)} title="Change SOP">Change</button>
        )}
        <Link href={`/sops/${block.sopId}`} className="bcard__open">Open <ChevronRight /></Link>
        {!readonly && (
          <button type="button" className="bcard__x" onClick={onRemove} aria-label="Remove from this page">
            <X />
          </button>
        )}
      </div>
    </div>
  );
}

// ───────── Task card block ─────────
type ApiTaskCard = {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  date?: string;
  ownerName?: string;
};

function TaskCardBlock({ block, readonly, onUpdate, onRemove }: {
  block: Extract<Block, { kind: "task_card" }>;
  readonly: boolean;
  onUpdate: (p: Partial<Block>) => void;
  onRemove: () => void;
}) {
  const [meta, setMeta] = useState<ApiTaskCard | null>(null);
  const [picking, setPicking] = useState(!block.taskId);
  const [list, setList] = useState<ApiTaskCard[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!block.taskId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tasks/${block.taskId}`);
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled) setMeta(d.data ?? d);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [block.taskId]);

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tasks?limit=100");
        if (!res.ok) return;
        const d = await res.json();
        const items: ApiTaskCard[] = Array.isArray(d) ? d : (d.data ?? d.items ?? []);
        if (!cancelled) setList(items);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [picking]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!list) return [];
    return list.filter((t) => !q || t.title.toLowerCase().includes(q)).slice(0, 40);
  }, [list, query]);

  if (picking || !block.taskId) {
    return (
      <div className="bcard bcard--picker" id={`b-${block.id}`} onClick={(e) => e.stopPropagation()}>
        <header className="bcard-pick__head">
          <CheckSquare />
          <strong>Pick a task to embed</strong>
          {!readonly && (
            <button type="button" className="bcard-pick__x" onClick={onRemove} aria-label="Remove"><X /></button>
          )}
        </header>
        <input
          type="search"
          className="bcard-pick__search"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {list === null ? (
          <div className="bcard-pick__loading"><Loader2 className="bedit__spin" /> Loading tasks…</div>
        ) : filtered.length === 0 ? (
          <div className="bcard-pick__empty">No tasks match.</div>
        ) : (
          <ul className="bcard-pick__list">
            {filtered.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => { onUpdate({ taskId: t.id }); setPicking(false); }}>
                  <CheckSquare />
                  <span className="bcard-pick__title">{t.title}</span>
                  {t.date && <em className="bcard-pick__type">{new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</em>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className={`bcard bcard--task bcard--task-${(meta?.priority ?? "normal").toLowerCase()}`} id={`b-${block.id}`} onClick={(e) => e.stopPropagation()}>
      <div className="bcard__icon"><CheckSquare /></div>
      <div className="bcard__body">
        <div className="bcard__title">{meta?.title ?? "Loading…"}</div>
        <div className="bcard__meta">
          {meta?.status && <span className="bcard__chip">{meta.status.toLowerCase()}</span>}
          {meta?.priority && <span className="bcard__chip bcard__chip--muted">{meta.priority.toLowerCase()}</span>}
          {meta?.date && <span className="bcard__chip bcard__chip--muted">{new Date(meta.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
          {meta?.ownerName && <span className="bcard__chip bcard__chip--muted">@{meta.ownerName}</span>}
        </div>
      </div>
      <div className="bcard__actions">
        {!readonly && (
          <button type="button" className="bcard__alt" onClick={() => setPicking(true)}>Change</button>
        )}
        <Link href={`/tasks/${block.taskId}`} className="bcard__open">Open <ChevronRight /></Link>
        {!readonly && (
          <button type="button" className="bcard__x" onClick={onRemove} aria-label="Remove"><X /></button>
        )}
      </div>
    </div>
  );
}

// ───────── Note card block ─────────
function NoteCardBlock({ block, readonly, onUpdate, onRemove }: {
  block: Extract<Block, { kind: "note_card" }>;
  readonly: boolean;
  onUpdate: (p: Partial<Block>) => void;
  onRemove: () => void;
}) {
  const [meta, setMeta] = useState<{ title: string; emoji?: string; excerpt?: string | null } | null>(null);
  const [picking, setPicking] = useState(!block.noteId);
  const [list, setList] = useState<Array<{ id: string; title: string; excerpt?: string | null; content?: { meta?: { icon?: string } } | null }> | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!block.noteId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/docs/${block.noteId}`);
        if (!res.ok) return;
        const d = await res.json();
        const doc = d.doc ?? d;
        if (!cancelled) {
          setMeta({
            title: doc.title || "Untitled note",
            emoji: doc.content?.meta?.icon,
            excerpt: doc.excerpt,
          });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [block.noteId]);

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/docs");
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled) setList(d.docs ?? d.data ?? []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [picking]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!list) return [];
    return list.filter((d) =>
      !q ||
      d.title.toLowerCase().includes(q) ||
      (d.excerpt ?? "").toLowerCase().includes(q),
    ).slice(0, 40);
  }, [list, query]);

  if (picking || !block.noteId) {
    return (
      <div className="bcard bcard--picker" id={`b-${block.id}`} onClick={(e) => e.stopPropagation()}>
        <header className="bcard-pick__head">
          <FileIcon />
          <strong>Pick a note to embed</strong>
          {!readonly && (
            <button type="button" className="bcard-pick__x" onClick={onRemove} aria-label="Remove"><X /></button>
          )}
        </header>
        <input
          type="search"
          className="bcard-pick__search"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {list === null ? (
          <div className="bcard-pick__loading"><Loader2 className="bedit__spin" /> Loading notes…</div>
        ) : filtered.length === 0 ? (
          <div className="bcard-pick__empty">No notes match.</div>
        ) : (
          <ul className="bcard-pick__list">
            {filtered.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => { onUpdate({ noteId: d.id }); setPicking(false); }}>
                  <span style={{ fontSize: 14, width: 16, textAlign: "center" }}>{d.content?.meta?.icon ?? "📝"}</span>
                  <span className="bcard-pick__title">{d.title || "Untitled note"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="bcard bcard--note" id={`b-${block.id}`} onClick={(e) => e.stopPropagation()}>
      <div className="bcard__icon" style={{ fontSize: 18 }}>{meta?.emoji ?? "📝"}</div>
      <div className="bcard__body">
        <div className="bcard__title">{meta?.title ?? "Loading…"}</div>
        {meta?.excerpt && (
          <div className="bcard__excerpt">
            {meta.excerpt.slice(0, 140)}{meta.excerpt.length > 140 ? "…" : ""}
          </div>
        )}
      </div>
      <div className="bcard__actions">
        {!readonly && (
          <button type="button" className="bcard__alt" onClick={() => setPicking(true)}>Change</button>
        )}
        <Link href={`/docs/${block.noteId}`} className="bcard__open">Open <ChevronRight /></Link>
        {!readonly && (
          <button type="button" className="bcard__x" onClick={onRemove} aria-label="Remove"><X /></button>
        )}
      </div>
    </div>
  );
}

// ───────── Subpage block ─────────
// Empty state: prompts for a title, creates a new Doc child-linked to the
// parent. Filled state: a clickable card that opens the child doc.
function SubpageBlock({ block, readonly, onUpdate, onRemove }: {
  block: Extract<Block, { kind: "subpage" }>;
  readonly: boolean;
  onUpdate: (p: Partial<Block>) => void;
  onRemove: () => void;
}) {
  const { toast } = useOsToast();
  const [creating, setCreating] = useState(false);
  const [pendingTitle, setPendingTitle] = useState("");
  const [childMeta, setChildMeta] = useState<{ title: string; icon?: string; updatedAt: string } | null>(null);

  // Refresh child metadata when this block points to a real doc.
  useEffect(() => {
    if (!block.childDocId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/docs/${block.childDocId}`);
        if (!res.ok) return;
        const d = await res.json();
        const doc = d.doc ?? d;
        const content = doc.content as { meta?: { icon?: string } } | null;
        if (cancelled) return;
        setChildMeta({
          title: doc.title || "Untitled note",
          icon: content?.meta?.icon,
          updatedAt: doc.updatedAt,
        });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [block.childDocId]);

  async function createChild() {
    const title = pendingTitle.trim() || "Untitled sub-page";
    setCreating(true);
    try {
      // Determine the parent doc id from the URL — the subpage is tied to
      // its containing note as `entityType: "DOC", entityId: parentId`.
      const parentMatch = window.location.pathname.match(/\/docs\/([^/]+)/);
      const parentId = parentMatch?.[1];
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content: { blocks: [{ id: Math.random().toString(36).slice(2, 10), kind: "paragraph", text: "" }] },
          entityType: parentId ? "DOC" : null,
          entityId: parentId ?? null,
        }),
      });
      if (!res.ok) { toast("Couldn't create sub-page"); return; }
      const data = await res.json();
      const d = data.doc ?? data.data ?? data;
      onUpdate({ childDocId: d.id, title });
    } catch { toast("Couldn't create sub-page"); }
    finally { setCreating(false); }
  }

  if (!block.childDocId) {
    if (readonly) {
      return <div className="brow__subpage brow__subpage--empty">Empty sub-page</div>;
    }
    return (
      <div className="brow__subpage-create" id={`b-${block.id}`}>
        <FilePlus />
        <input
          type="text"
          placeholder="Sub-page title"
          value={pendingTitle}
          onChange={(e) => setPendingTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createChild(); } }}
          onClick={(e) => e.stopPropagation()}
          disabled={creating}
          autoFocus
        />
        <button type="button" onClick={(e) => { e.stopPropagation(); void createChild(); }} disabled={creating}>
          {creating ? <><Loader2 className="bedit__spin" /> Creating…</> : "Create"}
        </button>
        <button type="button" className="brow__subpage-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove">
          <X />
        </button>
      </div>
    );
  }

  const label = childMeta?.title ?? block.title ?? "Sub-page";
  const icon = childMeta?.icon ?? block.emoji ?? "📄";

  return (
    <Link href={`/docs/${block.childDocId}`} className="brow__subpage" id={`b-${block.id}`}>
      <span className="brow__subpage-icon">{icon}</span>
      <span className="brow__subpage-label">{label}</span>
      <ChevronRight className="brow__subpage-arrow" />
      {!readonly && (
        <button
          type="button"
          className="brow__subpage-x"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
          aria-label="Remove from this page"
        >
          <X />
        </button>
      )}
    </Link>
  );
}

// ───────── Image block ─────────
function ImageBlock({ block, readonly, onUpdate, onRemove }: {
  block: Extract<Block, { kind: "image" }>;
  readonly: boolean;
  onUpdate: (p: Partial<Block>) => void;
  onRemove: () => void;
}) {
  const { toast } = useOsToast();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFile(file: File) {
    if (!file.type.startsWith("image/")) { toast("Not an image"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) { toast("Upload failed"); return; }
      const d = await res.json();
      onUpdate({ url: d.url, alt: file.name });
    } catch { toast("Upload failed"); }
    finally { setUploading(false); }
  }

  if (block.url) {
    return (
      <figure className="brow__image" id={`b-${block.id}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={block.url}
          alt={block.alt ?? ""}
          style={block.width ? { maxWidth: block.width } : undefined}
          onClick={(e) => {
            e.stopPropagation();
            openImageLightbox(block.url, block.alt ?? block.caption ?? "");
          }}
        />
        {!readonly && (
          <button type="button" className="brow__image-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove image">
            <X />
          </button>
        )}
        <figcaption
          contentEditable={!readonly}
          suppressContentEditableWarning
          className="brow__image-caption"
          data-placeholder="Add a caption…"
          onBlur={(e) => onUpdate({ caption: e.currentTarget.innerText })}
          onClick={(e) => e.stopPropagation()}
          dangerouslySetInnerHTML={{ __html: escapeHTML(block.caption ?? "") }}
        />
      </figure>
    );
  }

  if (readonly) {
    return <div className="brow__image brow__image--empty">No image attached</div>;
  }

  return (
    <div
      className="brow__image-drop"
      id={`b-${block.id}`}
      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) void uploadFile(file);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadFile(f);
        }}
      />
      {uploading ? (
        <span><Loader2 className="bedit__spin" /> Uploading…</span>
      ) : (
        <>
          <ImageIcon />
          <span>Click, drop, or paste an image</span>
          <em>PNG, JPG, GIF · 10MB max</em>
        </>
      )}
    </div>
  );
}

function EntityLinkBlock({ block, readonly, onRemove }: { block: Extract<Block, { kind: "entity_link" }>; readonly: boolean; onRemove: () => void }) {
  if (!block.entityId) {
    return (
      <div className="brow__entity brow__entity--empty" id={`b-${block.id}`}>
        <AtSign />
        <span>Mention a person, task, KRA, SOP or board. Type @ to pick one.</span>
        {!readonly && (
          <button type="button" className="brow__entity-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove">
            <X />
          </button>
        )}
      </div>
    );
  }
  const href = block.href ?? "#";
  const content = (
    <>
      <EntityKindIcon kind={block.entityKind} />
      <span className="brow__entity-txt">
        <span className="brow__entity-label">@{block.label}</span>
        {block.subtitle && <span className="brow__entity-sub">{block.subtitle}</span>}
      </span>
      <span className={`brow__entity-chip brow__entity-chip--${block.entityKind}`}>{block.entityKind}</span>
    </>
  );
  return (
    <div className={`brow__entity brow__entity--${block.entityKind}`} id={`b-${block.id}`}>
      {href === "#" ? <div className="brow__entity-pill">{content}</div> : (
        <Link href={href} className="brow__entity-pill">{content}</Link>
      )}
      {!readonly && (
        <button type="button" className="brow__entity-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove">
          <X />
        </button>
      )}
    </div>
  );
}
