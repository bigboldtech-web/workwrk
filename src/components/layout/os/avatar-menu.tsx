"use client";

// AvatarMenu (spec-shell 2.12): you. A 280px MenuList on the bar's avatar:
// a header with the real presence dot, then Set status…, Mute notifications
// (a submenu of durations, or "Muted until … · Unmute"), My profile, My
// settings, Workspace settings (Owner and Admin), the Theme segmented control
// (and Chrome once CHROME_CONTROL_EXPOSED), Personal tools (each row runs the
// tool; its check pins or unpins it on the bar's strip), Keyboard shortcuts,
// Help (the Help rows inline) and Log out. No Trash (a Work sidebar row), no
// Preferences row (My settings › Preferences is one click inside the door,
// and the Customize panel links there too).
//
// A Guest never sees the Teams hub, so their My profile row points at
// /account/profile and the My settings row is absent (one destination, one
// row). Mute writes home.notifications.mutedUntil through the shell's
// preference patch, which reverts and toasts on failure.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Bell, BellOff, Building2, CircleHelp, CircleUser, Keyboard, LogOut, Pin, PinOff, Settings, SmilePlus, Wrench,
} from "lucide-react";
import { MenuItem, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CHROME_CONTROL_EXPOSED, SHELL_LABELS } from "@/lib/nav/labels";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { cn } from "@/lib/utils";
import { ChromePopover } from "./chrome-popover";
import { HelpMenuRows } from "./help-menu";
import { openShortcutsOverlay } from "./shell-shortcuts";
import { useOsShell } from "./shell-context";
import { useBoot, useViewerRole } from "./boot-context";
import { useOsToast } from "./toast";
import { usePersonalTools } from "./use-personal-tools";

type Appearance = "LIGHT" | "DARK" | "AUTO";
type Chrome = "navy" | "light";

