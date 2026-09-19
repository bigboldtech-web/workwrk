"use client";

// EntityCard (spec-spaces-lists section 3): the one card in a card grid.
//
// The design system defines TableCard, the Home widget and the kanban card and
// no card-grid primitive, so /spaces' Grid view and /templates' template grid
// would otherwise be two separate piles of raw tokens drifting apart. They are
// one component with two variants.
//
// --os-surface, 1px --os-line, radius 8, padding 16, hover --os-surface-hov.
// No shadow, no hover transform (design-system: nothing a hovered element does
// moves it).

import Link from "next/link";
import { type ReactNode } from "react";
import { Globe, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** The two glyphs access section 6.1 fixes, and no third one. */
export type EntityCardGlyph = "globe" | "lock" | null;

export interface EntityCardProps {
  variant: "space" | "template";
  /** The tile or artwork at the head of the card. */
  media: ReactNode;
  title: string;
  /** One 13px line under the title. */
  subtitle?: string | null;
  /** The small chips and counts at the foot of the card. */
  meta?: ReactNode;
  glyph?: EntityCardGlyph;
  /** A card is a link when it has an href, and a button when it has onClick. */
  href?: string;
  onClick?: () => void;
  /** The hover "..." at the card's top-right corner. */
  menu?: ReactNode;
  people?: ReactNode;
  className?: string;
}

const GLYPH_TITLE: Record<"globe" | "lock", string> = {
  globe: "Everyone in the workspace",
  lock: "Restricted",
};

export function EntityCard({
  variant,
  media,
  title,
  subtitle,
  meta,
  glyph = null,
  href,
  onClick,
  menu,
  people,
  className,
}: EntityCardProps) {
  const Glyph = glyph === "globe" ? Globe : glyph === "lock" ? Lock : null;

  const body = (
    <>
      <div className={cn("flex", variant === "template" ? "justify-center pb-3" : "items-center pb-3")}>{media}</div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{title}</span>
        {Glyph ? <Glyph className="h-3 w-3 shrink-0 text-ink-3" aria-label={GLYPH_TITLE[glyph as "globe" | "lock"]} /> : null}
      </div>
      {subtitle ? <p className="mt-1 line-clamp-2 text-sm text-ink-2">{subtitle}</p> : null}
      {meta || people ? (
        <div className="mt-2.5 flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">{meta}</span>
          {people}
        </div>
      ) : null}
    </>
  );

  const shell = cn(
    "os-row group relative flex w-full flex-col rounded-lg border border-line bg-raised p-4 text-start hover:bg-hover",
    className,
  );

  return (
    <div className="relative">
      {href ? (
        <Link href={href} className={shell}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={shell}>
          {body}
        </button>
      )}
      {menu ? (
        <div className="absolute end-2 top-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100">
          {menu}
        </div>
      ) : null}
    </div>
  );
}
