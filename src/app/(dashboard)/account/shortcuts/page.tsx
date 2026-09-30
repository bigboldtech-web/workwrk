"use client";

// My settings > Keyboard shortcuts (spec-account-auth `/account/shortcuts`):
// the printable reference, one table per scope in the spec's order.
// Anywhere is the SAME live registry the ? overlay reads (src/lib/shortcuts.ts
// useShortcutList, global scope), so it can never list a key the shell does
// not answer. The page scopes (Lists and boards, Inbox, Docs, Tables, Talk,
// Settings) come from src/lib/shortcut-reference.ts, whose test fails when a
// listed chord's listener is gone. The avatar menu's old
// /settings?tab=shortcuts 308s here.

import { Fragment, useEffect, useMemo, useState } from "react";
import { detectPlatform, formatKeys, useShortcutList, type Platform } from "@/lib/shortcuts";
import { groupShortcuts } from "@/lib/shortcut-groups";
import { SHORTCUT_REFERENCE } from "@/lib/shortcut-reference";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";

const kbdCls = "rounded-md border border-line-strong bg-active px-1.5 py-0.5 font-sans text-xs text-ink";

function Chords({ keys, platform }: { keys: readonly string[]; platform: Platform }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <Fragment key={k}>
          {i > 0 ? <span className="text-sm text-ink-3" aria-hidden>/</span> : null}
          <kbd className={kbdCls}>{formatKeys(k, platform)}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

export default function KeyboardShortcutsPage() {
  const list = useShortcutList();
  const [platform, setPlatform] = useState<Platform>("mac");
  useEffect(() => {
    const t = setTimeout(() => setPlatform(detectPlatform()), 0);
    return () => clearTimeout(t);
  }, []);
  // Anywhere: every global chord the shell has registered right now.
  const anywhere = useMemo(() => groupShortcuts(list).flatMap((g) => g.items), [list]);

  return (
    <SettingsPage pageKey="account/shortcuts" subtitle={<>&#8984; is Ctrl on Windows and Linux.</>}>
      <SettingsCardStack>
        <SettingsCard title="Anywhere" id="shortcuts.anywhere" wide="shortcuts.list">
          <div>
            {anywhere.map((d) => (
              <SettingsRow key={d.id} label={d.label} readOnlyValue={<Chords keys={[d.keys]} platform={platform} />} />
            ))}
          </div>
        </SettingsCard>
        {SHORTCUT_REFERENCE.map((scope) => (
          <SettingsCard key={scope.key} title={scope.name} id={`shortcuts.${scope.key}`} wide="shortcuts.list">
            <div>
              {scope.rows.map((r) => (
                <SettingsRow key={r.id} label={r.label} helper={r.note} readOnlyValue={<Chords keys={r.keys} platform={platform} />} />
              ))}
            </div>
          </SettingsCard>
        ))}
        <p className="text-sm text-ink-2">
          Your browser&apos;s own print command prints this page. Press <kbd className={kbdCls}>?</kbd> anywhere to see the shortcuts for the page you are on.
        </p>
      </SettingsCardStack>
    </SettingsPage>
  );
}
