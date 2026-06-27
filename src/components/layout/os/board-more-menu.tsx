"use client";

// BoardMoreMenu — the per-board "..." popover that sits next to ShareBoardButton
// on the Space detail page (and any future Board listing surface). Mirrors
// SpaceMoreMenu's three-mode panel: menu / rename / icon.
//
// Actions wired to existing routes:
//   Rename            → PATCH /api/boards/[id] { name }
//   Change icon&color → PATCH /api/boards/[id] { icon, color }
//   Share             → opens ShareBoardDialog (hoisted callback)
//   Archive Board     → DELETE /api/boards/[id]  (soft-archive)

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal, Edit2, Palette, Share2, Archive, Loader2, Star,
  Link as LinkIcon, Zap, Tag, CircleDot,
  Download, Files, ArrowRightLeft, Copy, Trash2, Save,
  Shapes, Info, Mail,
} from "lucide-react";
import { SpaceIconPicker } from "./space-icon-picker";
import { useOsToast } from "./toast";
import { useOsShell } from "./shell-context";
import { MorePortal } from "./more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/dialog-provider";

interface BoardRowLike {
  id: string;
  name: string;
  slug?: string;
  icon: string | null;
  color: string | null;
}

interface Props {
  board: BoardRowLike;
  onUpdated?: () => void;
  onRequestShare?: () => void;
}

export function BoardMoreTrigger({ board, onUpdated, onRequestShare }: Props) {
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
        aria-label="Board actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={240} open={open} placement="below">
        <BoardMoreMenu
          board={board}
          onClose={() => setOpen(false)}
          onUpdated={onUpdated}
          onRequestShare={onRequestShare}
        />
      </MorePortal>
    </span>
  );
}

type Mode = "menu" | "rename" | "icon";

function BoardMoreMenu({
  board,
  onClose,
  onUpdated,
  onRequestShare,
}: {
  board: BoardRowLike;
  onClose: () => void;
  onUpdated?: () => void;
  onRequestShare?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { openTemplateCenter } = useOsShell();
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(board.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [iconName, setIconName] = useState(board.icon);
  const [color, setColor] = useState(board.color ?? "#71717A");
  const [starred, setStarred] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const ids: string[] = d?.effective?.home?.favoriteBoardIds ?? [];
        setStarred(ids.includes(board.id));
      })
      .catch(() => { if (alive) setStarred(false); });
    return () => { alive = false; };
  }, [board.id]);

  const toggleFavorite = useCallback(async () => {
    if (starred === null) return;
    const next = !starred;
    setStarred(next);
    try {
      await fetch("/api/me/favorites/boards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boardId: board.id, on: next }),
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      }
    } catch {
      setStarred(starred);
    }
  }, [board.id, starred]);

  // Custom Fields / Task statuses open the matching editor on the board
  // page via ?panel=; needs the slug. Falls back to a toast if absent.
  const openBoardPanel = useCallback((panel: "fields" | "statuses") => {
    onClose();
    if (board.slug) router.push(`/boards/${board.slug}?panel=${panel}`);
    else toast("Open the List to edit this");
  }, [board.slug, onClose, router, toast]);

  const saveAsTemplate = useCallback(async () => {
    setBusy("save-template");
    try {
      const res = await fetch("/api/template-center/save-as", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "LIST", boardId: board.id }),
      });
      if (!res.ok) throw new Error();
      toast(`Saved “${board.name}” as a template`);
      onClose();
    } catch {
      toast("Couldn't save template");
    } finally {
      setBusy(null);
    }
  }, [board.id, board.name, toast, onClose]);

  const copyLink = useCallback(async () => {
    try {
      const url = `${window.location.origin}/boards/${board.id}`;
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Couldn't copy");
    }
  }, [board.id, toast]);

  const patch = async (body: Record<string, unknown>, kind: string): Promise<boolean> => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/boards/${board.id}`, {
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
    if (!(await confirm({ title: "Archive board", description: `Archive "${board.name}"? You can restore it later.`, destructive: true, confirmLabel: "Archive" }))) return;
    setBusy("archive");
    try {
      const res = await fetch(`/api/boards/${board.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Archive failed");
        return;
      }
      toast(`${board.name} archived`);
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
          Rename board
        </div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = draft.trim();
              if (v && v !== board.name) {
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
              if (!v || v === board.name) { onClose(); return; }
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
            fallbackInitial={board.name[0]?.toUpperCase() ?? "B"}
            onChange={({ iconName: next, color: nextColor }) => {
              setIconName(next);
              setColor(nextColor);
            }}
          />
          <div className="text-[12px] text-zinc-500">Same icon catalog used by Spaces.</div>
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
      <MenuItem
        icon={Star}
        label={starred ? "Unfavorite" : "Favorite"}
        onClick={toggleFavorite}
        iconFilled={!!starred}
      />
      <MenuItem icon={Edit2} label="Rename" onClick={() => setMode("rename")} />
      <MenuItem icon={LinkIcon} label="Copy link" onClick={copyLink} />

      <MenuItem icon={Palette} label="List color" onClick={() => setMode("icon")} submenu />

      <MenuSeparator />

      <MenuItem icon={Tag}       label="Custom Fields" onClick={() => openBoardPanel("fields")} />
      <MenuItem icon={CircleDot} label="Task statuses" onClick={() => openBoardPanel("statuses")} />
      <MenuItem icon={Shapes}    label="Default task type" onClick={() => { onClose(); router.push("/settings/task-types"); }} />
      <MenuItem icon={Info}      label="List info" onClick={() => { onClose(); toast(`“${board.name}” — List (Board)`); }} />
      <MenuItem icon={Mail}      label="Email to List" onClick={() => toast("Email-to-List is coming soon")} />
      <MenuItem icon={Zap}       label="Automations" onClick={() => toast("Automations are coming soon")} />

      <MenuSeparator />

      <MenuItem icon={Download}       label="Imports"   onClick={() => toast("Imports are coming soon")} />
      <MenuItem icon={Files}          label="Browse templates" onClick={() => { onClose(); openTemplateCenter({ kind: "LIST" }); }} />
      <MenuItem icon={Save}           label="Save as template" busy={busy === "save-template"} onClick={saveAsTemplate} />
      <MenuItem icon={ArrowRightLeft} label="Move"      onClick={() => toast("Move is coming soon")} />
      <MenuItem icon={Copy}           label="Duplicate" onClick={() => toast("Duplicate is coming soon")} />
      <MenuItem icon={Archive}        label="Archive"   busy={busy === "archive"} onClick={archive} />
      <MenuItem icon={Trash2}         label="Delete"    destructive disabled title="Coming soon" />

      <MenuSeparator />

      <MenuItem
        icon={Share2}
        label="Sharing & Permissions"
        onClick={() => {
          if (onRequestShare) {
            onClose();
            onRequestShare();
          } else {
            toast("Share coming soon");
          }
        }}
      />
    </MenuList>
  );
}
