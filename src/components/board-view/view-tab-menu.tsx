"use client";

// ViewTabMenu — the "..." popover that lives on each view tab in the
// Board detail page. Actions:
//   Rename       — inline editor in the popover, PATCH name
//   Set default  — PATCH isDefault=true (server demotes the previous default in the same tx)
//   Duplicate    — POST a new view with the source's type + config + " (copy)" suffix
//   Delete       — DELETE; blocked server-side if it's the last view on the board

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal, Edit2, Copy, Trash2, Star, Loader2,
} from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import { useOsToast } from "@/components/layout/os/toast";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/dialog-provider";

interface ViewLike {
  id: string;
  name: string;
  type: ViewType;
  isDefault: boolean;
  config: unknown;
}

interface Props {
  boardId: string;
  view: ViewLike;
  children?: React.ReactNode;
}

export function ViewTabContextMenu({ boardId, view, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
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
    <>
      <div
        className="inline-flex h-full items-stretch"
        onContextMenu={(e) => {
          e.preventDefault();
          setPos({ x: e.clientX, y: e.clientY });
          setOpen(true);
        }}
      >
        {children}
      </div>
      {open ? (
        <div 
          ref={panelRef} 
          className="fixed z-[100] w-[200px]"
          style={{ 
            left: Math.min(pos.x, typeof window !== 'undefined' ? window.innerWidth - 210 : pos.x), 
            top: Math.min(pos.y, typeof window !== 'undefined' ? window.innerHeight - 300 : pos.y) 
          }}
        >
          <ViewMenuPanel boardId={boardId} view={view} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}

type Mode = "menu" | "rename";

function ViewMenuPanel({
  boardId,
  view,
  onClose,
}: {
  boardId: string;
  view: ViewLike;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(view.name);
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>, kind: string): Promise<boolean> => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/boards/${boardId}/views/${view.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Update failed");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async () => {
    setBusy("dup");
    try {
      const res = await fetch(`/api/boards/${boardId}/views`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${view.name} (copy)`,
          type: view.type,
          config: view.config ?? undefined,
          isShared: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Duplicate failed");
        return;
      }
      toast("View duplicated");
      onClose();
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: "Delete view", description: `Delete the "${view.name}" view?`, destructive: true, confirmLabel: "Delete" }))) return;
    setBusy("del");
    try {
      const res = await fetch(`/api/boards/${boardId}/views/${view.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Delete failed");
        return;
      }
      toast("View deleted");
      onClose();
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (mode === "rename") {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 shadow-2xl p-2.5">
        <div className="text-[10.5px] uppercase tracking-wide text-zinc-400 font-semibold mb-2">
          Rename view
        </div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = draft.trim();
              if (v && v !== view.name) {
                patch({ name: v }, "rename").then((ok) => { if (ok) onClose(); });
              } else {
                onClose();
              }
            }
            if (e.key === "Escape") onClose();
          }}
          className="w-full h-8 px-2 rounded-md border border-zinc-200 bg-white text-[12.5px] focus:outline-none focus:border-zinc-400"
          autoFocus
        />
        <div className="flex justify-end gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => setMode("menu")}
            disabled={Boolean(busy)}
            className="h-6 px-2 rounded-md text-[11.5px] text-zinc-600 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              const v = draft.trim();
              if (!v || v === view.name) { onClose(); return; }
              const ok = await patch({ name: v }, "rename");
              if (ok) onClose();
            }}
            disabled={Boolean(busy) || !draft.trim()}
            className="h-6 px-2 rounded-md text-[11.5px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-1.5"
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
      {!view.isDefault ? (
        <MenuItem
          icon={Star}
          label="Set as default"
          busy={busy === "default"}
          onClick={async () => {
            const ok = await patch({ isDefault: true }, "default");
            if (ok) onClose();
          }}
        />
      ) : null}
      <MenuItem icon={Copy} label="Duplicate" busy={busy === "dup"} onClick={duplicate} />
      <MenuSeparator />
      <MenuItem icon={Trash2} label="Delete" destructive busy={busy === "del"} onClick={remove} />
    </MenuList>
  );
}

export type { ViewLike };
