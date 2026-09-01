"use client";

// NamedRangesDialog — manage a sheet's named ranges. A named range binds a
// friendly name (Revenue) to a reference (A1:B10, A:A, [Header]); formulas can
// then read `=SUM(Revenue)`. Names must not look like a cell/column reference
// (the grammar would read them as that ref) — the engine validates and reports.
//
// All mutation goes through the live engine host: define/remove re-derive every
// formula's dependencies and recompute. The parent persists the result to
// DataTable.settings and repaints.

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Tag } from "lucide-react";
import type { TableEngine, NamedRangeDef } from "@/lib/sheet-engine-host";
import { validateNamedRangeName } from "@/lib/sheet-engine-host";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  host: TableEngine | null;
  /** Fired after any add/remove so the parent persists + repaints. */
  onChanged: (ranges: NamedRangeDef[]) => void;
  /** Optional prefill (e.g. the selected range's A1 text) for the ref field. */
  initialRef?: string;
}

export function NamedRangesDialog({ open, onOpenChange, host, onChanged, initialRef }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] p-0 gap-0">
        {/* Body mounts fresh each open, so it reads the host in useState
            initializers — no on-open effect + setState. */}
        {open && host ? (
          <NamedRangesBody host={host} onChanged={onChanged} initialRef={initialRef} />
        ) : (
          <div className="px-6 py-8 text-[13px] text-zinc-400">Loading…</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NamedRangesBody({
  host,
  onChanged,
  initialRef,
}: {
  host: TableEngine;
  onChanged: (ranges: NamedRangeDef[]) => void;
  initialRef?: string;
}) {
  const [ranges, setRanges] = useState<NamedRangeDef[]>(() => host.listNamedRanges());
  const [name, setName] = useState("");
  const [ref, setRef] = useState(initialRef ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live name feedback, but don't nag on an empty field.
  const nameHint = useMemo(() => (name.trim() ? validateNamedRangeName(name) : null), [name]);

  const add = () => {
    if (!host) return;
    setBusy(true);
    const err = host.setNamedRange(name, ref);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    const next = host.listNamedRanges();
    setRanges(next);
    setName("");
    setRef("");
    setError(null);
    onChanged(next);
  };

  const remove = (n: string) => {
    if (!host) return;
    host.removeNamedRange(n);
    const next = host.listNamedRanges();
    setRanges(next);
    onChanged(next);
  };

  const canAdd = !!name.trim() && !!ref.trim() && !nameHint && !busy;

  return (
    <>
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="text-[16px] font-semibold inline-flex items-center gap-2">
            <Tag className="h-4 w-4 text-zinc-500" /> Named ranges
          </DialogTitle>
          <DialogDescription className="mt-1">
            Give a range a name and use it in formulas — <code className="text-[12px] bg-zinc-100 px-1 py-0.5 rounded">=SUM(Revenue)</code>.
          </DialogDescription>
        </div>

        {/* Add */}
        <div className="px-6 pb-3 border-t border-zinc-100 pt-4">
          <div className="text-[12px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">Add a name</div>
          <div className="flex items-start gap-1.5">
            <div className="flex-1">
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && canAdd) add(); }}
                placeholder="Revenue"
                className={`w-full h-9 px-2.5 rounded-md border bg-white text-[14px] focus:outline-none ${nameHint ? "border-red-300 focus:border-red-400" : "border-zinc-200 focus:border-zinc-400"}`}
              />
              {nameHint ? <div className="text-[11.5px] text-red-500 mt-1 leading-snug">{nameHint}</div> : null}
            </div>
            <span className="h-9 inline-flex items-center text-[13px] text-zinc-400">=</span>
            <input
              value={ref}
              onChange={(e) => { setRef(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && canAdd) add(); }}
              placeholder="A1:B10"
              className="flex-1 h-9 px-2.5 rounded-md border border-zinc-200 bg-white text-[14px] font-mono focus:outline-none focus:border-zinc-400"
            />
            <button
              type="button"
              onClick={add}
              disabled={!canAdd}
              className="h-9 px-3 rounded-md bg-[#0073EA] text-white text-[13.5px] font-medium hover:bg-[#0060B9] disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </button>
          </div>
          {error ? <div className="text-[12.5px] text-red-500 mt-2">{error}</div> : null}
        </div>

        {/* List */}
        <div className="px-6 pb-5 border-t border-zinc-100 pt-4">
          <div className="text-[12px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            {ranges.length === 0 ? "Named ranges" : `Named ranges · ${ranges.length}`}
          </div>
          {ranges.length === 0 ? (
            <div className="text-[13px] text-zinc-400">None yet. Add one above.</div>
          ) : (
            <ul className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 max-h-[280px] overflow-y-auto">
              {ranges.map((r) => (
                <li key={r.name} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-medium truncate">{r.name}</span>
                    <span className="block text-[12px] text-zinc-500 font-mono truncate">={r.ref}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(r.name)}
                    className="h-7 w-7 rounded hover:bg-red-50 inline-flex items-center justify-center text-zinc-400 hover:text-red-500"
                    aria-label={`Remove ${r.name}`}
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
    </>
  );
}
