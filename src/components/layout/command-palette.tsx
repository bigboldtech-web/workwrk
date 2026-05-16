"use client";

// Cmd-K / Ctrl-K global navigation palette. Mirrors Workday's
// search-driven nav (their #1 power-user pattern). For v1 it covers
// every sidebar destination plus a small set of quick actions; data
// search (people / SOPs / tasks by name) lands in v2 once we have a
// unified search endpoint.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useRole } from "@/hooks/use-role";
import { getRecent, getPinned, subscribeSidebarPrefs } from "@/lib/sidebar-prefs";
import {
  LayoutDashboard, Inbox as InboxIcon, Megaphone, Users, Building2, Target,
  CalendarDays, BookOpen, ListChecks, Star, MessageSquare, BarChart3,
  GraduationCap, Heart, Lightbulb, Crosshair, Grid3x3, ClipboardCheck,
  MessageSquareHeart, Shield, Package, Activity, Wrench, Link2, Bot,
  Settings, FileText, Plus, UserPlus, Search, Receipt, DollarSign, CalendarOff, Clock, Briefcase, ShoppingCart,
  Pin, History, User as UserIcon, Hash,
} from "lucide-react";

/**
 * Shape returned by `/api/search` — flat array of typed hits with a
 * canonical `href` per kind. The palette renders each as a Command.Item.
 */
type SearchHit = {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

// Icon per result kind. New kinds fall through to Hash for visual
// consistency; nothing breaks if /api/search returns a new type.
const HIT_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  person: UserIcon,
  task: CalendarDays,
  sop: BookOpen,
  department: Building2,
  meeting: MessageSquare,
  okr: Crosshair,
  idea: Lightbulb,
  expense: Receipt,
  vendor: ShoppingCart,
  po: ShoppingCart,
  job: Briefcase,
  candidate: UserPlus,
  policy: Shield,
  announcement: Megaphone,
  glAccount: DollarSign,
  plan: BarChart3,
};

type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  // Visibility predicate evaluated against role flags. Defaults to "always".
  visible?: (role: { isManager: boolean; isAdmin: boolean }) => boolean;
};

const NAV: CommandItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { id: "inbox", label: "Inbox", href: "/inbox", icon: InboxIcon },
  { id: "announcements", label: "Announcements", href: "/announcements", icon: Megaphone },
  { id: "people", label: "People", href: "/people", icon: Users, visible: (r) => r.isManager },
  { id: "organization", label: "Organization", href: "/organization", icon: Building2 },
  { id: "kraKpi", label: "KRA & KPIs", href: "/kra-kpi", icon: Target },
  { id: "tasks", label: "Work Calendar", href: "/tasks", icon: CalendarDays },
  { id: "expenses", label: "Expenses", href: "/expenses", icon: Receipt },
  { id: "compensation", label: "Compensation", href: "/compensation", icon: DollarSign, visible: (r) => r.isManager },
  { id: "timeOff", label: "Time off", href: "/time-off", icon: CalendarOff },
  { id: "timesheets", label: "Timesheets", href: "/timesheets", icon: Clock },
  { id: "recruiting", label: "Recruiting", href: "/recruiting", icon: Briefcase, visible: (r) => r.isManager },
  { id: "procurement", label: "Procurement", href: "/procurement", icon: ShoppingCart, visible: (r) => r.isManager },
  { id: "learning", label: "Learning", href: "/learning", icon: GraduationCap },
  { id: "workforcePlanning", label: "Workforce Planning", href: "/workforce-planning", icon: Target, visible: (r) => r.isManager },
  { id: "sops", label: "SOPs", href: "/sops", icon: BookOpen },
  { id: "processRuns", label: "Process Runs", href: "/process-runs", icon: ListChecks, visible: (r) => r.isManager },
  { id: "reviews", label: "Reviews", href: "/reviews", icon: Star },
  { id: "meetings", label: "Meetings", href: "/meetings", icon: MessageSquare },
  { id: "analytics", label: "Analytics", href: "/analytics", icon: BarChart3, visible: (r) => r.isManager },
  { id: "onboarding", label: "Onboarding", href: "/onboarding", icon: GraduationCap, visible: (r) => r.isManager },
  { id: "kudos", label: "Kudos", href: "/kudos", icon: Heart },
  { id: "ideas", label: "Ideas", href: "/ideas", icon: Lightbulb },
  { id: "okrs", label: "OKRs", href: "/okrs", icon: Crosshair },
  { id: "talent", label: "Talent Grid", href: "/talent", icon: Grid3x3, visible: (r) => r.isManager },
  { id: "surveys", label: "Surveys", href: "/surveys", icon: ClipboardCheck },
  { id: "candor", label: "Candor", href: "/candor", icon: MessageSquareHeart },
  { id: "policies", label: "Policies", href: "/policies", icon: Shield },
  { id: "assets", label: "Assets", href: "/assets", icon: Package, visible: (r) => r.isManager },
  { id: "activity", label: "Activity", href: "/activity", icon: Activity },
  { id: "tools", label: "Tools", href: "/tools", icon: Wrench, visible: (r) => r.isManager },
  { id: "integrations", label: "Integrations", href: "/integrations", icon: Link2, visible: (r) => r.isAdmin },
  { id: "ai", label: "AI Assistant", href: "/ai", icon: Bot, visible: (r) => r.isManager },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings },
  { id: "tags", label: "Tags & dimensions", href: "/settings/tags", icon: Settings, visible: (r) => r.isAdmin },
  { id: "identity", label: "Identity & SSO", href: "/settings/identity", icon: Settings, visible: (r) => r.isAdmin },
  { id: "audit", label: "Audit trail", href: "/settings/audit", icon: Settings, visible: (r) => r.isManager },
  { id: "docs", label: "Docs", href: "/docs", icon: FileText },
];

