"use client";

// CanvasMoreMenu — per-canvas "..." popover for the sidebar Space tree.
// Mirrors TableMoreMenu (rename + delete) with a Copy-link entry, since a
// Canvas row previously had no way to be managed from the tree.
//
// Actions:
//   Rename    → PATCH  /api/whiteboards/[id] { name }
//   Copy link → clipboard `${origin}/canvas/[id]`
//   Delete    → DELETE /api/whiteboards/[id]

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MoreHorizontal, Edit2, Link2, Trash2, Loader2 } from "lucide-react";
import { useOsToast } from "./toast";
import { refreshSidebar } from "./sidebar-refresh";
import { MorePortal, type ContextMenuHandle } from "./more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/dialog-provider";

interface CanvasRowLike {
  id: string;
  name: string;
}

interface Props {
  canvas: CanvasRowLike;
  onUpdated?: () => void;
}

export const CanvasMoreTrigger = forwardRef<ContextMenuHandle, Props>(function CanvasMoreTrigger(
  { canvas, onUpdated },
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
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPoint(null); setOpen((v) => !v); }}
        className={`p-1 rounded transition-colors ${open ? "text-zinc-900 bg-zinc-200" : "text-zinc-500 hover:bg-zinc-200"}`}
        aria-label="Canvas actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={220} open={open} placement="below" point={point}>
        <CanvasMoreMenu canvas={canvas} onClose={() => setOpen(false)} onUpdated={onUpdated} />
      </MorePortal>
    </span>
  );
});

type Mode = "menu" | "rename";

function CanvasMoreMenu({
  canvas,
  onClose,
  onUpdated,
}: {
  canvas: CanvasRowLike;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(canvas.name);
  const [busy, setBusy] = useState<string | null>(null);

  const rename = async (name: string): Promise<boolean> => {
    setBusy("rename");
    try {
      const res = await fetch(`/api/whiteboards/${canvas.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Rename failed");
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

  const copyLink = () => {
    const url = `${window.location.origin}/canvas/${canvas.id}`;
    void navigator.clipboard.writeText(url).then(() => toast("Link copied"), () => toast("Couldn't copy link"));
    onClose();
  };

  const remove = async () => {
    if (!(await confirm({ title: "Delete canvas", description: `Delete "${canvas.name}"? It moves to Trash and can be restored for 60 days.`, destructive: true, confirmLabel: "Delete" }))) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/whiteboards/${canvas.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Delete failed");
        return;
      }
      toast(`${canvas.name} deleted`);
      onUpdated?.();
      refreshSidebar();
      // If the deleted canvas is the one open, leave it.
      if (pathname === `/canvas/${canvas.id}`) router.push("/canvas");
      else router.refresh();
      onClose();
    } finally {
      setBusy(null);
    }
  };

  if (mode === "rename") {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 shadow-2xl p-3">
        <div className="text-[12px] uppercase tracking-wide text-zinc-400 font-semibold mb-2">Rename canvas</div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = draft.trim();
              if (v && v !== canvas.name) rename(v).then((ok) => { if (ok) onClose(); });
              else onClose();
            }
            if (e.key === "Escape") onClose();
          }}
          className="w-full h-9 px-2.5 rounded-md border border-zinc-200 bg-white text-[14px] focus:outline-none focus:border-zinc-400"
          autoFocus
        />
        <div className="flex justify-end gap-1.5 mt-2.5">
          <button type="button" onClick={() => setMode("menu")} disabled={Boolean(busy)} className="h-7 px-2.5 rounded-md text-[13px] text-zinc-600 hover:bg-zinc-100">Cancel</button>
          <button
            type="button"
            onClick={async () => {
              const v = draft.trim();
              if (!v || v === canvas.name) { onClose(); return; }
              const ok = await rename(v);
              if (ok) onClose();
            }}
            disabled={Boolean(busy) || !draft.trim()}
            className="h-7 px-2.5 rounded-md text-[13px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy === "rename" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <MenuList>
      <MenuItem icon={Edit2} label="Rename" onClick={() => setMode("rename")} />
      <MenuItem icon={Link2} label="Copy link" onClick={copyLink} />
      <MenuSeparator />
      <MenuItem icon={Trash2} label="Delete canvas" destructive busy={busy === "delete"} onClick={remove} />
    </MenuList>
  );
}
