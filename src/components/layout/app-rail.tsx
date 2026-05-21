"use client";

// AppRail — Phase 2 of the monday-style polish.
//
// The old sidebar was a flat 50-item list; this rail is monday's
// pattern: a slim 60px column on the left edge with 7 anchor icons
// plus a "More" popover for the long tail. The actual product the
// user is inside gets its own sub-nav in the next column over (that
// arrives in Phase 3 as <ProductLayout>).
//
// Anchors:
//   Workspace · Sidekick · Agents · Vibe · Notetaker · Favorites · More
//
// "More" surfaces the universal admin / settings / docs / signout
// long-tail without cluttering the rail.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import {
  LayoutDashboard,
  Sparkles,
  Bot,
  Wand2,
  Mic,
  Star,
  MoreHorizontal,
  Settings,
  FileText,
  Activity,
  BarChart3,
  Shield,
  Wrench,
  Link2,
  Palette,
  Zap,
  LogOut,
  Package,
} from "lucide-react";

interface RailItem {
  key: string;
  label: string;
  href: string;
  Icon: typeof LayoutDashboard;
}

const RAIL_ITEMS: RailItem[] = [
  { key: "workspace", label: "Workspace", href: "/dashboard", Icon: LayoutDashboard },
  { key: "sidekick", label: "Sidekick", href: "/sidekick", Icon: Sparkles },
  { key: "agents", label: "Agents", href: "/agents", Icon: Bot },
  { key: "vibe", label: "Vibe", href: "/build", Icon: Wand2 },
  { key: "notetaker", label: "Notetaker", href: "/notetaker", Icon: Mic },
  { key: "favorites", label: "Favorites", href: "/favorites", Icon: Star },
];

interface MoreItem {
  key: string;
  label: string;
  href?: string;
  onClick?: () => void;
  Icon: typeof Settings;
  destructive?: boolean;
}

export function AppRail() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const moreItems: MoreItem[] = [
    { key: "store", label: "Product Store", href: "/store", Icon: Package },
    { key: "studio", label: "Studio", href: "/studio", Icon: Wrench },
    { key: "autopilot", label: "Autopilot", href: "/autopilot", Icon: Zap },
    { key: "activity", label: "Activity", href: "/activity", Icon: Activity },
    { key: "analytics", label: "Analytics", href: "/analytics", Icon: BarChart3 },
    { key: "integrations", label: "Integrations", href: "/integrations", Icon: Link2 },
    { key: "brand", label: "Brand Guide", href: "/brand-guide", Icon: Palette },
    { key: "docs", label: "Docs", href: "/docs", Icon: FileText },
    { key: "admin", label: "Admin", href: "/admin", Icon: Shield },
    { key: "settings", label: "Settings", href: "/settings", Icon: Settings },
    { key: "signout", label: "Sign out", onClick: () => signOut({ callbackUrl: "/" }), Icon: LogOut, destructive: true },
  ];

  return (
    <aside className="app-rail" aria-label="Primary navigation">
      <Link href="/dashboard" className="app-rail-brand" aria-label="WorkwrK home">
        <span className="app-rail-brand-dot" aria-hidden />
      </Link>

      <nav className="app-rail-nav">
        {RAIL_ITEMS.map((item) => {
          const Icon = item.Icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={"app-rail-link" + (active ? " is-active" : "")}
              aria-label={item.label}
              title={item.label}
            >
              <Icon size={18} />
              <span className="app-rail-tip">{item.label}</span>
            </Link>
          );
        })}

        <div className="app-rail-link-wrap">
          <button
            type="button"
            className={"app-rail-link" + (moreOpen ? " is-active" : "")}
            aria-label="More"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            title="More"
          >
            <MoreHorizontal size={18} />
            <span className="app-rail-tip">More</span>
          </button>

          {moreOpen && (
            <>
              <button
                type="button"
                aria-label="Close More menu"
                className="app-rail-more-backdrop"
                onClick={() => setMoreOpen(false)}
              />
              <div className="app-rail-more-pop" role="menu">
                <p className="app-rail-more-heading">Tools &amp; admin</p>
                {moreItems.map((it) => {
                  const Icon = it.Icon;
                  if (it.href) {
                    return (
                      <Link
                        key={it.key}
                        href={it.href}
                        onClick={() => setMoreOpen(false)}
                        className={"app-rail-more-item" + (it.destructive ? " is-destructive" : "")}
                        role="menuitem"
                      >
                        <Icon size={14} />
                        <span>{it.label}</span>
                      </Link>
                    );
                  }
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => { setMoreOpen(false); it.onClick?.(); }}
                      className={"app-rail-more-item" + (it.destructive ? " is-destructive" : "")}
                      role="menuitem"
                    >
                      <Icon size={14} />
                      <span>{it.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </nav>
    </aside>
  );
}