const QUICK_ACTIONS: CommandItem[] = [
  { id: "new-task", label: "Create task", hint: "go to calendar", href: "/tasks?create=1", icon: Plus },
  { id: "new-expense", label: "Submit expense", hint: "open expenses", href: "/expenses?create=1", icon: Receipt },
  { id: "request-time-off", label: "Request time off", hint: "open time off", href: "/time-off?create=1", icon: CalendarOff },
  { id: "clock-in", label: "Clock in / out", hint: "open timesheet", href: "/timesheets", icon: Clock },
  { id: "add-candidate", label: "Add candidate", hint: "open recruiting", href: "/recruiting", icon: Briefcase, visible: (r) => r.isManager },
  { id: "new-sop", label: "Create SOP", hint: "go to SOPs", href: "/sops?create=1", icon: Plus, visible: (r) => r.isManager },
  { id: "invite-person", label: "Invite a person", hint: "open people directory", href: "/people?invite=1", icon: UserPlus, visible: (r) => r.isManager },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { isManager, isAdmin } = useRole();

  // Global keybinding. Cmd-K on mac, Ctrl-K elsewhere. Don't fire when
  // a contenteditable / input has focus — typing in the SOP editor
  // shouldn't open the palette. Esc closes when open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "k" && e.key !== "K") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        target?.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      ) {
        return;
      }
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll while open so the page underneath doesn't drift.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  const role = useMemo(() => ({ isManager, isAdmin }), [isManager, isAdmin]);

  const visibleNav = NAV.filter((i) => !i.visible || i.visible(role));
  const visibleActions = QUICK_ACTIONS.filter((i) => !i.visible || i.visible(role));

  // Pinned + recent items hoist into their own groups at the top of the
  // palette so power users land on what they touch most without typing.
  // Sourced from the sidebar-prefs store; keys map to NAV entries.
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => {
      setPinnedKeys(getPinned());
      setRecentKeys(getRecent());
    };
    sync();
    return subscribeSidebarPrefs(sync);
  }, []);
  const navById = useMemo(() => {
    const m = new Map<string, CommandItem>();
    for (const item of visibleNav) m.set(item.id, item);
    return m;
  }, [visibleNav]);
  const pinnedItems = pinnedKeys.map((k) => navById.get(k)).filter((x): x is CommandItem => !!x);
  const recentItems = recentKeys
    .filter((k) => !pinnedKeys.includes(k))
    .map((k) => navById.get(k))
    .filter((x): x is CommandItem => !!x)
    .slice(0, 5);

  const onSelect = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  // ── Live entity search ──────────────────────────────────────────────
  // Drives the "Search results" group in the palette. Debounced so a
  // fast typist doesn't N+1 the search endpoint; aborts in-flight
  // requests when a newer keystroke supersedes them so stale results
  // never overwrite fresh ones.
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setSearching(false);
      if (abortRef.current) abortRef.current.abort();
      return;
    }
    const timer = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setSearching(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: ctl.signal,
          cache: "no-store",
        });
        if (!r.ok) return;
        const d = await r.json();
        const list: SearchHit[] = Array.isArray(d) ? d : d?.data || [];
        setHits(list);
      } catch {
        // Aborted or network error — fail quiet; the user is typing again.
      } finally {
        setSearching(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);
  // Reset query whenever the palette closes so the next open lands clean.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="cmd-palette-overlay" onClick={() => setOpen(false)} role="presentation">
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <Command label="Command palette" className="cmd-palette-cmd" loop>
          <div className="cmd-palette-input-row">
            <Search size={14} className="cmd-palette-input-icon" aria-hidden />
            <Command.Input
              placeholder="Search anything — people, tasks, SOPs, OKRs, expenses…"
              className="cmd-palette-input"
              autoFocus
              value={query}
              onValueChange={setQuery}
            />
            <kbd className="cmd-palette-kbd">esc</kbd>
          </div>
          <Command.List className="cmd-palette-list">
            <Command.Empty className="cmd-palette-empty">
              {searching ? "Searching…" : "No matches."}
            </Command.Empty>

            {hits.length > 0 && (
              <Command.Group heading="Search results" className="cmd-palette-group">
                {hits.map((h) => {
                  const Icon = HIT_ICONS[h.type] ?? Hash;
                  return (
                    <Command.Item
                      key={`hit-${h.type}-${h.id}`}
                      // Include the title so cmdk's substring matcher keeps
                      // ranking correctly even as the user keeps typing past
                      // the server response.
                      value={`hit ${h.title} ${h.subtitle ?? ""} ${h.type}`}
                      onSelect={() => onSelect(h.href)}
                      className="cmd-palette-item"
                    >
                      <Icon size={14} />
                      <span className="cmd-palette-label">{h.title}</span>
                      {h.subtitle && <span className="cmd-palette-hint">{h.subtitle}</span>}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {pinnedItems.length > 0 && (
              <Command.Group heading="Pinned" className="cmd-palette-group">
                {pinnedItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={`pin-${item.id}`}
                      value={`pinned ${item.label}`}
                      onSelect={() => onSelect(item.href)}
                      className="cmd-palette-item"
                    >
                      <Pin size={12} className="cmd-palette-input-icon" />
                      <Icon size={14} />
                      <span className="cmd-palette-label">{item.label}</span>
                      <span className="cmd-palette-hint">{item.href}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {recentItems.length > 0 && (
              <Command.Group heading="Recent" className="cmd-palette-group">
                {recentItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={`recent-${item.id}`}
                      value={`recent ${item.label}`}
                      onSelect={() => onSelect(item.href)}
                      className="cmd-palette-item"
                    >
                      <History size={12} className="cmd-palette-input-icon" />
                      <Icon size={14} />
                      <span className="cmd-palette-label">{item.label}</span>
                      <span className="cmd-palette-hint">{item.href}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {visibleActions.length > 0 && (
              <Command.Group heading="Quick actions" className="cmd-palette-group">
                {visibleActions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={item.id}
                      value={`action ${item.label} ${item.hint ?? ""}`}
                      onSelect={() => onSelect(item.href)}
                      className="cmd-palette-item"
                    >
                      <Icon size={14} />
                      <span className="cmd-palette-label">{item.label}</span>
                      {item.hint && <span className="cmd-palette-hint">{item.hint}</span>}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            <Command.Group heading="Navigate" className="cmd-palette-group">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                return (
                  <Command.Item
                    key={item.id}
                    value={`nav ${item.label}`}
                    onSelect={() => onSelect(item.href)}
                    className="cmd-palette-item"
                  >
                    <Icon size={14} />
                    <span className="cmd-palette-label">{item.label}</span>
                    <span className="cmd-palette-hint">{item.href}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
