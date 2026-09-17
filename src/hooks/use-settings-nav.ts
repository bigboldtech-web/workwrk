"use client";

// useSettingsNav: the router-bound half of the origin rule
// (settings-architecture.md section 8.3).
//
//   const { openSettings, closeSettings } = useSettingsNav();
//   openSettings("/settings/members");   // records where you came from, then navigates
//   closeSettings();                     // returnTo, else lastAppPath, else /today
//
// `closeSettings` runs the dirty guard first, so a Save-bar page with unsaved
// changes gets its Save / Discard / Keep editing confirm before anything moves.

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { confirmLeave } from "@/lib/dirty-guard";
import { clearSettingsReturn, closeSettingsTarget, rememberSettingsOrigin } from "@/lib/settings-nav";

export function useSettingsNav() {
  const router = useRouter();

  const openSettings = useCallback(
    (href: string) => {
      rememberSettingsOrigin();
      router.push(href);
    },
    [router],
  );

  const closeSettings = useCallback(async (): Promise<boolean> => {
    const ok = await confirmLeave();
    if (!ok) return false;
    const target = closeSettingsTarget();
    clearSettingsReturn();
    router.push(target);
    return true;
  }, [router]);

  return { openSettings, closeSettings };
}
