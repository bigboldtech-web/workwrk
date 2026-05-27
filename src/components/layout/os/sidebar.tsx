"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  UserPlus,
  Home,
  Inbox,
  Activity,
  Star,
  Sparkles,
  Calendar as CalendarIcon,
  Briefcase,
  TrendingUp,
  Megaphone,
  LifeBuoy,
  Users,
  Clock,
  Coins,
  Code2,
  BookOpen,
  Wrench,
  Building2,
} from "lucide-react";
import { useOsShell } from "./shell-context";

type Leaf = {
  href: string;
  label: string;
  mark: string;
  color: string;
  pulse?: boolean;
  count?: number;
};

type Space = {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  /** path prefixes that mark this space as "current" */
  match: string[];
  items: Leaf[];
};

/* ─────────────── Pinned (always visible) ─────────────── */
const PINNED: Leaf[] = [
  { href: "/today",     label: "Today — your day", mark: "T", color: "var(--os-c-orange)", pulse: true },
  { href: "/inbox",     label: "Inbox",            mark: "I", color: "var(--os-c-indigo)" },
  { href: "/activity",  label: "Activity feed",    mark: "A", color: "var(--os-c-brown)" },
  { href: "/favorites", label: "Favorites",        mark: "F", color: "var(--os-c-yellow)" },
  { href: "/sidekick",  label: "Sidekick AI",      mark: "S", color: "var(--os-c-pink)" },
  { href: "/files",     label: "Files",            mark: "F", color: "var(--os-c-blue)" },
];

