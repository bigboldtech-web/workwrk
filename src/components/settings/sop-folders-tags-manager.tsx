"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  FolderTree as FolderTreeIcon, Tag as TagIcon, Plus, Pencil, Trash2,
  Users as UsersIcon, Palette,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { type FolderNode } from "@/components/sops/folder-tree";
import { FolderManager } from "@/components/sops/folder-manager";

/**
 * Org-admin management for the SOP taxonomy and tags.
 *
 * One taxonomy: the SOPFolder tree is the data, but the entire UI speaks
 * Category (top-level) / Subcategory (child). Internal ids and API paths
 * keep the folder naming; user-visible copy never says "folder".
 * Two levels only going forward — subcategories can be created on
 * categories, never deeper (legacy deeper nodes still render indented).
 * Tags are cross-cutting labels (e.g. "Compliance", "Q2-2026").
 */
export function SopFoldersTagsManager() {
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [tags, setTags] = useState<Array<{ name: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState("");
  const [showAccessDialog, setShowAccessDialog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, tRes] = await Promise.all([
        fetch("/api/sop-folders"),
        fetch("/api/sop-tags"),
      ]);
      if (fRes.ok) {
        const d = await fRes.json();
        setFolders(Array.isArray(d) ? d : d.data || []);
      }
      if (tRes.ok) {
        const d = await tRes.json();
        setTags(Array.isArray(d) ? d : d.data || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Category = top-level node, Subcategory = anything below.
  const kindOf = (f: FolderNode) => (f.parentId === null ? "category" : "subcategory");
  const kindCap = (f: FolderNode) => (f.parentId === null ? "Category" : "Subcategory");

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, FolderNode[]>();
    for (const f of folders) {
      const arr = m.get(f.parentId) || [];
      arr.push(f);
      m.set(f.parentId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [folders]);

  // ---------- Category / Subcategory CRUD (SOPFolder under the hood) ----------
  async function handleCreateNode(parentId: string | null) {
    const parentName = parentId ? folders.find((f) => f.id === parentId)?.name : null;
    const name = await prompt({
      title: parentId ? `New subcategory in "${parentName}"` : "New category",
      description: parentId
        ? "Subcategories inherit access from their category unless you grant access explicitly."
        : "Top-level category. Visible to everyone in the org until you set an access list.",
      placeholder: parentId ? "e.g. Hiring" : "e.g. HR",
      submitLabel: "Create",
    });
    if (!name) return;
    const res = await fetch("/api/sop-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    if (res.ok) { toastSuccess(parentId ? "Subcategory created" : "Category created"); load(); }
    else {
      const err = await res.json().catch(() => ({}));
      toastError(err.error || `Failed to create ${parentId ? "subcategory" : "category"}`);
    }
  }
  async function handleRename(node: FolderNode) {
    const next = await prompt({
      title: `Rename ${kindOf(node)}`,
      description: `Currently named "${node.name}".`,
      defaultValue: node.name,
      submitLabel: "Save",
    });
    if (!next || next === node.name) return;
    const res = await fetch(`/api/sop-folders/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    if (res.ok) { toastSuccess(`${kindCap(node)} renamed`); load(); }
    else {
      const err = await res.json().catch(() => ({}));
      toastError(err.error || `Failed to rename ${kindOf(node)}`);
    }
  }
  async function handleDelete(node: FolderNode) {
    // Subcategories block deletion (server refuses too) — the admin must
    // clear them first. SOPs never block: they are moved, not deleted.
    const childCount = folders.filter((f) => f.parentId === node.id).length;
    if (childCount > 0) {
      toastError(`"${node.name}" still has ${childCount} subcategor${childCount === 1 ? "y" : "ies"}. Delete or move them first.`);
      return;
    }
    const parentName = node.parentId
      ? folders.find((p) => p.id === node.parentId)?.name ?? "the parent category"
      : null;
    const sopCount = node._count.sops;
    const reparentNote = sopCount > 0
      ? ` Its ${sopCount} SOP${sopCount === 1 ? "" : "s"} will move to ${parentName ? `"${parentName}"` : "Uncategorized"} — none are deleted.`
      : "";
    if (!(await confirm({
      title: `Delete ${kindOf(node)} "${node.name}"?`,
      description: `Access grants on it will also be removed.${reparentNote}`,
      confirmLabel: `Delete ${kindOf(node)}`,
      destructive: true,
    }))) return;
    const res = await fetch(`/api/sop-folders/${node.id}`, { method: "DELETE" });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      const moved = d?.sopsReparented ?? 0;
      toastSuccess(moved > 0
        ? `${kindCap(node)} deleted — ${moved} SOP${moved === 1 ? "" : "s"} moved`
        : `${kindCap(node)} deleted`);
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      toastError(err.error || `Failed to delete ${kindOf(node)}`);
    }
  }
  async function handleSetColor(node: FolderNode) {
    const hex = await prompt({
      title: `${kindCap(node)} color`,
      description: "Hex color used for the dot in the SOPs sidebar (e.g. #0073EA).",
      defaultValue: node.color || "",
      placeholder: "#0073EA",
      submitLabel: "Save",
      required: false,
    });
    if (hex === null) return;
    const value = hex.trim() || null;
    if (value && !/^#[0-9a-fA-F]{6}$/.test(value)) {
      toastError("Use a 6-digit hex color, e.g. #0073EA");
      return;
    }
    const res = await fetch(`/api/sop-folders/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: value }),
    });
    if (res.ok) { toastSuccess("Color saved"); load(); }
    else { toastError("Failed to update color"); }
  }

  // ---------- Tag CRUD ----------
  async function handleRenameTag(tag: { name: string; count: number }) {
    const next = await prompt({
      title: "Rename tag",
      description: `"${tag.name}" is used on ${tag.count} SOP${tag.count === 1 ? "" : "s"}. Renaming updates them all; renaming to an existing tag merges the two.`,
      defaultValue: tag.name,
      submitLabel: "Rename",
    });
    if (!next || next === tag.name) return;
    const res = await fetch("/api/sop-tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: tag.name, to: next }),
    });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      toastSuccess(`Renamed on ${d?.updated ?? "every"} SOP`);
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      toastError(err.error || "Failed to rename tag");
    }
  }
  async function handleDeleteTag(tag: { name: string; count: number }) {
    if (!(await confirm({
      title: `Delete tag "${tag.name}"?`,
      description: `This removes the tag from ${tag.count} SOP${tag.count === 1 ? "" : "s"}. The SOPs themselves are not deleted.`,
      confirmLabel: "Delete tag",
      destructive: true,
    }))) return;
    const res = await fetch(`/api/sop-tags?name=${encodeURIComponent(tag.name)}`, {
      method: "DELETE",
    });
    if (res.ok) { toastSuccess("Tag removed"); load(); }
    else {
      const err = await res.json().catch(() => ({}));
      toastError(err.error || "Failed to delete tag");
    }
  }

  const filteredTags = tagFilter
    ? tags.filter((t) => t.name.toLowerCase().includes(tagFilter.toLowerCase()))
    : tags;

  // One tree, hover actions on every row. "New subcategory" only on
  // categories — two levels going forward; legacy deeper nodes still render.
  function renderNode(node: FolderNode, depth: number): React.ReactNode {
    const kids = childrenOf.get(node.id) || [];
    return (
      <div key={node.id}>
        <div
          className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] hover:bg-surface-2 transition-colors"
          style={{ paddingLeft: depth * 18 + 8 }}
        >
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: node.color || "#0073EA" }}
          />
          <span className="truncate font-medium">{node.name}</span>
          <Badge variant="outline" className="text-[11px] h-5 shrink-0" title={depth === 0 ? "SOPs in this category, subcategories included" : "SOPs in this subcategory"}>
            {node.sopCountDeep} SOP{node.sopCountDeep === 1 ? "" : "s"}
          </Badge>
          <span className="flex-1" />
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {node.parentId === null && (
              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => handleCreateNode(node.id)}
                title="New subcategory"
                aria-label={`New subcategory in ${node.name}`}
              >
                <Plus size={12} />
              </Button>
            )}
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setShowAccessDialog(true)}
              title={`Manage access (${node._count.access})`}
              aria-label={`Manage access for ${node.name}`}
            >
              <UsersIcon size={12} />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => handleRename(node)}
              title="Rename"
              aria-label={`Rename ${node.name}`}
            >
              <Pencil size={12} />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => handleSetColor(node)}
              title="Set color"
              aria-label={`Set color for ${node.name}`}
            >
              <Palette size={12} />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300"
              onClick={() => handleDelete(node)}
              title={`Delete ${kindOf(node)}`}
              aria-label={`Delete ${node.name}`}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        </div>
        {kids.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const roots = childrenOf.get(null) || [];

  return (
    <div className="space-y-4">
      {/* Categories */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderTreeIcon size={16} /> Categories
              </CardTitle>
              <CardDescription>
                How the SOP library is organized: categories with subcategories
                inside them. Hover a row for actions.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAccessDialog(true)}>
                <UsersIcon size={13} /> Manage access
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => handleCreateNode(null)}>
                <Plus size={13} /> New category
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-xs text-muted py-6 text-center">Loading categories…</div>
          ) : roots.length === 0 ? (
            <div className="text-xs text-muted py-6 text-center">
              No categories yet. Create one to start organizing SOPs.
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface-2 p-2">
              {roots.map((r) => renderNode(r, 0))}
            </div>
          )}
          <p className="text-[12px] text-muted mt-3 leading-relaxed flex items-start gap-1.5">
            <UsersIcon size={12} className="mt-0.5 shrink-0" />
            <span>
              Access cascades: anyone granted a category also sees its
              subcategories. Deleting never deletes SOPs — they move to the
              parent category, or to Uncategorized.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Tags */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TagIcon size={16} /> Tags
              </CardTitle>
              <CardDescription>
                Cross-cutting labels added by anyone creating an SOP. Use this
                list to consolidate duplicates (&quot;HR&quot; vs &quot;Hr&quot;), rename labels,
                or remove unused ones.
              </CardDescription>
            </div>
            <div className="w-56">
              <Input
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                placeholder="Filter tags…"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-xs text-muted py-6 text-center">Loading tags…</div>
          ) : tags.length === 0 ? (
            <div className="text-xs text-muted py-6 text-center">
              No tags yet. Add tags while creating or editing an SOP — they
              appear here for cleanup.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredTags.map((t) => (
                <div key={t.name} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2 text-xs">
                  <TagIcon size={12} className="text-muted shrink-0" />
                  <span className="flex-1 truncate font-medium">#{t.name}</span>
                  <Badge variant="outline" className="text-[11px] h-5">{t.count}</Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRenameTag(t)} aria-label={`Rename tag ${t.name}`}>
                    <Pencil size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-400 hover:text-red-300"
                    onClick={() => handleDeleteTag(t)}
                    aria-label={`Delete tag ${t.name}`}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
              {filteredTags.length === 0 && (
                <div className="col-span-full text-[12px] text-muted text-center py-3">
                  No tags match &quot;{tagFilter}&quot;.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Category access — same dialog used by the SOPs page sidebar. */}
      <FolderManager
        open={showAccessDialog}
        onOpenChange={(o) => { setShowAccessDialog(o); if (!o) load(); }}
      />
    </div>
  );
}
