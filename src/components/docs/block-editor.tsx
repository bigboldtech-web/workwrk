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
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

// ───────── Block shape ─────────
export type BlockKind = "h1" | "h2" | "h3" | "paragraph" | "todo" | "divider" | "embed" | "file" | "callout";

export type Block =
  | { id: string; kind: "h1" | "h2" | "h3" | "paragraph"; text: string }
  | { id: string; kind: "todo"; text: string; done: boolean }
  | { id: string; kind: "divider" }
  | { id: string; kind: "embed"; url: string; title?: string }
  | { id: string; kind: "file"; name: string; url: string; size?: number; mimeType?: string }
  | { id: string; kind: "callout"; text: string; tone: "info" | "warn" | "success" };

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
