"use client";

// NamedRangesDialog, manage a sheet's named ranges. A named range binds a
// friendly name (Revenue) to a reference (A1:B10, A:A, [Header]); formulas can
// then read `=SUM(Revenue)`. Names must not look like a cell/column reference
// (the grammar would read them as that ref), the engine validates and reports.
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
import { Plus, Trash2, Tag } from "lucide-react";
import { Dots } from "@/components/ui/dots";
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
      <DialogContent className="os-chrome max-w-[560px] gap-0 border-line bg-raised p-0">
        {/* Body mounts fresh each open, so it reads the host in useState
            initializers, no on-open effect + setState. */}
        {open && host ? (
          <NamedRangesBody host={host} onChanged={onChanged} initialRef={initialRef} />
        ) : (
          <div className="flex flex-col gap-2 px-6 py-6" aria-busy="true">{["60%", "40%", "80%"].map((w, i) => <span key={i} className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />)}</div>
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
          <DialogTitle className="text-lg font-semibold inline-flex items-center gap-2">
            <Tag className="h-4 w-4 text-ink-2" /> Named ranges
          </DialogTitle>
          <DialogDescription className="mt-1">
            Give a range a name and use it in formulas, like <code className="text-xs bg-active px-1 py-0.5 rounded">=SUM(Revenue)</code>.
          </DialogDescription>
        </div>

        {/* Add */}
        <div className="px-6 pb-3 border-t border-line-soft pt-4">
          <div className="text-xs uppercase tracking-wide text-ink-2 font-semibold mb-2">Add a name</div>
          <div className="flex items-start gap-1.5">
            <div className="flex-1">
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && canAdd) add(); }}
                placeholder="Revenue"
                className={`w-full h-9 px-2.5 rounded-md border bg-raised text-base focus:outline-none ${nameHint ? "border-red-300 focus:border-red-400" : "border-line focus:border-brand"}`}
              />
              {nameHint ? <div className="text-xs text-red-500 mt-1 leading-snug">{nameHint}</div> : null}
            </div>
            <span className="h-9 inline-flex items-center text-sm text-ink-3">=</span>
            <input
              value={ref}
              onChange={(e) => { setRef(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && canAdd) add(); }}
              placeholder="A1:B10"
              className="flex-1 h-9 px-2.5 rounded-md border border-line bg-raised text-base font-mono focus:outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={add}
              disabled={!canAdd}
              className="h-9 px-3 rounded-md bg-brand text-white text-base font-medium hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
            >
              {busy ? <Dots variant="pending" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </button>
          </div>
          {error ? <div className="text-xs text-red-500 mt-2">{error}</div> : null}
        </div>

        {/* List */}
        <div className="px-6 pb-5 border-t border-line-soft pt-4">
          <div className="text-xs uppercase tracking-wide text-ink-2 font-semibold mb-2">
            {ranges.length === 0 ? "Named ranges" : `Named ranges · ${ranges.length}`}
          </div>
          {ranges.length === 0 ? (
            <div className="text-sm text-ink-3">None yet. Add one above.</div>
          ) : (
            <ul className="rounded-lg border border-line divide-y divide-line-soft max-h-[280px] overflow-y-auto">
              {ranges.map((r) => (
                <li key={r.name} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-base font-medium truncate">{r.name}</span>
                    <span className="block text-xs text-ink-2 font-mono truncate">={r.ref}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(r.name)}
                    className="h-7 w-7 rounded hover:bg-red-50 inline-flex items-center justify-center text-ink-3 hover:text-red-500"
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
