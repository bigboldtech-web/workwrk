"use client";

// Central registry for the ClickUp-style app switcher. Each entry is
// one icon in the left rail; clicking it makes its `Sidebar` the
// secondary column, hovering it shows the same `Sidebar` inside a
// floating preview popover. Keep this file lean — sidebars that grow
// past ~30 lines of UI should move to apps/<key>-sidebar.tsx.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Home, Calendar, Sparkles, Users, FileText, BarChart3, Brush, ClipboardCheck,
  Video, Trophy, Clock, LayoutGrid,
  Inbox, MessageSquare, CheckSquare, ListChecks, MoreHorizontal,
  Plus, ChevronDown, ChevronRight, Star, Lock,
  TrendingUp, Megaphone, Briefcase, Layers, BookOpen, Wrench, Building2,
  LifeBuoy, HeartHandshake, GraduationCap, UserCheck, Award, ThumbsUp, FileSpreadsheet,
  HardDrive, Server, Receipt, Coins, Database, Code2, Settings as SettingsIcon,
  ShoppingBag, Workflow, AlertTriangle, ScrollText, Gavel, Palette, Boxes,
  TrendingDown, ClipboardList, FileBarChart, Lightbulb, ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { BloomMark } from "./bloom-mark";
import { usePathname } from "next/navigation";
import { NewSpaceDialog } from "./new-space-dialog";

export interface AppEntry {
  key: string;
  label: string;
  /** Allow non-Lucide icons (e.g. BloomMark) for AI-branded entries. */
  Icon: LucideIcon | React.ComponentType<{ className?: string }>;
  /** Where to navigate when the user clicks this rail icon. */
  defaultHref: string;
  /** Path prefixes that auto-select this app when the URL matches. */
  matchPaths: string[];
  /** Renders the secondary sidebar body for this app. */
  Sidebar: React.ComponentType;
  /** Grouping label inside the More popover ("Work", "Sales", …). */
  category?: string;
  /** Pinned to the rail by default for new users. More-popover apps default to false. */
  defaultPinned?: boolean;
  /** Cannot be unpinned — always shown in the rail (e.g. Home). */
  alwaysPinned?: boolean;
  /** Hidden in the More-popover catalog (e.g. the "More" tile itself). */
  hideFromCatalog?: boolean;
  /**
   * What the sidebar header's "+" button does for this app. Either a
   * route (href) or a custom-event name the app's Sidebar component
   * listens for. Absent → button hidden.
   */
  newAction?: { label: string; href?: string; event?: string };
}

/** Window event name format for per-app "new" actions. */
export const NEW_EVENT_PREFIX = "workwrk:os:new:";

/** Helper: build a sidebar component from a static link list. */
function linksSidebar(
  links: Array<{ href: string; label: string; Icon: LucideIcon }>,
): React.ComponentType {
  function Sidebar() {
    return (
      <ul>
        {links.map((l) => (
          <NavItem key={l.href} href={l.href} label={l.label} Icon={l.Icon} />
        ))}
      </ul>
    );
  }
  return Sidebar;
}

/* ───────────────────────── shared sidebar primitives ───────────────────────── */

