"use client";

/* Block editor — Notion-style page composer.
 *
 * A Doc's content is stored as `{ blocks: Block[] }`. Each block is a
 * small, focused unit: heading, paragraph, todo, divider, embed,
 * callout, file-attachment. The editor reads/writes that array;
 * everything else (versions, sharing, drawer wiring) is handled by
 * the surrounding FullScreenDocEditor.
 *
 * Legacy docs with `{ html: string }` content render in read-only
 * compat mode with a "Convert to blocks" button — never lossy.
 *
 * Why a custom mini-runtime instead of TipTap/BlockNote: lets each
 * block be a real React component (Files attachment renders a true
 * /files link, Embed pulls a live preview, Todo writes to its own
 * data). Easier to extend with WorkwrK-specific block types later
 * (Person picker, Status pill, /tasks embed, /sops embed, etc.).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, GripVertical, Trash2, Type, Hash, Heading2, ListChecks,
  Minus, Link2, FileText as FileIcon, AlertCircle, Sparkles, Loader2, Check,
  CheckSquare, LayoutGrid, BookCopy, CalendarClock, FormInput, ChevronRight,
  Table as TableIcon,
} from "lucide-react";
import Link from "next/link";
import { useOsToast } from "@/components/layout/os/toast";

// ───────── Block shape ─────────
export type BlockKind =
  | "h1" | "h2" | "h3" | "paragraph"
  | "todo" | "divider" | "embed" | "file" | "callout"
  | "tasks_view" | "studio_board" | "sops_list" | "meetings_view" | "form" | "data_table";

export type Block =
  | { id: string; kind: "h1" | "h2" | "h3" | "paragraph"; text: string }
  | { id: string; kind: "todo"; text: string; done: boolean }
  | { id: string; kind: "divider" }
  | { id: string; kind: "embed"; url: string; title?: string }
  | { id: string; kind: "file"; name: string; url: string; size?: number; mimeType?: string }
  | { id: string; kind: "callout"; text: string; tone: "info" | "warn" | "success" }
  | { id: string; kind: "tasks_view"; window: "today" | "week" | "overdue"; title?: string }
  | { id: string; kind: "studio_board"; boardId: string; boardName?: string }
  | { id: string; kind: "sops_list"; category?: string }
  | { id: string; kind: "meetings_view"; window: "upcoming" | "past" }
  | { id: string; kind: "form"; formId: string; formName?: string }
  | { id: string; kind: "data_table"; tableId: string; tableName?: string };

type ApiFile = { id: string; name: string; mimeType: string; size: number; url: string };

function newId() { return Math.random().toString(36).slice(2, 10); }
function emptyParagraph(): Block { return { id: newId(), kind: "paragraph", text: "" }; }

// ───────── Slash menu ─────────
const MENU: { kind: BlockKind; label: string; Icon: React.ComponentType<{ className?: string }>; build: () => Block }[] = [
  { kind: "h1",        label: "Heading 1",     Icon: Hash,          build: () => ({ id: newId(), kind: "h1", text: "" }) },
  { kind: "h2",        label: "Heading 2",     Icon: Heading2,      build: () => ({ id: newId(), kind: "h2", text: "" }) },
  { kind: "h3",        label: "Heading 3",     Icon: Heading2,      build: () => ({ id: newId(), kind: "h3", text: "" }) },
  { kind: "paragraph", label: "Paragraph",     Icon: Type,          build: () => emptyParagraph() },
  { kind: "todo",      label: "To-do",         Icon: ListChecks,    build: () => ({ id: newId(), kind: "todo", text: "", done: false }) },
  { kind: "callout",   label: "Callout",       Icon: AlertCircle,   build: () => ({ id: newId(), kind: "callout", text: "", tone: "info" }) },
  { kind: "divider",   label: "Divider",       Icon: Minus,         build: () => ({ id: newId(), kind: "divider" }) },
  { kind: "embed",     label: "Embed URL",     Icon: Link2,         build: () => ({ id: newId(), kind: "embed", url: "", title: "" }) },
  { kind: "file",      label: "File attachment", Icon: FileIcon,    build: () => ({ id: newId(), kind: "file", name: "", url: "" }) },
  { kind: "tasks_view",    label: "Tasks view",    Icon: CheckSquare,    build: () => ({ id: newId(), kind: "tasks_view", window: "today" }) },
  { kind: "studio_board",  label: "Studio board",  Icon: LayoutGrid,     build: () => ({ id: newId(), kind: "studio_board", boardId: "" }) },
  { kind: "sops_list",     label: "SOPs",          Icon: BookCopy,       build: () => ({ id: newId(), kind: "sops_list" }) },
  { kind: "meetings_view", label: "Meetings",      Icon: CalendarClock,  build: () => ({ id: newId(), kind: "meetings_view", window: "upcoming" }) },
  { kind: "form",          label: "Form",          Icon: FormInput,      build: () => ({ id: newId(), kind: "form", formId: "" }) },
  { kind: "data_table",    label: "Table",         Icon: TableIcon,      build: () => ({ id: newId(), kind: "data_table", tableId: "" }) },
];

// ───────── Editor ─────────
export interface BlockEditorProps {
  initialBlocks: Block[] | null;
  /** Called debounced after any change. Returns when save completes. */
  onSave: (blocks: Block[]) => Promise<void> | void;
  /** Whether the user can edit (false → read-only render). */
  readonly?: boolean;
}

