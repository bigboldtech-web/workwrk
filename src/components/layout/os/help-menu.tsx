"use client";

// HelpMenu (spec-shell 2.13): where to get help. A 240px MenuList on the
// bar's "?": Help center (external), Keyboard shortcuts ("?"), What's new
// (external changelog), Privacy & cookies (the consent preferences, mounted
// lazily so no banner ever renders in the app on its own), then Contact
// support. "Take the tour" renders only once the onboarding unit registers
// rewritten steps; the stale tour never auto-launches from the shell.

import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, CircleHelp, Keyboard, Mail, Shield, Sparkles } from "lucide-react";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { CHANGELOG_URL, HELP_CENTER_URL, SHELL_LABELS, SUPPORT_EMAIL } from "@/lib/nav/labels";
import { ConsentProvider, useConsent } from "@/components/layout/consent-provider";
import { ConsentBanner } from "@/components/layout/consent-banner";
import { ChromeIconButton, ChromePopover } from "./chrome-popover";
import { openShortcutsOverlay } from "./shell-shortcuts";
import { useOsToast } from "./toast";

/** The rows alone, so the avatar menu can inline them as a submenu. */
export function HelpMenuRows({ onDone, onPrivacy }: { onDone: () => void; onPrivacy: () => void }) {
  const { toast } = useOsToast();
  const openExternal = (url: string) => {
    onDone();
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) {
      toast("Couldn't open Help. Copy the link", {
        action: { label: "Copy link", onClick: () => { void navigator.clipboard?.writeText(url); } },
      });
    }
  };
  return (
    <>
      <MenuItem icon={BookOpen} label="Help center" onClick={() => openExternal(HELP_CENTER_URL)} />
      <MenuItem icon={Keyboard} label="Keyboard shortcuts" shortcut="?" onClick={() => { onDone(); openShortcutsOverlay(); }} />
      <MenuItem icon={Sparkles} label="What's new" onClick={() => openExternal(CHANGELOG_URL)} />
      <MenuItem icon={Shield} label="Privacy & cookies" onClick={() => { onDone(); onPrivacy(); }} />
      <MenuSeparator />
      <MenuItem icon={Mail} label="Contact support" href={`mailto:${SUPPORT_EMAIL}`} onClick={onDone} />
    </>
  );
}

/**
 * Opens the consent preferences once the provider has resolved the stored
 * choice, so the reopen is not undone by that first resolution.
 */
function ReopenConsentOnResolve() {
  const { geo, reopen } = useConsent();
  useEffect(() => {
    if (geo) reopen();
  }, [geo, reopen]);
  return null;
}

/**
 * Mount once in the frame: owns the lazily mounted consent preferences. The
 * ConsentProvider lives here and nowhere else in the app (spec-shell 1.13),
 * so /api/consent is fetched only when a person opens Privacy & cookies;
 * every open remounts it (the key) so the dialog reopens each time.
 */
export function usePrivacyDialog() {
  const [openCount, setOpenCount] = useState(0);
  const open = () => setOpenCount((n) => n + 1);
  const node: ReactNode = openCount > 0 ? (
    <ConsentProvider key={openCount}>
      <ReopenConsentOnResolve />
      <ConsentBanner />
    </ConsentProvider>
  ) : null;
  return { open, node };
}

export function HelpMenu({ onPrivacy }: { onPrivacy: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <ChromePopover
      open={open}
      onOpenChange={setOpen}
      width={240}
      layerId="help-menu"
      ariaLabel={SHELL_LABELS.help}
      trigger={
        <ChromeIconButton label={SHELL_LABELS.help} aria-haspopup="menu" aria-expanded={open} active={open}>
          <CircleHelp className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </ChromeIconButton>
      }
    >
      <div className="py-1">
        <HelpMenuRows onDone={() => setOpen(false)} onPrivacy={onPrivacy} />
      </div>
    </ChromePopover>
  );
}
