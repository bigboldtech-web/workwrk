"use client";

// SopTaxonomyPicker — THE control for an SOP's Category / Subcategory.
//
// One taxonomy, one vocabulary: the SOPFolder tree is the data (top-level
// folder = Category, child = Subcategory), and this picker writes `folderId`.
// The API mirrors the names into the legacy category/subcategory strings, so
// every older reader stays consistent. No surface should offer a separate
// folder picker or a string-based category picker — this is the only door.
//
// Inline creation: admins get "+ New category / subcategory" right in the
// dropdowns (POST /api/sop-folders); non-admins see the API's 403 as a toast.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { usePrompt } from "@/components/ui/dialog-provider";
import { useToast } from "@/components/ui/toast";

export interface SopFolderNode {
  id: string;
  name: string;
  parentId: string | null;
  color?: string | null;
}

interface SopTaxonomyPickerProps {
  /** The SOP's folderId (category or subcategory node) — null = uncategorized. */
  folderId: string | null;
  /** Fired with the new folderId (null clears). Parent persists it. */
  onChange: (folderId: string | null) => void | Promise<void>;
  disabled?: boolean;
  /** Stack vertically (rail) instead of the default inline row (editors). */
  stacked?: boolean;
}

const NONE = "__none__";
const CREATE = "__create__";

export function SopTaxonomyPicker({ folderId, onChange, disabled, stacked }: SopTaxonomyPickerProps) {
  const prompt = usePrompt();
  const { error: toastError } = useToast();
  const [folders, setFolders] = useState<SopFolderNode[] | null>(null);

  const load = useCallback(() => {
    return fetch("/api/sop-folders")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (d) setFolders(Array.isArray(d) ? d : d.data || []);
      })
      .catch(() => { /* picker stays empty; SOP save is unaffected */ });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map((folders ?? []).map((f) => [f.id, f])), [folders]);
  const categories = useMemo(
    () => (folders ?? []).filter((f) => f.parentId === null),
    [folders],
  );

  // Resolve the current folderId to (categoryNode, subNode). A node deeper
  // than two levels resolves to its top-most ancestor as the category and
  // itself as the subcategory, so legacy deep trees still display.
  const { catId, subId } = useMemo(() => {
    if (!folderId || !byId.has(folderId)) return { catId: null as string | null, subId: null as string | null };
    const node = byId.get(folderId)!;
    if (node.parentId === null) return { catId: node.id, subId: null };
    let top = node;
    while (top.parentId !== null && byId.has(top.parentId)) top = byId.get(top.parentId)!;
    return { catId: top.id, subId: node.id };
  }, [folderId, byId]);

  const subs = useMemo(
    () => (folders ?? []).filter((f) => f.parentId === catId),
    [folders, catId],
  );

  async function createNode(parentId: string | null): Promise<void> {
    const name = await prompt({
      title: parentId ? "New subcategory" : "New category",
      description: parentId
        ? `Added under "${byId.get(parentId)?.name ?? ""}".`
        : "Top-level category SOP authors can pick from.",
      placeholder: parentId ? "Subcategory name" : "Category name",
    });
    if (!name?.trim()) return;
    const res = await fetch("/api/sop-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), parentId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toastError(err.error || "Couldn't create it (org admins only).");
      return;
    }
    const created = await res.json();
    const node = created.data ?? created;
    await load();
    if (node?.id) void onChange(node.id);
  }

  return (
    <div className={stacked ? "space-y-1.5" : "flex flex-wrap items-center gap-1.5"}>
      <Select
        value={catId ?? NONE}
        disabled={disabled || folders === null}
        onValueChange={(v) => {
          if (v === CREATE) { void createNode(null); return; }
          void onChange(v === NONE ? null : v);
        }}
      >
        <SelectTrigger className={stacked ? "h-8 text-xs" : "h-8 w-[170px] text-xs"}>
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No category</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
          <SelectItem value={CREATE}>+ New category…</SelectItem>
        </SelectContent>
      </Select>

      {catId && (
        <Select
          value={subId ?? NONE}
          disabled={disabled}
          onValueChange={(v) => {
            if (v === CREATE) { void createNode(catId); return; }
            void onChange(v === NONE ? catId : v);
          }}
        >
          <SelectTrigger className={stacked ? "h-8 text-xs" : "h-8 w-[180px] text-xs"}>
            <SelectValue placeholder="Subcategory" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No subcategory</SelectItem>
            {subs.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
            <SelectItem value={CREATE}>+ New subcategory…</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
