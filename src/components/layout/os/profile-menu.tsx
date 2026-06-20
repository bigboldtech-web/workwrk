"use client";

// ProfileMenu — the dropdown anchored to the top-right avatar.
// Mirrors ClickUp's profile menu:
//   ┌────────────────────────────────────────────────┐
//   │ [Avatar]  Ibrahim Surya                        │
//   │            Online                              │
//   ├────────────────────────────────────────────────┤
//   │ [☺] Set status                                 │
//   │ [🔕] Mute notifications                  toggle │
//   ├────────────────────────────────────────────────┤
//   │ ⚙ Settings                                     │
//   │ 🔔 Notifications                               │
//   │ 🎨 Themes                                      │
//   │ ⌘ Keyboard shortcuts                           │
//   │ ? Help                                         │
//   ├────────────────────────────────────────────────┤
//   │ Personal Tools                                 │
//   │   [✓] Create task                  📌          │
//   │   [✓] My Work                      📌          │
//   │   …                                            │
//   ├────────────────────────────────────────────────┤
//   │ 🗑 Trash                                        │
//   │ ⤴ Log out                                       │
//   └────────────────────────────────────────────────┘
//
// Pin toggles next to each Personal Tool are wired to
// useOsShell().toggleProfileToolPin, which drives the top bar's
// quick-icon strip in click-topbar.tsx.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  SmilePlus, BellOff, Bell, ChevronRight, Settings, Palette, Command,
  HelpCircle, Trash2, LogOut, Pin, PinOff,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { PROFILE_TOOLS } from "./profile-tools";

type Props = {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
};

export function ProfileMenu({ open, onClose, anchorRef }: Props) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const {
    presenceStatus, openStatusModal,
    mutedNotifications, setMutedNotifications,
    profileToolPins, toggleProfileToolPin,
  } = useOsShell();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open) return null;

  const goto = (href: string) => {
    router.push(href);
    onClose();
  };

  const handleSetStatus = () => {
    openStatusModal();
    onClose();
  };

  const handleLogout = async () => {
    onClose();
    // Use NextAuth's signOut so the CSRF token is included and the session
    // cookie (including the cross-subdomain .workwrk.com scope) is actually
    // cleared. A bare POST to /api/auth/signout is rejected by CSRF and never
    // logs the user out — which made logout silently bounce back into the app.
    await signOut({ callbackUrl: "/login" });
  };

  const statusLabel = presenceStatus.label === "Online"
    ? "Online"
    : presenceStatus.label;

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label="Account menu"
      className="absolute right-0 bottom-full mb-1.5 z-[70] w-[280px] bg-zinc-900 text-white rounded-xl shadow-2xl border border-zinc-800 overflow-hidden text-[13px]"
    >
      {/* User header */}
      <div className="px-3 py-3 flex items-center gap-2.5">
        <div className="relative">
          <span
            className="w-9 h-9 rounded-full text-white flex items-center justify-center text-[12px] font-semibold"
            style={{ background: "var(--os-brand)" }}
          >
            IS
          </span>
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-zinc-900" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white truncate">Ibrahim Surya</div>
          <div className="text-zinc-400 text-[11.5px] truncate flex items-center gap-1">
            {presenceStatus.emoji ? <span>{presenceStatus.emoji}</span> : null}
            <span>{statusLabel}</span>
          </div>
        </div>
      </div>

      {/* Set status / Mute */}
      <div className="px-1.5 pb-1.5">
        <button
          type="button"
          onClick={handleSetStatus}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800 text-left"
          role="menuitem"
        >
          <span className="w-7 h-7 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <SmilePlus className="w-3.5 h-3.5 text-zinc-300" />
          </span>
          <span className="text-zinc-300 flex-1">Set status</span>
        </button>
        <button
          type="button"
          onClick={() => setMutedNotifications(!mutedNotifications)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800 text-left"
          role="menuitemcheckbox"
          aria-checked={mutedNotifications}
        >
          {mutedNotifications ? (
            <BellOff className="w-4 h-4 text-zinc-400" />
          ) : (
            <Bell className="w-4 h-4 text-zinc-400" />
          )}
          <span className="text-zinc-300 flex-1">
            {mutedNotifications ? "Notifications muted" : "Mute notifications"}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
        </button>
      </div>

      <Divider />

      <div className="px-1.5 py-1.5">
        <MenuRow icon={Settings}     label="Settings"           onClick={() => goto("/settings")} />
        <MenuRow icon={Bell}         label="Notifications"      onClick={() => goto("/inbox")} />
        <MenuRow icon={Palette}      label="Themes"             onClick={() => goto("/settings?tab=themes")} />
        <MenuRow icon={Command}      label="Keyboard shortcuts" onClick={() => goto("/settings?tab=shortcuts")} />
        <MenuRow icon={HelpCircle}   label="Help"               onClick={() => window.open("https://workwrk.com/help", "_blank")} />
      </div>

      <Divider />

      <div className="px-1.5 pt-2 pb-1.5">
        <div className="px-2 text-[10.5px] uppercase tracking-wide text-zinc-500 mb-1">Personal Tools</div>
        <div className="max-h-[260px] overflow-y-auto">
          {PROFILE_TOOLS.map((tool) => {
            const pinned = profileToolPins.includes(tool.key);
            return (
              <div
                key={tool.key}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-zinc-800 group"
              >
                <button
                  type="button"
                  onClick={() => tool.href && goto(tool.href)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  role="menuitem"
                >
                  <tool.Icon className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                  <span className="text-zinc-300 truncate">{tool.label}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleProfileToolPin(tool.key); }}
                  className={`p-1 rounded-md transition-opacity ${
                    pinned
                      ? "text-amber-400 opacity-100"
                      : "text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-300"
                  }`}
                  aria-label={pinned ? `Unpin ${tool.label}` : `Pin ${tool.label}`}
                  title={pinned ? `Unpin from top bar` : `Pin to top bar`}
                >
                  {pinned ? <Pin className="w-3 h-3 fill-current" /> : <PinOff className="w-3 h-3" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <Divider />

      <div className="px-1.5 py-1.5">
        <MenuRow icon={Trash2} label="Trash"   onClick={() => goto("/trash")} />
        <MenuRow icon={LogOut} label="Log out" onClick={handleLogout} />
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-zinc-800" />;
}

function MenuRow({
  icon: Icon, label, onClick,
}: {
  icon: typeof Settings;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800 text-left"
      role="menuitem"
    >
      <Icon className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
      <span className="text-zinc-300 flex-1">{label}</span>
    </button>
  );
}

