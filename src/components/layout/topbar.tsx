"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, BellRing, Search, Plus, Users, CheckSquare, BookOpen, Building2, MessageSquare, HelpCircle, CheckCheck, X, Keyboard, Clock as ClockIcon, Grid3x3, Heart, Inbox as InboxIcon } from "lucide-react";
import { useTour } from "@/components/tour-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession, signOut } from "next-auth/react";
import { getInitials } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { OrgSwitcher } from "./org-switcher";
import { ActivePunchPill } from "./active-punch-pill";
import { useDesktopNotifications } from "@/hooks/use-desktop-notifications";
import { ShortcutsOverlay, useShortcutsOverlay } from "./shortcuts-overlay";
import { applyDensity, readDensity, type Density } from "@/lib/density";
import { Kbd } from "@/components/ui/kbd";
import { useGoToNav } from "@/hooks/use-goto-nav";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor, Sparkle } from "lucide-react";
import { AppsPanel } from "./apps-panel";

interface SearchResult {
  type: "person" | "task" | "sop" | "department" | "meeting";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  createdAt: string;
}

const typeIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  person: Users,
  task: CheckSquare,
  sop: BookOpen,
  department: Building2,
  meeting: MessageSquare,
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export function Topbar() {
  const { data: session } = useSession();
  type ExtendedUser = {
    name?: string | null;
    firstName?: string;
    lastName?: string;
    avatar?: string;
    organizationName?: string;
  };
  const user = session?.user as ExtendedUser | undefined;
  const firstName = user?.firstName;
  const lastName = user?.lastName;
  const avatar = user?.avatar;
  const organizationName = user?.organizationName;

  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const tSettings = useTranslations("settings");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shortcuts = useShortcutsOverlay();
  useGoToNav();
  // Theme — light / dark / system. We let next-themes manage persistence;
  // the user menu pill row reflects whichever value is currently set.
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => { setThemeMounted(true); }, []);
  const [appsOpen, setAppsOpen] = useState(false);
  // Density (compact / cozy) — read on mount and after density-change
  // events so the user-menu radio reflects the current setting whether
  // it was set by us or by another tab.
  const [density, setDensity] = useState<Density>("compact");
  useEffect(() => {
    setDensity(readDensity());
    const sync = () => setDensity(readDensity());
    window.addEventListener("workwrk:density-change", sync);
    return () => window.removeEventListener("workwrk:density-change", sync);
  }, []);
  const handleDensityChange = useCallback((d: Density) => {
    applyDensity(d);
    setDensity(d);
  }, []);

  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Desktop alerts — permission state + notify(). See use-desktop-notifications.
  const desktop = useDesktopNotifications();
  // Track the most recent notification id we've already seen so we only
  // ping for genuinely new ones across polling cycles. Ref, not state —
  // updating it shouldn't trigger re-renders, and the first poll seeds
  // it silently so we don't ding on page load.
  const lastSeenIdRef = useRef<string | null>(null);
  const firstPollRef = useRef(true);

  // Shared fetch-and-diff. Runs once on mount + every 45s + on tab focus.
  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      const notifs: Notification[] = data.notifications || (Array.isArray(data) ? data : []);
      setNotifications(notifs.slice(0, 10));
      setUnreadCount(data.unreadCount ?? notifs.filter((n: Notification) => !n.read).length);

      if (notifs.length === 0) return;
      const latestId = notifs[0].id;

      if (firstPollRef.current) {
        // Seed on first load so a refresh doesn't re-alert on stale unread items.
        lastSeenIdRef.current = latestId;
        firstPollRef.current = false;
        return;
      }

      // Fire desktop alert for every notification that's newer than the
      // last one we saw. Stops at the first known id so we don't replay
      // the whole history after a long idle.
      if (latestId !== lastSeenIdRef.current) {
        const fresh: Notification[] = [];
        for (const n of notifs) {
          if (n.id === lastSeenIdRef.current) break;
          if (!n.read) fresh.push(n);
        }
        fresh.reverse(); // oldest-first so tags don't collapse the newest one
        for (const n of fresh) {
          desktop.notify({
            title: n.title,
            body: n.message,
            tag: `notif-${n.id}`,
            url: n.link || undefined,
          });
        }
        lastSeenIdRef.current = latestId;
      }
    } catch { /* offline / transient — retry next tick */ }
  }, [desktop]);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 45_000);
    const onFocus = () => loadNotifications();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadNotifications]);

  const handleNotificationClick = useCallback(
    (notif: Notification) => {
      if (!notif.read) {
        fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: notif.id }),
        }).catch(() => {});
        setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)));
        setUnreadCount((c) => Math.max(0, c - 1));
      }
      if (notif.link) router.push(notif.link);
    },
    [router],
  );

  const handleMarkAllRead = useCallback(() => {
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  // Which row's snooze picker is currently expanded. Only one open at a
  // time — clicking the clock on another row replaces it.
  const [snoozePickerOpenFor, setSnoozePickerOpenFor] = useState<string | null>(null);

  // Snooze a notification. Optimistically remove from the local panel so
  // the badge updates immediately; the PATCH writes `snoozedUntil` and
  // the GET will hide it on next poll.
  const handleSnoozeNotification = useCallback((id: string, untilISO: string) => {
    setSnoozePickerOpenFor(null);
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target && !target.read) {
        setUnreadCount((u) => Math.max(0, u - 1));
      }
      return prev.filter((n) => n.id !== id);
    });
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, snoozeUntil: untilISO }),
    }).catch(() => {});
  }, []);

  // Quick-snooze presets. "Tomorrow morning" lands at 9am local on the
  // next calendar day so the user wakes up to it; everything else is a
  // simple offset from now.
  const snoozePresets = (): { label: string; until: () => string }[] => {
    const tomorrow9 = () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    };
    const offset = (hours: number) => () =>
      new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    return [
      { label: "1 hour", until: offset(1) },
      { label: "4 hours", until: offset(4) },
      { label: "Tomorrow 9am", until: tomorrow9 },
      { label: "1 day", until: offset(24) },
      { label: "1 week", until: offset(24 * 7) },
    ];
  };

  // Delete a single notification optimistically. Used by the small X
  // button on each row — lets users sweep already-seen items one by
  // one without leaving the dropdown.
  const handleDismissNotification = useCallback((id: string) => {
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target && !target.read) {
        setUnreadCount((u) => Math.max(0, u - 1));
      }
      return prev.filter((n) => n.id !== id);
    });
    fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (searchQuery.length < 2) {
      setSearchResults([]);
      setShowSearch(false);
      return;
    }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
        setShowSearch(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [searchQuery]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const input = document.getElementById("global-search") as HTMLInputElement | null;
        input?.focus();
        return;
      }
      // "/" focuses search, but only when the user isn't already typing.
      if (e.key === "/") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        e.preventDefault();
        const input = document.getElementById("global-search") as HTMLInputElement | null;
        input?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const displayName = user?.name || "User";
  const initials =
    firstName || lastName
      ? getInitials(firstName ?? "", lastName ?? "")
      : displayName.charAt(0).toUpperCase();

  return (
    <header className="app-topbar">
      {/* Search */}
      <div className="app-search-wrap" ref={searchRef}>
        <Search className="app-search-icon" size={14} />
        <input
          id="global-search"
          type="text"
          placeholder={tCommon("search") + "..."}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchResults.length > 0 && setShowSearch(true)}
          className="app-search-input"
        />
        <kbd className="app-search-kbd">⌘K</kbd>

        {showSearch && (
          <div className="app-search-dropdown">
            {searching ? (
              <div className="app-search-empty">Searching…</div>
            ) : searchResults.length === 0 ? (
              <div className="app-search-empty">No results</div>
            ) : (
              <div style={{ maxHeight: 340, overflowY: "auto" }}>
                {searchResults.map((r) => {
                  const Icon = typeIcons[r.type] || Search;
                  return (
                    <Link
                      key={`${r.type}-${r.id}`}
                      href={r.href}
                      onClick={() => {
                        setShowSearch(false);
                        setSearchQuery("");
                      }}
                      className="app-search-result"
                    >
                      <Icon size={14} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="app-search-result-title">{r.title}</div>
                        <div className="app-search-result-sub">{r.subtitle}</div>
                      </div>
                      <span className="app-search-result-type">{r.type}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right */}
      <div className="app-topbar-right">
        <ActivePunchPill />

        <Link href="/tasks" className="app-quick-add">
          <Plus size={14} />
          Quick add
        </Link>

        <OrgSwitcher />

        {/* Inbox — monday-style direct entry point next to the bell.
            /inbox is the universal home for assigned items + mentions. */}
        <InboxButton />

        {/* Kudos — moved from FAB to topbar so anyone can drop a
            recognition without scrolling to find the heart. */}
        <Link href="/kudos" className="app-icon-btn" aria-label="Give kudos" title="Give kudos">
          <Heart size={16} />
        </Link>

        <HelpButton />

        {/* Apps Grid → Work OS panel. monday.com puts this in the same
            slot; clicking opens the catalog of installable products,
            grouped by team (Sales / HR / Dev / etc.). */}
        <button
          type="button"
          onClick={() => setAppsOpen(true)}
          className="app-icon-btn"
          aria-label="Work OS products"
          title="Work OS products"
        >
          <Grid3x3 size={16} />
        </button>
        {appsOpen && <AppsPanel onClose={() => setAppsOpen(false)} />}

        {/* Notifications */}
        <DropdownMenu onOpenChange={(open) => { if (!open) setSnoozePickerOpenFor(null); }}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="app-icon-btn" aria-label="Notifications">
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="app-icon-btn-badge">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-[10px] flex items-center gap-1 text-[color:var(--accent-strong)]"
                  title="Mark all as read"
                >
                  <CheckCheck size={12} />
                  Mark all read
                </button>
              )}
            </DropdownMenuLabel>
            <DesktopAlertsRow desktop={desktop} />
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm" style={{ color: "#a0a0a0" }}>
                No notifications yet
              </div>
            ) : (
              <>
                {notifications.slice(0, 5).map((notif) => (
                  <DropdownMenuItem
                    key={notif.id}
                    className={`flex flex-col items-start gap-1 py-2 cursor-pointer ${!notif.read ? "bg-[rgba(212,255,46,0.06)]" : ""}`}
                    onClick={() => handleNotificationClick(notif)}
                    // Don't auto-close the dropdown when the user
                    // clicks the X (the click target is a child
                    // button which calls e.stopPropagation, but the
                    // DropdownMenuItem's default onSelect would still
                    // close — keep it open for fast multi-dismiss).
                    onSelect={(e) => {
                      const target = e.target as HTMLElement | null;
                      if (target?.closest?.("[data-dismiss-notif]")) e.preventDefault();
                    }}
                  >
                    <div className="flex items-center gap-2 w-full">
                      {!notif.read && (
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ background: "var(--b-accent-text)" }}
                        />
                      )}
                      <span
                        className={`text-sm truncate flex-1 ${!notif.read ? "font-semibold text-foreground" : "font-medium text-muted"}`}
                      >
                        {notif.title}
                      </span>
                      <span className="text-[10px] flex-shrink-0 text-muted-2">
                        {timeAgo(notif.createdAt)}
                      </span>
                      <button
                        type="button"
                        data-dismiss-notif
                        className={`flex-shrink-0 rounded p-0.5 transition-colors ${snoozePickerOpenFor === notif.id ? "text-foreground bg-surface-2" : "text-muted-2 hover:text-foreground hover:bg-surface-2"}`}
                        aria-label="Snooze for…"
                        aria-expanded={snoozePickerOpenFor === notif.id}
                        title="Snooze for…"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSnoozePickerOpenFor((cur) => (cur === notif.id ? null : notif.id));
                        }}
                      >
                        <ClockIcon size={11} />
                      </button>
                      <button
                        type="button"
                        data-dismiss-notif
                        className="ml-0.5 flex-shrink-0 rounded p-0.5 text-muted-2 hover:text-foreground hover:bg-surface-2 transition-colors"
                        aria-label="Dismiss notification"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDismissNotification(notif.id);
                        }}
                      >
                        <X size={11} />
                      </button>
                    </div>
                    <span className="text-xs line-clamp-1 text-muted">{notif.message}</span>
                    {snoozePickerOpenFor === notif.id && (
                      <div
                        data-dismiss-notif
                        className="flex flex-wrap items-center gap-1 mt-1 pt-1 border-t border-border w-full"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[10px] text-muted-2 mr-1">Snooze for:</span>
                        {snoozePresets().map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            data-dismiss-notif
                            className="text-[10px] rounded-md px-1.5 py-0.5 border border-border text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSnoozeNotification(notif.id, preset.until());
                            }}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="app-user-btn" aria-label="User menu">
              <span className="app-user-avatar" aria-hidden>
                {avatar ? (
                  // Avatars come from arbitrary upload URLs (S3-presigned and
                  // potentially other domains). next/image requires every
                  // host to be allow-listed in next.config; until that's
                  // configured we use a plain <img>. Same pattern as the
                  // sidebar brand logo.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                  initials
                )}
              </span>
              <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }} className="hidden md:flex">
                <span className="app-user-name">{displayName}</span>
                <span className="app-user-org">{organizationName || "Workspace"}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>My account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">{tSettings("profile")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/security">Security &amp; 2FA</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings">{tNav("settings")}</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {themeMounted && (
              <ThemeRow value={(theme as "light" | "dark" | "night" | "system" | undefined) ?? "system"} onChange={setTheme} />
            )}
            <DensityRow value={density} onChange={handleDensityChange} />
            <DropdownMenuItem
              onSelect={(e) => {
                // Don't auto-close — we want the overlay to take over,
                // and re-opening the menu after closing the overlay
                // would be one extra click.
                e.preventDefault();
                shortcuts.setOpen(true);
              }}
              className="flex items-center justify-between gap-2 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Keyboard size={13} className="text-muted" />
                <span className="text-sm">Keyboard shortcuts</span>
              </span>
              <Kbd keys="?" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              style={{ color: "#ff3d8a" }}
            >
              {tNav("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ShortcutsOverlay open={shortcuts.open} onClose={shortcuts.close} />
    </header>
  );
}