function initialsOf(first?: string | null, last?: string | null, name?: string | null): string {
  const fl = `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
  if (fl) return fl;
  return (name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
}

function fmtUntil(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sameDay = d.getTime() < today.getTime() + 86_400_000 && d >= today;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + time;
}

export function Avatar({ size = 28, className }: { size?: number; className?: string }) {
  const { boot } = useBoot();
  const { presenceStatus } = useOsShell();
  const v = boot.viewer;
  const initials = initialsOf(v.firstName, v.lastName, v.name);
  const online = presenceStatus.label === "Online";
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {v.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.avatar} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-active text-micro font-medium normal-case tracking-normal text-ink-strong" style={{ fontSize: size >= 32 ? 13 : 11 }}>
          {initials}
        </span>
      )}
      <span
        className={cn("absolute -bottom-px -end-px h-2 w-2 rounded-full ring-2 ring-chrome", online ? "bg-chrome-presence" : "bg-warning-solid")}
        aria-hidden
      />
    </span>
  );
}

export function AvatarMenu({ onPrivacy }: { onPrivacy: () => void }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data: session } = useSession();
  const { boot } = useBoot();
  const { isGuest, isAdmin } = useViewerRole();
  const { openSettings } = useSettingsNav();
  const { toast } = useOsToast();
  const {
    presenceStatus, openStatusModal, mutedNotifications, mutedUntil, setMutedUntil, prefs, patchPrefs,
  } = useOsShell();
  const tools = usePersonalTools();

  const v = boot.viewer;
  const displayName = v.name || session?.user?.email || "My account";
  const statusLine = presenceStatus.label === "Online"
    ? (v.email ?? "Active")
    : `${presenceStatus.emoji ? presenceStatus.emoji + " " : ""}${presenceStatus.label}`;
  const close = () => setOpen(false);

  const locked = new Set(prefs.lockedKeys ?? []);
  const appearance: Appearance = prefs.theme.appearance ?? "LIGHT";
  const chrome: Chrome = prefs.theme.chrome ?? "navy";

  const write = async (patch: Parameters<typeof patchPrefs>[0]) => {
    const ok = await patchPrefs(patch);
    if (!ok) toast("Couldn't save. Try again", { action: { label: "Try again", onClick: () => { void write(patch); } } });
  };

  const mute = async (until: string | null) => {
    close();
    const ok = await setMutedUntil(until);
    if (!ok) toast("Couldn't save. Try again");
  };
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const untilTomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); };
  const forever = () => new Date(Date.now() + 100 * 365 * 86_400_000).toISOString();

  const profileHref = isGuest ? "/account/profile" : "/people/me";

  return (
    <ChromePopover
      open={open}
      onOpenChange={setOpen}
      width={280}
      layerId="avatar-menu"
      ariaLabel="Account menu"
      trigger={
        <button
          type="button"
          aria-label={`${displayName} · ${presenceStatus.label}`}
          title={`${displayName} · ${presenceStatus.label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-chrome-hov"
        >
          <Avatar size={28} />
        </button>
      }
    >
      <div className="flex h-14 items-center gap-3 px-4">
        <Avatar size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium text-ink">{displayName}</div>
          <div className="truncate text-sm text-ink-2">{statusLine}</div>
        </div>
      </div>
      <div className="py-1">
        <MenuItem icon={SmilePlus} label="Set status…" onClick={() => { close(); openStatusModal(); }} />
        {mutedNotifications && mutedUntil ? (
          <MenuItem icon={BellOff} label={`Muted until ${fmtUntil(mutedUntil)} · Unmute`} onClick={() => { void mute(null); }} />
        ) : (
          <MenuSubmenu icon={Bell} label="Mute notifications">
            <MenuItem label="1 hour" onClick={() => { void mute(inHours(1)); }} />
            <MenuItem label="Until tomorrow" onClick={() => { void mute(untilTomorrow()); }} />
            <MenuItem label="Until I turn it back on" onClick={() => { void mute(forever()); }} />
          </MenuSubmenu>
        )}
        <MenuSeparator />
        <MenuItem
          icon={CircleUser}
          label={SHELL_LABELS.myProfile}
          onClick={() => { close(); if (isGuest) openSettings(profileHref); else router.push(profileHref); }}
        />
        {!isGuest ? (
          <MenuItem icon={Settings} label={SHELL_LABELS.mySettings} onClick={() => { close(); openSettings("/account/profile"); }} />
        ) : null}
        {isAdmin ? (
          <MenuItem icon={Building2} label={SHELL_LABELS.workspaceSettings} onClick={() => { close(); openSettings("/settings"); }} />
        ) : null}
        <MenuSeparator />
        <div className="flex min-h-9 items-center justify-between gap-3 px-3 py-1">
          <span className="text-base text-ink">Theme</span>
          <SegmentedControl<Appearance>
            size="sm"
            label="Theme"
            value={appearance}
            locked={locked.has("theme.appearance")}
            options={[{ value: "LIGHT", label: "Light" }, { value: "DARK", label: "Dark" }, { value: "AUTO", label: "System" }]}
            onChange={(v) => { void write({ theme: { appearance: v } }); }}
          />
        </div>
        {CHROME_CONTROL_EXPOSED ? (
          <div className="flex min-h-9 items-center justify-between gap-3 px-3 py-1">
            <span className="text-base text-ink">Chrome</span>
            <SegmentedControl<Chrome>
              size="sm"
              label="Chrome"
              value={chrome}
              locked={locked.has("theme.chrome")}
              options={[{ value: "navy", label: "Navy" }, { value: "light", label: "Light" }]}
              onChange={(v) => { void write({ theme: { chrome: v } }); }}
            />
          </div>
        ) : null}
        <MenuSeparator />
        {/* Each row runs its tool; the pin at its end decides whether it
            also sits on the bar. Two controls, two things. */}
        <MenuSubmenu icon={Wrench} label="Personal tools" width={260}>
          {tools.tools.map((t) => {
            const on = tools.pins.includes(t.key);
            return (
              <MenuItem
                key={t.key}
                icon={t.Icon}
                label={t.label}
                onClick={() => { close(); void tools.run(t); }}
                trailing={
                  // A span with the button role, not a <button>: the row itself
                  // is a button and HTML forbids nesting them (it hydrates as
                  // an error). Enter and Space run it like a button would.
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); void tools.toggle(t.key); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void tools.toggle(t.key); }
                    }}
                    aria-label={on ? `Unpin ${t.label} from the bar` : `Pin ${t.label} to the bar`}
                    title={on ? "Unpin from the bar" : "Pin to the bar"}
                    aria-pressed={on}
                    className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-hover", on ? "text-ink" : "text-ink-3")}
                  >
                    {on ? <Pin className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} aria-hidden /> : <PinOff className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />}
                  </span>
                }
              />
            );
          })}
        </MenuSubmenu>
        <MenuItem icon={Keyboard} label="Keyboard shortcuts" shortcut="?" onClick={() => { close(); openShortcutsOverlay(); }} />
        <MenuSubmenu icon={CircleHelp} label={SHELL_LABELS.help} width={240}>
          <HelpMenuRows onDone={close} onPrivacy={onPrivacy} />
        </MenuSubmenu>
        <MenuSeparator />
        <MenuItem icon={LogOut} label={SHELL_LABELS.logOut} onClick={() => { close(); void signOut({ callbackUrl: "/login" }); }} />
      </div>
    </ChromePopover>
  );
}
