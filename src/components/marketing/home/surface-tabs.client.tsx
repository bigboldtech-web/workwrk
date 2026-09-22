"use client";

// The tab strip over the product frame.
//
// This is the category's answer to breadth, and the survey found all four
// rivals solving the same problem the same way: monday, ClickUp, Jira and
// Notion each need to show a dozen capabilities without a dozen sections,
// and each of them uses a horizontal row of selectable chips over one
// picture that changes. A visitor learns the product is wide by operating
// the page rather than by reading a list that says so.
//
// WHY THIS IS THE ONE CLIENT ISLAND ON THE PAGE. Everything else the home
// page does is server markup. This section cannot be: the chips have to
// swap the picture without a navigation, which is the whole mechanic.
//
// WHAT IT DOES NOT DO, AND WHY. It does not render the product frames. The
// frames are built on the SERVER and arrive here as ReactNodes in `tabs`.
// A `render: () => ReactNode` field would not survive the boundary at all
// (a function is not serializable), and even a client-side import of
// MarketingShell would drag the whole surfaces library, its icon set and
// its stylesheet into the browser bundle to draw pictures that never
// change. So this island owns exactly three things: which chip is on,
// keyboard movement between chips, and the ARIA wiring. Everything visible
// inside a panel is server markup.
//
// ACCESSIBILITY. This is the ARIA tabs pattern, not a row of buttons that
// happen to change a div. The strip is a `tablist`, arrow keys move between
// chips with Home and End jumping to the ends, and the roving tabindex
// keeps exactly one chip in the tab order so a keyboard user passes the
// section in one press rather than eight.
//
// All panels are MOUNTED at once and the inactive ones are hidden with the
// `hidden` attribute rather than unmounted. Two reasons, the second load
// bearing:
//   1. Switching a chip costs no render, so the picture changes on the same
//      frame as the click.
//   2. This content is the product tour. A crawler, a link preview and a
//      reader with JavaScript off all get every surface in the markup
//      instead of one. `hidden` is honoured by assistive technology, so
//      nobody is read the inactive ones.

import { useCallback, useId, useRef, useState, type ReactNode } from "react";

export interface SurfaceTab {
  /** Stable key, also used to build the tab and panel ids. */
  id: string;
  /** The chip's label. */
  label: string;
  /** The chip's icon, rendered on the server. */
  icon: ReactNode;
  /** The product frame for this view, rendered on the server. */
  frame: ReactNode;
  /** The sentence under the frame saying what this view is. */
  note: string;
}

export function SurfaceTabs({ tabs }: { tabs: SurfaceTab[] }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const stripRef = useRef<HTMLDivElement>(null);

  const focusTab = useCallback((index: number) => {
    const chips = stripRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    chips?.[index]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const last = tabs.length - 1;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = active === last ? 0 : active + 1;
      else if (event.key === "ArrowLeft") next = active === 0 ? last : active - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      if (next === null) return;
      // Only once the key is one we handle. Calling this unconditionally
      // would eat Tab and trap the keyboard inside the strip.
      event.preventDefault();
      setActive(next);
      focusTab(next);
    },
    [active, focusTab, tabs.length],
  );

  return (
    <div>
      <div className="mk-tabs" role="tablist" aria-label="Product views" ref={stripRef} onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            className="mk-tab"
            aria-selected={index === active}
            aria-controls={`${baseId}-panel-${tab.id}`}
            // Roving tabindex: the strip is ONE tab stop, per the pattern.
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={index !== active}
          // The panel holds no focusable content of its own, so it takes
          // focus itself when a reader tabs out of the strip into it.
          tabIndex={0}
        >
          <div className="mk-tabpanel">{tab.frame}</div>
          <p className="mk-tabpanel__note">{tab.note}</p>
        </div>
      ))}
    </div>
  );
}
