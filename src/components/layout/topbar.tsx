"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Bell, Search, Plus, Users, CheckSquare, BookOpen, Building2, MessageSquare } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const typeIcons: Record<string, React.ComponentType<any>> = {
  person: Users,
  task: CheckSquare,
  sop: BookOpen,
  department: Building2,
  meeting: MessageSquare,
};

export function Topbar() {
  const { data: session } = useSession();
  const user = session?.user;

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch notifications
  useEffect(() => {
    fetch("/api/notifications")
      .then((res) => res.json())
      .then((data) => {
        const notifs = data.notifications || (Array.isArray(data) ? data : []);
        setNotifications(notifs.slice(0, 10));
        setUnreadCount(data.unreadCount ?? notifs.filter((n: Notification) => !n.read).length);
      })
      .catch(() => {});
  }, []);

  // Search with debounce
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

  // Close search on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const input = document.getElementById("global-search") as HTMLInputElement;
        input?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-xl">
      {/* Search */}
      <div className="relative flex-1 max-w-md" ref={searchRef}>
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          id="global-search"
          type="text"
          placeholder="Search people, tasks, SOPs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchResults.length > 0 && setShowSearch(true)}
          className="h-9 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-sm text-foreground placeholder:text-muted focus:border-purple-500 focus:outline-none transition-colors"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted font-mono">
          ⌘K
        </kbd>

        {/* Search Results Dropdown */}
        {showSearch && (
          <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-border bg-surface shadow-xl overflow-hidden z-50">
            {searching ? (
              <div className="px-4 py-3 text-sm text-muted">Searching...</div>
            ) : searchResults.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted">No results found</div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {searchResults.map((result) => {
                  const Icon = typeIcons[result.type] || Search;
                  return (
                    <Link
                      key={`${result.type}-${result.id}`}
                      href={result.href}
                      onClick={() => {
                        setShowSearch(false);
                        setSearchQuery("");
                      }}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors"
                    >
                      <Icon size={16} className="text-muted flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{result.title}</p>
                        <p className="text-xs text-muted truncate">{result.subtitle}</p>
                      </div>
                      <span className="text-[10px] text-muted uppercase tracking-wider flex-shrink-0">
                        {result.type}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" className="gap-2">
          <Plus size={16} />
          Quick Add
        </Button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-foreground transition-colors">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">{unreadCount} new</Badge>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted">
                No notifications yet
              </div>
            ) : (
              notifications.slice(0, 5).map((notif) => (
                <DropdownMenuItem key={notif.id} className="flex flex-col items-start gap-1 py-2">
                  <div className="flex items-center gap-2 w-full">
                    {!notif.read && <span className="h-2 w-2 rounded-full bg-purple-500 flex-shrink-0" />}
                    <span className="text-sm font-medium truncate">{notif.title}</span>
                  </div>
                  <span className="text-xs text-muted line-clamp-1">{notif.message}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-surface-2 transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarImage src={(user as any)?.avatar || undefined} />
                <AvatarFallback>
                  {user ? getInitials((user as any).firstName, (user as any).lastName) : "U"}
                </AvatarFallback>
              </Avatar>
              <div className="hidden text-left md:block">
                <p className="text-sm font-medium text-foreground">
                  {user?.name || "User"}
                </p>
                <p className="text-xs text-muted">
                  {(user as any)?.organizationName || "Organization"}
                </p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-red-400 focus:text-red-400"
            >
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
