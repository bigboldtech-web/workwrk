"use client";

// Small pieces of the sheet's chrome (spec-tables-forms section 2
// /tables/[id]), kept out of the 6,000-line page:
//
//   CoPresenceChip   the title row's "Priya is editing" chip, from the 20s
//                    heartbeat (POST /api/tables/[id]/presence)
//   SheetStatusBar   the 36px bar pinned under the grid: rows and columns (or
//                    the stream progress with a 4px bar) left, the selection
//                    statistics centre, the last-saved time right. It takes
//                    over the two jobs the deleted bottom tab bar's meta
//                    spans had.
//   TableAboutDialog File > About... and the toolbar "..." > About: the
//                    table's name and description, which nothing could edit
//                    before (data.md 3.18).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import { apiFetch } from "@/lib/api-fetch";
import { PRESENCE_POLL_MS, presenceLabel, type PresenceEntry } from "@/lib/table-presence";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format/use-date-prefs";

/* ───────────────────────────── co-presence ───────────────────────────── */

export function useTablePresence(tableId: string | null): PresenceEntry[] {
  const [others, setOthers] = useState<PresenceEntry[]>([]);
  useEffect(() => {
    if (!tableId) return;
    let alive = true;
    const beat = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const r = await apiFetch<{ others: PresenceEntry[] }>(`/api/tables/${tableId}/presence`, { method: "POST", json: {} });
      if (alive && r.ok) setOthers(r.data.others ?? []);
    };
    const first = setTimeout(() => void beat(), 0);
    const t = setInterval(() => void beat(), PRESENCE_POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") void beat(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      // Leave, best effort: the next reader's TTL covers a lost request.
      void fetch(`/api/tables/${tableId}/presence`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    };
  }, [tableId]);
  return others;
}

export function CoPresenceChip({ others }: { others: PresenceEntry[] }) {
  if (others.length === 0) return null;
  const first = others[0];
  const [firstName, ...rest] = first.name.split(" ");
  return (
    <span
      className="os-chrome inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-hover px-1.5 text-xs text-ink-2"
      title={others.map((o) => o.name).join(", ")}
    >
      <span className="relative inline-flex">
        <PersonAvatar person={{ id: first.userId, firstName: firstName ?? null, lastName: rest.join(" ") || null, avatar: first.avatar }} size={16} />
        <span className="absolute -bottom-0.5 -end-0.5 h-1.5 w-1.5 rounded-full bg-presence ring-1 ring-[var(--os-surface)]" aria-hidden />
      </span>
      {presenceLabel(others.map((o) => o.name))}
    </span>
  );
}

/* ───────────────────────────── status bar ───────────────────────────── */

export function SheetStatusBar({
  rows, columns, stream, stats, lastSavedAt, saveFailed = false, leading,
}: {
  rows: number;
  columns: number;
  stream: { loaded: number; total: number | null } | null;
  stats: string | null;
  lastSavedAt: Date | null;
  /** A write is still unsaved: the right slot says so instead of a stale "Saved" time. */
  saveFailed?: boolean;
  /** A tiny control at the left edge, under the grid's gutter (Add 1,000 rows). */
  leading?: ReactNode;
}) {
  const fmt = useFormat();
  const pct = stream && stream.total ? Math.min(100, Math.round((stream.loaded / stream.total) * 100)) : null;
  return (
    <div className="os-chrome relative flex h-9 shrink-0 items-center gap-4 border-t border-line bg-[var(--os-surface-1)] px-3 text-sm text-ink-2 print:hidden" role="status" aria-live="polite">
      {leading ? <span className="-ms-1 -me-2 inline-flex">{leading}</span> : null}
      <span className="min-w-0 shrink-0 tabular-nums">
        {stream
          ? stream.total !== null
            ? `Loading rows, ${fmt.count(stream.loaded)} of ${fmt.count(stream.total)}`
            : `Loading rows, ${fmt.count(stream.loaded)}`
          : `${fmt.count(rows)} row${rows === 1 ? "" : "s"} · ${fmt.count(columns)} column${columns === 1 ? "" : "s"}`}
      </span>
      <span className="min-w-0 flex-1 truncate text-center tabular-nums">{stats ?? ""}</span>
      <span className={cn("shrink-0 text-xs font-medium tabular-nums", saveFailed && "text-danger-text")}>
        {saveFailed ? "Not saved" : lastSavedAt ? `Saved ${fmt.date(lastSavedAt, "time")}` : ""}
      </span>
      {pct !== null ? (
        <span className="absolute inset-x-0 top-0 h-1 bg-transparent" aria-hidden>
          <span className="block h-1 bg-brand" style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── About ───────────────────────────── */

export function TableAboutDialog({
  open, onClose, name, description, canEdit, onSave,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  description: string | null;
  canEdit: boolean;
  /** Resolves true when the server accepted the change. */
  onSave: (next: { name: string; description: string | null }) => Promise<boolean>;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) { setDraftName(name); setDraftDesc(description ?? ""); setError(null); }
  }
  const nameRef = useRef<HTMLInputElement>(null);
  const dirty = draftName.trim() !== name || (draftDesc.trim() || null) !== (description?.trim() || null);

  async function save() {
    if (!dirty) { onClose(); return; }
    setBusy(true);
    setError(null);
    const ok = await onSave({ name: draftName.trim() || "Untitled table", description: draftDesc.trim() ? draftDesc.slice(0, 2000) : null });
    setBusy(false);
    if (ok) onClose();
    else setError("Not saved. Check your connection and try again.");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="os-chrome max-w-[560px] gap-0 border-line bg-raised p-0" onOpenAutoFocus={(e) => { e.preventDefault(); nameRef.current?.focus(); }}>
        <div className="flex h-14 items-center border-b border-line px-5">
          <DialogTitle className="text-lg font-semibold text-ink">About this table</DialogTitle>
        </div>
        <DialogDescription className="sr-only">The table&apos;s name and description.</DialogDescription>
        <div className="flex flex-col gap-4 px-5 py-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-2">
            Name
            <input ref={nameRef} value={draftName} readOnly={!canEdit} onChange={(e) => setDraftName(e.target.value)} placeholder="Untitled table"
              className="h-9 rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink focus:outline-none focus-visible:border-brand" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-2">
            Description
            <textarea value={draftDesc} readOnly={!canEdit} onChange={(e) => setDraftDesc(e.target.value)} rows={4} maxLength={2000}
              placeholder={canEdit ? "What this table holds, and who keeps it up to date" : "No description"}
              className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink focus:outline-none focus-visible:border-brand" />
          </label>
          {error ? <p className="m-0 text-sm text-danger-text" role="alert">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="h-9 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover">{canEdit ? "Cancel" : "Close"}</button>
          {canEdit ? (
            <button type="button" onClick={() => void save()} disabled={busy || !dirty}
              className={cn("inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-active disabled:text-ink-4")}>
              {busy ? <Dots variant="pending" /> : null}
              Save
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
