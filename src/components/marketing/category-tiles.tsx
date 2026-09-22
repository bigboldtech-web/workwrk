"use client";

// The fourteen category tiles, as one component.
//
// They were built for the Stack Receipt on the home page, where tapping a
// tile adds a line to the receipt. marketing-concept.md section 5 asks for
// the SAME object on /demo, as the "tools you use today" field, so the
// answer routes the request: a prospect who taps Spreadsheets, Chat and an
// OKR tool has told us more in three taps than an "Industry" select ever
// does, and it is the one field that makes this form ours rather than a
// generic contact form.
//
// So the markup lives here and both surfaces render it. One grid, one
// pressed state, one focus ring, one source of categories, and a tile
// added to the pricing file appears on both pages at once.
//
// `glyph` and `price` are optional because the demo form is not a
// calculator: it asks which tools you pay for, not what they cost.

import type { ReactNode } from "react";

import { pricing } from "@/components/marketing/data/pricing";
import "@/components/marketing/home/home.css";

export function CategoryTiles({
  selected,
  onToggle,
  glyphs,
  priceFor,
  ariaLabel,
}: {
  /** The ids currently pressed. */
  selected: readonly string[];
  onToggle: (id: string) => void;
  /** One icon per category id. Omit for a tile grid with no glyphs. */
  glyphs?: Record<string, ReactNode>;
  /** The per seat price to print on a tile. Omit to print none. */
  priceFor?: (id: string) => string;
  /** Names the group for a screen reader. */
  ariaLabel: string;
}) {
  return (
    <div className="mk-tiles" role="group" aria-label={ariaLabel}>
      {pricing.categories.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            className="mk-tile14 mk-focus"
            aria-pressed={on}
            onClick={() => onToggle(c.id)}
          >
            {glyphs ? <span className="mk-tile14__glyph">{glyphs[c.id]}</span> : null}
            <span className="mk-tile14__label">{c.label}</span>
            {priceFor ? (
              <span className="mk-tile14__price mk-figures">{priceFor(c.id)}</span>
            ) : null}
            {/* No trailing dot on the toggle. It carries no meaning here
                that the pressed state does not already carry, and the 14px
                it takes is what pushed "Spreadsheets" onto two lines in a
                two column phone grid. */}
          </button>
        );
      })}
    </div>
  );
}

/** The labels behind a set of ids, in the pricing file's own order. */
export function categoryLabels(ids: readonly string[]): string[] {
  return pricing.categories.filter((c) => ids.includes(c.id)).map((c) => c.label);
}
