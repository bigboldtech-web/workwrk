"use client";

// FolderMoreMenu — per-folder "..." popover on the Space detail page.
// Mirrors BoardMoreMenu's three-mode panel (menu / rename / icon).
//
// Actions wired to existing /api/folders/[id] endpoints:
//   Rename            → PATCH { name }
//   Change icon&color → PATCH { icon, color }
//   Archive folder    → DELETE (soft-archive)
//
// Folders don't have visibility / member overrides (they inherit from
// Space), so there's no Share row here — keeps the menu tight.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal, Edit2, Palette, Archive, Loader2, Star, PanelLeft, PanelTop,
  Link as LinkIcon, Zap, Plus, ListChecks, FileText, Brush,
  SlidersHorizontal, CircleDot, Boxes,
  Download, Files, ArrowRightLeft, Copy, Trash2, Share2,
} from "lucide-react";
import { SpaceIconPicker } from "./space-icon-picker";
import { useOsToast } from "./toast";
import { useOsShell } from "./shell-context";
import { refreshSidebar } from "./sidebar-refresh";
import { MorePortal, type ContextMenuHandle } from "./more-portal";
import { MenuItem, MenuList, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/dialog-provider";

interface FolderRowLike {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface Props {
  folder: FolderRowLike;
  /** Parent Space id — lets "Create new" drop a List/Doc/Whiteboard in this folder. */
  spaceId?: string;
  onUpdated?: () => void;
}

export const FolderMoreTrigger = forwardRef<ContextMenuHandle, Props>(function FolderMoreTrigger(
  { folder, spaceId, onUpdated },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    openAtPoint: (x, y) => { setPoint({ x, y }); setOpen(true); },
  }), []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPoint(null);
          setOpen((v) => !v);
        }}
        className={`p-1 rounded transition-colors ${
          open ? "text-zinc-900 bg-zinc-200" : "text-zinc-500 hover:bg-zinc-200"
        }`}
        aria-label="Folder actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={244} open={open} placement="below" point={point}>
        <FolderMoreMenu folder={folder} spaceId={spaceId} onClose={() => setOpen(false)} onUpdated={onUpdated} />
      </MorePortal>
    </span>
  );
});

type Mode = "menu" | "rename" | "icon";

