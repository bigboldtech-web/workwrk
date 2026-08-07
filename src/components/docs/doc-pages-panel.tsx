"use client";

/*
 * DocPagesPanel — the left "Pages" tree inside /docs/[id] (ClickUp parity).
 *
 * Pure chrome over the EXISTING Doc tree columns (Doc.parentId / position /
 * isFolder — real columns, migration 20260608120000_doc_folders). The tree is
 * assembled client-side from the flat GET /api/docs response; children are
 * created through the normal POST /api/docs {parentId} path. This file never
 * touches any doc-content save path (persist / handleEditorChange) — creating
 * a page and navigating is safe because the canvas flushes pending saves on
 * unmount and the editor's PUT uses keepalive.
 *
 * Row actions reuse the shared NoteActionMenu (rename / copy link / favorite /
 * duplicate / trash); its dispatchDocsChanged event refreshes every surface,
 * including this panel. Drag-reorder is deliberately omitted (not stubbed).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, FileText, MoreHorizontal, PanelLeftClose, Plus } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { NoteActionMenu, useNoteMenu } from "./note-actions-menu";
import { renderNoteIcon } from "./note-icon";

export type DocTreeRow = {
  id: string;
  title: string;
  emoji: string | null;
  parentId: string | null;
  position: number;
  updatedAt: string;
};

/**
 * POST a new child page under `parentId` and broadcast the change.
 * Returns the new doc id, or null on failure (caller shows the toast).
 */
export async function createChildPage(parentId: string | null): Promise<string | null> {
  try {
    const res = await fetch("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled", content: {}, parentId }),
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    const id: string | undefined = d?.doc?.id ?? d?.data?.id ?? d?.id;
    if (!id) return null;
    window.dispatchEvent(new CustomEvent("workwrk:docs-changed"));
    return id;
  } catch {
    return null;
  }
}

/**
 * Fetch the org's doc list once and derive the page tree around `docId`:
 * sibling lists (position asc, then title), the ancestor chain (root-first,
 * cycle-guarded), and the root of the current doc's tree. Pass null to
 * disable (peek panes) — no fetch fires.
 *
 * Note: GET /api/docs caps at 200 rows (updatedAt desc), so trees in very
 * large workspaces may be partial — the walk simply stops at a missing row.
 */
export function useDocTree(docId: string | null) {
  const [rows, setRows] = useState<DocTreeRow[] | null>(null);

  const refresh = useCallback(async () => {
    if (!docId) return;
    try {
      const res = await fetch("/api/docs", { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      const list = (d.docs ?? []) as Array<Record<string, unknown>>;
      setRows(list.map((r) => ({
        id: String(r.id),
        title: typeof r.title === "string" ? r.title : "",
        emoji: typeof r.emoji === "string" ? r.emoji : null,
        parentId: typeof r.parentId === "string" ? r.parentId : null,
        position: typeof r.position === "number" ? r.position : 0,
        updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
      })));
    } catch { /* keep the last snapshot — panel is read-only chrome */ }
  }, [docId]);

  useEffect(() => {
    if (!docId) return;
    const run = async () => { await refresh(); };
    void run();
    const onChanged = () => { void run(); };
    window.addEventListener("workwrk:docs-changed", onChanged);
    window.addEventListener("workwrk:sidebar-refresh", onChanged);
    return () => {
      window.removeEventListener("workwrk:docs-changed", onChanged);
      window.removeEventListener("workwrk:sidebar-refresh", onChanged);
    };
  }, [docId, refresh]);

  const rowsById = useMemo(() => {
    const m = new Map<string, DocTreeRow>();
    for (const r of rows ?? []) m.set(r.id, r);
    return m;
  }, [rows]);

  const byParent = useMemo(() => {
    const m = new Map<string, DocTreeRow[]>();
    for (const r of rows ?? []) {
      if (!r.parentId) continue;
      const arr = m.get(r.parentId);
      if (arr) arr.push(r);
      else m.set(r.parentId, [r]);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.position - b.position) || a.title.localeCompare(b.title));
    }
    return m;
  }, [rows]);

  const childrenOf = useCallback((id: string): DocTreeRow[] => byParent.get(id) ?? [], [byParent]);

  // Ancestor chain of the open doc — root-first, direct parent last. A
  // visited set guards against parentId cycles from bad data; the walk also
  // hard-stops after 20 hops.
  const ancestors = useMemo(() => {
    if (!docId) return [] as DocTreeRow[];
    const chain: DocTreeRow[] = [];
    const visited = new Set<string>([docId]);
    let cur = rowsById.get(docId);
    let hops = 0;
    while (cur?.parentId && hops < 20) {
      if (visited.has(cur.parentId)) break; // cycle — stop walking
      const parent = rowsById.get(cur.parentId);
      if (!parent) break; // beyond the 200-row cap — chain is partial
      visited.add(parent.id);
      chain.unshift(parent);
      cur = parent;
      hops += 1;
    }
    return chain;
  }, [docId, rowsById]);

  const rootId = docId ? (ancestors[0]?.id ?? docId) : null;

  return { rows, rowsById, childrenOf, ancestors, rootId, refresh };
}

