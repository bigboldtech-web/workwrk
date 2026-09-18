"use client";

// The one primary on AppOff for an Admin: opens the Apps page through
// openSettings so "Back to app" returns here (settings-nav origin rule).

import { useSettingsNav } from "@/hooks/use-settings-nav";

export function SettingsLink({ href, label }: { href: string; label: string }) {
  const { openSettings } = useSettingsNav();
  return (
    <button
      type="button"
      onClick={() => openSettings(href)}
      className="os-chrome inline-flex h-9 items-center rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-[var(--os-brand-hover)]"
    >
      {label}
    </button>
  );
}
