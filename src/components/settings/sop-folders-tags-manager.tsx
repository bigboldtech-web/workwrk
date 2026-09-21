"use client";

// The SOP folders and Tags tabs of Organize (spec-process section 2
// `/sops/manage`).
//
//   SOP folders  a tree of 36px rows (EntityTile in the folder's opt-in hue
//                from the eight in design-system 1.7, the name, the count of
//                SOPs), one "…" per row (Rename, Add or Edit description,
//                Share…, New subfolder, Change colour, Delete), the blue
//                "New folder" top right. The description is the field the
//                old FolderManager carried; the API still stores it, so it
//                stays editable here and shows muted after the name.
//                Share… opens the one folder share dialog on the existing
//                SOPFolderAccess store (the AccessGrant flavour waits for the
//                access flip). Delete says what it does: the SOPs inside
//                move up or become Unfiled, never deleted.
//   Tags         36px rows with the usage count, "…" Rename / Delete, a
//                filter input when there are more than 12. Tags are created
//                from the SOP page's Tags picker, never here.
//
// One taxonomy: the SOPFolder tree IS the folder system (the naming canon's
// word; the legacy category strings stay mirrored by the API, never shown).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, FolderPlus, Palette, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { SkeletonRows } from "@/components/ui/skeleton";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { RowMoreButton } from "@/components/ui/table-card";
import { Picker } from "@/components/ui/picker";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import type { FolderNode } from "@/lib/sop-folder-node";
import { SopFolderShareDialog } from "@/components/sops/sop-folder-share-dialog";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

/** The eight muted hues (design-system 1.7, tokens.css --os-status-user-N). */
const HUES: Array<{ key: string; hex: string; label: string }> = [
  { key: "1", hex: "#0B5FC2", label: "Blue" },
  { key: "2", hex: "#0F766E", label: "Teal" },
  { key: "3", hex: "#3F6212", label: "Green" },
  { key: "4", hex: "#854D0E", label: "Amber" },
  { key: "5", hex: "#9A3412", label: "Orange" },
  { key: "6", hex: "#9F1239", label: "Rose" },
  { key: "7", hex: "#475569", label: "Slate" },
  { key: "8", hex: "#57534E", label: "Stone" },
];
type Tag = { name: string; count: number };