export function DocPagesPanel({
  docId,
  rootId,
  rowsById,
  childrenOf,
  ancestors,
  refresh,
  currentTitle,
  currentEmoji,
  onNavigate,
  onCollapse,
}: {
  docId: string;
  rootId: string;
  rowsById: Map<string, DocTreeRow>;
  childrenOf: (id: string) => DocTreeRow[];
  ancestors: DocTreeRow[];
  refresh: () => void;
  /** Live title/icon of the open doc so the active row tracks typing. */
  currentTitle?: string;
  currentEmoji?: string | null;
  onNavigate: (id: string) => void;
  onCollapse: () => void;
}) {
  const { toast } = useOsToast();
  const noteMenu = useNoteMenu();

  // Favorite ids so the "…" menu shows the right favorite toggle state.
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/preferences");
        if (!res.ok) return;
        const d = await res.json();
        const ids: string[] = d.effective?.home?.favoriteDocIds ?? [];
        if (!cancelled) setFavIds(new Set(ids));
      } catch { /* ignore */ }
    };
    void load();
    const onFavs = () => { void load(); };
    window.addEventListener("workwrk:favs-changed", onFavs);
    return () => { cancelled = true; window.removeEventListener("workwrk:favs-changed", onFavs); };
  }, []);

  // Expansion is derived: rows along the ancestor path (plus the root and
  // the open doc) default open so the current page is always visible, and a
  // per-row override map records the user's explicit toggles — which then
  // stick across refetches without any state-seeding effect.
  const defaultOpen = useMemo(
    () => new Set<string>([rootId, docId, ...ancestors.map((a) => a.id)]),
    [rootId, docId, ancestors],
  );
  const [openOverrides, setOpenOverrides] = useState<Map<string, boolean>>(new Map());
  const isExpanded = (id: string) => openOverrides.get(id) ?? defaultOpen.has(id);
  const toggleExpand = (id: string) => {
    setOpenOverrides((prev) => new Map(prev).set(id, !isExpanded(id)));
  };

  async function addPage(parentId: string) {
    const id = await createChildPage(parentId);
    if (!id) { toast("Couldn't create page"); return; }
    setOpenOverrides((prev) => new Map(prev).set(parentId, true));
    onNavigate(id);
  }

  // Root row falls back to the open doc when the fetch hasn't landed yet
  // (or the doc sits beyond the 200-row list cap).
  const rootRow: DocTreeRow = rowsById.get(rootId) ?? {
    id: docId,
    title: currentTitle ?? "",
    emoji: currentEmoji ?? null,
    parentId: null,
    position: 0,
    updatedAt: "",
  };

  const renderRow = (row: DocTreeRow, depth: number): ReactNode => {
    if (depth > 20) return null; // belt-and-braces against cyclic data
    const kids = childrenOf(row.id);
    const isOpen = isExpanded(row.id);
    const active = row.id === docId;
    const title = ((active ? (currentTitle ?? row.title) : row.title) || "Untitled").trim() || "Untitled";
    const emoji = active ? (currentEmoji ?? null) : row.emoji;
    return (
      <div key={row.id}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigate(row.id)}
          onKeyDown={(e) => { if (e.key === "Enter") onNavigate(row.id); }}
          onContextMenu={(e) => noteMenu.open(e, { id: row.id, title, favorite: favIds.has(row.id) })}
          className={`group/prow flex items-center gap-1.5 h-7 pr-1 rounded-md text-[13px] cursor-pointer ${
            active ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-zinc-50"
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              aria-label={isOpen ? "Collapse" : "Expand"}
              aria-expanded={isOpen}
              onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}
              className="w-3 shrink-0 grid place-items-center text-zinc-400 hover:text-zinc-700"
            >
              <ChevronRight className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
            </button>
          ) : (
            <span className="w-3 shrink-0" aria-hidden />
          )}
          <span className="w-4 shrink-0 grid place-items-center text-[13px] [&_svg]:w-3.5 [&_svg]:h-3.5 [&_img]:w-4 [&_img]:h-4 [&_img]:rounded-[3px] [&_img]:object-cover">
            {emoji ? renderNoteIcon(emoji) : <FileText className="w-3.5 h-3.5 text-zinc-400" />}
          </span>
          <span className="flex-1 truncate">{title}</span>
          <button
            type="button"
            aria-label="Add subpage"
            title="Add subpage"
            onClick={(e) => { e.stopPropagation(); void addPage(row.id); }}
            className="opacity-0 group-hover/prow:opacity-100 w-5 h-5 grid place-items-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Page actions"
            title="Page actions"
            onClick={(e) => { e.stopPropagation(); noteMenu.open(e, { id: row.id, title, favorite: favIds.has(row.id) }); }}
            className="opacity-0 group-hover/prow:opacity-100 w-5 h-5 grid place-items-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 shrink-0"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
        {isOpen && kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );
  };

  return (
    <aside
      aria-label="Pages"
      className="w-[240px] shrink-0 self-start sticky border-r border-zinc-100 px-2 pt-3 pb-6 overflow-y-auto"
      style={{
        // 49px = bdoc__head height (h-7 content + 10px padding x2 + 1px border);
        // the header is sticky at var(--doctabs-h) so the panel sits just below.
        top: "calc(var(--doctabs-h, 0px) + 49px)",
        maxHeight: "calc(100vh - var(--doctabs-h, 0px) - 49px)",
      }}
    >
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Pages</span>
        <button
          type="button"
          onClick={onCollapse}
          title="Hide pages"
          aria-label="Hide pages panel"
          className="w-5 h-5 grid place-items-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => void addPage(docId)}
        className="flex w-full items-center gap-1.5 h-7 px-2 rounded-md text-[12.5px] font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700"
      >
        <Plus className="w-3.5 h-3.5" /> Add page
      </button>

      <div className="mt-1 flex flex-col gap-0.5">{renderRow(rootRow, 0)}</div>

      {noteMenu.menu && (
        <NoteActionMenu
          target={noteMenu.menu.target}
          x={noteMenu.menu.x}
          y={noteMenu.menu.y}
          onClose={noteMenu.close}
          onChanged={() => refresh()}
        />
      )}
    </aside>
  );
}
