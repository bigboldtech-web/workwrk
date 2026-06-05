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

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal, Edit2, Palette, Share2, Archive, Loader2,
} from "lucide-react";
import { SpaceIconPicker } from "./space-icon-picker";
import { useOsToast } from "./toast";
import { MorePortal } from "./more-portal";

interface BoardRowLike {
  id: string;
  name: string;
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
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(board.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [iconName, setIconName] = useState(board.icon);
  const [color, setColor] = useState(board.color ?? "#71717A");

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
    if (!window.confirm(`Archive "${board.name}"? You can restore it later.`)) return;
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
    <div role="menu" className="bg-white rounded-xl border border-zinc-200 shadow-2xl py-1.5">
      <Item Icon={Edit2} label="Rename" onClick={() => setMode("rename")} />
      <Item Icon={Palette} label="Change icon &amp; color" onClick={() => setMode("icon")} />
      <Item
        Icon={Share2}
        label="Share &amp; permissions"
        onClick={() => {
          if (onRequestShare) {
            onClose();
            onRequestShare();
          } else {
            toast("Share coming soon");
          }
        }}
      />
      <div className="h-px bg-zinc-100 my-1" />
      <Item Icon={Archive} label="Archive board" destructive busy={busy === "archive"} onClick={archive} />
    </div>
  );
}

function Item({
  Icon,
  label,
  busy,
  destructive,
  onClick,
}: {
  Icon: typeof Edit2;
  label: string | ReactNode;
  busy?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={busy}
      className={`w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] disabled:opacity-50 ${
        destructive ? "text-red-600 hover:bg-red-50" : "text-zinc-800 hover:bg-zinc-50"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${destructive ? "text-red-500" : "text-zinc-500"}`} />
      <span className="flex-1">{label}</span>
      {busy ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400" /> : null}
    </button>
  );
}