// Inline density selector that lives inside the user-menu dropdown.
// Two pill buttons; the active one gets the violet accent. Persists to
// localStorage and applies via [data-density] on <html> immediately.
function DensityRow({
  value,
  onChange,
}: {
  value: Density;
  onChange: (d: Density) => void;
}) {
  return (
    <div className="px-2 py-1.5 text-xs">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-2 mb-1.5 px-1">
        Display density
      </p>
      <div className="flex gap-1.5">
        {([
          { id: "compact", label: "Compact" },
          { id: "cozy", label: "Cozy" },
        ] as { id: Density; label: string }[]).map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={
                "flex-1 px-2 py-1 rounded-md text-[11.5px] font-medium border transition-colors " +
                (active
                  ? "bg-[color:var(--accent-soft)] border-[color:var(--accent-strong)] text-[color:var(--accent-strong)]"
                  : "bg-transparent border-border text-muted hover:bg-surface-2 hover:text-foreground")
              }
              aria-pressed={active}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Inline theme selector — three icon-tabbed buttons (light / dark /
// system). Persists via next-themes; reading `theme` (not resolvedTheme)
// keeps the "system" choice sticky across sessions.
function ThemeRow({
  value,
  onChange,
}: {
  value: "light" | "dark" | "night" | "system";
  onChange: (t: string) => void;
}) {
  const opts: { id: "light" | "dark" | "night" | "system"; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "light", label: "Light", Icon: Sun },
    { id: "dark", label: "Dark", Icon: Moon },
    { id: "night", label: "Night", Icon: Sparkle },
    { id: "system", label: "System", Icon: Monitor },
  ];
  return (
    <div className="px-2 py-1.5 text-xs">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-2 mb-1.5 px-1">
        Theme
      </p>
      <div className="flex gap-1">
        {opts.map((o) => {
          const active = value === o.id;
          const Icon = o.Icon;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={
                "flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors " +
                (active
                  ? "bg-[color:var(--accent-soft)] border-[color:var(--accent-strong)] text-[color:var(--accent-strong)]"
                  : "bg-transparent border-border text-muted hover:bg-surface-2 hover:text-foreground")
              }
              aria-pressed={active}
              title={o.label}
            >
              <Icon size={12} />
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Small row inside the bell dropdown so users can enable / disable the
// browser-level ding. Shown above the separator so it's always visible
// even when the notifications list is empty.
function DesktopAlertsRow({
  desktop,
}: {
  desktop: ReturnType<typeof useDesktopNotifications>;
}) {
  const { permission, pref, enabled, requestPermission, disable, enable } = desktop;

  // Don't render if the browser has no Notification API at all (e.g.
  // some embedded webviews) — it would just confuse the user.
  if (permission === "unsupported") return null;

  let label = "Enable desktop alerts";
  let subtitle = "Get a ping when something new arrives";
  let icon = <Bell size={14} className="text-muted" />;
  let action: () => void = () => { requestPermission(); };
  let actionLabel = "Enable";
  let muted = false;

  if (permission === "denied") {
    label = "Desktop alerts blocked";
    subtitle = "Enable in your browser's site settings";
    icon = <BellOff size={14} className="text-muted" />;
    actionLabel = "";
    muted = true;
  } else if (enabled) {
    label = "Desktop alerts on";
    subtitle = "Ping + popup for new notifications";
    icon = <BellRing size={14} className="text-[color:var(--accent-strong)]" />;
    actionLabel = "Turn off";
    action = disable;
  } else if (permission === "granted" && pref === "off") {
    label = "Desktop alerts paused";
    subtitle = "Turn back on to hear new notifications";
    icon = <BellOff size={14} className="text-muted" />;
    actionLabel = "Turn on";
    action = enable;
  }

  return (
    <div className={`px-3 py-2 text-xs flex items-center gap-2 ${muted ? "opacity-70" : ""}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{label}</p>
        <p className="text-[10px] text-muted truncate">{subtitle}</p>
      </div>
      {actionLabel && (
        <button
          type="button"
          onClick={action}
          className="text-[10px] px-2 py-1 rounded border border-border hover:border-violet-500 hover:text-[color:var(--accent-strong)] transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function HelpButton() {
  const { startTour, isAdmin } = useTour();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="app-icon-btn" aria-label="Help & tours" title="Help & Tours">
          <HelpCircle size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Help &amp; tours</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin && (
          <DropdownMenuItem onClick={() => startTour("admin")} className="cursor-pointer">
            <span className="text-sm">Replay admin setup tour</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => startTour("employee")} className="cursor-pointer">
          <span className="text-sm">Replay new-member tour</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <Link href="/docs">
          <DropdownMenuItem className="cursor-pointer">
            <span className="text-sm">Documentation</span>
          </DropdownMenuItem>
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// InboxButton — icon + live unread count badge. Polls /api/inbox/count
// on mount + on a 60s timer so the badge stays roughly fresh without
// a websocket.
function InboxButton() {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/inbox/count")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data) return;
          setTotal(typeof data.total === "number" ? data.total : 0);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <Link href="/inbox" className="app-icon-btn relative" aria-label="Inbox" title="Inbox">
      <InboxIcon size={16} />
      {total > 0 && (
        <span className="app-icon-btn-badge">{total > 9 ? "9+" : total}</span>
      )}
    </Link>
  );
}
