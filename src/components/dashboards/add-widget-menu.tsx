"use client";

// Add widget: the kinds a surface offers, in WIDGET_KIND_META's order (Stat,
// Chart, List, Text). Each row is a 28px neutral tile with the kind's 16px
// glyph, the label at 14/500 and a 12px description. The canvas opens it as
// a ~240px popover under its "+ Add widget"; the Space Overview's Add cards
// panel lists the same rows with a trailing "Add".

import { type ReactNode, type RefObject } from "react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { kindsFor, type WidgetKind, type WidgetSurface } from "@/lib/dashboards/widget-kinds";
import { WIDGET_REGISTRY } from "./widget-registry";
import { cn } from "@/lib/utils";

export function AddWidgetRow({ kind, label, description, onPick, trailing, className }: {
  kind: WidgetKind;
  label: string;
  description: string;
  onPick: () => void;
  trailing?: ReactNode;
  className?: string;
}) {
  const Icon = WIDGET_REGISTRY[kind].icon;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start hover:bg-hover focus-visible:bg-hover focus-visible:outline-none", className)}
    >
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-hover text-ink-2">
        <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-ink">{label}</span>
        <span className="line-clamp-2 block text-xs text-ink-2">{description}</span>
      </span>
      {trailing}
    </button>
  );
}

export function AddWidgetMenu({ open, anchorRef, surface, onClose, onPick }: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  surface: WidgetSurface;
  onClose: () => void;
  onPick: (kind: WidgetKind) => void;
}) {
  return (
    <MorePortal anchorRef={anchorRef} width={264} open={open} placement="below" onClose={onClose}>
      <div role="menu" aria-label="Add widget" className="rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)]">
        {kindsFor(surface).map((m) => (
          <AddWidgetRow
            key={m.kind}
            kind={m.kind}
            label={m.label}
            description={m.description}
            onPick={() => {
              onClose();
              onPick(m.kind);
            }}
          />
        ))}
      </div>
    </MorePortal>
  );
}
