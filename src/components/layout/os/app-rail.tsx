"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Calendar,
  Inbox,
  BarChart3,
  Users,
  Code2,
  Store,
  HelpCircle,
} from "lucide-react";

type RailItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
  hasUpdate?: boolean;
};

const PRIMARY: RailItem[] = [
  {
    href: "/today",
    label: "Workspace home",
    Icon: Home,
    match: (p) => p === "/today" || p === "/" || p === "/dashboard",
  },
  {
    href: "/tasks",
    label: "My work",
    Icon: Calendar,
    match: (p) => p.startsWith("/tasks"),
    hasUpdate: true,
  },
  {
    href: "/inbox",
    label: "Inbox",
    Icon: Inbox,
    match: (p) => p.startsWith("/inbox"),
  },
];

const PRODUCTS: RailItem[] = [
  { href: "/crm",       label: "CRM",         Icon: BarChart3, match: (p) => p.startsWith("/crm") },
  { href: "/people",    label: "HR & People", Icon: Users,     match: (p) => p.startsWith("/people") || p.startsWith("/recruiting") },
  { href: "/dev",       label: "Dev",         Icon: Code2,     match: (p) => p.startsWith("/dev") },
  { href: "/store",     label: "Marketplace", Icon: Store,     match: (p) => p.startsWith("/store") || p.startsWith("/integrations") },
];

export function OsAppRail() {
  const pathname = usePathname() || "";

  return (
    <aside className="os-rail" aria-label="Primary navigation">
      <Link href="/today" className="os-rail__logo" aria-label="WorkwrK home">
        w
      </Link>

      {PRIMARY.map(({ href, label, Icon, match, hasUpdate }) => {
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

      <div className="os-rail__divider" aria-hidden />

      {PRODUCTS.map(({ href, label, Icon, match, hasUpdate }) => {
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

      <div className="os-rail__spacer" />

      <Link href="/help" className="os-rail__btn" data-tip="Help" aria-label="Help">
        <HelpCircle />
      </Link>
      <Link href="/account" className="os-rail__avatar" aria-label="Account" title="You">
        BB
      </Link>
    </aside>
  );
}
