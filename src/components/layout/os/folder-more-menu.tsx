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

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal, Edit2, Palette, Archive, Loader2, Star,
  Link as LinkIcon, Zap,
  Download, Files, ArrowRightLeft, Copy, Trash2, Share2,
  ChevronRight,
} from "lucide-react";
import { SpaceIconPicker } from "./space-icon-picker";
import { useOsToast } from "./toast";
import { useOsShell } from "./shell-context";
import { MorePortal } from "./more-portal";

interface FolderRowLike {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface Props {
  folder: FolderRowLike;
  onUpdated?: () => void;
}

export function FolderMoreTrigger({ folder, onUpdated }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={240} open={open} placement="below">
        <FolderMoreMenu folder={folder} onClose={() => setOpen(false)} onUpdated={onUpdated} />
      </MorePortal>
    </span>
  );
}

type Mode = "menu" | "rename" | "icon";

function FolderMoreMenu({
  folder,
  onClose,
  onUpdated,
}: {
  folder: FolderRowLike;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { openTemplateCenter } = useOsShell();
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(folder.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [iconName, setIconName] = useState(folder.icon);
  const [color, setColor] = useState(folder.color ?? "#71717A");
  const [starred, setStarred] = useState<boolean | null>(null);

  // Load current favorite state once when the menu opens.
  useEffect(() => {
    let alive = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const ids: string[] = d?.effective?.home?.favoriteFolderIds ?? [];
        setStarred(ids.includes(folder.id));
      })
      .catch(() => { if (alive) setStarred(false); });
    return () => { alive = false; };
  }, [folder.id]);

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
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    if (!window.confirm(`Archive "${folder.name}"? Boards inside stay accessible.`)) return;
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
    <div role="menu" className="bg-white rounded-xl border border-zinc-200 shadow-2xl py-1.5">
      <Item
        Icon={Star}
        label={starred ? "Unfavorite" : "Favorite"}
        onClick={toggleFavorite}
        iconFilled={!!starred}
      />
      <Item Icon={Edit2} label="Rename" onClick={() => setMode("rename")} />
      <Item Icon={LinkIcon} label="Copy link" onClick={copyLink} />

      <Item Icon={Palette} label="Folder color" onClick={() => setMode("icon")} submenu />

      <div className="h-px bg-zinc-100 my-1" />

      <Item Icon={Zap}        label="Automations"    onClick={() => toast("Automations are coming soon")} />

      <div className="h-px bg-zinc-100 my-1" />

      <Item Icon={Download}       label="Imports"   onClick={() => toast("Imports are coming soon")} />
      <Item Icon={Files}          label="Browse templates" onClick={() => { onClose(); openTemplateCenter({ kind: "FOLDER" }); }} />
      <Item Icon={ArrowRightLeft} label="Move"      onClick={() => toast("Move is coming soon")} />
      <Item Icon={Copy}           label="Duplicate" onClick={() => toast("Duplicate is coming soon")} />
      <Item Icon={Archive}        label="Archive"   busy={busy === "archive"} onClick={archive} />
      <Item Icon={Trash2}         label="Delete"    destructive disabled />

      <div className="h-px bg-zinc-100 my-1" />

      <Item Icon={Share2} label="Sharing & Permissions" onClick={() => toast("Folder sharing is coming soon")} />
    </div>
  );
}

function Item({
  Icon,
  label,
  busy,
  destructive,
  onClick,
  submenu,
  disabled,
  iconFilled,
}: {
  Icon: typeof Edit2;
  label: string | ReactNode;
  busy?: boolean;
  destructive?: boolean;
  onClick?: () => void;
  submenu?: boolean;
  disabled?: boolean;
  iconFilled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={busy || disabled}
      title={disabled && !busy ? "Coming soon" : undefined}
      className={`w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] ${
        disabled
          ? "text-zinc-400 cursor-not-allowed"
          : destructive
            ? "text-red-600 hover:bg-red-50"
            : "text-zinc-800 hover:bg-zinc-50"
      } disabled:opacity-100`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${
          disabled
            ? "text-zinc-300"
            : destructive
              ? "text-red-500"
              : iconFilled
                ? "text-amber-400"
                : "text-zinc-500"
        }`}
        style={iconFilled ? { fill: "currentColor" } : undefined}
      />
      <span className="flex-1">{label}</span>
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
      ) : submenu ? (
        <ChevronRight className="h-3 w-3 text-zinc-400 shrink-0" />
      ) : null}
    </button>
  );
}
