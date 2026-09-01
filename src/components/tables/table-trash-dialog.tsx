"use client";

// TableTrashDialog — a table's recycle bin. Deleted rows are soft-deleted and
// listed here; Restore brings a row back into the grid, Delete removes it for
// good. Rows auto-purge 60 days after deletion.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Trash2, Undo2, Clock } from "lucide-react";
import { useConfirm } from "@/components/ui/dialog-provider";

interface TrashRow {
  id: string;
  values: Record<string, unknown>;
  position: number;
  deletedAt: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tableId: string | null;
  /** Column ids + labels, to render a readable preview of each trashed row. */
  columns: { id: string; label: string }[];
  /** Fired after a restore so the parent reloads the grid. */
  onChanged: () => void;
}

function preview(values: Record<string, unknown>, columns: { id: string; label: string }[]): string {
  const parts: string[] = [];
  for (const c of columns) {
    const v = values[c.id];
    if (v === null || v === undefined || v === "") continue;
    parts.push(Array.isArray(v) ? v.join(", ") : String(typeof v === "object" ? JSON.stringify(v) : v));
    if (parts.length >= 4) break;
  }
  return parts.join(" · ") || "(empty row)";
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function TableTrashDialog({ open, onOpenChange, tableId, columns, onChanged }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] p-0 gap-0">
        {/* Body mounts on open so its fetch effect starts fresh with no
            in-effect setState reset. */}
        {open && tableId ? (
          <TrashBody tableId={tableId} columns={columns} onChanged={onChanged} />
        ) : (
          <div className="px-6 py-8 text-[13px] text-zinc-400">Loading…</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TrashBody({ tableId, columns, onChanged }: {
  tableId: string;
  columns: { id: string; label: string }[];
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<TrashRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyBulk, setBusyBulk] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/tables/${tableId}/trash`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active) setRows(Array.isArray(d?.data?.rows) ? d.data.rows : (Array.isArray(d?.rows) ? d.rows : [])); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [tableId]);

  const act = async (action: "restore" | "purge" | "empty", ids?: string[]) => {
    if (!tableId) return null;
    const res = await fetch(`/api/tables/${tableId}/trash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(ids ? { ids } : {}) }),
    });
    return res.ok;
  };

  const restore = async (row: TrashRow) => {
    setBusyId(row.id);
    const ok = await act("restore", [row.id]);
    setBusyId(null);
    if (ok) {
      setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id));
      onChanged();
    }
  };

  const purge = async (row: TrashRow) => {
    if (!(await confirm({ title: "Delete permanently", description: "This row can't be recovered afterwards.", destructive: true, confirmLabel: "Delete" }))) return;
    setBusyId(row.id);
    const ok = await act("purge", [row.id]);
    setBusyId(null);
    if (ok) setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id));
  };

  const empty = async () => {
    if (!rows || rows.length === 0) return;
    if (!(await confirm({ title: "Empty trash", description: `Permanently delete ${rows.length} row${rows.length === 1 ? "" : "s"}? This can't be undone.`, destructive: true, confirmLabel: "Empty trash" }))) return;
    setBusyBulk(true);
    const ok = await act("empty");
    setBusyBulk(false);
    if (ok) setRows([]);
  };

  return (
    <>
        <div className="px-6 pt-6 pb-3 flex items-start justify-between gap-3">
          <div>
            <DialogTitle className="text-[16px] font-semibold inline-flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-zinc-500" /> Trash
            </DialogTitle>
            <DialogDescription className="mt-1">
              Deleted rows are kept for 60 days. Restore brings a row back into the sheet.
            </DialogDescription>
          </div>
          {rows && rows.length > 0 ? (
            <button
              type="button"
              onClick={empty}
              disabled={busyBulk}
              className="mt-0.5 h-8 px-2.5 rounded-md text-[12.5px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
            >
              {busyBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Empty trash
            </button>
          ) : null}
        </div>

        <div className="px-6 pb-5 border-t border-zinc-100 pt-4">
          {rows === null ? (
            <div className="text-[13px] text-zinc-400 py-4 text-center inline-flex items-center gap-2 justify-center w-full">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-[13px] text-zinc-400 py-8 text-center">Trash is empty.</div>
          ) : (
            <ul className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 max-h-[360px] overflow-y-auto">
              {rows.map((row) => {
                const busy = busyId === row.id;
                return (
                  <li key={row.id} className="flex items-center gap-2.5 px-3 py-2">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] text-zinc-800 truncate">{preview(row.values, columns)}</span>
                      <span className="block text-[11.5px] text-zinc-400 inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> deleted {relTime(row.deletedAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => restore(row)}
                      disabled={busy}
                      className="h-7 px-2 rounded-md text-[12.5px] font-medium text-[#0073EA] hover:bg-blue-50 disabled:opacity-50 inline-flex items-center gap-1"
                      title="Restore this row"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => purge(row)}
                      disabled={busy}
                      className="h-7 w-7 rounded hover:bg-red-50 inline-flex items-center justify-center text-zinc-400 hover:text-red-500 disabled:opacity-50"
                      aria-label="Delete permanently"
                      title="Delete permanently"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
    </>
  );
}
