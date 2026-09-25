"use client";

// The thin bar over Bird's eye: a title search and "Hide closed" (statuses in
// the done or closed group). Hide closed starts OFF, so the colours show the
// whole flow. A refetch keeps the cards on screen and says so here with the
// pending dots, never by blanking the view.

import { type KeyboardEvent, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";

export function BirdseyeToolbar({
  query,
  onQuery,
  hideClosed,
  onHideClosed,
  refreshing,
  trailing,
}: {
  query: string;
  onQuery: (q: string) => void;
  hideClosed: boolean;
  onHideClosed: (next: boolean) => void;
  refreshing: boolean;
  trailing?: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Esc clears a search; an empty field lets it through (it leaves focus mode).
    if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      onQuery("");
    }
  };
  return (
    <div className="flex h-11 min-w-0 shrink-0 items-center gap-3 px-6" role="toolbar" aria-label="Bird's eye">
      <label className="relative flex h-8 w-60 min-w-0 max-w-full items-center">
        <Search className="pointer-events-none absolute start-2 h-4 w-4 text-ink-3" strokeWidth={1.75} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={120}
          placeholder="Search tasks"
          aria-label="Search tasks by title"
          className="h-8 w-full rounded-md border border-line bg-raised ps-8 pe-7 text-base text-ink placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQuery("")}
            className="absolute end-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
            aria-label="Clear search"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </label>
      {/* A label around the switch: a click on the words toggles it too,
          the native way, with one control for assistive tech. */}
      <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-sm text-ink-2" title="Hide tasks whose status is done or closed">
        <Switch checked={hideClosed} onChange={onHideClosed} aria-label="Hide closed tasks" />
        <span>Hide closed</span>
      </label>
      <div className="ms-auto flex min-w-0 items-center gap-3">
        {refreshing ? <Dots variant="pending" label="Refreshing" className="text-ink-3" /> : null}
        {trailing}
      </div>
    </div>
  );
}
