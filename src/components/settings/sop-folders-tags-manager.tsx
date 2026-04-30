"use client";

import { useCallback, useEffect, useState } from "react";
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
import { FolderTree, type FolderNode } from "@/components/sops/folder-tree";
import { FolderManager } from "@/components/sops/folder-manager";

/**
 * Org-admin folder + tag management for SOPs.
 *
 * Folders are the structural taxonomy + access-scope unit. Tags are
 * cross-cutting labels (e.g. "Compliance", "Q2-2026"). Both live
 * here so launch-day admins have one canonical place to keep the
 * SOP system tidy.
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

  // ---------- Folder CRUD ----------
  async function handleCreateFolder(parentId: string | null) {
    const parentName = parentId ? folders.find((f) => f.id === parentId)?.name : null;
    const name = await prompt({
      title: parentId ? `New sub-folder in "${parentName}"` : "New folder",
      description: parentId
        ? "Sub-folders inherit access from their parent unless you grant access explicitly."
        : "Top-level folder. Visible to everyone in the org until you set an access list.",
      placeholder: parentId ? "e.g. Hiring" : "e.g. HR",
      submitLabel: "Create",
    });
    if (!name) return;
    const res = await fetch("/api/sop-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    if (res.ok) { toastSuccess("Folder created"); load(); }
    else {
      const err = await res.json().catch(() => ({}));
      toastError(err.error || "Failed to create folder");
    }
  }
  async function handleRenameFolder(folder: FolderNode) {
    const next = await prompt({
      title: "Rename folder",
      description: `Currently named "${folder.name}".`,
      defaultValue: folder.name,
      submitLabel: "Save",
    });
    if (!next || next === folder.name) return;
    const res = await fetch(`/api/sop-folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    if (res.ok) { toastSuccess("Folder renamed"); load(); }
    else {
      const err = await res.json().catch(() => ({}));
      toastError(err.error || "Failed to rename folder");
    }
  }
  async function handleDeleteFolder(folder: FolderNode) {
    if (folder._count.sops > 0) {
      toastError(`"${folder.name}" still has ${folder._count.sops} SOP${folder._count.sops === 1 ? "" : "s"}. Move them out first.`);
      return;
    }
    const childCount = folders.filter((f) => f.parentId === folder.id).length;
    if (childCount > 0) {
      toastError(`"${folder.name}" still has ${childCount} sub-folder${childCount === 1 ? "" : "s"}. Delete or move them first.`);
      return;
    }
    if (!(await confirm({
      title: `Delete folder "${folder.name}"?`,
      description: "Folder access grants will also be removed. SOPs are not deleted.",
      confirmLabel: "Delete folder",
      destructive: true,
    }))) return;
    const res = await fetch(`/api/sop-folders/${folder.id}`, { method: "DELETE" });
    if (res.ok) { toastSuccess("Folder deleted"); load(); }
    else {
      const err = await res.json().catch(() => ({}));
      toastError(err.error || "Failed to delete folder");
    }
  }
  async function handleSetColor(folder: FolderNode) {
    const hex = await prompt({
      title: "Folder color",
      description: "Hex color used for the dot in the sidebar tree (e.g. #d4ff2e).",
      defaultValue: folder.color || "",
      placeholder: "#d4ff2e",
      submitLabel: "Save",
      required: false,
    });
    if (hex === null) return;
    const value = hex.trim() || null;
    if (value && !/^#[0-9a-fA-F]{6}$/.test(value)) {
      toastError("Use a 6-digit hex color, e.g. #d4ff2e");
      return;
    }
    const res = await fetch(`/api/sop-folders/${folder.id}`, {
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
      description: `"${tag.name}" is used on ${tag.count} SOP${tag.count === 1 ? "" : "s"}. Renaming updates them all.`,
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
      toastSuccess(`Renamed on ${d?.data?.updated ?? "every"} SOP`);
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
  const totalSopsAcross = folders.reduce((s, f) => s + f._count.sops, 0);

  return (
    <div className="space-y-4">
      {/* Folders */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderTreeIcon size={16} /> Folders
              </CardTitle>
              <CardDescription>
                The structural taxonomy for SOPs. Folders nest, and access
                cascades to sub-folders. Right-click a node for actions.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAccessDialog(true)}>
                <UsersIcon size={13} /> Manage access
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => handleCreateFolder(null)}>
                <Plus size={13} /> New folder
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-xs text-muted py-6 text-center">Loading folders…</div>
          ) : folders.length === 0 ? (
            <div className="text-xs text-muted py-6 text-center">
              No folders yet. Create one to start organizing SOPs.
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface-2 p-2">
              <FolderTree
                folders={folders}
                totalSops={totalSopsAcross}
                selected="all"
                onSelect={() => {}}
                onCreateChild={handleCreateFolder}
                onRename={handleRenameFolder}
                onManageAccess={() => setShowAccessDialog(true)}
                onDelete={handleDeleteFolder}
                canManage
              />
            </div>
          )}
          <p className="text-[11px] text-muted mt-3 leading-relaxed flex items-start gap-1.5">
            <Palette size={12} className="mt-0.5 shrink-0" />
            <span>
              Right-click any folder to rename or delete. Use the colored dot in
              the SOPs sidebar to recognise folders at a glance — set a color
              with Rename + the color action below if needed.
            </span>
          </p>
          {folders.length > 0 && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
              {folders.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: f.color || "#d4ff2e" }}
                  />
                  <span className="flex-1 truncate">
                    {f.name}
                    {f.parentId && (
                      <span className="text-muted ml-1">
                        · child of {folders.find((p) => p.id === f.parentId)?.name ?? "—"}
                      </span>
                    )}
                  </span>
                  <Badge variant="outline" className="text-[10px] h-5">{f._count.sops} SOP{f._count.sops === 1 ? "" : "s"}</Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSetColor(f)} aria-label={`Set color for ${f.name}`}>
                    <Palette size={12} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRenameFolder(f)} aria-label={`Rename ${f.name}`}>
                    <Pencil size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${f._count.sops > 0 ? "text-muted-2" : "text-red-400 hover:text-red-300"}`}
                    onClick={() => handleDeleteFolder(f)}
                    aria-label={`Delete ${f.name}`}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}
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
                list to consolidate duplicates ("HR" vs "Hr"), rename labels,
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
              No tags in use yet. People will add them as they create SOPs.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredTags.map((t) => (
                <div key={t.name} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2 text-xs">
                  <TagIcon size={12} className="text-muted shrink-0" />
                  <span className="flex-1 truncate font-medium">#{t.name}</span>
                  <Badge variant="outline" className="text-[10px] h-5">{t.count}</Badge>
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
                <div className="col-span-full text-[11px] text-muted text-center py-3">
                  No tags match "{tagFilter}".
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Folder access — same dialog used by the SOPs page sidebar. */}
      <FolderManager
        open={showAccessDialog}
        onOpenChange={(o) => { setShowAccessDialog(o); if (!o) load(); }}
      />
    </div>
  );
}
