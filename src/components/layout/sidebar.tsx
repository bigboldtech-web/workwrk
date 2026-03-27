"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Building2,
  Target,
  CheckSquare,
  BookOpen,
  Star,
  MessageSquare,
  BarChart3,
  Bot,
  GraduationCap,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Link2,
  Activity,
} from "lucide-react";

// moduleKey maps nav items to module keys from settings.enabledModules
// Items without a moduleKey are always shown (Dashboard, Organization)
const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "People", href: "/people", icon: Users, moduleKey: "people" },
  { name: "Organization", href: "/organization", icon: Building2 },
  { name: "KRA & KPIs", href: "/kra-kpi", icon: Target, moduleKey: "kra-kpi" },
  { name: "Tasks", href: "/tasks", icon: CheckSquare, moduleKey: "tasks" },
  { name: "SOPs", href: "/sops", icon: BookOpen, moduleKey: "sops" },
  { name: "Reviews", href: "/reviews", icon: Star, moduleKey: "reviews" },
  { name: "Meetings", href: "/meetings", icon: MessageSquare, moduleKey: "meetings" },
  { name: "Analytics", href: "/analytics", icon: BarChart3, moduleKey: "analytics" },
  { name: "Onboarding", href: "/onboarding", icon: GraduationCap, moduleKey: "checkins" },
  { name: "Activity", href: "/activity", icon: Activity },
  { name: "Integrations", href: "/integrations", icon: Link2 },
  { name: "AI Assistant", href: "/ai", icon: Bot, moduleKey: "ai" },
];

const bottomNav = [
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data?.settings?.enabledModules) {
          setEnabledModules(data.settings.enabledModules);
        }
      })
      .catch(() => {});
  }, []);

  const visibleNav = navigation.filter((item) => {
    if (!item.moduleKey) return true;
    if (!enabledModules) return true; // show all while loading
    return enabledModules.includes(item.moduleKey);
  });

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen border-r border-[#2A2A3A] bg-[#0A0A0F] transition-all duration-300",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-[#2A2A3A] px-4">
          {!collapsed && (
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="bg-gradient-to-r from-purple-500 via-purple-300 to-green-400 bg-clip-text text-xl font-extrabold tracking-tight text-transparent"
                style={{ fontFamily: "'Syne', sans-serif" }}>
                theywrk
              </span>
              <span className="text-[#8888A0] opacity-50">.</span>
            </Link>
          )}
          {collapsed && (
            <Link href="/dashboard" className="mx-auto">
              <span className="bg-gradient-to-r from-purple-500 to-green-400 bg-clip-text text-xl font-extrabold text-transparent"
                style={{ fontFamily: "'Syne', sans-serif" }}>
                t
              </span>
            </Link>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-md p-1 text-[#8888A0] hover:bg-[#1A1A26] hover:text-[#E8E8F0] transition-colors"
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
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-purple-600/10 text-purple-400 border border-purple-600/20"
                    : "text-[#8888A0] hover:bg-[#1A1A26] hover:text-[#E8E8F0]",
                  collapsed && "justify-center px-2"
                )}
                title={collapsed ? item.name : undefined}
              >
                <item.icon size={20} className={cn(isActive && "text-purple-400")} />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Navigation */}
        <div className="border-t border-[#2A2A3A] px-3 py-4 space-y-1">
          {bottomNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-purple-600/10 text-purple-400"
                    : "text-[#8888A0] hover:bg-[#1A1A26] hover:text-[#E8E8F0]",
                  collapsed && "justify-center px-2"
                )}
              >
                <item.icon size={20} />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            );
          })}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#8888A0] hover:bg-red-500/10 hover:text-red-400 transition-all",
              collapsed && "justify-center px-2"
            )}
          >
            <LogOut size={20} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