/* ─────────────── Spaces (collapsible clusters) ─────────────── */
const SPACES: Space[] = [
  {
    id: "work",
    label: "Work",
    Icon: Briefcase,
    color: "var(--os-c-blue)",
    match: ["/tasks", "/meetings", "/okrs", "/docs", "/notetaker", "/whiteboards", "/ideas"],
    items: [
      { href: "/tasks",          label: "My tasks",     mark: "T", color: "var(--os-c-blue)" },
      { href: "/tasks/backlog",  label: "Backlog",      mark: "B", color: "var(--os-c-indigo)" },
      { href: "/tasks/sprint",   label: "Sprint",       mark: "S", color: "var(--os-c-orange)" },
      { href: "/tasks/board",    label: "Sprint board", mark: "K", color: "var(--os-c-purple)" },
      { href: "/tasks/calendar", label: "Task calendar", mark: "C", color: "var(--os-c-pink)" },
      { href: "/tasks/gantt",    label: "Gantt",        mark: "G", color: "var(--os-c-purple)" },
      { href: "/meetings",       label: "Meetings",     mark: "M", color: "var(--os-c-pink)" },
      { href: "/okrs",           label: "OKRs",         mark: "O", color: "var(--os-c-indigo)" },
      { href: "/docs",           label: "Docs & notes", mark: "D", color: "var(--os-c-teal)" },
      { href: "/notetaker",      label: "Notetaker",    mark: "N", color: "var(--os-c-purple)" },
      { href: "/whiteboards",    label: "Whiteboards",  mark: "W", color: "var(--os-c-teal)" },
      { href: "/ideas",          label: "Ideas board",  mark: "I", color: "var(--os-c-lime)" },
    ],
  },
  {
    id: "crm",
    label: "Sales · CRM",
    Icon: TrendingUp,
    color: "var(--os-c-green)",
    match: ["/crm"],
    items: [
      { href: "/crm",            label: "CRM hub",   mark: "C", color: "var(--os-c-green)" },
      { href: "/crm/leads",      label: "Leads",     mark: "L", color: "var(--os-c-orange)" },
      { href: "/crm/accounts",   label: "Accounts",  mark: "A", color: "var(--os-c-indigo)" },
      { href: "/crm/pipeline",   label: "Pipeline",  mark: "P", color: "var(--os-c-green)" },
      { href: "/crm/activities", label: "Activities", mark: "@", color: "var(--os-c-brown)" },
      { href: "/crm/reports",    label: "Reports",   mark: "R", color: "var(--os-c-teal)" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    Icon: Megaphone,
    color: "var(--os-c-pink)",
    match: ["/marketing"],
    items: [
      { href: "/marketing",           label: "Marketing hub", mark: "M", color: "var(--os-c-pink)" },
      { href: "/marketing/campaigns", label: "Campaigns",     mark: "C", color: "var(--os-c-orange)" },
      { href: "/marketing/content",   label: "Content",       mark: "C", color: "var(--os-c-purple)" },
      { href: "/marketing/events",    label: "Events",        mark: "E", color: "var(--os-c-pink)" },
    ],
  },
  {
    id: "service",
    label: "Service",
    Icon: LifeBuoy,
    color: "var(--os-c-orange)",
    match: ["/helpdesk", "/itsm", "/process-runs"],
    items: [
      { href: "/helpdesk",           label: "Helpdesk",         mark: "H", color: "var(--os-c-orange)" },
      { href: "/helpdesk/tickets",   label: "Helpdesk tickets", mark: "T", color: "var(--os-c-orange)" },
      { href: "/helpdesk/customers", label: "Customers",        mark: "C", color: "var(--os-c-pink)" },
      { href: "/helpdesk/macros",    label: "Macros",           mark: "M", color: "var(--os-c-brown)" },
      { href: "/itsm",               label: "ITSM",             mark: "I", color: "var(--os-c-red)" },
      { href: "/itsm/incidents",     label: "Incidents",        mark: "!", color: "var(--os-c-red)" },
      { href: "/itsm/tickets",       label: "Service tickets",  mark: "T", color: "var(--os-c-orange)" },
      { href: "/itsm/problems",      label: "Problems",         mark: "P", color: "var(--os-c-red)" },
      { href: "/itsm/changes",       label: "Changes",          mark: "C", color: "var(--os-c-orange)" },
      { href: "/itsm/cmdb",          label: "CMDB",             mark: "M", color: "var(--os-c-purple)" },
      { href: "/itsm/kb",            label: "Knowledge base",   mark: "K", color: "var(--os-c-teal)" },
      { href: "/process-runs",       label: "Process runs",     mark: "R", color: "var(--os-c-orange)" },
    ],
  },
  {
    id: "people",
    label: "People · HR",
    Icon: Users,
    color: "var(--os-c-pink)",
    match: ["/people", "/organization", "/recruiting", "/onboarding", "/reviews", "/talent", "/candor", "/kra-kpi", "/workforce-planning", "/announcements", "/kudos", "/surveys", "/people/departments", "/people/roles", "/people/skills"],
    items: [
      { href: "/people",                label: "Directory",        mark: "D", color: "var(--os-c-pink)" },
      { href: "/organization",          label: "Org chart",        mark: "O", color: "var(--os-c-purple)" },
      { href: "/people/departments",    label: "Departments",      mark: "D", color: "var(--os-c-indigo)" },
      { href: "/people/roles",          label: "Roles",            mark: "R", color: "var(--os-c-blue)" },
      { href: "/people/skills",         label: "Skills",           mark: "S", color: "var(--os-c-orange)" },
      { href: "/recruiting",            label: "Recruiting",       mark: "R", color: "var(--os-c-green)" },
      { href: "/recruiting/jobs",       label: "Jobs",             mark: "J", color: "var(--os-c-blue)" },
      { href: "/recruiting/candidates", label: "Candidates",       mark: "C", color: "var(--os-c-indigo)" },
      { href: "/recruiting/pipeline",   label: "Hiring pipeline",  mark: "P", color: "var(--os-c-green)" },
      { href: "/recruiting/interviews", label: "Interviews",       mark: "I", color: "var(--os-c-purple)" },
      { href: "/onboarding",            label: "Onboarding",       mark: "O", color: "var(--os-c-orange)" },
      { href: "/reviews",               label: "Reviews",          mark: "R", color: "var(--os-c-blue)" },
      { href: "/talent",                label: "Talent (9-box)",   mark: "T", color: "var(--os-c-purple)" },
      { href: "/candor",                label: "Candor",           mark: "C", color: "var(--os-c-pink)" },
      { href: "/kra-kpi",               label: "KRA & KPI",        mark: "K", color: "var(--os-c-indigo)" },
      { href: "/kra-kpi/review",        label: "People reviews",   mark: "R", color: "var(--os-c-purple)" },
      { href: "/workforce-planning",    label: "Workforce plan",   mark: "W", color: "var(--os-c-indigo)" },
      { href: "/announcements",         label: "Announcements",    mark: "A", color: "var(--os-c-red)", pulse: true },
      { href: "/kudos",                 label: "Kudos",            mark: "K", color: "var(--os-c-yellow)" },
      { href: "/surveys",               label: "Surveys",          mark: "S", color: "var(--os-c-teal)" },
    ],
  },
  {
    id: "time-pay",
    label: "Time & Pay",
    Icon: Clock,
    color: "var(--os-c-teal)",
    match: ["/clock", "/timesheets", "/time-off", "/payroll", "/benefits", "/my-benefits", "/expenses", "/compensation"],
    items: [
      { href: "/clock",              label: "Clock in/out",      mark: "C", color: "var(--os-c-teal)" },
      { href: "/timesheets",         label: "Timesheets",        mark: "T", color: "var(--os-c-blue)" },
      { href: "/time-off",           label: "Time off",          mark: "O", color: "var(--os-c-orange)" },
      { href: "/time-off/policies",  label: "Leave policies",    mark: "P", color: "var(--os-c-purple)" },
      { href: "/payroll",            label: "Payroll",           mark: "$", color: "var(--os-c-green)" },
      { href: "/payroll/runs",       label: "Pay runs",          mark: "R", color: "var(--os-c-green)" },
      { href: "/payroll/groups",     label: "Pay groups",        mark: "G", color: "var(--os-c-indigo)" },
      { href: "/benefits",           label: "Benefits",          mark: "B", color: "var(--os-c-pink)" },
      { href: "/benefits/plans",     label: "Plans",             mark: "P", color: "var(--os-c-pink)" },
      { href: "/benefits/oe",        label: "Open enrolment",    mark: "O", color: "var(--os-c-orange)" },
      { href: "/my-benefits",        label: "My benefits",       mark: "M", color: "var(--os-c-teal)" },
      { href: "/expenses",           label: "Expenses",          mark: "E", color: "var(--os-c-indigo)" },
      { href: "/compensation",       label: "Compensation",      mark: "C", color: "var(--os-c-green)" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    Icon: Coins,
    color: "var(--os-c-sage)",
    match: ["/financials", "/planning", "/procurement", "/assets"],
    items: [
      { href: "/financials",              label: "Financials hub", mark: "F", color: "var(--os-c-sage)" },
      { href: "/financials/accounts",     label: "GL accounts",    mark: "A", color: "var(--os-c-sage)" },
      { href: "/financials/entries",      label: "Journal entries", mark: "J", color: "var(--os-c-indigo)" },
      { href: "/financials/statements",   label: "Statements",     mark: "S", color: "var(--os-c-purple)" },
      { href: "/financials/reports",      label: "Reports",        mark: "R", color: "var(--os-c-teal)" },
      { href: "/financials/calendar",     label: "Periods",        mark: "P", color: "var(--os-c-orange)" },
      { href: "/financials/integrations", label: "Integrations",   mark: "I", color: "var(--os-c-blue)" },
      { href: "/planning",                label: "Plans",          mark: "P", color: "var(--os-c-indigo)" },
      { href: "/planning/plans",          label: "Budget plans",   mark: "B", color: "var(--os-c-indigo)" },
      { href: "/planning/variance",       label: "Variance",       mark: "V", color: "var(--os-c-red)" },
      { href: "/procurement",             label: "Procurement",    mark: "P", color: "var(--os-c-brown)" },
      { href: "/procurement/pos",         label: "Purchase orders", mark: "P", color: "var(--os-c-brown)" },
      { href: "/procurement/invoices",    label: "Invoices",       mark: "I", color: "var(--os-c-orange)" },
      { href: "/procurement/vendors",     label: "Vendors",        mark: "V", color: "var(--os-c-indigo)" },
      { href: "/assets",                  label: "Assets",         mark: "A", color: "var(--os-c-blue)" },
    ],
  },
  {
    id: "dev",
    label: "Dev",
    Icon: Code2,
    color: "var(--os-c-blue)",
    match: ["/dev"],
    items: [
      { href: "/dev",          label: "Dev hub",  mark: "D", color: "var(--os-c-blue)" },
      { href: "/dev/sprints",  label: "Sprints",  mark: "S", color: "var(--os-c-purple)" },
      { href: "/dev/releases", label: "Releases", mark: "R", color: "var(--os-c-green)" },
      { href: "/dev/roadmap",  label: "Roadmap",  mark: "R", color: "var(--os-c-indigo)" },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    Icon: BookOpen,
    color: "var(--os-c-purple)",
    match: ["/sops", "/policies", "/legal", "/learning", "/brand-guide"],
    items: [
      { href: "/sops",              label: "SOPs",        mark: "S", color: "var(--os-c-teal)" },
      { href: "/sops/my-sops",      label: "My SOPs",     mark: "M", color: "var(--os-c-teal)" },
      { href: "/sops/compliance",   label: "Compliance",  mark: "C", color: "var(--os-c-red)" },
      { href: "/policies",          label: "Policies",    mark: "P", color: "var(--os-c-indigo)" },
      { href: "/legal",             label: "Legal",       mark: "L", color: "var(--os-c-brown)" },
      { href: "/legal/contracts",   label: "Contracts",   mark: "C", color: "var(--os-c-brown)" },
      { href: "/legal/ip",          label: "IP",          mark: "I", color: "var(--os-c-purple)" },
      { href: "/legal/privacy",     label: "Privacy",     mark: "P", color: "var(--os-c-red)" },
      { href: "/learning",          label: "Learning",    mark: "L", color: "var(--os-c-orange)" },
      { href: "/learning/catalog",  label: "Catalog",     mark: "C", color: "var(--os-c-orange)" },
      { href: "/learning/mine",     label: "My courses",  mark: "M", color: "var(--os-c-teal)" },
      { href: "/learning/manage",   label: "Manage",      mark: "M", color: "var(--os-c-indigo)" },
      { href: "/brand-guide",       label: "Brand guide", mark: "B", color: "var(--os-c-pink)" },
    ],
  },
  {
    id: "build",
    label: "Build & Extend",
    Icon: Wrench,
    color: "var(--os-c-purple)",
    match: ["/build", "/studio", "/tools", "/agents", "/autopilot", "/ai", "/store", "/integrations"],
    items: [
      { href: "/build",        label: "Build apps",   mark: "B", color: "var(--os-c-purple)" },
      { href: "/studio",       label: "Studio",       mark: "S", color: "var(--os-c-teal)" },
      { href: "/tools",        label: "Tools",        mark: "T", color: "var(--os-c-brown)" },
      { href: "/agents",       label: "Agents",       mark: "A", color: "var(--os-c-purple)" },
      { href: "/autopilot",    label: "Autopilot",    mark: "A", color: "var(--os-c-indigo)" },
      { href: "/ai",           label: "AI workshop",  mark: "A", color: "var(--os-c-pink)" },
      { href: "/store",        label: "Marketplace",  mark: "M", color: "var(--os-c-orange)" },
      { href: "/integrations", label: "Integrations", mark: "I", color: "var(--os-c-blue)" },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    Icon: Building2,
    color: "var(--os-c-darkgray)",
    match: ["/analytics", "/settings", "/account", "/redeem", "/dashboard"],
    items: [
      { href: "/analytics",          label: "Analytics",    mark: "A", color: "var(--os-c-blue)" },
      { href: "/settings",           label: "Settings",     mark: "S", color: "var(--os-c-darkgray)" },
      { href: "/settings/identity",  label: "Identity",     mark: "I", color: "var(--os-c-indigo)" },
      { href: "/settings/tags",      label: "Tags",         mark: "T", color: "var(--os-c-teal)" },
      { href: "/settings/calendar",  label: "Calendar feeds", mark: "C", color: "var(--os-c-orange)" },
      { href: "/settings/audit",     label: "Audit log",    mark: "A", color: "var(--os-c-red)" },
      { href: "/account/security",   label: "Account · Security", mark: "S", color: "var(--os-c-green)" },
      { href: "/redeem",             label: "Redeem code",  mark: "R", color: "var(--os-c-yellow)" },
    ],
  },
];

function leafActive(pathname: string, href: string): boolean {
  if (href === pathname) return true;
  if (href === "/today" && (pathname === "/" || pathname === "/dashboard")) return true;
  return false;
}

function spaceContainsPath(space: Space, pathname: string): boolean {
  return space.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function LeafItem({ item, pathname }: { item: Leaf; pathname: string }) {
  const active = leafActive(pathname, item.href);
  return (
    <Link href={item.href} className={`os-side__item ${active ? "is-active" : ""}`}>
      <span className="os-side__item-mark" style={{ background: item.color }}>{item.mark}</span>
      <span className="os-side__item-text">{item.label}</span>
      {item.pulse ? <span className="os-side__item-pulse" aria-hidden /> : null}
      {item.count !== undefined ? <span className="os-side__item-count">{item.count}</span> : null}
    </Link>
  );
}

export function OsSidebar() {
  const pathname = usePathname() || "";
  const { openPalette } = useOsShell();

  const currentSpaceId = useMemo(
    () => SPACES.find((s) => spaceContainsPath(s, pathname))?.id ?? null,
    [pathname],
  );

  const [openSpaces, setOpenSpaces] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (currentSpaceId) initial.add(currentSpaceId);
    return initial;
  });

  // When the user navigates into a different space, auto-open it. We don't
  // close other spaces — the user's explicit toggles win.
  useEffect(() => {
    if (currentSpaceId) {
      setOpenSpaces((prev) => {
        if (prev.has(currentSpaceId)) return prev;
        const next = new Set(prev);
        next.add(currentSpaceId);
        return next;
      });
    }
  }, [currentSpaceId]);

  function toggleSpace(id: string) {
    setOpenSpaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
            <span>★ Pinned</span>
            <button type="button" className="os-side__section-head-btn" aria-label="Add pin">
              <Plus />
            </button>
          </div>
          {PINNED.map((it) => <LeafItem key={it.href} item={it} pathname={pathname} />)}
        </section>

        <section className="os-side__section">
          <div className="os-side__section-head">
            <span>Spaces</span>
            <button type="button" className="os-side__section-head-btn" aria-label="New space">
              <Plus />
            </button>
          </div>
          {SPACES.map((space) => {
            const open = openSpaces.has(space.id);
            const isCurrent = space.id === currentSpaceId;
            return (
              <div key={space.id} className="os-side__space">
                <button
                  type="button"
                  className={`os-side__space-head ${isCurrent ? "is-current" : ""}`}
                  onClick={() => toggleSpace(space.id)}
                  aria-expanded={open}
                >
                  <span className="os-side__space-chev" data-open={open}>
                    {open ? <ChevronDown /> : <ChevronRight />}
                  </span>
                  <span className="os-side__space-icon" style={{ background: space.color }}>
                    <space.Icon />
                  </span>
                  <span className="os-side__space-label">{space.label}</span>
                  <span className="os-side__space-count">{space.items.length}</span>
                </button>
                {open ? (
                  <div className="os-side__space-children">
                    {space.items.map((it) => <LeafItem key={it.href} item={it} pathname={pathname} />)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      </div>

      <div className="os-side__foot">
        <button type="button" className="os-side__foot-btn">
          <SettingsIcon />
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
