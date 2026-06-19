"use client";

/* System-wide Trash — org recycle bin. Deleted documents (SOPs, Tables, Files,
 * Policies …) are recoverable here for 60 days, then auto-purged. Managers only.
 *   GET    /api/trash
 *   POST   /api/trash/[id]/restore
 *   DELETE /api/trash/[id]
 */

import { useCallback, useEffect, useState } from "react";
import {
  Trash2, Loader2, RotateCcw, BookCopy, ShieldCheck, FileText, Table as TableIcon,
  Paperclip, PenLine, FileSignature,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Item = { id: string; entityType: string; entityId: string; label: string; deletedByName: string | null; deletedAt: string };

const TYPE_META: Record<string, { label: string; Icon: typeof FileText }> = {
  note: { label: "Note", Icon: PenLine },
  sop: { label: "SOP", Icon: BookCopy },
  whiteboard: { label: "Whiteboard", Icon: FileText },
  table: { label: "Table", Icon: TableIcon },
  file: { label: "File", Icon: Paperclip },
  policy: { label: "Policy", Icon: ShieldCheck },
  contract: { label: "Contract", Icon: FileSignature },
};

function daysLeft(deletedAt: string): number {
  const elapsed = (Date.now() - new Date(deletedAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(60 - elapsed));
}

export default function TrashPage() {
  const { toast } = useOsToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trash");
      if (res.status === 403) { setErr("Manager access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setItems(((d.data ?? d).items) ?? []);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "load failed"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function restore(it: Item) {
    setBusy(it.id);
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(it.id)}/restore`, { method: "POST" });
      if (res.ok) { toast(`Restored ${TYPE_META[it.entityType]?.label ?? "item"}`); await load(); }
      else toast((await res.json().catch(() => ({})))?.error || "Couldn't restore");
    } catch { toast("Couldn't restore"); } finally { setBusy(null); }
  }
  async function deleteForever(it: Item) {
    if (!confirm(`Permanently delete “${it.label}”? This cannot be undone.`)) return;
    setBusy(it.id);
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(it.id)}`, { method: "DELETE" });
      if (res.ok) { toast("Deleted permanently"); await load(); } else toast("Couldn't delete");
    } catch { toast("Couldn't delete"); } finally { setBusy(null); }
  }

  return (
    <>
      <OsTitleBar
        title="Trash"
        Icon={Trash2}
        iconGradient={GRAD.redPink}
        showStandardActions={false}
        description={items === null ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"} · auto-deleted 60 days after deletion`}
      />

      <div className="mx-auto max-w-4xl px-6 py-8">
        {err ? (
          <OsEmptyView Icon={Trash2} iconGradient={GRAD.redPink} title="Couldn't load Trash" subtitle={err} cta="Retry" onCta={() => void load()} />
        ) : items === null ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 p-10 text-center">
            <Trash2 className="mx-auto h-8 w-8 text-zinc-300" />
            <div className="mt-3 text-sm font-medium text-zinc-700">Trash is empty</div>
            <div className="mt-1 text-[13px] text-zinc-500">Deleted documents (SOPs, Tables, Files, Policies …) appear here and are recoverable for 60 days.</div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <ul className="divide-y divide-zinc-100">
              {items.map((it) => {
                const meta = TYPE_META[it.entityType] ?? { label: it.entityType, Icon: FileText };
                const left = daysLeft(it.deletedAt);
                return (
                  <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500"><meta.Icon className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-zinc-900">{it.label}</div>
                      <div className="truncate text-[11px] text-zinc-400">
                        {meta.label} · deleted {new Date(it.deletedAt).toLocaleDateString()}{it.deletedByName ? ` by ${it.deletedByName}` : ""}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${left <= 7 ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>{left}d left</span>
                    <button type="button" disabled={busy === it.id} onClick={() => restore(it)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                      {busy === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Restore
                    </button>
                    <button type="button" disabled={busy === it.id} onClick={() => deleteForever(it)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-red-600 hover:bg-red-50 disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