function NavItem({
  href, label, Icon, active, badge,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active?: boolean;
  badge?: string | number;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-2 py-1 rounded-md text-[13px] ${
        active ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0 text-zinc-500" />
      <span className="truncate flex-1">{label}</span>
      {badge !== undefined ? <span className="text-[10px] text-zinc-500">{badge}</span> : null}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1.5 mt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-3 py-6 text-center">
      <div className="text-[12px] font-medium text-zinc-700">{title}</div>
      {body ? <div className="text-[11px] text-zinc-500 mt-1">{body}</div> : null}
    </div>
  );
}

/* ───────────────────────── Home sidebar (Inbox / My Tasks / Favorites / Spaces) ───────────────────────── */

interface SpaceRow {
  id: string;
  slug: string;
  name: string;
  visibility: "PRIVATE" | "WORKSPACE" | "ORG";
}

/** Default order if /api/preferences isn't loaded yet or the user hasn't customised. */
const DEFAULT_SECTIONS_ORDER: string[] = ["favorites", "spaces"];

function HomeSidebar() {
  const pathname = usePathname() || "";
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [sectionsOrder, setSectionsOrder] = useState<string[]>(DEFAULT_SECTIONS_ORDER);

  // The sidebar header "+" dispatches `workwrk:os:new:home-new-space`
  // when Home is active — open the NewSpaceDialog in response.
  useEffect(() => {
    const onNew = () => setNewSpaceOpen(true);
    window.addEventListener("workwrk:os:new:home-new-space", onNew);
    return () => window.removeEventListener("workwrk:os:new:home-new-space", onNew);
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/spaces", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setSpaces(Array.isArray(data.spaces) ? data.spaces : []);
    } catch {}
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Subscribe to /api/preferences for sectionsOrder. Updates live when
  // CustomizePanel saves (dispatches workwrk:prefs-changed).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/preferences", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const next = data?.effective?.sidebar?.sectionsOrder;
        if (alive && Array.isArray(next)) setSectionsOrder(next);
      } catch {}
    };
    void load();
    const onChange = () => void load();
    window.addEventListener("workwrk:prefs-changed", onChange);
    return () => {
      alive = false;
      window.removeEventListener("workwrk:prefs-changed", onChange);
    };
  }, []);

  const renderFavorites = () => (
    <div key="favorites">
      <button
        type="button"
        onClick={() => setFavoritesOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1.5 mt-2 text-[13px] font-medium w-full text-zinc-700 hover:text-zinc-900"
      >
        {favoritesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>Favorites</span>
      </button>
      {favoritesOpen ? (
        <div className="px-2 py-1 text-[11px] text-zinc-400">No favorites yet.</div>
      ) : null}
    </div>
  );

  const renderSpaces = () => (
    <div key="spaces">
      <div className="flex items-center gap-2 px-2 py-1.5 mt-1">
        <span className="text-[13px] font-medium flex-1 text-zinc-700">Spaces</span>
        <button
          type="button"
          onClick={() => setNewSpaceOpen(true)}
          className="p-0.5 rounded text-zinc-500 hover:bg-zinc-100"
          aria-label="New space"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
      <ul>
        {spaces.map((s) => {
          const isActive = pathname === `/spaces/${s.slug}`;
          return (
            <li key={s.id}>
              <Link
                href={`/spaces/${s.slug}`}
                className={`flex items-center gap-2.5 px-2 py-1 rounded-md text-[13px] ${
                  isActive ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {s.visibility === "PRIVATE" ? (
                  <Lock className="w-3.5 h-3.5 text-zinc-500" />
                ) : (
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                )}
                <span className="truncate flex-1">{s.name}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setNewSpaceOpen(true)}
            className="w-full flex items-center gap-2.5 px-2 py-1 rounded-md text-[13px] text-zinc-500 hover:bg-zinc-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Space</span>
          </button>
        </li>
      </ul>
    </div>
  );

  return (
    <>
      <ul>
        <NavItem href="/inbox" Icon={Inbox} label="Inbox" active={pathname.startsWith("/inbox")} />
        <NavItem href="/inbox?assigned-comments" Icon={MessageSquare} label="Assigned Comments" />
        <NavItem href="/tasks" Icon={CheckSquare} label="My Tasks" active={pathname === "/tasks"} />
        <NavItem href="/spaces" Icon={ListChecks} label="All Tasks" active={pathname === "/spaces"} />
        <NavItem href="#" Icon={MoreHorizontal} label="More" />
      </ul>

      {/* Sections rendered in user's preferred order; hidden ones omitted. */}
      {sectionsOrder.map((key) => {
        if (key === "favorites") return renderFavorites();
        if (key === "spaces") return renderSpaces();
        return null;
      })}

      <NewSpaceDialog
        open={newSpaceOpen}
        onOpenChange={setNewSpaceOpen}
        onCreated={() => void reload()}
      />
    </>
  );
}

/* ───────────────────────── Planner sidebar ───────────────────────── */

function PlannerSidebar() {
  return (
    <div className="px-3 pt-2">
      <div className="flex flex-col items-center text-center py-6">
        <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center mb-3">
          <Calendar className="w-6 h-6 text-zinc-500" />
        </div>
        <div className="text-sm text-zinc-700">
          Connect your calendar to view upcoming events and join your next call
        </div>
      </div>
      <button
        type="button"
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-zinc-200 hover:bg-zinc-50 text-sm mb-2"
      >
        <span className="w-5 h-5 rounded bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">31</span>
        <span className="flex-1 text-left">Google Calendar</span>
        <span className="text-xs text-zinc-500">Connect</span>
      </button>
      <button
        type="button"
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-zinc-200 hover:bg-zinc-50 text-sm"
      >
        <span className="w-5 h-5 rounded bg-sky-600 text-white text-[10px] font-bold flex items-center justify-center">O</span>
        <span className="flex-1 text-left">Microsoft Outlook</span>
        <span className="text-xs text-zinc-500">Connect</span>
      </button>
    </div>
  );
}

/* ───────────────────────── AI sidebar ───────────────────────── */

function AiSidebar() {
  return (
    <ul>
      <NavItem href="/sidekick" Icon={Sparkles} label="Ask Sidekick" />
      <NavItem href="/sidekick/history" Icon={MessageSquare} label="History" />
      <NavItem href="/sidekick/prompts" Icon={FileText} label="Prompts" />
      <NavItem href="/agents" Icon={Sparkles} label="Agents" />
    </ul>
  );
}

/* ───────────────────────── Teams sidebar ───────────────────────── */

function TeamsSidebar() {
  const pathname = usePathname() || "";
  return (
    <>
      <ul>
        <NavItem href="/team/alignment" Icon={Users} label="Alignment" active={pathname === "/team/alignment"} />
        <NavItem href="/team/reviews" Icon={ClipboardCheck} label="Reviews" active={pathname === "/team/reviews"} />
        <NavItem href="/team/rollup" Icon={BarChart3} label="Rollup" active={pathname === "/team/rollup"} />
      </ul>
      <SectionLabel>People</SectionLabel>
      <ul>
        <NavItem href="/people" Icon={Users} label="Directory" />
        <NavItem href="/organization" Icon={Building2} label="Org chart" />
        <NavItem href="/kra-kpi" Icon={Star} label="KRA & KPI" />
      </ul>
    </>
  );
}

/* ───────────────────────── Docs sidebar ───────────────────────── */

function DocsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/docs" Icon={FileText} label="All Docs" />
        <NavItem href="/docs?mine=1" Icon={FileText} label="My Docs" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Doc to see it here" />
    </>
  );
}

/* ───────────────────────── Dashboards sidebar ───────────────────────── */

function DashboardsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/dashboard" Icon={BarChart3} label="All Dashboards" />
        <NavItem href="/dashboard?mine=1" Icon={BarChart3} label="My Dashboards" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Dashboard to see it here" />
    </>
  );
}

/* ───────────────────────── Whiteboards sidebar ───────────────────────── */

function WhiteboardsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/whiteboards" Icon={Brush} label="All Whiteboards" />
        <NavItem href="/whiteboards?mine=1" Icon={Brush} label="My Whiteboards" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Whiteboard to see it here" />
    </>
  );
}

/* ───────────────────────── Forms sidebar ───────────────────────── */

function FormsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/forms" Icon={ClipboardCheck} label="All Forms" />
        <NavItem href="/forms?mine=1" Icon={ClipboardCheck} label="My Forms" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Form to see it here" />
    </>
  );
}

/* ───────────────────────── Clips sidebar ───────────────────────── */

function ClipsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/notetaker" Icon={Video} label="All Clips" />
        <NavItem href="/notetaker?mine=1" Icon={Video} label="My Clips" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Clip to see it here" />
    </>
  );
}

/* ───────────────────────── Goals sidebar ───────────────────────── */

function GoalsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/okrs" Icon={Trophy} label="All Goals" />
        <NavItem href="/okrs?mine=1" Icon={Trophy} label="My Goals" />
      </ul>
      <SectionLabel>Favorites</SectionLabel>
      <EmptyState title="Star a Goal to see it here" />
    </>
  );
}

/* ───────────────────────── Timesheets sidebar ───────────────────────── */

function TimesheetsSidebar() {
  return (
    <>
      <ul>
        <NavItem href="/timesheets" Icon={Clock} label="My Timesheets" />
        <NavItem href="/time-off" Icon={Calendar} label="Time off" />
      </ul>
      <SectionLabel>Approvals</SectionLabel>
      <EmptyState title="No pending approvals" />
    </>
  );
}

/* ───────────────────────── catalog ─────────────────────────
 * Apps are grouped by `category` for the More popover. `defaultPinned`
 * decides which icons render in the rail for new users; users override
 * via the More popover's pin toggles (persisted to localStorage).
 *
 * Adding a new app:
 *   1. add an entry below — set category + defaultPinned
 *   2. its Sidebar is the linksSidebar helper for simple link lists
 *   3. matchPaths is what makes route-based auto-select work
 */

export const APPS: AppEntry[] = [
  // ── Core (always pinned by default) ──────────────────────────
  { key: "home", label: "Home", Icon: Home, defaultHref: "/today",
    matchPaths: ["/today", "/inbox", "/tasks", "/spaces", "/activity", "/favorites", "/files"],
    Sidebar: HomeSidebar, category: "Core", defaultPinned: true, alwaysPinned: true,
    newAction: { label: "New Space", event: "home-new-space" } },
  { key: "planner", label: "Planner", Icon: Calendar, defaultHref: "/planner",
    matchPaths: ["/planner", "/calendar"], Sidebar: PlannerSidebar,
    category: "Core", defaultPinned: true },
  { key: "ai", label: "AI", Icon: BloomMark, defaultHref: "/sidekick",
    matchPaths: ["/sidekick", "/agents"], Sidebar: AiSidebar,
    category: "Core", defaultPinned: true },
  { key: "teams", label: "Teams", Icon: Users, defaultHref: "/team/alignment",
    matchPaths: ["/team", "/people", "/organization", "/kra-kpi"],
    Sidebar: TeamsSidebar, category: "Core", defaultPinned: true },
  { key: "docs", label: "Docs", Icon: FileText, defaultHref: "/docs",
    matchPaths: ["/docs"], Sidebar: DocsSidebar, category: "Core", defaultPinned: true,
    newAction: { label: "New Doc", href: "/docs?new=1" } },
  { key: "dashboards", label: "Dashboa..", Icon: BarChart3, defaultHref: "/dashboard",
    matchPaths: ["/dashboard"], Sidebar: DashboardsSidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "New Dashboard", href: "/dashboard?new=1" } },
  { key: "whiteboards", label: "Whitebo..", Icon: Brush, defaultHref: "/whiteboards",
    matchPaths: ["/whiteboards"], Sidebar: WhiteboardsSidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "New Whiteboard", href: "/whiteboards?new=1" } },
  { key: "forms", label: "Forms", Icon: ClipboardCheck, defaultHref: "/forms",
    matchPaths: ["/forms"], Sidebar: FormsSidebar, category: "Core", defaultPinned: true,
    newAction: { label: "New Form", href: "/forms?new=1" } },
  { key: "clips", label: "Clips", Icon: Video, defaultHref: "/notetaker",
    matchPaths: ["/notetaker", "/clips"], Sidebar: ClipsSidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "Record clip", href: "/notetaker?new=1" } },
  { key: "goals", label: "Goals", Icon: Trophy, defaultHref: "/okrs",
    matchPaths: ["/okrs", "/goals"], Sidebar: GoalsSidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "New Goal", href: "/okrs?new=1" } },
  { key: "timesheets", label: "Timeshe..", Icon: Clock, defaultHref: "/timesheets",
    matchPaths: ["/timesheets", "/time-off"], Sidebar: TimesheetsSidebar,
    category: "Core", defaultPinned: true,
    newAction: { label: "Log time", href: "/timesheets?new=1" } },

  // ── Sales (off by default) ──────────────────────────────────
  { key: "crm", label: "CRM", Icon: TrendingUp, defaultHref: "/crm",
    matchPaths: ["/crm"], category: "Sales",
    Sidebar: linksSidebar([
      { href: "/crm",            label: "CRM hub",    Icon: TrendingUp },
      { href: "/crm/leads",      label: "Leads",      Icon: UserCheck },
      { href: "/crm/accounts",   label: "Accounts",   Icon: Building2 },
      { href: "/crm/pipeline",   label: "Pipeline",   Icon: Workflow },
      { href: "/crm/activities", label: "Activities", Icon: MessageSquare },
      { href: "/crm/reports",    label: "Reports",    Icon: FileBarChart },
    ]) },

  // ── Marketing ───────────────────────────────────────────────
  { key: "marketing", label: "Marketing", Icon: Megaphone, defaultHref: "/marketing",
    matchPaths: ["/marketing"], category: "Marketing",
    Sidebar: linksSidebar([
      { href: "/marketing",           label: "Marketing hub", Icon: Megaphone },
      { href: "/marketing/campaigns", label: "Campaigns",     Icon: TrendingUp },
      { href: "/marketing/content",   label: "Content",       Icon: FileText },
      { href: "/marketing/events",    label: "Events",        Icon: Calendar },
    ]) },

  // ── Service ─────────────────────────────────────────────────
  { key: "helpdesk", label: "Helpdesk", Icon: LifeBuoy, defaultHref: "/helpdesk",
    matchPaths: ["/helpdesk"], category: "Service",
    Sidebar: linksSidebar([
      { href: "/helpdesk",           label: "Helpdesk",         Icon: LifeBuoy },
      { href: "/helpdesk/tickets",   label: "Helpdesk tickets", Icon: ClipboardList },
      { href: "/helpdesk/customers", label: "Customers",        Icon: Users },
    ]) },
  { key: "itsm", label: "ITSM", Icon: Server, defaultHref: "/itsm",
    matchPaths: ["/itsm", "/process-runs"], category: "Service",
    Sidebar: linksSidebar([
      { href: "/itsm",           label: "ITSM hub",        Icon: Server },
      { href: "/itsm/incidents", label: "Incidents",       Icon: AlertTriangle },
      { href: "/itsm/tickets",   label: "Service tickets", Icon: ClipboardList },
      { href: "/itsm/problems",  label: "Problems",        Icon: AlertTriangle },
      { href: "/itsm/changes",   label: "Changes",         Icon: Workflow },
      { href: "/itsm/cmdb",      label: "CMDB",            Icon: Database },
      { href: "/itsm/kb",        label: "Knowledge base",  Icon: BookOpen },
      { href: "/process-runs",   label: "Process runs",    Icon: Workflow },
    ]) },

  // ── People & HR ─────────────────────────────────────────────
  { key: "recruiting", label: "Recruiting", Icon: UserCheck, defaultHref: "/recruiting",
    matchPaths: ["/recruiting"], category: "People",
    Sidebar: linksSidebar([
      { href: "/recruiting",            label: "Recruiting",      Icon: UserCheck },
      { href: "/recruiting/jobs",       label: "Jobs",            Icon: Briefcase },
      { href: "/recruiting/candidates", label: "Candidates",      Icon: Users },
      { href: "/recruiting/pipeline",   label: "Hiring pipeline", Icon: Workflow },
      { href: "/recruiting/interviews", label: "Interviews",      Icon: MessageSquare },
    ]) },
  { key: "onboarding", label: "Onboarding", Icon: HeartHandshake, defaultHref: "/onboarding",
    matchPaths: ["/onboarding"], category: "People",
    Sidebar: linksSidebar([
      { href: "/onboarding", label: "Onboarding", Icon: HeartHandshake },
    ]) },
  { key: "reviews", label: "Reviews", Icon: ClipboardCheck, defaultHref: "/reviews",
    matchPaths: ["/reviews"], category: "People",
    Sidebar: linksSidebar([
      { href: "/reviews", label: "Reviews", Icon: ClipboardCheck },
      { href: "/talent",  label: "Talent (9-box)", Icon: Award },
    ]) },
  { key: "candor", label: "Candor", Icon: MessageSquare, defaultHref: "/candor",
    matchPaths: ["/candor"], category: "People",
    Sidebar: linksSidebar([{ href: "/candor", label: "Candor", Icon: MessageSquare }]) },
  { key: "announcements", label: "Announce..", Icon: Megaphone, defaultHref: "/announcements",
    matchPaths: ["/announcements"], category: "People",
    Sidebar: linksSidebar([{ href: "/announcements", label: "Announcements", Icon: Megaphone }]) },
  { key: "kudos", label: "Kudos", Icon: ThumbsUp, defaultHref: "/kudos",
    matchPaths: ["/kudos"], category: "People",
    Sidebar: linksSidebar([{ href: "/kudos", label: "Kudos", Icon: ThumbsUp }]) },
  { key: "surveys", label: "Surveys", Icon: FileSpreadsheet, defaultHref: "/surveys",
    matchPaths: ["/surveys"], category: "People",
    Sidebar: linksSidebar([{ href: "/surveys", label: "Surveys", Icon: FileSpreadsheet }]) },

  // ── Time & Pay ──────────────────────────────────────────────
  { key: "time-off", label: "Time off", Icon: Calendar, defaultHref: "/time-off",
    matchPaths: ["/time-off"], category: "Time & Pay",
    Sidebar: linksSidebar([{ href: "/time-off", label: "Time off", Icon: Calendar }]) },
  { key: "payroll", label: "Payroll", Icon: Coins, defaultHref: "/payroll",
    matchPaths: ["/payroll"], category: "Time & Pay",
    Sidebar: linksSidebar([
      { href: "/payroll",      label: "Payroll",  Icon: Coins },
      { href: "/payroll/runs", label: "Pay runs", Icon: Workflow },
    ]) },
  { key: "benefits", label: "Benefits", Icon: HeartHandshake, defaultHref: "/benefits",
    matchPaths: ["/benefits"], category: "Time & Pay",
    Sidebar: linksSidebar([{ href: "/benefits", label: "Benefits", Icon: HeartHandshake }]) },
  { key: "expenses", label: "Expenses", Icon: Receipt, defaultHref: "/expenses",
    matchPaths: ["/expenses"], category: "Time & Pay",
    Sidebar: linksSidebar([{ href: "/expenses", label: "Expenses", Icon: Receipt }]) },
  { key: "compensation", label: "Compen..", Icon: Coins, defaultHref: "/compensation",
    matchPaths: ["/compensation"], category: "Time & Pay",
    Sidebar: linksSidebar([{ href: "/compensation", label: "Compensation", Icon: Coins }]) },

  // ── Finance ─────────────────────────────────────────────────
  { key: "financials", label: "Financ..", Icon: BarChart3, defaultHref: "/financials",
    matchPaths: ["/financials"], category: "Finance",
    Sidebar: linksSidebar([
      { href: "/financials",            label: "Financials hub",  Icon: BarChart3 },
      { href: "/financials/accounts",   label: "GL accounts",     Icon: Database },
      { href: "/financials/entries",    label: "Journal entries", Icon: FileText },
      { href: "/financials/statements", label: "Statements",      Icon: FileBarChart },
      { href: "/financials/calendar",   label: "Periods",         Icon: Calendar },
    ]) },
  { key: "planning", label: "Planning", Icon: TrendingDown, defaultHref: "/planning",
    matchPaths: ["/planning"], category: "Finance",
    Sidebar: linksSidebar([
      { href: "/planning/plans",    label: "Budget plans", Icon: ClipboardList },
      { href: "/planning/variance", label: "Variance",     Icon: TrendingDown },
    ]) },
  { key: "procurement", label: "Procure..", Icon: ShoppingBag, defaultHref: "/procurement",
    matchPaths: ["/procurement"], category: "Finance",
    Sidebar: linksSidebar([
      { href: "/procurement/pos",      label: "Purchase orders", Icon: ShoppingBag },
      { href: "/procurement/invoices", label: "Invoices",        Icon: Receipt },
      { href: "/procurement/vendors",  label: "Vendors",         Icon: Building2 },
    ]) },
  { key: "assets", label: "Assets", Icon: Boxes, defaultHref: "/assets",
    matchPaths: ["/assets"], category: "Finance",
    Sidebar: linksSidebar([{ href: "/assets", label: "Assets", Icon: Boxes }]) },

  // ── Dev ─────────────────────────────────────────────────────
  { key: "dev", label: "Dev", Icon: Code2, defaultHref: "/dev",
    matchPaths: ["/dev"], category: "Dev",
    Sidebar: linksSidebar([
      { href: "/dev",          label: "Dev hub",  Icon: Code2 },
      { href: "/dev/sprints",  label: "Sprints",  Icon: Workflow },
      { href: "/dev/releases", label: "Releases", Icon: Boxes },
      { href: "/dev/roadmap",  label: "Roadmap",  Icon: TrendingUp },
    ]) },

  // ── Knowledge ───────────────────────────────────────────────
  { key: "sops", label: "SOPs", Icon: ScrollText, defaultHref: "/sops",
    matchPaths: ["/sops"], category: "Knowledge",
    Sidebar: linksSidebar([
      { href: "/sops",            label: "All SOPs",   Icon: ScrollText },
      { href: "/sops/my-sops",    label: "My SOPs",    Icon: ScrollText },
      { href: "/sops/compliance", label: "Compliance", Icon: ShieldCheck },
    ]) },
  { key: "policies", label: "Policies", Icon: ShieldCheck, defaultHref: "/policies",
    matchPaths: ["/policies"], category: "Knowledge",
    Sidebar: linksSidebar([{ href: "/policies", label: "Policies", Icon: ShieldCheck }]) },
  { key: "legal", label: "Legal", Icon: Gavel, defaultHref: "/legal",
    matchPaths: ["/legal"], category: "Knowledge",
    Sidebar: linksSidebar([
      { href: "/legal",           label: "Legal hub", Icon: Gavel },
      { href: "/legal/contracts", label: "Contracts", Icon: FileText },
      { href: "/legal/ip",        label: "IP",        Icon: Lightbulb },
      { href: "/legal/privacy",   label: "Privacy",   Icon: ShieldCheck },
    ]) },
  { key: "learning", label: "Learning", Icon: GraduationCap, defaultHref: "/learning",
    matchPaths: ["/learning"], category: "Knowledge",
    Sidebar: linksSidebar([
      { href: "/learning/catalog", label: "Catalog",    Icon: BookOpen },
      { href: "/learning/mine",    label: "My courses", Icon: GraduationCap },
      { href: "/learning/manage",  label: "Manage",     Icon: SettingsIcon },
    ]) },
  { key: "brand", label: "Brand", Icon: Palette, defaultHref: "/brand-guide",
    matchPaths: ["/brand-guide"], category: "Knowledge",
    Sidebar: linksSidebar([{ href: "/brand-guide", label: "Brand guide", Icon: Palette }]) },

  // ── Build & Extend ──────────────────────────────────────────
  { key: "build", label: "Build", Icon: Wrench, defaultHref: "/build",
    matchPaths: ["/build"], category: "Build & Extend",
    Sidebar: linksSidebar([{ href: "/build", label: "Build apps", Icon: Wrench }]) },
  { key: "studio", label: "Studio", Icon: Palette, defaultHref: "/studio",
    matchPaths: ["/studio"], category: "Build & Extend",
    Sidebar: linksSidebar([{ href: "/studio", label: "Studio", Icon: Palette }]) },
  { key: "tools", label: "Tools", Icon: HardDrive, defaultHref: "/tools",
    matchPaths: ["/tools"], category: "Build & Extend",
    Sidebar: linksSidebar([{ href: "/tools", label: "Tools", Icon: HardDrive }]) },
  { key: "store", label: "Marketp..", Icon: ShoppingBag, defaultHref: "/store",
    matchPaths: ["/store"], category: "Build & Extend",
    Sidebar: linksSidebar([{ href: "/store", label: "Marketplace", Icon: ShoppingBag }]) },

  // ── Workspace ───────────────────────────────────────────────
  { key: "settings", label: "Settings", Icon: SettingsIcon, defaultHref: "/settings",
    matchPaths: ["/settings", "/account"], category: "Workspace",
    Sidebar: linksSidebar([
      { href: "/settings",         label: "Workspace settings", Icon: SettingsIcon },
      { href: "/account/security", label: "Account · Security", Icon: ShieldCheck },
    ]) },
];

/** Apps to render in the rail when the user hasn't customised yet. */
export const DEFAULT_PINNED_KEYS: string[] = APPS.filter((a) => a.defaultPinned).map((a) => a.key);

/** Apps that must always appear in the rail regardless of user prefs. */
export const ALWAYS_PINNED_KEYS: string[] = APPS.filter((a) => a.alwaysPinned).map((a) => a.key);

export function isAlwaysPinned(key: string): boolean {
  return ALWAYS_PINNED_KEYS.includes(key);
}

/** Apps shown in the More popover (everything except the More tile itself). */
export const CATALOG_APPS: AppEntry[] = APPS.filter((a) => !a.hideFromCatalog);

/** Stable category order in the More popover. */
export const CATEGORY_ORDER: string[] = [
  "Core", "Sales", "Marketing", "Service", "People", "Time & Pay",
  "Finance", "Dev", "Knowledge", "Build & Extend", "Workspace",
];

export function findAppForPath(pathname: string): AppEntry | undefined {
  return APPS.find((a) =>
    a.matchPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`)),
  );
}

export function getApp(key: string): AppEntry | undefined {
  return APPS.find((a) => a.key === key);
}
