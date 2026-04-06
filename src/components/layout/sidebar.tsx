"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useRole } from "@/hooks/use-role";
import {
  LayoutDashboard,
  Users,
  Building2,
  Target,
  CalendarDays,
  BookOpen,
  Star,
  Lightbulb,
  Megaphone,
  Shield,
  Crosshair,
  Grid3x3,
  ClipboardCheck,
  MessageSquare,
  BarChart3,
  Bot,
  GraduationCap,
  Settings,
  Wrench,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Link2,
  Activity,
  FileText,
  ListChecks,
  Package,
} from "lucide-react";

// moduleKey maps nav items to module keys from settings.enabledModules
// Items without a moduleKey are always shown (Dashboard, Organization)
const navigation: { name: string; href: string; icon: any; moduleKey?: string; managerOnly?: boolean; adminOnly?: boolean }[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Announcements", href: "/announcements", icon: Megaphone },
  { name: "People", href: "/people", icon: Users, moduleKey: "people", managerOnly: true },
  { name: "Organization", href: "/organization", icon: Building2 },
  { name: "KRA & KPIs", href: "/kra-kpi", icon: Target, moduleKey: "kra-kpi" },
  { name: "Work Calendar", href: "/tasks", icon: CalendarDays, moduleKey: "tasks" },
  { name: "SOPs", href: "/sops", icon: BookOpen, moduleKey: "sops" },
  { name: "Process Runs", href: "/process-runs", icon: ListChecks, moduleKey: "sops", managerOnly: true },
  { name: "Reviews", href: "/reviews", icon: Star, moduleKey: "reviews" },
  { name: "Meetings", href: "/meetings", icon: MessageSquare, moduleKey: "meetings" },
  { name: "Analytics", href: "/analytics", icon: BarChart3, moduleKey: "analytics", managerOnly: true },
  { name: "Onboarding", href: "/onboarding", icon: GraduationCap, moduleKey: "checkins", managerOnly: true },
  { name: "Ideas", href: "/ideas", icon: Lightbulb },
  { name: "OKRs", href: "/okrs", icon: Crosshair },
  { name: "Talent Grid", href: "/talent", icon: Grid3x3, managerOnly: true },
  { name: "Surveys", href: "/surveys", icon: ClipboardCheck },
  { name: "Policies", href: "/policies", icon: Shield },
  { name: "Assets", href: "/assets", icon: Package, managerOnly: true },
  { name: "Activity", href: "/activity", icon: Activity },
  { name: "Tools", href: "/tools", icon: Wrench },
  { name: "Integrations", href: "/integrations", icon: Link2, adminOnly: true },
  { name: "AI Assistant", href: "/ai", icon: Bot, moduleKey: "ai" },
];

const bottomNav = [
  { name: "Docs", href: "/docs", icon: FileText },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Sync sidebar width to CSS variable so the content area can adjust
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", collapsed ? "56px" : "220px");
  }, [collapsed]);
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);
  const [announcementCount, setAnnouncementCount] = useState(0);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data?.settings?.enabledModules) {
          setEnabledModules(data.settings.enabledModules);
        }
      })
      .catch(() => {});

    // Fetch unread announcement count
    fetch("/api/announcements")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { const items = d?.data || []; setAnnouncementCount(Array.isArray(items) ? items.length : 0); })
      .catch(() => {});
  }, []);

  const { isManager: isManagerRole, isAdmin: isAdminRole } = useRole();

  const visibleNav = navigation.filter((item) => {
    if (item.adminOnly && !isAdminRole) return false;
    if (item.managerOnly && !isManagerRole) return false;
    if (item.moduleKey && enabledModules && !enabledModules.includes(item.moduleKey)) return false;
    return true;
  });

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen border-r border-border bg-background transition-all duration-300",
        collapsed ? "w-[56px]" : "w-[220px]"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-12 items-center justify-between border-b border-border px-3">
          {!collapsed && (
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="bg-gradient-to-r from-purple-500 via-purple-300 to-green-400 bg-clip-text text-base font-bold tracking-tight text-transparent"
                style={{ fontFamily: "'Syne', sans-serif" }}>
                workwrk
              </span>
              <span className="text-muted opacity-50">.</span>
            </Link>
          )}
          {collapsed && (
            <Link href="/dashboard" className="mx-auto">
              <span className="bg-gradient-to-r from-purple-500 to-green-400 bg-clip-text text-base font-bold text-transparent"
                style={{ fontFamily: "'Syne', sans-serif" }}>
                W
              </span>
            </Link>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {visibleNav.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                  isActive
                    ? "bg-purple-600/10 text-purple-400 border border-purple-600/20"
                    : "text-muted hover:bg-surface-2 hover:text-foreground",
                  collapsed && "justify-center px-2"
                )}
                title={collapsed ? item.name : undefined}
              >
                <item.icon size={16} className={cn(isActive && "text-purple-400")} />
                {!collapsed && (
                  <span className="flex-1 flex items-center justify-between">
                    <span>{item.name}</span>
                    {item.name === "Announcements" && announcementCount > 0 && (
                      <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
                        {announcementCount}
                      </span>
                    )}
                  </span>
                )}
                {collapsed && item.name === "Announcements" && announcementCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Navigation */}
        <div className="border-t border-border px-3 py-4 space-y-1">
          {bottomNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                  isActive
                    ? "bg-purple-600/10 text-purple-400"
                    : "text-muted hover:bg-surface-2 hover:text-foreground",
                  collapsed && "justify-center px-2"
                )}
              >
                <item.icon size={16} />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            );
          })}
          <ThemeToggle collapsed={collapsed} />
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-red-500/10 hover:text-red-400 transition-all",
              collapsed && "justify-center px-2"
            )}
          >
            <LogOut size={16} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
