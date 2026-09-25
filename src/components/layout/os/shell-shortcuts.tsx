"use client";

// ShellShortcuts: the shell's ONE window keydown listener (spec-shell
// section 1.8) and the registration of the global map from
// src/lib/shortcuts.ts. Mounted once in OsShell.
//
// Order of business on every keydown:
//   1. nothing while the session is expired (the dialog owns the screen)
//   2. an event some component already consumed (defaultPrevented) is not
//      ours: a Radix dialog's own Esc stays its own
//   3. while the splash is the top layer ANY key skips it (1.5)
//   4. Esc closes the top layer of the LayerStack and stops there; when no
//      layer is open it falls through to any registered Escape shortcut
//      (the settings takeover registers one, scope "page")
//   5. everything else goes to the registry: chords, then the G prefix
//
// Only chords with a working destination today are registered; the overlay
// lists `shortcuts.visible()` so it can never advertise a dead one.

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOsShell } from "./shell-context";
import { shortcuts, useShortcut, SHORTCUTS } from "@/lib/shortcuts";
import { isSessionExpired } from "@/lib/session-expiry";
import { isSettingsRoute } from "@/lib/settings-nav";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { SETTINGS_FILTER_FOCUS_EVENT } from "./top-bar/top-bar";
import { apiFetch } from "@/lib/api-fetch";
import { useOsToast } from "./toast";
// A note made with the chord opens in the section the person is in.
import { objectHrefNow } from "./use-object-href";

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
    topLayerKind,
  } = useOsShell();

  // The listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSessionExpired()) return;
      if (e.defaultPrevented) return;
      // The splash is skippable by any key, not only Esc.
      if (topLayerKind === "splash" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        closeTopLayer();
        e.preventDefault();
        return;
      }
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
  }, [closeTopLayer, topLayerKind]);

  // ── The global map ─────────────────────────────────────────────
  // Inside a settings door ⌘K opens the door filter, not the palette
  // (settings spec 8.2); ⌘/ does the same there.
  useShortcut({
    ...canon["search"],
    scope: "global",
    run: () => {
      if (inSettings) {
        window.dispatchEvent(new CustomEvent(SETTINGS_FILTER_FOCUS_EVENT));
        return;
      }
      if (paletteOpen) closePalette();
      else openPalette();
    },
  });
  useShortcut({
    ...canon["create-task"],
    scope: "global",
    run: () => openCreateTask(),
  });
  // Cmd+Shift+N: quick capture. Creates a blank note and lands in its editor;
  // one in flight at a time so a held chord makes one note, not six.
  const { toast } = useOsToast();
  const noteInFlight = useRef(false);
  useShortcut({
    ...canon["quick-note"],
    scope: "global",
    when: () => !inSettings,
    run: () => {
      if (noteInFlight.current) return;
      noteInFlight.current = true;
      void (async () => {
        try {
          const r = await apiFetch<{ doc?: { id?: string } }>("/api/docs", {
            method: "POST",
            json: { title: "Untitled note", content: { type: "doc", content: [{ type: "paragraph" }] } },
          });
          const id = r.ok ? r.data?.doc?.id : undefined;
          if (!id) { toast("Couldn't create note. Try again"); return; }
          router.push(objectHrefNow("doc", id));
        } finally {
          noteInFlight.current = false;
        }
      })();
    },
  });
  // Spec 1.8 makes this Members-only. The Guest gate waits for the access
  // step's useViewer().orgRole; today it matches the rail: whoever can open
  // the AI hub can press this. The panel is not mounted in the takeover.
  useShortcut({
    ...canon["ask-ai"],
    scope: "global",
    when: () => !inSettings && railApps.some((a) => a.key === "ai"),
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
  useShortcut({
    id: "shortcuts-overlay-alt",
    keys: "mod+/",
    label: "Keyboard shortcuts",
    scope: "global",
    hidden: true,
    run: () => {
      if (inSettings) window.dispatchEvent(new CustomEvent(SETTINGS_FILTER_FOCUS_EVENT));
      else openShortcutsOverlay();
    },
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
        label: app ? `Go to ${app.label}` : canon[`hub-${i + 1}`].label,
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
  useShortcut({ ...canon["go-home"], scope: "global", run: () => router.push(WORK_HOME_HREF) });
  useShortcut({ ...canon["go-my-work"], scope: "global", run: () => router.push("/my-work") });
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
