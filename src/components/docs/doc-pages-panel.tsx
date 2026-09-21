"use client";

/*
 * The doc tree helpers behind /docs/[id]: `createChildPage` (the one POST
 * path for a child doc, used by the editor's "Add sub-doc", the Docs sidebar
 * tree and DocRowMenu's "New doc inside") and `useDocTree` (the flat
 * GET /api/docs list folded into siblings, ancestors and the tree root around
 * the open doc, for the editor's crumb and outline).
 *
 * Pure chrome over the EXISTING Doc tree columns (Doc.parentId / position /
 * isFolder, migration 20260608120000_doc_folders). Children are created
 * through the normal POST /api/docs {parentId} path. This file never touches
 * any doc-content save path (persist / handleEditorChange): creating a doc and
 * navigating is safe because the canvas flushes pending saves on unmount and
 * the editor's PUT uses keepalive.
 *
 * The left "Pages" panel that used to live here (a second tree beside the
 * Docs sidebar's) had no importer after the sidebar rebuild; the sidebar tree
 * is the one tree, and its row menu is DocRowMenu.
 */

import { notifyDocsChanged } from "@/components/layout/os/sidebar-refresh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBoot } from "@/components/layout/os/boot-context";

export type DocTreeRow = {
  id: string;
  title: string;
  emoji: string | null;
  parentId: string | null;
  position: number;
  updatedAt: string;
  /** The viewer's role from GET /api/docs, so the row menu gates its rows. */
  role?: "full" | "edit" | "comment" | "view";
  own?: boolean;
};

/**
 * POST a new child doc under `parentId` and broadcast the change.
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
    notifyDocsChanged();
    return id;
  } catch {
    return null;
  }
}

/**
 * Fetch the org's doc list once and derive the doc tree around `docId`:
 * sibling lists (position asc, then title), the ancestor chain (root-first,
 * cycle-guarded), and the root of the current doc's tree. Pass null to
 * disable (peek panes): no fetch fires.
 *
 * Note: GET /api/docs caps at 200 rows (updatedAt desc), so trees in very
 * large workspaces may be partial; the walk simply stops at a missing row.
 */
export function useDocTree(docId: string | null) {
  const [rows, setRows] = useState<DocTreeRow[] | null>(null);
  const { boot } = useBoot();
  const meId = boot.viewer.id;

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
        role: r.canManage ? "full" : r.myRole === "view" ? "view" : r.myRole === "comment" ? "comment" : r.myRole === "edit" ? "edit" : undefined,
        own: typeof r.createdById === "string" && !!meId && r.createdById === meId,
      })));
    } catch { /* keep the last snapshot: the tree is read-only chrome */ }
  }, [docId, meId]);

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

  // Ancestor chain of the open doc: root-first, direct parent last. A
  // visited set guards against parentId cycles from bad data; the walk also
  // hard-stops after 20 hops.
  const ancestors = useMemo(() => {
    if (!docId) return [] as DocTreeRow[];
    const chain: DocTreeRow[] = [];
    const visited = new Set<string>([docId]);
    let cur = rowsById.get(docId);
    let hops = 0;
    while (cur?.parentId && hops < 20) {
      if (visited.has(cur.parentId)) break; // cycle: stop walking
      const parent = rowsById.get(cur.parentId);
      if (!parent) break; // beyond the 200-row cap: chain is partial
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
