"use client";

// ClickAppRail — left icon column, driven by the org ACCESS system
// (2026-08-22, replaces personal pins). Every icon is an app the viewer
// has access to, in the Super Admin's order — shell-context's railApps
// resolves that from OrgPreference.sidebarDefault.apps via
// src/lib/rail-apps. Consequences here:
//   - no drag-reorder, no pin/unpin context menu, no ghost icons:
//     everything accessible is always present, so there is nothing to
//     pin and nothing "unpinned" to surface
//   - a route whose app the org hid (or the viewer can't access) simply
//     highlights nothing — the icon isn't ghosted back in
//   - the <nav> scrolls (overflow-y-auto): with access-wide visibility
//     the rail can carry 15-20+ icons on short viewports
//
// The highlight is URL-derived (spec-shell.md §1.1): the white pill and
// aria-current sit on resolveHub(pathname), never on a stored key, so a
// pasted link shows the same chrome the sender saw. The hover-preview of
// another hub's sidebar is gone with it — hovering a rail icon changes
// nothing but the icon's own background. Cmd+1..9 (shell-context) now
// navigates to the hub instead of writing a key.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UserPlus, ArrowUpCircle, LayoutGrid } from "lucide-react";
import { type AppEntry } from "./apps-catalog";
import { resolveHub } from "@/lib/nav/route-hub";
import { InviteModal } from "./invite-modal";
import { useOsShell } from "./shell-context";

const HOVER_OPEN_MS = 180;
const HOVER_CLOSE_MS = 120;

// One rail-label treatment so every cell is the same height and full
// words never clip. Centered under the icon, up to 2 lines, then
// ellipsis — no more hard-coded "Dashboa.." / "Timeshe..".
function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-[20px] w-full items-center justify-center px-px">
      <span className="line-clamp-2 break-words text-center text-[10px] leading-[1.3]">
        {children}
      </span>
    </span>
  );
}

