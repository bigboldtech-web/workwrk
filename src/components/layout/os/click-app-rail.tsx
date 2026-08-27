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
// Unchanged: Cmd+1..9 jumps to the Nth rail app (shell-context), hover
// previews the app's sidebar, active app shows the white pill, and the
// "More" tile opens AppsMorePopover as a launcher over the same set.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UserPlus, ArrowUpCircle, LayoutGrid } from "lucide-react";
import { type AppEntry } from "./apps-catalog";
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
      <span className="line-clamp-2 break-words text-center text-[10px] leading-[1.1]">
        {children}
      </span>
    </span>
  );
}

export function ClickAppRail() {
  const router = useRouter();
  const {
    activeAppKey, setActiveApp, sidebarCollapsed,
    railApps, openAppsGrid, appsGridOpen,
    pushRecentApp, iconsOnly,
    setPreviewApp, keepPreview, clearPreviewSoon,
  } = useOsShell();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // activeAppKey can lag reality (localStorage carries it across sessions,
  // and an admin may hide the app mid-session). When it names an app that
  // isn't in railApps, no icon matches and nothing highlights — which is
  // exactly the wanted behavior for hidden apps' routes.
  const highlightedKey = activeAppKey || "home";

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const scheduleOpen = (key: string) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    keepPreview(); // cancel any pending close so sweeping between icons doesn't flicker
    hoverTimer.current = setTimeout(() => { setHoverKey(key); setPreviewApp(key); }, HOVER_OPEN_MS);
  };
  const scheduleClose = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHoverKey(null), HOVER_CLOSE_MS);
    clearPreviewSoon(); // the sidebar cancels this if the pointer lands on it
  };

  const handleClick = (app: AppEntry) => {
    setActiveApp(app.key);
    pushRecentApp(app.key);
    if (app.defaultHref) router.push(app.defaultHref);
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
          const active = highlightedKey === app.key && !sidebarCollapsed;
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
