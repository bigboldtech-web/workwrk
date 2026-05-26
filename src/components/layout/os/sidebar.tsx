"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Search,
  Plus,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useOsShell } from "./shell-context";

type BoardItem = {
  href: string;
  label: string;
  mark: string; // single letter shown inside colored square
  color: string; // CSS color value
  count?: number;
  pulse?: boolean;
};

const FAVORITES: BoardItem[] = [
  { href: "/today",        label: "Today — your day", mark: "T", color: "var(--os-c-orange)", pulse: true },
  { href: "/tasks",        label: "Sprint Q3 — Eng",  mark: "S", color: "var(--os-c-purple)", count: 47 },
  { href: "/crm/pipeline", label: "Pipeline",         mark: "P", color: "var(--os-c-green)",  count: 23 },
];

const BOARDS: BoardItem[] = [
  { href: "/tasks",         label: "My tasks",      mark: "M", color: "var(--os-c-blue)" },
  { href: "/meetings",      label: "Meetings",      mark: "M", color: "var(--os-c-pink)" },
  { href: "/okrs",          label: "OKRs Q3",       mark: "O", color: "var(--os-c-indigo)" },
  { href: "/docs",          label: "Docs & notes",  mark: "D", color: "var(--os-c-teal)" },
  { href: "/announcements", label: "Announcements", mark: "A", color: "var(--os-c-red)", pulse: true },
  { href: "/ideas",         label: "Ideas board",   mark: "I", color: "var(--os-c-lime)" },
  { href: "/activity",      label: "Activity feed", mark: "A", color: "var(--os-c-brown)" },
];

const SPACES: BoardItem[] = [
  { href: "/crm",        label: "Sales",       mark: "S", color: "var(--os-c-green)" },
  { href: "/dev",        label: "Engineering", mark: "E", color: "var(--os-c-blue)" },
  { href: "/people",     label: "People & HR", mark: "H", color: "var(--os-c-pink)" },
  { href: "/financials", label: "Finance",     mark: "F", color: "var(--os-c-teal)" },
  { href: "/helpdesk",   label: "Support",     mark: "C", color: "var(--os-c-orange)" },
];

function navMatch(pathname: string, href: string) {
  if (href === pathname) return true;
  if (href === "/today" && (pathname === "/" || pathname === "/dashboard")) return true;
  return false;
}

function NavItem({ item, pathname }: { item: BoardItem; pathname: string }) {
  const active = navMatch(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={`os-side__item ${active ? "is-active" : ""}`}
    >
      <span className="os-side__item-mark" style={{ background: item.color }}>
        {item.mark}
      </span>
      <span className="os-side__item-text">{item.label}</span>
      {item.pulse ? <span className="os-side__item-pulse" aria-hidden /> : null}
      {item.count !== undefined ? <span className="os-side__item-count">{item.count}</span> : null}
    </Link>
  );
}

export function OsSidebar() {
  const pathname = usePathname() || "";
  const { openPalette } = useOsShell();

  return (
    <aside className="os-side" aria-label="Workspace navigation">
      <div className="os-side__head">
        <button type="button" className="os-side__ws">
          <span className="os-side__ws-mark">C</span>
          <span className="os-side__ws-info">
            <span className="os-side__ws-name">Cashkr</span>
            <span className="os-side__ws-tier">Enterprise · 247 users</span>
          </span>
          <span className="os-side__ws-chev"><ChevronDown /></span>
        </button>

        <button type="button" className="os-side__search" onClick={openPalette}>
          <Search />
          <span className="os-side__search-label">Search everything…</span>
          <span className="os-side__search-kbd">⌘K</span>
        </button>
      </div>

      <div className="os-side__scroll">
        <section className="os-side__section">
          <div className="os-side__section-head">
            <span>★ Favorites</span>
            <button type="button" className="os-side__section-head-btn" aria-label="Add favorite">
              <Plus />
            </button>
          </div>
          {FAVORITES.map((it) => <NavItem key={it.href + it.label} item={it} pathname={pathname} />)}
        </section>

        <section className="os-side__section">
          <div className="os-side__section-head">
            <span>Boards</span>
            <button type="button" className="os-side__section-head-btn" aria-label="New board">
              <Plus />
            </button>
          </div>
          {BOARDS.map((it) => <NavItem key={it.href + it.label} item={it} pathname={pathname} />)}
          <button type="button" className="os-side__add">
            <Plus />
            <span>New board</span>
          </button>
        </section>

        <section className="os-side__section">
          <div className="os-side__section-head">
            <span>Spaces</span>
            <button type="button" className="os-side__section-head-btn" aria-label="New space">
              <Plus />
            </button>
          </div>
          {SPACES.map((it) => <NavItem key={it.href + it.label} item={it} pathname={pathname} />)}
        </section>
      </div>

      <div className="os-side__foot">
        <button type="button" className="os-side__foot-btn">
          <Settings />
          <span>Workspace settings</span>
        </button>
        <button type="button" className="os-side__foot-btn">
          <Trash2 />
          <span>Trash</span>
        </button>
        <button type="button" className="os-side__foot-btn os-side__foot-btn--invite">
          <UserPlus />
          <span>Invite teammates</span>
        </button>
      </div>
    </aside>
  );
}
