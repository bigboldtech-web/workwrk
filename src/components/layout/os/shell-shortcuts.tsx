"use client";

// ShellShortcuts: the shell's ONE window keydown listener (spec-shell
// section 1.8) and the registration of the global map from
// src/lib/shortcuts.ts. Mounted once in OsShell, above the settings fork.
//
// Order of business on every keydown:
//   1. nothing while the session is expired (the dialog owns the screen)
//   2. an event some component already consumed (defaultPrevented) is not
//      ours: a Radix dialog's own Esc stays its own
//   3. Esc closes the top layer of the LayerStack and stops there; when no
//      layer is open it falls through to any registered Escape shortcut
//      (the settings takeover registers one, scope "page")
//   4. everything else goes to the registry: chords, then the G prefix
//
// Only chords with a working destination today are registered; the overlay
// lists `shortcuts.visible()` so it can never advertise a dead one.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOsShell } from "./shell-context";
import { shortcuts, useShortcut, SHORTCUTS } from "@/lib/shortcuts";
import { isSessionExpired } from "@/lib/session-expiry";
import { isSettingsRoute } from "@/lib/settings-nav";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";

export const SHORTCUTS_OVERLAY_EVENT = "workwrk:shortcuts-overlay";

/** Open (or toggle) the "?" overlay from anywhere (menus, help). */
export function openShortcutsOverlay(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SHORTCUTS_OVERLAY_EVENT));
}

const canon = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s]));

export function ShellShortcuts() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const inSettings = isSettingsRoute(pathname);
  const {
    openPalette,
    closePalette,
    paletteOpen,
    openCreateTask,
    toggleSidekick,
    toggleSidebar,
    setSidebarCollapsed,
    railApps,
    hubHref,
    closeTopLayer,
    layerCount,
  } = useOsShell();

  // The listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSessionExpired()) return;
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        const r = closeTopLayer();
        if (r === "closed" || r === "refused") {
          e.preventDefault();
          return;
        }
      }
      shortcuts.dispatch(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeTopLayer]);

  // ── The global map ─────────────────────────────────────────────
  // The palette is unmounted in settings mode, so ⌘K is gated there until
  // the door filter exists (settings spec section 8.1).
  useShortcut({
    ...canon["search"],
    scope: "global",
    when: () => !inSettings,
    run: () => (paletteOpen ? closePalette() : openPalette()),
  });
  useShortcut({
    ...canon["create-task"],
    scope: "global",
    when: () => !inSettings,
    run: () => openCreateTask(),
  });
  // Spec 1.8 makes this Members-only. The Guest gate waits for the access
  // step's useViewer().orgRole (reading accessLevel on the client is banned
  // and the engine stays inert in this step), so today it matches the rail:
  // whoever can open the AI hub can press this.
  useShortcut({
    ...canon["ask-ai"],
    scope: "global",
    when: () => !inSettings,
    run: () => toggleSidekick(),
  });
  useShortcut({
    ...canon["toggle-sidebar"],
    scope: "global",
    when: () => !inSettings,
    run: () => toggleSidebar(),
  });
  useShortcut({
    ...canon["shortcuts-overlay"],
    scope: "global",
    run: () => openShortcutsOverlay(),
  });
  // ⌘/ opens the same overlay outside a door (inside one it will focus the
  // door filter once that ships). Hidden: the overlay lists "?" for it. Not
  // in inputs: only ⌘K and Esc work while typing (spec 1.8).
  useShortcut({
    id: "shortcuts-overlay-alt",
    keys: "mod+/",
    label: "Keyboard shortcuts",
    scope: "global",
    hidden: true,
    run: () => openShortcutsOverlay(),
  });

  // G then 1..8: the Nth rail hub in the org's order. Registered only for
  // hubs that exist for this viewer, so the overlay never lists a dead one.
  const hubKeys = railApps.slice(0, 8).map((a) => a.key);
  for (let i = 0; i < 8; i++) {
    const key = hubKeys[i];
    const app = railApps[i];
    // Hooks in a fixed-count loop: the count is a constant, so the order is stable.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useShortcut(
      {
        ...canon[`hub-${i + 1}`],
        label: app ? `Go to ${app.label.replace(/\.\.$/, "")}` : canon[`hub-${i + 1}`].label,
        scope: "global",
        run: () => {
          if (!key) return;
          setSidebarCollapsed(false);
          router.push(hubHref(key));
        },
      },
      !!key,
    );
  }
  useShortcut({ ...canon["go-inbox"], scope: "global", run: () => router.push("/inbox") });
  // "Home" is the Work landing; today that is WORK_HOME_HREF (/today).
  useShortcut({ ...canon["go-home"], scope: "global", run: () => router.push(WORK_HOME_HREF) });
  // Esc is handled above before dispatch; this entry exists so the overlay
  // lists it while a layer is open, and it is a no-op otherwise.
  useShortcut({
    ...canon["close-layer"],
    scope: "global",
    when: () => layerCount > 0,
    run: () => {
      closeTopLayer();
    },
  });

  return null;
}
