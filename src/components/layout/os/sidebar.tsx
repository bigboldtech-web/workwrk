"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  ChevronsUpDown,
  Plus,
  Inbox,
  CheckSquare,
  CalendarDays,
  Target,
  FileText,
  Megaphone,
  Lightbulb,
  Activity,
  Sparkles,
  Store,
  PlugZap,
  UserPlus,
  ChevronRight,
  Layers,
  Briefcase,
  Code2,
  Users2,
  CircleDollarSign,
  Headphones,
} from "lucide-react";
import { useOsShell } from "./shell-context";

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  count?: number | string;
  badge?: string;
};

type Group = {
  title: string;
  items: NavItem[];
  collapsible?: boolean;
};

const TODAY_GROUPS: Group[] = [
  {
    title: "Inbox",
    items: [
      { href: "/today", label: "Today", Icon: Inbox, count: 7 },
      { href: "/inbox", label: "Notifications", Icon: Megaphone, count: 12 },
      { href: "/tasks", label: "My tasks", Icon: CheckSquare, count: 23 },
      { href: "/meetings", label: "Meetings", Icon: CalendarDays, count: 3 },
    ],
  },
  {
    title: "Personal",
    items: [
      { href: "/okrs", label: "My OKRs", Icon: Target },
      { href: "/docs", label: "Notes & docs", Icon: FileText },
      { href: "/activity", label: "Activity", Icon: Activity },
      { href: "/ideas", label: "Ideas", Icon: Lightbulb },
    ],
  },
];

const SPACES = [
  { slug: "sales", name: "Sales", Icon: Briefcase, color: "var(--os-success)" },
  { slug: "engineering", name: "Engineering", Icon: Code2, color: "var(--os-info)" },
  { slug: "people", name: "People & HR", Icon: Users2, color: "var(--os-hue-rose-fg)" },
  { slug: "finance", name: "Finance", Icon: CircleDollarSign, color: "var(--os-hue-teal-fg)" },
  { slug: "support", name: "Support", Icon: Headphones, color: "var(--os-accent)" },
];

const AGENTS_GROUPS: Group[] = [
  {
    title: "Your agents",
    items: [
      { href: "/agents/ria", label: "Ria — SDR", Icon: Sparkles, badge: "12" },
      { href: "/agents/priya", label: "Priya — HR Ops", Icon: Sparkles, badge: "4" },
      { href: "/agents/maya", label: "Maya — Recruiter", Icon: Sparkles },
      { href: "/agents/aman", label: "Aman — IT", Icon: Sparkles },
    ],
  },
  {
    title: "Chats",
    items: [
      { href: "/sidekick", label: "Sidekick (you)", Icon: Inbox },
    ],
  },
];

const STORE_GROUPS: Group[] = [
  {
    title: "Discover",
    items: [
      { href: "/store", label: "Marketplace", Icon: Store },
      { href: "/store?cat=apps", label: "Apps", Icon: Layers },
      { href: "/store?cat=agents", label: "Agents", Icon: Sparkles },
      { href: "/integrations", label: "Integrations", Icon: PlugZap },
    ],
  },
  {
    title: "Installed",
    items: [
      { href: "/tools", label: "My tools", Icon: CheckSquare, count: 14 },
    ],
  },
];

function navMatch(pathname: string, href: string) {
  if (href === pathname) return true;
  if (href === "/today" && (pathname === "/" || pathname === "/dashboard")) return true;
  return false;
}

export function OsSidebar() {
  const pathname = usePathname() || "";
  const { openPalette } = useOsShell();

  let groups: Group[] = TODAY_GROUPS;
  let showSpaces = false;
  let title = "Your day";

  if (pathname.startsWith("/spaces")) {
    showSpaces = true;
    title = "Spaces";
    groups = [];
  } else if (pathname.startsWith("/agents") || pathname.startsWith("/sidekick")) {
    groups = AGENTS_GROUPS;
    title = "Agents";
  } else if (pathname.startsWith("/store") || pathname.startsWith("/tools") || pathname.startsWith("/integrations")) {
    groups = STORE_GROUPS;
    title = "Library";
  }

  return (
    <nav className="os-side" aria-label={title}>
      <div className="os-side__header">
        <button type="button" className="os-side__org">
          <span className="os-side__org-mark">CK</span>
          <span className="os-side__org-name">Cashkr</span>
          <ChevronsUpDown className="os-side__org-chev" />
        </button>
      </div>

      <div className="os-side__search">
        <button
          type="button"
          className="os-side__search-box"
          onClick={() => openPalette()}
        >
          <Search />
          <span className="os-side__search-box-label">Search or jump to…</span>
          <kbd>⌘K</kbd>
        </button>
      </div>

      <div className="os-side__nav">
        {showSpaces ? (
          <>
            <div className="os-side__group">
              <div className="os-side__group-title">
                <span>Your spaces</span>
                <button type="button" className="os-side__group-title-btn" aria-label="New space">
                  <Plus />
                </button>
              </div>
              {SPACES.map((s) => {
                const href = `/spaces/${s.slug}`;
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={s.slug}
                    href={href}
                    className={`os-nav-item ${active ? "is-active" : ""}`}
                  >
                    <span className="os-nav-item__hue" style={{ background: s.color }} aria-hidden />
                    <span>{s.name}</span>
                    <ChevronRight className="os-nav-item__count" />
                  </Link>
                );
              })}
            </div>
          </>
        ) : (
          groups.map((group) => (
            <div key={group.title} className="os-side__group">
              <div className="os-side__group-title">
                <span>{group.title}</span>
              </div>
              {group.items.map((it) => {
                const active = navMatch(pathname, it.href);
                const Icon = it.Icon;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={`os-nav-item ${active ? "is-active" : ""}`}
                  >
                    <Icon />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.label}
                    </span>
                    {it.badge ? (
                      <span className="os-nav-item__badge">{it.badge}</span>
                    ) : it.count !== undefined ? (
                      <span className="os-nav-item__count">{it.count}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="os-side__bottom">
        <button type="button" className="os-side__invite">
          <UserPlus />
          <span>Invite teammates</span>
        </button>
      </div>
    </nav>
  );
}
