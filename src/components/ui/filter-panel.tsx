"use client";

// FilterPanel (design-system 5.2): the 272px side panel the toolbar's Filter
// chip opens at the left of the content. `--os-surface`, 1px line, radius 8,
// padding 16, sticky under the toolbar with its own scroll, `.os-row`.
// Heading "Filter {objects} by" 16/600 with a "Clear all" text link when
// anything is active; a 36px search input; then 36px checkbox rows
// (`FilterRow`) for every filterable field, each expanding an inline value
// control beneath it when checked. Bottom: "Save as view" text link. Esc (a
// layer) or the Filter chip closes it. Under 1024 the same panel is a 320px
// drawer from the inline-start edge over a scrim.
//
// Layout contract: render it as the first child of a `flex gap-4` row with
// the table or board beside it; the sibling narrows over 220ms.

import { useId, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLayer } from "@/components/layout/os/shell-context";

export interface FilterPanelProps {
  open: boolean;
  onClose: () => void;
  /** The plural object name: "tasks", "docs", "people". */
  objects: string;
  /** How many filters are active; shows "Clear all" when above zero. */
  activeCount?: number;
  onClearAll?: () => void;
  onSaveView?: () => void;
  /** The field search. Omit to hide the input (fewer than 6 fields). */
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  children: ReactNode;
  className?: string;
}

export function FilterPanel({ open, onClose, objects, activeCount = 0, onClearAll, onSaveView, search, children, className }: FilterPanelProps) {
  useLayer(open, { kind: "panel", close: onClose });
  const headingId = useId();
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        // The scrim starts after the rail and below the bar: spec-shell 1.16
        // keeps the rail at 64 and the bar at 48 live at every width.
        className="fixed bottom-0 end-0 start-[var(--os-rail-w)] top-[var(--os-top-h)] z-30 bg-[var(--os-scrim)] lg:hidden"
      />
      <aside
        aria-labelledby={headingId}
        className={cn(
          "os-row os-filter-panel flex w-[272px] shrink-0 flex-col gap-3 self-start overflow-y-auto rounded-lg border border-line bg-raised p-4 text-ink",
          "sticky top-0 max-h-full",
          "max-lg:fixed max-lg:bottom-0 max-lg:top-[var(--os-top-h)] max-lg:start-[var(--os-rail-w)] max-lg:z-40 max-lg:w-80 max-lg:max-h-none max-lg:rounded-none max-lg:border-y-0 max-lg:border-s-0 max-lg:shadow-[var(--os-shadow-modal)]",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <h2 id={headingId} className="min-w-0 flex-1 truncate text-lg font-semibold">Filter {objects} by</h2>
          {activeCount > 0 && onClearAll ? (
            <button type="button" onClick={onClearAll} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">
              Clear all
            </button>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close filters" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink lg:hidden">
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
        {search ? (
          <label className="relative block">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.5} aria-hidden />
            <input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? "Search fields…"}
              className="h-9 w-full rounded-md border border-line-strong bg-raised ps-9 pe-3 text-base text-ink placeholder:text-ink-3"
            />
          </label>
        ) : null}
        <ul className="flex flex-col">{children}</ul>
        {onSaveView ? (
          <div className="mt-auto pt-2">
            <button type="button" onClick={onSaveView} className="text-sm font-medium text-brand-deep hover:underline">
              Save as view
            </button>
          </div>
        ) : null}
      </aside>
    </>
  );
}

/** One 36px checkbox row; `children` is the inline value control shown when checked. */
export function FilterRow({ label, checked, onCheckedChange, children, count }: {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
  /** Optional right-aligned 12/500 count. */
  count?: number;
}) {
  return (
    <li className="flex flex-col">
      <label className="flex h-9 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-hover">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="h-[18px] w-[18px] shrink-0 rounded border-line-strong accent-[var(--os-brand)]"
        />
        <span className="min-w-0 flex-1 truncate text-row text-ink">{label}</span>
        {typeof count === "number" ? <span className="shrink-0 text-xs font-medium tabular-nums text-ink-2">{count}</span> : null}
      </label>
      {checked && children ? <div className="mb-2 ms-8 me-2">{children}</div> : null}
    </li>
  );
}
