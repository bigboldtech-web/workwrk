"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Layers, Sparkles, Store, Settings } from "lucide-react";

type RailItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
  hasUpdate?: boolean;
};

const ITEMS: RailItem[] = [
  {
    href: "/today",
    label: "Today",
    Icon: Home,
    match: (p) => p === "/today" || p === "/" || p === "/dashboard",
    hasUpdate: true,
  },
  {
    href: "/spaces",
    label: "Spaces",
    Icon: Layers,
    match: (p) => p.startsWith("/spaces"),
  },
  {
    href: "/agents",
    label: "Agents",
    Icon: Sparkles,
    match: (p) => p.startsWith("/agents") || p.startsWith("/sidekick"),
  },
  {
    href: "/store",
    label: "Library",
    Icon: Store,
    match: (p) => p.startsWith("/store") || p.startsWith("/tools"),
  },
];

export function OsAppRail() {
  const pathname = usePathname() || "";

  return (
    <aside className="os-rail" aria-label="Primary navigation">
      <Link href="/today" className="os-rail__brand" aria-label="WorkwrK home">
        W
      </Link>
      <div className="os-rail__divider" />

      {ITEMS.map(({ href, label, Icon, match, hasUpdate }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={`os-rail__btn ${active ? "is-active" : ""}`}
            data-tip={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            {hasUpdate && !active ? <span className="os-rail__btn-dot" aria-hidden /> : null}
          </Link>
        );
      })}

      <div className="os-rail__bottom">
        <Link href="/settings" className="os-rail__btn" data-tip="Settings" aria-label="Settings">
          <Settings />
        </Link>
        <Link href="/account" className="os-rail__avatar" aria-label="Account" title="You">
          BB
        </Link>
      </div>
    </aside>
  );
}
