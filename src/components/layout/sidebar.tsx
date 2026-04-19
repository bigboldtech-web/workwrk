"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/use-role";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Menu, Sun, Moon } from "lucide-react";
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
  MessageSquareHeart,
} from "lucide-react";

type NavItem = {
  name: string;
  key: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  moduleKey?: string;
  managerOnly?: boolean;
  adminOnly?: boolean;
};

const navigation: NavItem[] = [
  { name: "Dashboard", key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Announcements", key: "announcements", href: "/announcements", icon: Megaphone },
  { name: "People", key: "people", href: "/people", icon: Users, moduleKey: "people", managerOnly: true },
  { name: "Organization", key: "organization", href: "/organization", icon: Building2 },
  { name: "KRA & KPIs", key: "kraKpi", href: "/kra-kpi", icon: Target, moduleKey: "kra-kpi" },
  { name: "Work Calendar", key: "calendar", href: "/tasks", icon: CalendarDays, moduleKey: "tasks" },
  { name: "SOPs", key: "sops", href: "/sops", icon: BookOpen, moduleKey: "sops" },
  { name: "Process Runs", key: "processRuns", href: "/process-runs", icon: ListChecks, moduleKey: "sops", managerOnly: true },
  { name: "Reviews", key: "reviews", href: "/reviews", icon: Star, moduleKey: "reviews" },
  { name: "Meetings", key: "meetings", href: "/meetings", icon: MessageSquare, moduleKey: "meetings" },
  { name: "Analytics", key: "analytics", href: "/analytics", icon: BarChart3, moduleKey: "analytics", managerOnly: true },
  { name: "Onboarding", key: "onboarding", href: "/onboarding", icon: GraduationCap, moduleKey: "checkins", managerOnly: true },
  { name: "Ideas", key: "ideas", href: "/ideas", icon: Lightbulb },
  { name: "OKRs", key: "okrs", href: "/okrs", icon: Crosshair },
  { name: "Talent Grid", key: "talentGrid", href: "/talent", icon: Grid3x3, managerOnly: true },
  { name: "Surveys", key: "surveys", href: "/surveys", icon: ClipboardCheck },
  { name: "Candor", key: "candor", href: "/candor", icon: MessageSquareHeart },
  { name: "Policies", key: "policies", href: "/policies", icon: Shield },
  { name: "Assets", key: "assets", href: "/assets", icon: Package, managerOnly: true },
  { name: "Activity", key: "activity", href: "/activity", icon: Activity },
  { name: "Tools", key: "tools", href: "/tools", icon: Wrench },
  { name: "Integrations", key: "integrations", href: "/integrations", icon: Link2, adminOnly: true },
  { name: "AI Assistant", key: "aiAssistant", href: "/ai", icon: Bot, moduleKey: "ai" },
];

const bottomNav = [
  { name: "Docs", key: "docs", href: "/docs", icon: FileText },
  { name: "Settings", key: "settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [themeMounted, setThemeMounted] = useState(false);
  const tNav = useTranslations("nav");
  const { theme, resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", collapsed ? "64px" : "232px");
  }, [collapsed]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [mobileOpen]);

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

    fetch("/api/announcements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = Array.isArray(d) ? d : d?.data || [];
        setAnnouncementCount(items.length);
      })
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
    <>
      {/* Mobile hamburger — only visible on small screens */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="app-mobile-trigger"
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>

      {/* Mobile scrim — click-anywhere-to-close */}
      {mobileOpen && (
        <button
          type="button"
          className="app-mobile-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

    <aside
      className={cn("app-sidebar", collapsed && "is-collapsed", mobileOpen && "is-mobile-open")}
      aria-label="Dashboard navigation"
    >
      {/* Brand */}
      <div className="app-sidebar-brand">
        {!collapsed ? (
          <Link href="/dashboard" className="app-sidebar-brand-full" aria-label="workwrk home">
            <span className="app-sidebar-dot" aria-hidden />
            <span className="app-sidebar-wordmark">workwrk</span>
          </Link>
        ) : (
          <Link href="/dashboard" className="app-sidebar-brand-mini" aria-label="workwrk home">
            <span className="app-sidebar-dot" aria-hidden />
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="app-sidebar-collapse"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Main nav */}
      <nav className="app-sidebar-nav">
        {visibleNav.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn("app-sidebar-link", isActive && "is-active", collapsed && "is-collapsed")}
              title={collapsed ? tNav(item.key) : undefined}
            >
              <Icon size={16} />
              {!collapsed && (
                <>
                  <span className="app-sidebar-label">{tNav(item.key)}</span>
                  {item.key === "announcements" && announcementCount > 0 && (
                    <span className="app-sidebar-badge">{announcementCount}</span>
                  )}
                </>
              )}
              {collapsed && item.key === "announcements" && announcementCount > 0 && (
                <span className="app-sidebar-dot-pip" aria-hidden />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="app-sidebar-bottom">
        {bottomNav.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn("app-sidebar-link", isActive && "is-active", collapsed && "is-collapsed")}
              title={collapsed ? tNav(item.key) : undefined}
            >
              <Icon size={16} />
              {!collapsed && <span className="app-sidebar-label">{tNav(item.key)}</span>}
            </Link>
          );
        })}
        {themeMounted && (() => {
          const isDark = (resolvedTheme ?? theme) === "dark";
          const label = isDark ? tNav("lightMode") : tNav("darkMode");
          return (
            <button
              type="button"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className={cn("app-sidebar-link", collapsed && "is-collapsed")}
              aria-label={label}
              title={collapsed ? label : undefined}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
              {!collapsed && <span className="app-sidebar-label">{label}</span>}
            </button>
          );
        })()}
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={cn("app-sidebar-link app-sidebar-signout", collapsed && "is-collapsed")}
          aria-label={tNav("signOut")}
        >
          <LogOut size={16} />
          {!collapsed && <span className="app-sidebar-label">{tNav("signOut")}</span>}
        </button>
      </div>
    </aside>
    </>
  );
}
