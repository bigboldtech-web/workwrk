"use client";

// My settings > Keyboard shortcuts (settings-architecture 4.6): read-only,
// and the SAME live registry the ? overlay reads (src/lib/shortcuts.ts
// useShortcutList), grouped the same way, so the page can never list a key
// the app does not answer or miss one it does. The avatar menu's old
// /settings?tab=shortcuts 308s here.

import { useEffect, useMemo, useState } from "react";
import { detectPlatform, formatKeys, useShortcutList, type Platform } from "@/lib/shortcuts";
import { groupShortcuts } from "@/lib/shortcut-groups";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";

export default function KeyboardShortcutsPage() {
  const list = useShortcutList();
  const [platform, setPlatform] = useState<Platform>("mac");
  useEffect(() => {
    const t = setTimeout(() => setPlatform(detectPlatform()), 0);
    return () => clearTimeout(t);
  }, []);
  const groups = useMemo(() => groupShortcuts(list), [list]);

  return (
    <SettingsPage pageKey="account/shortcuts">
      <p className="mb-4 max-w-2xl text-base text-ink-2">
        Every shortcut WorkwrK answers right now. Press <kbd className="rounded border border-line-strong bg-active px-1.5 py-0.5 font-sans text-xs text-ink">?</kbd> anywhere to see this list over the page you are on.
      </p>
      <SettingsCardStack>
        {groups.map((g) => (
          <SettingsCard key={g.name} title={g.name} wide="shortcuts.list">
            <div>
              {g.items.map((d) => (
                <SettingsRow
                  key={d.id}
                  label={d.label}
                  readOnlyValue={
                    <kbd className="rounded-md border border-line-strong bg-active px-1.5 py-0.5 font-sans text-xs text-ink">
                      {formatKeys(d.keys, platform)}
                    </kbd>
                  }
                />
              ))}
            </div>
          </SettingsCard>
        ))}
        {groups.length === 0 ? <p className="text-base text-ink-2">No shortcuts are registered right now.</p> : null}
      </SettingsCardStack>
    </SettingsPage>
  );
}