export function ClickAppRail() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const {
    sidebarCollapsed, setSidebarCollapsed,
    railApps, openAppsGrid, appsGridOpen,
    pushRecentApp, iconsOnly, hubHref,
  } = useOsShell();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The one source of the highlight. When the resolved hub is not in railApps
  // (the org hid it, or the viewer cannot access it) no icon matches and
  // nothing highlights, which is the wanted behaviour for those routes.
  const highlightedKey: string = resolveHub(pathname);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // Hover state is local and cosmetic now: it tints the icon chip and nothing
  // else. It no longer swaps the sidebar out from under the URL.
  const scheduleOpen = (key: string) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverKey(key), HOVER_OPEN_MS);
  };
  const scheduleClose = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHoverKey(null), HOVER_CLOSE_MS);
  };

  const handleClick = (app: AppEntry) => {
    // Reopening a collapsed sidebar is the side effect setActiveApp used to
    // carry; it has to live here now, or a collapsed sidebar could only be
    // reopened by the chord.
    setSidebarCollapsed(false);
    // "Clicking the already-active hub reopens a collapsed sidebar and
    // otherwise does nothing" (spec-shell §1.1). Inside a hub the sidebar is
    // how you move, so re-navigating would only throw away where you are: the
    // Work landing, for one, re-runs its first-Space redirect and drops you in
    // a Space you were not in. No landing is stranded: the click still
    // navigates from every other hub, and inside the hub the sidebar carries
    // the rows.
    if (highlightedKey === app.key) return;
    pushRecentApp(app.key);
    router.push(hubHref(app.key));
  };

  // ClickUp-style theming: the rail uses a *dark, muted* version of the
  // accent (--os-brand-rail) regardless of light/dark theme — that's
  // what gives the composed look. The full-saturation brand reappears
  // on the active pill (white background, brand-colored icon).
  // Why full white (not /85): the saturated brand-rail tones (mint, teal,
  // pink, …) dim a translucent white into the background hue, so 85%
  // read as faded brand-tinted ghosts in light mode. Full white at this
  // size (18px stroked) holds up cleanly against every accent.
  const railTextColor = "text-white";
  const railHoverBg = "hover:bg-white/15";

  return (
    <aside
      // `color: #fff` here is load-bearing. `.workwrk-os button { color:
      // inherit }` in os.css has higher specificity than Tailwind's
      // `.text-white`, so Tailwind utilities on rail buttons would lose
      // and the icons would inherit `--os-ink` (dark text on dark rail =
      // invisible in light mode). Setting it on the <aside> lets the
      // inactive children inherit white, while active items still win
      // with their own inline `color: var(--os-brand-rail)` for the
      // dark-icon-on-white-pill look.
      style={{ backgroundColor: "var(--os-brand-rail)", color: "#fff" }}
      className="w-[60px] flex-shrink-0 h-full flex flex-col relative transition-colors rounded-xl overflow-hidden"
      onMouseLeave={scheduleClose}
    >
      {/* overflow-y-auto is load-bearing: the ACCESS rail shows every
          accessible app (15-20+ icons for admins), so the column must
          scroll on short viewports instead of clipping the tail. */}
      <nav className="flex-1 pt-3 pb-2 overflow-y-auto overflow-x-visible os-no-scrollbar">
        {railApps.map((app, idx) => {
          // No `&& !sidebarCollapsed`: the pill follows the URL whether or not
          // the sidebar is open, so working collapsed no longer hides where
          // you are.
          const active = highlightedKey === app.key;
          const isHovered = hoverKey === app.key;
          const shortcut = idx < 9 ? `⌘${idx + 1}` : undefined;
          return (
            <div
              key={app.key}
              className="relative mb-1.5"
              onMouseEnter={() => scheduleOpen(app.key)}
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                onClick={() => handleClick(app)}
                title={`${app.label.replace(/\.\.$/, "")}${shortcut ? `  ${shortcut}` : ""}`}
                className={`group w-full flex flex-col items-center justify-center gap-0.5 px-0.5 py-1 focus:outline-none focus-visible:outline-none transition-colors ${
                  active ? "text-white" : `${railTextColor} hover:text-white`
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span
                  className={`flex items-center justify-center w-[28px] h-[28px] rounded-lg transition-colors ${
                    active ? "" : isHovered ? railHoverBg : "group-hover:bg-white/10"
                  }`}
                  style={active ? {
                    background: "rgba(255,255,255,0.95)",
                    color: "var(--os-brand-rail)",
                  } : undefined}
                >
                  {/* Lined icons only (user 2026-08-27): the duotone
                      brand glyphs made half the rail colourful while TLK
                      and Tables sat there as clean lines. */}
                  <app.Icon className="w-[16px] h-[16px]" />
                </span>
                {iconsOnly ? null : <RailLabel>{app.label}</RailLabel>}
              </button>
            </div>
          );
        })}

        <div className="relative mt-1">
          <button
            type="button"
            onClick={openAppsGrid}
            title="Browse and launch apps"
            className={`group w-full flex flex-col items-center justify-center gap-0.5 px-0.5 py-1 focus:outline-none focus-visible:outline-none transition-colors ${
              appsGridOpen ? "text-white" : `${railTextColor} hover:text-white`
            }`}
            aria-haspopup="dialog"
            aria-expanded={appsGridOpen}
          >
            <span
              className={`flex items-center justify-center w-[28px] h-[28px] rounded-lg transition-colors ${
                appsGridOpen ? "" : "group-hover:bg-white/15"
              }`}
              style={appsGridOpen ? {
                background: "rgba(255,255,255,0.95)",
                color: "var(--os-brand-rail)",
              } : undefined}
            >
              <LayoutGrid className="w-[16px] h-[16px]" />
            </span>
            {iconsOnly ? null : <RailLabel>More</RailLabel>}
          </button>
        </div>
      </nav>

      <div className="pb-2 pt-1.5 border-t border-white/15">
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          title="Invite teammates"
          className="mx-1 flex w-[calc(100%-8px)] flex-col items-center gap-0.5 rounded-lg py-1.5 text-white hover:bg-white/10 transition-colors"
        >
          <UserPlus className="w-[16px] h-[16px]" />
          {iconsOnly ? null : <RailLabel>Invite</RailLabel>}
        </button>
        <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} />
        <Link
          href="/settings"
          title="Upgrade workspace"
          className="mx-1 flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-white hover:bg-white/10 transition-colors"
        >
          <ArrowUpCircle className="w-[16px] h-[16px]" />
          {iconsOnly ? null : <RailLabel>Upgrade</RailLabel>}
        </Link>
      </div>
    </aside>
  );
}
