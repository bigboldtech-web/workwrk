"use client";

// Presentational chrome for the back-office. The platform-staff gate lives in
// the server layout (layout.tsx) — this component just renders the nav + frame
// once access is already granted.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Building2, BarChart3, Shield, ArrowLeft, Sparkles, ShieldCheck } from "lucide-react";
import { ToastProvider } from "@/components/ui/toast";

const adminNav = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Companies", href: "/admin/companies", icon: Building2 },
  { name: "AppSumo Codes", href: "/admin/appsumo", icon: Sparkles },
  { name: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { name: "Platform Staff", href: "/admin/staff", icon: ShieldCheck },
];

export function AdminShell({
  email,
  children,
}: {
  email: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-[240px] border-r border-border bg-background flex flex-col">
        <div className="h-16 flex items-center px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield size={20} className="text-red-400" />
            <span className="font-bold text-sm">WorkwrK Admin</span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {adminNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                )}
              >
                <item.icon size={18} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t border-border">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground transition-all"
          >
            <ArrowLeft size={16} />
            <span>Back to Dashboard</span>
          </Link>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-background/80 backdrop-blur">
          <h1 className="text-sm font-medium text-muted">WorkwrK Staff · Platform back-office</h1>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Shield size={12} className="text-red-400" />
            {email}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <ToastProvider>{children}</ToastProvider>
        </main>
      </div>
    </div>
  );
}
