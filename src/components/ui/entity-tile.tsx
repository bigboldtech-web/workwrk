"use client";

// EntityTile — the one canonical "icon square" for every entity in the
// app: Space, Folder, Board, Doc, Whiteboard, Table, saved View, etc.
//
// Before this existed the same colored-rounded-square-with-a-glyph was
// hand-rolled ~17 times across the sidebar, breadcrumbs, pickers, create
// modals and detail pages — each with its own size, radius, glyph size
// and color source. That drift is exactly the "bleeding / unaligned"
// look we're fixing: tiles that should be identical were 16/18/20/36px
// with `rounded` vs `rounded-md` vs `rounded-lg`.
//
// One component, four sizes, one radius ramp, one glyph ramp. Pass a
// lucide icon NAME (resolved via the Space icon catalog), a lucide
// component directly, an emoji string, or nothing (falls back to the
// first letter of `name`).
//
// 2026-08-26 restyle (user: "make all the icons lined like TLK"): the
// colored square is GONE. The glyph renders as a plain outline icon
// stroked with the entity's color (zinc when none), letters become
// colored letters, emoji stay emoji. The box keeps its exact size so
// no row or picker shifts by a pixel.

import { createElement, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Folder, FileText, ListChecks, LayoutGrid, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSpaceIcon } from "@/components/layout/os/space-icon-catalog";

// Named fallbacks — a Server Component can pass a *string* (not a function),
// which is safe across the RSC boundary. `fallbackIcon` (a component) is only
// safe from Client Components.
const FALLBACK_ICONS = {
  folder: Folder,
  doc: FileText,
  file: FileText,
  board: LayoutGrid,
  list: ListChecks,
} as const;
export type EntityTileFallback = keyof typeof FALLBACK_ICONS;

/** Neutral zinc used when an entity has no color of its own. */
export const DEFAULT_TILE_COLOR = "#71717A";

const tileVariants = cva(
  "inline-flex items-center justify-center font-semibold uppercase shrink-0 leading-none select-none overflow-hidden",
  {
    variants: {
      size: {
        xs: "h-4 w-4 text-[10px]",
        sm: "h-[18px] w-[18px] text-[11px]",
        md: "h-5 w-5 text-[12px]",
        lg: "h-9 w-9 text-[16px]",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

// Glyph size per box — a touch larger than the old chip glyphs since
// there is no square around them anymore.
const GLYPH: Record<NonNullable<VariantProps<typeof tileVariants>["size"]>, string> = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-6 w-6",
};

export interface EntityTileProps extends VariantProps<typeof tileVariants> {
  /** Lucide icon name (catalog), a lucide component, or an emoji string. */
  icon?: string | LucideIcon | null;
  /** Stroke/letter color (the entity's identity color). Neutral zinc default. */
  color?: string | null;
  /** Name — first letter is the glyph when no icon resolves. */
  name?: string | null;
  /** Icon to use when `icon` resolves to nothing (e.g. FileText for docs).
   *  A component — only pass from Client Components. */
  fallbackIcon?: LucideIcon | null;
  /** Named fallback icon — SAFE to pass from Server Components (it's a string). */
  fallback?: EntityTileFallback | null;
  className?: string;
  title?: string;
}

function resolveLucide(icon: EntityTileProps["icon"]): LucideIcon | null {
  if (!icon) return null;
  if (typeof icon === "string") return getSpaceIcon(icon);
  return icon;
}

export function EntityTile({
  icon,
  color,
  name,
  fallbackIcon,
  fallback,
  size = "sm",
  className,
  title,
}: EntityTileProps) {
  const sz = size ?? "sm";
  const glyph = GLYPH[sz];
  const lucide = resolveLucide(icon);
  // A string `icon` that isn't a catalog name (e.g. an emoji) renders as text.
  const emoji = typeof icon === "string" && !lucide && icon.trim() ? icon.trim() : null;
  const namedFallback = fallback ? FALLBACK_ICONS[fallback] : null;
  const Glyph = lucide ?? (emoji ? null : (fallbackIcon ?? namedFallback ?? null));

  let content: ReactNode;
  if (Glyph) content = createElement(Glyph, { className: glyph });
  else if (emoji) content = <span className="not-italic normal-case">{emoji}</span>;
  else content = name?.trim()?.[0]?.toUpperCase() ?? "?";

  return (
    <span
      className={cn(tileVariants({ size: sz }), className)}
      style={{ color: color ?? DEFAULT_TILE_COLOR }}
      title={title}
      aria-hidden
    >
      {content}
    </span>
  );
}