export function SopFoldersTagsManager({ tab = "folders", canCreateTopLevel = true }: { tab?: "folders" | "tags"; canCreateTopLevel?: boolean }) {
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const [folders, setFolders] = useState<FolderNode[] | null>(null);
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [menu, setMenu] = useState<{ node: FolderNode; anchor: React.RefObject<HTMLElement | null> } | null>(null);
  const [tagMenu, setTagMenu] = useState<{ tag: Tag; anchor: React.RefObject<HTMLElement | null> } | null>(null);
  const [shareFor, setShareFor] = useState<FolderNode | null>(null);
  const [colourFor, setColourFor] = useState<{ node: FolderNode; point: { top: number; left: number } | null } | null>(null);

  const load = useCallback(async () => {
    const [f, t] = await Promise.all([
      apiFetch<FolderNode[] | { data?: FolderNode[] }>("/api/sop-folders", { cache: "no-store" }),
      apiFetch<Tag[] | { data?: Tag[] }>("/api/sop-tags", { cache: "no-store" }),
    ]);
    if (!f.ok && !t.ok) { setLoadError(true); return; }
    setLoadError(false);
    setFolders(f.ok ? (Array.isArray(f.data) ? f.data : f.data?.data ?? []) : []);
    setTags(t.ok ? (Array.isArray(t.data) ? t.data : t.data?.data ?? []) : []);
  }, []);
  useEffect(() => { const x = setTimeout(() => void load(), 0); return () => clearTimeout(x); }, [load]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, FolderNode[]>();
    for (const f of folders ?? []) { const arr = m.get(f.parentId) || []; arr.push(f); m.set(f.parentId, arr); }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [folders]);
  const kindOf = (f: FolderNode) => (f.parentId === null ? "folder" : "subfolder");

  /* ── folders ── */
  const createNode = async (parentId: string | null) => {
    const parentName = parentId ? folders?.find((f) => f.id === parentId)?.name : null;
    const name = await prompt({ title: parentId ? `New subfolder in "${parentName}"` : "New folder", description: parentId ? "Subfolders follow their folder's sharing." : `Visible to admins until you share it.`, placeholder: parentId ? "e.g. Hiring" : "e.g. HR", submitLabel: "Create" });
    if (!name) return;
    const r = await apiFetch("/api/sop-folders", { method: "POST", json: { name, parentId } });
    if (!r.ok) { toast(r.error || "Couldn't create the folder", { tone: "danger" }); return; }
    toast(parentId ? "Subfolder created" : "Folder created"); void load();
  };
  const rename = async (node: FolderNode) => {
    const next = await prompt({ title: `Rename ${kindOf(node)}`, defaultValue: node.name, submitLabel: "Save" });
    if (!next || next === node.name) return;
    const r = await apiFetch(`/api/sop-folders/${node.id}`, { method: "PATCH", json: { name: next } });
    if (!r.ok) { toast(r.error || "Couldn't rename", { tone: "danger" }); return; }
    toast("Renamed"); void load();
  };
  // The folder description the old FolderManager carried (the API stores it,
  // GET returns it): kept editable here so nothing a person wrote is stranded.
  // An empty submit clears it; Cancel leaves it as it was.
  const describe = async (node: FolderNode) => {
    const next = await prompt({ title: `Describe ${node.name}`, description: "A line about what belongs in this folder. Leave it empty to remove the description.", defaultValue: node.description ?? "", placeholder: "e.g. Everything the hiring team runs", submitLabel: "Save", required: false });
    if (next === null || next === (node.description ?? "")) return;
    const r = await apiFetch(`/api/sop-folders/${node.id}`, { method: "PATCH", json: { description: next } });
    if (!r.ok) { toast(r.error || "Couldn't save the description", { tone: "danger" }); return; }
    toast(next ? "Description saved" : "Description removed"); void load();
  };
  const setColour = async (node: FolderNode, hex: string | null) => {
    setColourFor(null);
    const r = await apiFetch(`/api/sop-folders/${node.id}`, { method: "PATCH", json: { color: hex } });
    if (!r.ok) { toast(r.error || "Couldn't save the colour", { tone: "danger" }); return; }
    void load();
  };
  const remove = async (node: FolderNode) => {
    const kids = (folders ?? []).filter((f) => f.parentId === node.id).length;
    if (kids > 0) { toast(`"${node.name}" still has ${kids} subfolder${kids === 1 ? "" : "s"}. Delete or move them first.`, { tone: "danger" }); return; }
    const parentName = node.parentId ? folders?.find((p) => p.id === node.parentId)?.name ?? "the parent folder" : null;
    const n = node._count.sops;
    const description = n > 0
      ? parentName
        ? `The ${n} SOP${n === 1 ? "" : "s"} inside move to "${parentName}". None are deleted, and this subfolder's sharing is removed.`
        : `The ${n} SOP${n === 1 ? "" : "s"} inside become Unfiled. Published ones will then be readable by everyone at ${boot.org.name} until you restrict them, and the folder's sharing is removed.`
      : `Nothing is inside it. This ${kindOf(node)}'s sharing is removed.`;
    const ok = await confirm({ title: `Delete ${node.name}?`, description, confirmLabel: `Delete ${kindOf(node)}`, destructive: true });
    if (!ok) return;
    const r = await apiFetch<{ sopsReparented?: number }>(`/api/sop-folders/${node.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete", { tone: "danger" }); return; }
    const moved = r.data?.sopsReparented ?? 0;
    toast(moved > 0 ? `Deleted, ${moved} SOP${moved === 1 ? "" : "s"} moved` : "Deleted"); void load();
  };

  /* ── tags ── */
  const renameTag = async (tag: Tag) => {
    const next = await prompt({ title: "Rename tag", description: `"${tag.name}" is on ${tag.count} SOP${tag.count === 1 ? "" : "s"}. Renaming onto an existing tag merges the two.`, defaultValue: tag.name, submitLabel: "Rename" });
    if (!next || next === tag.name) return;
    const r = await apiFetch<{ updated?: number }>("/api/sop-tags", { method: "PATCH", json: { from: tag.name, to: next } });
    if (!r.ok) { toast(r.error || "Couldn't rename the tag", { tone: "danger" }); return; }
    toast(`Renamed on ${r.data?.updated ?? "every"} SOP${(r.data?.updated ?? 2) === 1 ? "" : "s"}`); void load();
  };
  const deleteTag = async (tag: Tag) => {
    const ok = await confirm({ title: `Remove this tag from ${tag.count} SOP${tag.count === 1 ? "" : "s"}?`, description: `"${tag.name}" disappears from them. The SOPs stay.`, confirmLabel: "Delete tag", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/sop-tags?name=${encodeURIComponent(tag.name)}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete the tag", { tone: "danger" }); return; }
    toast("Tag removed"); void load();
  };

  const pointFromMenu = (m: { anchor: React.RefObject<HTMLElement | null> } | null): { top: number; left: number } | null => {
    const rect = m?.anchor.current?.getBoundingClientRect();
    return rect ? { top: rect.bottom + 4, left: Math.max(8, rect.right - 240) } : null;
  };

  function renderNode(node: FolderNode, depth: number): React.ReactNode {
    const kids = childrenOf.get(node.id) || [];
    return (
      <li key={node.id}>
        <div className="os-tc__row group/row flex h-9 items-center gap-3 border-b border-line-soft px-4 hover:bg-hover" style={{ paddingInlineStart: depth * 24 + 16 }}>
          <EntityTile size="sm" fallback="folder" name={node.name} color={node.color} />
          <span className="min-w-0 flex-1 truncate text-base text-ink">{node.name}</span>
          {node.description ? <span className="hidden min-w-0 max-w-[36%] truncate text-xs text-ink-3 md:inline" title={node.description}>{node.description}</span> : null}
          {node._count.access > 0 ? <span className="shrink-0 text-xs text-ink-3">{node._count.access} {node._count.access === 1 ? "person" : "people"}</span> : null}
          <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{node.sopCountDeep} SOP{node.sopCountDeep === 1 ? "" : "s"}</span>
          <span className="os-tc__more"><RowTrigger open={menu?.node.id === node.id} onOpen={(ref) => setMenu({ node, anchor: ref })} label={`${node.name} actions`} /></span>
        </div>
        {kids.length ? <ul>{kids.map((c) => renderNode(c, depth + 1))}</ul> : null}
      </li>
    );
  }
  const roots = childrenOf.get(null) || [];
  const filteredTags = (tags ?? []).filter((t) => !tagFilter || t.name.toLowerCase().includes(tagFilter.toLowerCase()));

  if (loadError) {
    return <p className="flex h-11 items-center gap-2 rounded-lg border border-line bg-raised px-4 text-base text-ink-2">Couldn&apos;t load this tab · <button type="button" onClick={() => void load()} className="font-medium text-brand-deep hover:underline">Retry</button></p>;
  }

  return (
    <>
      {tab === "folders" ? (
        <section className="rounded-lg border border-line bg-raised">
          <header className="flex h-12 items-center gap-2 border-b border-line px-4">
            <h2 className="min-w-0 flex-1 truncate text-row font-medium text-ink">SOP folders</h2>
            {canCreateTopLevel ? <button type="button" onClick={() => void createNode(null)} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover"><Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> New folder</button> : null}
          </header>
          {folders === null ? (
            <div className="p-3"><SkeletonRows rows={4} rowHeight="36px" /></div>
          ) : roots.length === 0 ? (
            <p className="flex h-9 items-center gap-2 px-4 text-base text-ink-2">No folders yet{canCreateTopLevel ? <> · <button type="button" onClick={() => void createNode(null)} className="font-medium text-brand-deep hover:underline">New folder</button></> : null}</p>
          ) : (
            <ul className="[&>li:last-child>div]:border-b-0">{roots.map((r) => renderNode(r, 0))}</ul>
          )}
          <p className="px-4 py-3 text-xs text-ink-3">Sharing cascades: anyone with access to a folder also sees its subfolders. Deleting never deletes SOPs: they move to the parent folder, or become Unfiled.</p>
        </section>
      ) : (
        <section className="rounded-lg border border-line bg-raised">
          <header className="flex h-12 items-center gap-2 border-b border-line px-4">
            <h2 className="min-w-0 flex-1 truncate text-row font-medium text-ink">Tags</h2>
            {(tags?.length ?? 0) > 12 ? <input type="search" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="Filter tags" aria-label="Filter tags" className="h-9 w-56 rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" /> : null}
          </header>
          {tags === null ? (
            <div className="p-3"><SkeletonRows rows={4} rowHeight="36px" /></div>
          ) : tags.length === 0 ? (
            <p className="flex h-9 items-center px-4 text-base text-ink-2">No tags yet. Add tags while editing a SOP and they appear here for cleanup.</p>
          ) : filteredTags.length === 0 ? (
            <p className="flex h-9 items-center px-4 text-base text-ink-2">No tags match &quot;{tagFilter}&quot;.</p>
          ) : (
            <ul>
              {filteredTags.map((t) => (
                <li key={t.name} className="os-tc__row group/row flex h-9 items-center gap-3 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover">
                  <span className={cn("inline-flex h-6 items-center rounded-md bg-active px-2 text-xs font-medium text-ink")}>{t.name}</span>
                  <span className="min-w-0 flex-1" />
                  <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{t.count} SOP{t.count === 1 ? "" : "s"}</span>
                  <span className="os-tc__more"><RowTrigger open={tagMenu?.tag.name === t.name} onOpen={(ref) => setTagMenu({ tag: t, anchor: ref })} label={`${t.name} actions`} /></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open onClose={() => setMenu(null)} placement="below">
          <MenuList onClick={() => setMenu(null)}>
            <MenuItem icon={Pencil} label="Rename" onClick={() => void rename(menu.node)} />
            <MenuItem icon={AlignLeft} label={menu.node.description ? "Edit description" : "Add description"} onClick={() => void describe(menu.node)} />
            <MenuItem icon={Share2} label="Share…" onClick={() => setShareFor(menu.node)} />
            {menu.node.parentId === null ? <MenuItem icon={FolderPlus} label="New subfolder" onClick={() => void createNode(menu.node.id)} /> : null}
            <MenuItem icon={Palette} label="Change colour" onClick={() => setColourFor({ node: menu.node, point: pointFromMenu(menu) })} />
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete" destructive onClick={() => void remove(menu.node)} />
          </MenuList>
        </MorePortal>
      ) : null}
      {tagMenu ? (
        <MorePortal anchorRef={tagMenu.anchor} width={200} open onClose={() => setTagMenu(null)} placement="below">
          <MenuList onClick={() => setTagMenu(null)}>
            <MenuItem icon={Pencil} label="Rename" onClick={() => void renameTag(tagMenu.tag)} />
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete" destructive onClick={() => void deleteTag(tagMenu.tag)} />
          </MenuList>
        </MorePortal>
      ) : null}
      {colourFor ? (
        <Picker open onClose={() => setColourFor(null)} ariaLabel="Folder colour" anchorPoint={colourFor.point ?? { top: 80, left: 80 }} selected={HUES.find((h) => h.hex.toLowerCase() === (colourFor.node.color ?? "").toLowerCase())?.key ?? "none"}
          onSelect={(v) => void setColour(colourFor.node, v === "none" ? null : HUES.find((h) => h.key === v)?.hex ?? null)}
          sections={[{ options: [{ value: "none", label: "Neutral", glyph: <span className="inline-block h-3 w-3 rounded-full border border-line-strong" /> }, ...HUES.map((h) => ({ value: h.key, label: h.label, glyph: <span className="inline-block h-3 w-3 rounded-full" style={{ background: h.hex }} /> }))] }]} width={220} />
      ) : null}
      <SopFolderShareDialog open={!!shareFor} onClose={() => setShareFor(null)} folder={shareFor} onSaved={() => void load()} />
    </>
  );
}

function RowTrigger({ onOpen, open, label }: { onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void; open?: boolean; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label={label} />;
}
