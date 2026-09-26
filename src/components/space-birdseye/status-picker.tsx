"use client";

// The status glyph at the left of a Bird's eye card, and, for someone who may
// write in the List, the picker it opens: THAT List's statuses, in its own
// order, the current one checked. A reader gets the same glyph with the
// status named in its tooltip and nothing to click, so status is never
// carried by colour alone.
//
// The glyph is drawn in the theme-lifted status colour (TINT_GLYPH, set on
// the card), so a pale status still stands off its own tint; the menu rows
// draw each status in its true colour on the raised surface.

import { useRef, useState } from "react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { StatusGlyph } from "@/components/board-view/status-glyph";
import type { StatusOption } from "@/lib/board-items-shared";
import { TINT_GLYPH } from "@/lib/work/birdseye";
import { cn } from "@/lib/utils";

function LiftedGlyph({ option, statuses }: { option: StatusOption; statuses: StatusOption[] }) {
  // currentColor carries the lifted colour into every part StatusGlyph draws
  // (the ring, the wedge, the done fill), whatever the theme.
  return (
    <span className="inline-flex" style={{ color: TINT_GLYPH }} aria-hidden>
      <StatusGlyph current={{ ...option, color: "currentColor" }} statuses={statuses} />
    </span>
  );
}

export function StatusPicker({
  option,
  statuses,
  canChange,
  onPick,
  className,
}: {
  /** The card's status, resolved against its List (resolveCardStatus). */
  option: StatusOption;
  statuses: StatusOption[];
  canChange: boolean;
  onPick: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const name = option.label || "No status";

  if (!canChange) {
    return (
      <span
        className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center", className)}
        title={`Status: ${name}`}
        role="img"
        aria-label={`Status: ${name}`}
      >
        <LiftedGlyph option={option} statuses={statuses} />
      </span>
    );
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-[color-mix(in_srgb,var(--be-c)_var(--be-pill),transparent)]",
          className,
        )}
        title={`Status: ${name}. Change status`}
        aria-label={`Status: ${name}. Change status`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <LiftedGlyph option={option} statuses={statuses} />
      </button>
      <MorePortal anchorRef={anchorRef} width={260} open={open} placement="below" onClose={() => setOpen(false)}>
        <MenuList aria-label="Change status">
          {statuses.map((s) => (
            <MenuItem
              key={s.value}
              role="menuitemradio"
              aria-checked={s.value === option.value}
              leading={<StatusGlyph current={s} statuses={statuses} />}
              label={s.label}
              title={s.label}
              selected={s.value === option.value}
              onClick={() => {
                setOpen(false);
                if (s.value !== option.value) onPick(s.value);
              }}
            />
          ))}
        </MenuList>
      </MorePortal>
    </>
  );
}
