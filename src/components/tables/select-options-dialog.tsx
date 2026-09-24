"use client";

// The options editor a Single select or Multiple select column opens with
// (spec-tables-forms section 2, "Typing a column"): one option per row, a
// remove button per row, Move up and Move down (the keyboard and touch path
// for reordering), and "Add option". Options are the column's existing
// `options` string list; a new select column arrives pre-filled with the
// distinct values already in it, so nothing it holds becomes invalid.

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function SelectOptionsDialog({
  open, columnName, initial, onCancel, onSave,
}: {
  open: boolean;
  columnName: string;
  initial: string[];
  onCancel: () => void;
  onSave: (options: string[]) => void;
}) {
  const [opts, setOpts] = useState<string[]>(initial.length ? initial : [""]);
  const move = (i: number, d: -1 | 1) => setOpts((prev) => {
    const j = i + d;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const clean = () => {
    const out: string[] = [];
    for (const raw of opts) {
      const o = raw.trim();
      if (o && !out.includes(o)) out.push(o);
    }
    return out;
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="os-chrome max-w-[560px] border-line bg-raised p-5">
        <DialogTitle className="text-lg font-semibold text-ink">Options for {columnName}</DialogTitle>
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {opts.map((o, i) => (
            <div key={i} className="flex h-9 items-center gap-1">
              <input
                value={o}
                autoFocus={i === opts.length - 1 && o === ""}
                aria-label={`Option ${i + 1}`}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setOpts((prev) => prev.map((x, k) => (k === i ? e.target.value : x)))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setOpts((prev) => [...prev.slice(0, i + 1), "", ...prev.slice(i + 1)]); } }}
                className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink outline-none focus:ring-2 focus:ring-focus"
              />
              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label="Move down" disabled={i === opts.length - 1} onClick={() => move(i, 1)} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" aria-label={`Remove option ${i + 1}`} onClick={() => setOpts((prev) => prev.filter((_, k) => k !== i))} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setOpts((prev) => [...prev, ""])} className="flex h-9 items-center gap-2 rounded-md px-2 text-base text-ink-2 hover:bg-hover">
            <Plus className="h-4 w-4" /> Add option
          </button>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="h-9 rounded-md px-3 text-base text-ink-2 hover:bg-hover">Cancel</button>
          <button type="button" onClick={() => onSave(clean())} className="h-9 rounded-md bg-brand px-4 text-base font-medium text-ink-inv hover:bg-brand-hover">Save options</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
