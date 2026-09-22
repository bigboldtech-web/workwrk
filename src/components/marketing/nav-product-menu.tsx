"use client";

// The Product dropdown (marketing-concept.md section 3 row 0).
//
// The spec asks for "Product ▾ (eight modules, each one line, one dot, one
// 'Replaces:' note)", and section 2.4 says the rail's hover tags are what
// "gives the Product nav dropdown its one-line note per hub". The nav shipped
// "Product" as a flat anchor to /features instead, so the eight
// /product/[module] pages, which section 5 says carry the SEO keywords, had
// no entry anywhere in the top navigation. They were reachable from the home
// module tour, the footer and /features, so nothing was lost; what was
// missing was the spec's primary path to them.
//
// WHY A NATIVE `details` AND NOT A MENU WIDGET.
//
// The nav this one replaced was three hover-only mega menus: the triggers
// opened on pointer enter and closed on a 120ms timer, with no click path and
// no key path, so twenty one links were unreachable without a mouse. The note
// at the top of nav.tsx records that, and the fix was to delete them. Putting
// a dropdown back has to not reintroduce it, so the browser owns everything
// it can own: `details` gives the toggle, Enter, Space and the expanded state
// for free, the panel's contents are ordinary links in the tab order, and
// there is no roving tabindex, no focus trap and no aria-expanded to keep in
// sync by hand.
//
// THE THREE THINGS THE BROWSER DOES NOT DO, and they are the whole of this
// client island:
//
//   1. Escape closes it and returns focus to the trigger. `details` has no
//      Escape behaviour, so without this a keyboard visitor who opened the
//      panel could only leave it by tabbing through all nine rows.
//   2. A pointer press outside closes it. Otherwise the panel stays open
//      over the page after the visitor has moved on, which on a sticky nav
//      means it covers the hero until something else is clicked.
//   3. Navigating closes it. A client-side route change does not unmount the
//      nav, so the panel would still be open on the page it just opened.
//
// Nothing here opens the panel on hover. Hover-to-open is what made the old
// nav unusable, and a pointer user has a click.
//
// It renders NOTHING it does not receive: the eight rows are built on the
// server from the Tuesday fixture and handed down as children, so the 850
// line storyboard never crosses into the browser bundle with this file.

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function NavProductMenu({
  label,
  children,
  owns,
}: {
  label: string;
  children: ReactNode;
  /**
   * The path prefixes this row answers for, so the underline still answers
   * "where am I". The trigger is not a link and has no `aria-current`, so
   * without this the eight module pages and /features would be the only
   * routes on the site with no row underlined. The list is computed HERE
   * rather than passed in from the server: the nav is a server component and
   * `usePathname` is the only thing that knows the answer.
   */
  owns: readonly string[];
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const current = Boolean(
    pathname && owns.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );

  // Close on navigation. The nav is in the layout, so a route change inside
  // the marketing group re-renders it without unmounting it.
  useEffect(() => {
    const el = ref.current;
    if (el) el.open = false;
  }, [pathname]);

  useEffect(() => {
    function close(focusTrigger: boolean) {
      const el = ref.current;
      if (!el?.open) return;
      el.open = false;
      if (focusTrigger) el.querySelector("summary")?.focus();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close(true);
    }
    function onPointerDown(event: PointerEvent) {
      const el = ref.current;
      if (!el?.open) return;
      if (event.target instanceof Node && el.contains(event.target)) return;
      close(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <details className="mk-nav__product" ref={ref}>
      <summary className="mk-nav__link mk-focus" data-current={current ? "true" : undefined}>
        {label}
        {/* Decorative: the disclosure state is already on the summary. */}
        <svg className="mk-nav__caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden focusable="false">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="mk-nav__panel">{children}</div>
    </details>
  );
}