function FolderMoreMenu({
  folder,
  spaceId,
  onClose,
  onUpdated,
}: {
  folder: FolderRowLike;
  spaceId?: string;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { openTemplateCenter } = useOsShell();
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(folder.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [iconName, setIconName] = useState(folder.icon);
  const [color, setColor] = useState(folder.color ?? "#71717A");
  const [starred, setStarred] = useState<boolean | null>(null);
  const [pinnedTop, setPinnedTop] = useState<boolean | null>(null);

  // Load current favorite state once when the menu opens.
  useEffect(() => {
    let alive = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const ids: string[] = d?.effective?.home?.favoriteFolderIds ?? [];
        setStarred(ids.includes(folder.id));
        const pins: { kind: string; id: string }[] = d?.effective?.home?.topPins ?? [];
        setPinnedTop(pins.some((p) => p.kind === "folder" && p.id === folder.id));
      })
      .catch(() => { if (alive) { setStarred(false); setPinnedTop(false); } });
    return () => { alive = false; };
  }, [folder.id]);

  const togglePinTop = useCallback(async () => {
    if (pinnedTop === null) return;
    const next = !pinnedTop;
    setPinnedTop(next);
    try {
      await fetch("/api/me/pins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "folder", id: folder.id, on: next }),
      });
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("workwrk:pins-changed"));
    } catch {
      setPinnedTop(pinnedTop);
    }
  }, [folder.id, pinnedTop]);

  const toggleFavorite = useCallback(async () => {
    if (starred === null) return;
    const next = !starred;
    setStarred(next);
    try {
      await fetch("/api/me/favorites/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: folder.id, on: next }),
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      }
    } catch {
      setStarred(starred); // revert
    }
  }, [folder.id, starred]);

  const copyLink = useCallback(async () => {
    try {
      const url = `${window.location.origin}${window.location.pathname}#folder-${folder.id}`;
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Couldn't copy");
    }
  }, [folder.id, toast]);

  const soon = (label: string) => { toast(`${label} — coming soon`); onClose(); };

  // Create new — drops a List / Doc / Whiteboard inside this folder. Lists +
  // Docs anchor to the folder; whiteboards have no folderId so they land in the
  // Space. Fire-and-forget with a toast on failure, then jump into the new item.
  const createList = async () => {
    onClose();
    if (!spaceId) { toast("Couldn't create list"); return; }
    try {
      const res = await fetch("/api/boards", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId, folderId: folder.id, name: "New List" }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast(d?.error ?? "Couldn't create list"); return; }
      refreshSidebar();
      const slug = d?.board?.slug ?? d?.slug;
      if (slug) router.push(`/boards/${slug}`);
    } catch { toast("Couldn't create list"); }
  };
  const createDoc = async () => {
    onClose();
    try {
      const res = await fetch("/api/docs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Untitled doc",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          entityType: "FOLDER", entityId: folder.id,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast(d?.error ?? "Couldn't create doc"); return; }
      refreshSidebar();
      const id = d?.doc?.id ?? d?.id;
      if (id) router.push(`/docs/${id}`);
    } catch { toast("Couldn't create doc"); }
  };
  const createWhiteboard = async () => {
    onClose();
    try {
      const res = await fetch("/api/whiteboards", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Untitled whiteboard", ...(spaceId ? { spaceId } : {}) }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast(d?.error ?? "Couldn't create whiteboard"); return; }
      refreshSidebar();
      const id = d?.whiteboard?.id ?? d?.id;
      if (id) router.push(`/whiteboards/${id}`);
    } catch { toast("Couldn't create whiteboard"); }
  };

  const patch = async (body: Record<string, unknown>, kind: string): Promise<boolean> => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/folders/${folder.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Update failed");
        return false;
      }
      onUpdated?.();
      refreshSidebar();
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    if (!(await confirm({ title: "Archive folder", description: `Archive "${folder.name}"? Boards inside stay accessible.`, destructive: true, confirmLabel: "Archive" }))) return;
    setBusy("archive");
    try {
      const res = await fetch(`/api/folders/${folder.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Archive failed");
        return;
      }
      toast(`${folder.name} archived`);
      onUpdated?.();
      refreshSidebar();
      router.refresh();
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const del = async () => {
    if (!(await confirm({ title: "Delete folder", description: `Delete "${folder.name}"? It and its Lists move to Trash and can be restored for 60 days.`, destructive: true, confirmLabel: "Delete" }))) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/folders/${folder.id}?hard=1`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Delete failed");
        return;
      }
      toast(`${folder.name} deleted`);
      onUpdated?.();
      refreshSidebar();
      router.refresh();
      onClose();
    } finally {
      setBusy(null);
    }
  };

  if (mode === "rename") {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 shadow-2xl p-3">
        <div className="text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mb-2">
          Rename folder
        </div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = draft.trim();
              if (v && v !== folder.name) {
                patch({ name: v }, "rename").then((ok) => { if (ok) onClose(); });
              } else {
                onClose();
              }
            }
            if (e.key === "Escape") onClose();
          }}
          className="w-full h-9 px-2.5 rounded-md border border-zinc-200 bg-white text-[13px] focus:outline-none focus:border-zinc-400"
          autoFocus
        />
        <div className="flex justify-end gap-1.5 mt-2.5">
          <button
            type="button"
            onClick={() => setMode("menu")}
            disabled={Boolean(busy)}
            className="h-7 px-2.5 rounded-md text-[12px] text-zinc-600 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              const v = draft.trim();
              if (!v || v === folder.name) { onClose(); return; }
              const ok = await patch({ name: v }, "rename");
              if (ok) onClose();
            }}
            disabled={Boolean(busy) || !draft.trim()}
            className="h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy === "rename" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    );
  }

  if (mode === "icon") {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 shadow-2xl p-3">
        <div className="text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mb-2">
          Change icon &amp; color
        </div>
        <div className="flex items-center gap-3">
          <SpaceIconPicker
            iconName={iconName}
            color={color}
            fallbackInitial={folder.name[0]?.toUpperCase() ?? "F"}
            onChange={({ iconName: next, color: nextColor }) => {
              setIconName(next);
              setColor(nextColor);
            }}
          />
          <div className="text-[12px] text-zinc-500">Same icon catalog used by Spaces and Boards.</div>
        </div>
        <div className="flex justify-end gap-1.5 mt-3">
          <button
            type="button"
            onClick={() => setMode("menu")}
            disabled={Boolean(busy)}
            className="h-7 px-2.5 rounded-md text-[12px] text-zinc-600 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              const ok = await patch({ icon: iconName ?? null, color }, "icon");
              if (ok) onClose();
            }}
            disabled={Boolean(busy)}
            className="h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy === "icon" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <MenuList>
      <MenuSubmenu icon={Star} label="Favorite">
        <MenuItem
          icon={PanelLeft}
          label={starred ? "Remove from Sidebar" : "Sidebar"}
          onClick={toggleFavorite}
          iconFilled={!!starred}
        />
        <MenuItem
          icon={PanelTop}
          label={pinnedTop ? "Remove from Top" : "Top"}
          onClick={togglePinTop}
          iconFilled={!!pinnedTop}
        />
      </MenuSubmenu>
      <MenuItem icon={Edit2} label="Rename" onClick={() => setMode("rename")} />
      <MenuItem icon={LinkIcon} label="Copy link" onClick={copyLink} />

      <MenuSeparator />

      <MenuSubmenu icon={Plus} label="Create new">
        <MenuItem icon={ListChecks} label="List" onClick={createList} />
        <MenuItem icon={FileText}   label="Doc" onClick={createDoc} />
        <MenuItem icon={Brush}      label="Whiteboard" onClick={createWhiteboard} />
      </MenuSubmenu>
      <MenuItem icon={Palette} label="Folder color" onClick={() => setMode("icon")} submenu />
      <MenuItem icon={Zap} label="Automations" onClick={() => soon("Automations")} />
      <MenuItem icon={SlidersHorizontal} label="Custom Fields" onClick={() => soon("Custom Fields")} />
      <MenuItem icon={CircleDot} label="Task statuses" onClick={() => soon("Task statuses")} />
      <MenuSubmenu icon={MoreHorizontal} label="More">
        <MenuItem icon={Boxes} label="Convert to Space" onClick={() => soon("Convert to Space")} />
      </MenuSubmenu>

      <MenuSeparator />

      <MenuItem icon={Download} label="Imports" onClick={() => soon("Imports")} />
      <MenuItem icon={Files} label="Templates" onClick={() => { onClose(); openTemplateCenter({ kind: "FOLDER" }); }} />

      <MenuSeparator />

      <MenuItem icon={ArrowRightLeft} label="Move" onClick={() => soon("Move")} />
      <MenuItem icon={Copy} label="Duplicate" onClick={() => soon("Duplicate")} />
      <MenuItem icon={Archive} label="Archive" busy={busy === "archive"} onClick={archive} />
      <MenuItem icon={Trash2} label="Delete" destructive busy={busy === "delete"} onClick={del} />

      <MenuSeparator />

      {/* Sharing & Permissions — bottom accent button, like ClickUp */}
      <div className="px-1.5 pt-1 pb-0.5">
        <button
          type="button"
          onClick={() => soon("Sharing & Permissions")}
          className="w-full h-8 rounded-md text-[12.5px] font-medium text-white flex items-center justify-center gap-1.5 hover:opacity-90"
          style={{ backgroundColor: "var(--os-brand, #0073EA)" }}
        >
          <Share2 className="w-3.5 h-3.5" /> Sharing &amp; Permissions
        </button>
      </div>
    </MenuList>
  );
}