export function BlockEditor({ initialBlocks, onSave, readonly = false }: BlockEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(() =>
    initialBlocks && initialBlocks.length > 0 ? initialBlocks : [emptyParagraph()]
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Debounced save (800ms).
  useEffect(() => {
    if (!dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      await onSave(blocks);
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => s === "saved" ? "idle" : s), 1200);
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [blocks, onSave]);

  function update(id: string, patch: Partial<Block>) {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, ...patch } as Block : b));
    dirty.current = true;
  }
  function insertAfter(afterId: string | null, b: Block) {
    setBlocks((prev) => {
      if (afterId === null) return [...prev, b];
      const i = prev.findIndex((x) => x.id === afterId);
      if (i < 0) return [...prev, b];
      const next = [...prev]; next.splice(i + 1, 0, b);
      return next;
    });
    dirty.current = true;
    setActiveId(b.id);
    setMenuFor(null);
  }
  function remove(id: string) {
    setBlocks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      return next.length === 0 ? [emptyParagraph()] : next;
    });
    dirty.current = true;
  }

  return (
    <div className={`bedit ${readonly ? "is-readonly" : ""}`}>
      {!readonly && (
        <div className="bedit__status">
          {saveState === "saving" && <><Loader2 className="bedit__spin" /> Saving…</>}
          {saveState === "saved"  && <><Check /> Saved</>}
        </div>
      )}
      <div className="bedit__stack">
        {blocks.map((b) => (
          <BlockRow
            key={b.id}
            block={b}
            readonly={readonly}
            isActive={activeId === b.id}
            menuOpen={menuFor === b.id}
            onActivate={() => setActiveId(b.id)}
            onUpdate={(patch) => update(b.id, patch)}
            onRemove={() => remove(b.id)}
            onOpenMenu={() => setMenuFor(menuFor === b.id ? null : b.id)}
            onSelectKind={(item) => insertAfter(b.id, item.build())}
            onEnterAtEnd={() => insertAfter(b.id, emptyParagraph())}
          />
        ))}
        {!readonly && (
          <button type="button" className="bedit__add-end" onClick={() => insertAfter(null, emptyParagraph())}>
            <Plus /> Add a block
          </button>
        )}
      </div>
    </div>
  );
}

