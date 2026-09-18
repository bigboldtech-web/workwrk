"use client";

// SkipLinks (spec-shell 2.1 landmarks): the first two focusable elements in
// the frame. Visually hidden until focused, then a 36px surface pill at the
// inline-start of the content column. "Skip to content" moves focus to
// <main id="main">; "Skip to sidebar" targets the hub sidebar.
//
// The pill clears the rail at every width and additionally clears the
// sidebar column only where a sidebar is actually docked (spec-shell 1.16:
// below 1024 the hub sidebar is an overlay drawer, so the content column
// starts right after the rail and a 264px offset would push the pill into
// the page).

const CLS =
  "os-chrome sr-only focus:not-sr-only focus:fixed focus:start-[calc(var(--os-rail-w)+12px)] lg:focus:start-[calc(var(--os-rail-w)+var(--os-side-w)+12px)] focus:top-[calc(var(--os-top-h)+8px)] focus:z-[70] focus:inline-flex focus:h-9 focus:items-center focus:rounded-full focus:border focus:border-line focus:bg-raised focus:px-4 focus:text-base focus:font-medium focus:text-ink focus:shadow-[var(--os-shadow-pop)] focus:outline-none";

export const MAIN_ID = "main";
export const SIDEBAR_ID = "hub-sidebar";
/** The tablet overlay drawer (768 to 1023); a second element, never both. */
export const SIDEBAR_DRAWER_ID = "hub-sidebar-drawer";

function focusTarget(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus();
}

export function SkipLinks({ settingsMode }: { settingsMode?: boolean }) {
  return (
    <>
      <a href={`#${MAIN_ID}`} className={CLS} onClick={(e) => { e.preventDefault(); focusTarget(MAIN_ID); }}>
        Skip to content
      </a>
      {/* The link is rendered only where its target is actually on screen:
          focus() on a display:none element is a no-op, so a link past the
          breakpoint would be dead. In the app the hub sidebar is a drawer
          below 1024 (the bar's Menu button opens it); in the settings
          takeover the list survives down to its own 900px breakpoint
          (spec-shell 1.16), where the Pages select replaces it. */}
      <a
        href={`#${SIDEBAR_ID}`}
        className={`${CLS} ${settingsMode ? "max-[899px]:hidden" : "max-lg:hidden"}`}
        onClick={(e) => { e.preventDefault(); focusTarget(SIDEBAR_ID); }}
      >
        {settingsMode ? "Skip to settings list" : "Skip to sidebar"}
      </a>
    </>
  );
}
