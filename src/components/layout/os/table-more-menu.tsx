"use client";

// TableMoreMenu — per-table "..." popover for the sidebar Space tree
// (Phase 34 surface). Tables don't carry icon/color today, so this is
// the trimmed cousin of BoardMoreMenu: rename + delete only.
//
// Actions:
//   Rename → PATCH /api/tables/[id] { name }
//   Delete → DELETE /api/tables/[id]  (hard delete — rows cascade)

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Edit2, Trash2, Loader2 } from "lucide-react";
import { useOsToast } from "./toast";
import { MorePortal } from "./more-portal";

interface TableRowLike {
  id: string;
  name: string;
}

interface Props {
  table: TableRowLike;
  onUpdated?: () => void;
}

export function TableMoreTrigger({ table, onUpdated }: Props) {
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
        aria-label="Table actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={220} open={open} placement="below">
        <TableMoreMenu
          table={table}
          onClose={() => setOpen(false)}
          onUpdated={onUpdated}
        />
      </MorePortal>
    </span>
  );
}

type Mode = "menu" | "rename";

function TableMoreMenu({
  table,
  onClose,
  onUpdated,
}: {
  table: TableRowLike;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState(table.name);
  const [busy, setBusy] = useState<string | null>(null);

  const rename = async (name: string): Promise<boolean> => {
    setBusy("rename");
    try {
      const res = await fetch(`/api/tables/${table.id}`, {
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
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${table.name}"? Rows will be deleted permanently.`)) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/tables/${table.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Delete failed");
        return;
      }
      toast(`${table.name} deleted`);
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
          Rename table
        </div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = draft.trim();
              if (v && v !== table.name) {
                rename(v).then((ok) => { if (ok) onClose(); });
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
              if (!v || v === table.name) { onClose(); return; }
              const ok = await rename(v);
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

  return (
    <div role="menu" className="bg-white rounded-xl border border-zinc-200 shadow-2xl py-1.5">
      <Item Icon={Edit2} label="Rename" onClick={() => setMode("rename")} />
      <div className="h-px bg-zinc-100 my-1" />
      <Item Icon={Trash2} label="Delete table" destructive busy={busy === "delete"} onClick={remove} />
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