// ───────── Block row ─────────
function BlockRow({
  block, readonly, isActive, menuOpen,
  onActivate, onUpdate, onRemove, onOpenMenu, onSelectKind, onEnterAtEnd,
}: {
  block: Block;
  readonly: boolean;
  isActive: boolean;
  menuOpen: boolean;
  onActivate: () => void;
  onUpdate: (patch: Partial<Block>) => void;
  onRemove: () => void;
  onOpenMenu: () => void;
  onSelectKind: (item: (typeof MENU)[number]) => void;
  onEnterAtEnd: () => void;
}) {
  return (
    <div className={`brow brow--${block.kind} ${isActive ? "is-active" : ""}`} onClick={onActivate}>
      {!readonly && (
        <div className="brow__gutter">
          <button type="button" className="brow__handle" title="Insert block" onClick={(e) => { e.stopPropagation(); onOpenMenu(); }}>
            <Plus />
          </button>
          <button type="button" className="brow__handle" title="Delete block" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            <Trash2 />
          </button>
        </div>
      )}

      <div className="brow__body">
        <BlockContent block={block} readonly={readonly} onUpdate={onUpdate} onEnterAtEnd={onEnterAtEnd} />
      </div>

      {menuOpen && !readonly && (
        <div className="brow__menu" onClick={(e) => e.stopPropagation()}>
          <header><Sparkles /> Add block below</header>
          <div className="brow__menu-grid">
            {MENU.map((item) => (
              <button key={item.kind} type="button" onClick={() => onSelectKind(item)}>
                <item.Icon />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────── Block content (per-type) ─────────
function BlockContent({
  block, readonly, onUpdate, onEnterAtEnd,
}: {
  block: Block;
  readonly: boolean;
  onUpdate: (patch: Partial<Block>) => void;
  onEnterAtEnd: () => void;
}) {
  const placeholderMap: Record<BlockKind, string> = {
    h1: "Heading 1",
    h2: "Heading 2",
    h3: "Heading 3",
    paragraph: "Write something… (type / for blocks)",
    todo: "To-do",
    callout: "Callout text",
    divider: "",
    embed: "https://…",
    file: "",
    tasks_view: "",
    studio_board: "",
    sops_list: "",
    meetings_view: "",
    form: "",
    data_table: "",
  };

  // Text-style blocks
  if (block.kind === "h1" || block.kind === "h2" || block.kind === "h3" || block.kind === "paragraph") {
    const Tag = (block.kind === "paragraph" ? "p" : block.kind) as keyof React.JSX.IntrinsicElements;
    return (
      <Tag
        className="brow__text"
        contentEditable={!readonly}
        suppressContentEditableWarning
        data-placeholder={placeholderMap[block.kind]}
        onBlur={(e) => onUpdate({ text: (e.target as HTMLElement).innerText })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onUpdate({ text: (e.target as HTMLElement).innerText });
            onEnterAtEnd();
          }
        }}
        dangerouslySetInnerHTML={{ __html: escapeHTML(block.text) }}
      />
    );
  }

  if (block.kind === "todo") {
    return (
      <div className={`brow__todo ${block.done ? "is-done" : ""}`}>
        <button type="button" className="brow__todo-check" onClick={(e) => { e.stopPropagation(); onUpdate({ done: !block.done }); }} disabled={readonly}>
          {block.done ? "✓" : ""}
        </button>
        <span
          className="brow__text"
          contentEditable={!readonly}
          suppressContentEditableWarning
          data-placeholder={placeholderMap.todo}
          onBlur={(e) => onUpdate({ text: (e.target as HTMLElement).innerText })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onUpdate({ text: (e.target as HTMLElement).innerText });
              onEnterAtEnd();
            }
          }}
          dangerouslySetInnerHTML={{ __html: escapeHTML(block.text) }}
        />
      </div>
    );
  }

  if (block.kind === "callout") {
    return (
      <div className={`brow__callout brow__callout--${block.tone}`}>
        <AlertCircle />
        <span
          className="brow__text"
          contentEditable={!readonly}
          suppressContentEditableWarning
          data-placeholder={placeholderMap.callout}
          onBlur={(e) => onUpdate({ text: (e.target as HTMLElement).innerText })}
          dangerouslySetInnerHTML={{ __html: escapeHTML(block.text) }}
        />
        {!readonly && (
          <select
            value={block.tone}
            onChange={(e) => onUpdate({ tone: e.target.value as "info" | "warn" | "success" })}
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

  if (block.kind === "divider") {
    return <hr className="brow__divider" />;
  }

  if (block.kind === "embed") {
    return (
      <div className="brow__embed">
        {!readonly && (
          <input
            type="url"
            className="brow__embed-input"
            placeholder={placeholderMap.embed}
            defaultValue={block.url}
            onBlur={(e) => onUpdate({ url: e.target.value.trim() })}
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

  if (block.kind === "file") {
    return <FileBlock block={block} readonly={readonly} onUpdate={onUpdate} />;
  }

  if (block.kind === "tasks_view") {
    return <TasksViewBlock block={block} readonly={readonly} onUpdate={onUpdate} />;
  }
  if (block.kind === "studio_board") {
    return <StudioBoardBlock block={block} readonly={readonly} onUpdate={onUpdate} />;
  }
  if (block.kind === "sops_list") {
    return <SopsListBlock block={block} readonly={readonly} onUpdate={onUpdate} />;
  }
  if (block.kind === "meetings_view") {
    return <MeetingsViewBlock block={block} readonly={readonly} onUpdate={onUpdate} />;
  }
  if (block.kind === "form") {
    return <FormBlock block={block} readonly={readonly} onUpdate={onUpdate} />;
  }
  if (block.kind === "data_table") {
    return <DataTableBlock block={block} readonly={readonly} onUpdate={onUpdate} />;
  }

  return null;
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
function escapeHTML(s: string): string {
  // We render via dangerouslySetInnerHTML so the editor can show the
  // current text content, but we escape so user input can't inject.
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
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
