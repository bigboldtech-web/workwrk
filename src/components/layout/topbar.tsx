"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, BellRing, Search, Plus, Users, CheckSquare, BookOpen, Building2, MessageSquare, HelpCircle, CheckCheck } from "lucide-react";
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
import { LanguageSwitcher } from "./language-switcher";
import { CurrencySwitcher } from "./currency-switcher";
import { useDesktopNotifications } from "@/hooks/use-desktop-notifications";

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
        <Link href="/tasks" className="app-quick-add">
          <Plus size={14} />
          Quick add
        </Link>

        <LanguageSwitcher />
        <CurrencySwitcher />

        <HelpButton />

        {/* Notifications */}
        <DropdownMenu>
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
                  >
                    <div className="flex items-center gap-2 w-full">
                      {!notif.read && (
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ background: "var(--b-accent-text)" }}
                        />
                      )}
                      <span
                        className={`text-sm truncate ${!notif.read ? "font-semibold text-foreground" : "font-medium text-muted"}`}
                      >
                        {notif.title}
                      </span>
                      <span className="text-[10px] ml-auto flex-shrink-0 text-muted-2">
                        {timeAgo(notif.createdAt)}
                      </span>
                    </div>
                    <span className="text-xs line-clamp-1 text-muted">{notif.message}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="justify-center">
                  <Link
                    href="/activity"
                    className="text-xs text-center w-full text-[color:var(--accent-strong)]"
                  >
                    View all notifications →
                  </Link>
                </DropdownMenuItem>
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
          <DropdownMenuContent align="end" className="w-56">
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
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              style={{ color: "#ff3d8a" }}
            >
              {tNav("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
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
    icon = <BellRing size={14} className="text-[#d4ff2e]" />;
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
          className="text-[10px] px-2 py-1 rounded border border-border hover:border-[#d4ff2e] hover:text-[#d4ff2e] transition-colors"
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
