"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Building2, BarChart3, Settings, Shield } from "lucide-react";

const adminNav = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Companies", href: "/admin/companies", icon: Building2 },
  { name: "Analytics", href: "/admin/analytics", icon: BarChart3 },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-[240px] border-r border-[#2A2A3A] bg-[#0A0A0F] flex flex-col">
        <div className="h-16 flex items-center px-4 border-b border-[#2A2A3A]">
          <div className="flex items-center gap-2">
            <Shield size={20} className="text-red-400" />
            <span className="font-bold text-sm">TheywrK Admin</span>
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
                    : "text-[#8888A0] hover:bg-[#1A1A26] hover:text-[#E8E8F0]"
                )}
              >
                <item.icon size={18} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-[#2A2A3A] flex items-center px-6 bg-[#0A0A0F]/80 backdrop-blur">
          <h1 className="text-sm font-medium text-[#8888A0]">Subscriber Admin Panel</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
