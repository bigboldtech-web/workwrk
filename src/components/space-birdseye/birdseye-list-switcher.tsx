"use client";

// "Lists": every List of the Space in overview order, one click to focus any
// of them. The chip row beside it shows the same Lists as letters; with dozens
// of Lists a letter is not enough to find one, so this menu names them, counts
// them and, past eight, filters them as you type (review #21).

import { useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { EntityTile } from "@/components/ui/entity-tile";
import type { BirdseyeList } from "@/lib/work/birdseye";

export function BirdseyeListSwitcher({
  lists,
  focusedId,
  onPick,
}: {
  lists: BirdseyeList[];
  focusedId: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? lists.filter((l) => l.name.toLowerCase().includes(needle)) : lists;
  }, [lists, filter]);

  const close = () => {
    setOpen(false);
    setFilter("");
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
        title="Every List in this Space"
      >
        Lists
        <ChevronsUpDown className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </button>
      <MorePortal anchorRef={anchorRef} width={280} open={open} placement="below" onClose={close}>
        <MenuList aria-label="Lists in this Space" className="max-h-[60vh] overflow-y-auto">
          {lists.length > 8 ? (
            <div className="px-2 pb-1 pt-0.5">
              <label className="relative flex items-center">
                <Search className="pointer-events-none absolute start-2 h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} aria-hidden />
                <input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && shown[0]) {
                      e.preventDefault();
                      onPick(shown[0].id);
                      close();
                    }
                  }}
                  placeholder="Find a List"
                  aria-label="Find a List"
                  className="h-8 w-full rounded-md border border-line bg-raised ps-7 pe-2 text-sm text-ink placeholder:text-ink-3"
                />
              </label>
            </div>
          ) : null}
          {shown.map((l) => (
            <MenuItem
              key={l.id}
              leading={<EntityTile size="xs" icon={l.icon} color={l.color} name={l.name} />}
              label={l.name}
              trailing={<span className="text-xs tabular-nums text-ink-3">{l.total}</span>}
              selected={l.id === focusedId}
              active={l.id === focusedId}
              onClick={() => {
                onPick(l.id);
                close();
              }}
            />
          ))}
          {shown.length === 0 ? <p className="px-3 py-2 text-sm text-ink-3">No List matches that.</p> : null}
        </MenuList>
      </MorePortal>
    </>
  );
}
