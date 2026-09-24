"use client";

// Insert > Function > More functions… (spec-tables-forms section 2, the
// sheet's Insert menu): the function reference. Every function the engine
// evaluates, read from the same catalog the formula bar's autocomplete uses
// (FUNCTION_ITEMS, lib/sheet-engine FUNCTIONS), so the list can never name a
// function the engine does not have. A search field narrows by name or
// summary; picking a row starts that function in the active cell, the same
// seed Insert > Function > SUM uses.
//
// In the Drawer container (design-system 4.5), so Esc goes through the
// LayerStack and the grid stays visible and scrollable underneath.

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { FUNCTION_ITEMS } from "@/components/tables/formula-bar";

export function FunctionReferenceDrawer({ open, onClose, onPick, canInsert }: {
  open: boolean;
  onClose: () => void;
  /** Start `=NAME(` in the active cell. */
  onPick: (name: string) => void;
  /** False for a read-only viewer: the list is a reference only. */
  canInsert: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () => (needle
      ? FUNCTION_ITEMS.filter((f) => f.name.toLowerCase().includes(needle) || f.summary.toLowerCase().includes(needle))
      : FUNCTION_ITEMS),
    [needle],
  );
  return (
    <Drawer
      open={open}
      onClose={onClose}
      ariaLabel="Functions"
      layerId="table-function-reference"
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">Functions</span>
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink" aria-label="Close" title="Close (Esc)">
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <label className="flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-2.5 text-sm text-ink focus-within:ring-2 focus-within:ring-focus">
          <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search functions"
            aria-label="Search functions"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
            autoFocus
          />
        </label>
        <p className="m-0 text-xs text-ink-2">
          {rows.length === FUNCTION_ITEMS.length ? `${FUNCTION_ITEMS.length} functions` : `${rows.length} of ${FUNCTION_ITEMS.length} functions`}
          {canInsert ? ". Pick one to start it in the active cell." : "."}
        </p>
        {rows.length === 0 ? (
          <p className="m-0 py-6 text-center text-sm text-ink-2">{`No function matches "${q.trim()}"`}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Functions">
            {rows.map((f) => {
              const body = (
                <>
                  <span className="font-mono text-xs font-medium text-ink">{f.signature}</span>
                  <span className="text-sm text-ink-2">{f.summary}</span>
                </>
              );
              return (
                <li key={f.name} className="border-b border-line-soft last:border-b-0">
                  {canInsert ? (
                    <button
                      type="button"
                      onClick={() => onPick(f.name)}
                      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-start hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex flex-col gap-0.5 px-2 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
