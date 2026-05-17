"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/use-role";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Menu, Sun, Moon, Pin, PinOff, Clock as ClockIcon, Search as SearchIcon, X } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { useBranding } from "@/hooks/use-branding";
import {
  getPinned,
  getRecent,
  togglePin as togglePinPref,
  trackRecent,
  subscribeSidebarPrefs,
} from "@/lib/sidebar-prefs";
import {
  LayoutDashboard,
  Users,
  Building2,
  Target,
  CalendarDays,
  BookOpen,
  Star,
  Lightbulb,
  Megaphone,
  Shield,
  Crosshair,
  Grid3x3,
  ClipboardCheck,
  MessageSquare,
  BarChart3,
  Bot,
  GraduationCap,
  Settings,
  Wrench,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LogOut,
  Link2,
  Activity,
  FileText,
  ListChecks,
  Package,
  MessageSquareHeart,
  Heart,
  Palette,
  Folder,
  Inbox,
  Receipt,
  DollarSign,
  CalendarOff,
  Clock,
  Briefcase,
  ShoppingCart,
  Banknote,
  BookText,
} from "lucide-react";

type NavItem = {
  name: string;
  key: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  moduleKey?: string;
  managerOnly?: boolean;
  adminOnly?: boolean;
  // Visible only to SUPER_ADMIN — the platform owner viewing all
  // tenants. Used for the cross-org Admin console link.
  superAdminOnly?: boolean;
  // ClickUp-style "Coming Soon" badge — shown on items whose backend
  // is wired but missing a vendor decision or a runtime piece. The
  // link still opens the page so admins can preview; the badge
  // signals "don't expect this to be production-grade yet."
  comingSoon?: boolean;
  // Each item also belongs to a section so the sidebar reads as a
  // grouped table-of-contents instead of a 40-item flat list.
  section: NavSection;
  // Per-icon hue token for the ClickUp-look colored icon chip.
  hue?: NavHue;
};

// Seven persona-driven hubs. The order here is the render order in
// the sidebar. Hubs collapse independently; defaults below.
type NavSection = "home" | "people" | "work" | "money" | "talent" | "culture" | "platform";
type NavHue = "blue" | "green" | "amber" | "violet" | "pink" | "teal" | "sky" | "rose" | "lime" | "slate";

const SECTION_ORDER: readonly NavSection[] = [
  "home", "people", "work", "money", "talent", "culture", "platform",
] as const;

// Hub labels live in messages/<locale>.json under nav.hub.* — see
// tNav("hub.<section>") at the render site. Keeping the labels
// translation-driven means new locales pick up automatically.

// One lucide icon per hub — paired with the section label in the
// collapsible header. Chosen for legibility at small sizes.
const SECTION_ICON: Record<NavSection, React.ComponentType<{ size?: number; className?: string }>> = {
  home: LayoutDashboard,
  people: Users,
  work: CalendarDays,
  money: DollarSign,
  talent: Star,
  culture: Megaphone,
  platform: Wrench,
};

// Persona-aware default expansion. IC sees the three daily-touch hubs
// open and everything else collapsed; managers gain People + Talent;
// admins gain Money + Platform. Users can override per-hub and we
// persist their choice in localStorage.
function defaultExpandedFor(role: { isAdmin: boolean; isManager: boolean }): Record<NavSection, boolean> {
  const ic = { home: true, people: false, work: true, money: false, talent: false, culture: true, platform: false };
  if (role.isAdmin) return { home: true, people: true, work: true, money: true, talent: true, culture: true, platform: true };
  if (role.isManager) return { ...ic, people: true, talent: true };
  return ic;
}

const navigation: NavItem[] = [
  // 🏠 Home — opens by default for every persona. Daily-touch entries
  // that don't fit anywhere more specific.
  { name: "Dashboard", key: "dashboard", href: "/dashboard", icon: LayoutDashboard, section: "home", hue: "blue" },
  { name: "Inbox", key: "inbox", href: "/inbox", icon: Inbox, section: "home", hue: "violet" },
  { name: "AI Assistant", key: "aiAssistant", href: "/ai", icon: Bot, moduleKey: "ai", managerOnly: true, section: "home", hue: "lime" },

  // 👥 People — the org's roster + structure. Talent (perf/comp/recruiting)
  // lives in its own hub since it's a different ceremony.
  { name: "People", key: "people", href: "/people", icon: Users, moduleKey: "people", managerOnly: true, section: "people", hue: "blue" },
  { name: "Organization", key: "organization", href: "/organization", icon: Building2, section: "people", hue: "sky" },

  // ✅ Work — daily-touch ops + cadence. Everything an IC opens during
  // a normal workday belongs here.
  { name: "Work Calendar", key: "calendar", href: "/tasks", icon: CalendarDays, moduleKey: "tasks", section: "work", hue: "blue" },
  { name: "KRA & KPIs", key: "kraKpi", href: "/kra-kpi", icon: Target, moduleKey: "kra-kpi", section: "work", hue: "rose" },
  { name: "OKRs", key: "okrs", href: "/okrs", icon: Crosshair, section: "work", hue: "violet" },
  { name: "SOPs", key: "sops", href: "/sops", icon: BookOpen, moduleKey: "sops", section: "work", hue: "teal" },
  { name: "Process Runs", key: "processRuns", href: "/process-runs", icon: ListChecks, moduleKey: "sops", managerOnly: true, section: "work", hue: "sky" },
  { name: "Meetings", key: "meetings", href: "/meetings", icon: MessageSquare, moduleKey: "meetings", section: "work", hue: "amber" },
  { name: "Time off", key: "timeOff", href: "/time-off", icon: CalendarOff, section: "work", hue: "lime" },
  { name: "Timesheets", key: "timesheets", href: "/timesheets", icon: Clock, section: "work", hue: "blue" },
  { name: "Clock in", key: "clock", href: "/clock", icon: Clock, section: "work", hue: "green" },

  // 💰 Money — anything that moves currency or plans it. Workforce
  // planning lives here (not Platform) because it's FP&A.
  { name: "Expenses", key: "expenses", href: "/expenses", icon: Receipt, section: "money", hue: "amber" },
  { name: "Procurement", key: "procurement", href: "/procurement", icon: ShoppingCart, managerOnly: true, section: "money", hue: "sky" },
  { name: "Financials", key: "financials", href: "/financials", icon: BookText, adminOnly: true, section: "money", hue: "blue" },
  { name: "Planning", key: "planning", href: "/planning", icon: Target, adminOnly: true, section: "money", hue: "violet" },
  { name: "Workforce Planning", key: "workforcePlanning", href: "/workforce-planning", icon: Target, managerOnly: true, section: "money", hue: "violet" },
  { name: "Payroll", key: "payroll", href: "/payroll", icon: Banknote, adminOnly: true, comingSoon: true, section: "money", hue: "green" },
  { name: "Benefits", key: "benefits", href: "/benefits", icon: Heart, adminOnly: true, comingSoon: true, section: "money", hue: "pink" },
  { name: "My Benefits", key: "myBenefits", href: "/my-benefits", icon: Heart, comingSoon: true, section: "money", hue: "rose" },

  // 🎯 Talent — promotion/comp/hiring/learning ceremonies. Mostly
  // manager-only; ICs see Reviews + Learning when assigned.
  { name: "Reviews", key: "reviews", href: "/reviews", icon: Star, moduleKey: "reviews", section: "talent", hue: "amber" },
  { name: "Compensation", key: "compensation", href: "/compensation", icon: DollarSign, managerOnly: true, section: "talent", hue: "green" },
  { name: "Onboarding", key: "onboarding", href: "/onboarding", icon: GraduationCap, moduleKey: "checkins", managerOnly: true, section: "talent", hue: "teal" },
  { name: "Recruiting", key: "recruiting", href: "/recruiting", icon: Briefcase, managerOnly: true, section: "talent", hue: "violet" },
  { name: "Talent Grid", key: "talentGrid", href: "/talent", icon: Grid3x3, managerOnly: true, section: "talent", hue: "rose" },
  { name: "Learning", key: "learning", href: "/learning", icon: GraduationCap, section: "talent", hue: "violet" },

  // 📣 Culture — broadcast + signal channels. Everyone sees these.
  { name: "Announcements", key: "announcements", href: "/announcements", icon: Megaphone, section: "culture", hue: "amber" },
  { name: "Kudos", key: "kudos", href: "/kudos", icon: Heart, section: "culture", hue: "pink" },
  { name: "Policies", key: "policies", href: "/policies", icon: Shield, section: "culture", hue: "rose" },
  { name: "Ideas", key: "ideas", href: "/ideas", icon: Lightbulb, section: "culture", hue: "amber" },
  { name: "Surveys", key: "surveys", href: "/surveys", icon: ClipboardCheck, section: "culture", hue: "teal" },
  { name: "Candor", key: "candor", href: "/candor", icon: MessageSquareHeart, section: "culture", hue: "pink" },

  // ⚙️ Platform — admin / configuration / observability surfaces.
  { name: "Activity", key: "activity", href: "/activity", icon: Activity, section: "platform", hue: "slate" },
  { name: "Analytics", key: "analytics", href: "/analytics", icon: BarChart3, moduleKey: "analytics", managerOnly: true, section: "platform", hue: "blue" },
  { name: "Assets", key: "assets", href: "/assets", icon: Package, managerOnly: true, section: "platform", hue: "amber" },
  { name: "Tools", key: "tools", href: "/tools", icon: Wrench, managerOnly: true, section: "platform", hue: "slate" },
  { name: "Integrations", key: "integrations", href: "/integrations", icon: Link2, adminOnly: true, section: "platform", hue: "sky" },
  { name: "Studio", key: "studio", href: "/studio", icon: Wrench, adminOnly: true, comingSoon: true, section: "platform", hue: "lime" },
  { name: "Brand Guide", key: "brandGuide", href: "/brand-guide", icon: Palette, section: "platform", hue: "pink" },
  { name: "Admin Console", key: "admin", href: "/admin", icon: Shield, superAdminOnly: true, section: "platform", hue: "rose" },
];

const bottomNav = [
  { name: "Docs", key: "docs", href: "/docs", icon: FileText },
  { name: "Settings", key: "settings", href: "/settings", icon: Settings },
];

// Maps a sidebar nav `key` to the `Notification.type` that signals
// "something new for this section." The backend already stamps these
// strings on Notification rows (see kudos/route.ts, pulse-surveys/route.ts,
// sop-assignments/route.ts).
const NAV_KEY_TO_NOTIFICATION_TYPE: Record<string, string> = {
  kudos: "KUDOS",
  surveys: "SURVEY",
  sops: "SOP",
  reviews: "REVIEW",
};

// Reverse lookup: when the pathname matches one of these, we clear that
// type's unread count (arriving at the section counts as "seeing it").
const PATH_TO_NOTIFICATION_TYPE: Record<string, string> = {
  "/kudos": "KUDOS",
  "/surveys": "SURVEY",
  "/sops": "SOP",
  "/reviews": "REVIEW",
};

// Pinned + Recent rows reuse the same look as a normal nav link, but
// always render the pin/unpin button on the right (pinned rows show
// "unpin", recent rows show "pin"). Kept as a pure function so the
// markup stays in one place.
type RenderArgs = {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  tNav: (key: string) => string;
  unreadByType: Record<string, number>;
  announcementCount: number;
  pinned: boolean;
  onTogglePin: (key: string) => void;
  isSopsEntry: boolean;
  sopsExpanded: boolean;
  setSopsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  sopFolders: unknown;
  sopFoldersLoading: boolean;
};

function renderNavLink(args: RenderArgs) {
  const { item, pathname, collapsed, tNav, unreadByType, announcementCount, pinned, onTogglePin } =
    args;
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
  const Icon = item.icon;
  const notifType = NAV_KEY_TO_NOTIFICATION_TYPE[item.key];
  const sectionUnread = notifType ? unreadByType[notifType] ?? 0 : 0;
  const announcementBadge = item.key === "announcements" ? announcementCount : 0;
  const badgeCount = sectionUnread || announcementBadge;
  const hasBadge = badgeCount > 0;

  return (
    <div key={`${pinned ? "pin" : "recent"}-${item.key}`} className="app-sidebar-link-row">
      <Link
        href={item.href}
        className={cn(
          "app-sidebar-link",
          isActive && "is-active",
          collapsed && "is-collapsed",
          item.hue && `hue-${item.hue}`,
        )}
        title={collapsed ? tNav(item.key) : undefined}
      >
        <span className="app-sidebar-icon-chip" aria-hidden>
          <Icon size={14} />
        </span>
        {!collapsed && (
          <>
            <span className="app-sidebar-label">{tNav(item.key)}</span>
            {hasBadge && (
              <span className="app-sidebar-badge">{badgeCount > 9 ? "9+" : badgeCount}</span>
            )}
            <button
              type="button"
              className={cn("app-sidebar-pin", pinned && "is-pinned")}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTogglePin(item.key);
              }}
              aria-label={pinned ? "Unpin" : "Pin"}
              title={pinned ? "Unpin from top" : "Pin to top"}
            >
              {pinned ? <PinOff size={10} /> : <Pin size={10} />}
            </button>
          </>
        )}
        {collapsed && hasBadge && <span className="app-sidebar-dot-pip" aria-hidden />}
      </Link>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [themeMounted, setThemeMounted] = useState(false);
  const tNav = useTranslations("nav");
  const { theme, resolvedTheme, setTheme } = useTheme();
  const branding = useBranding();
  // Branding is honoured only when white-label is on. We still want
  // to use the org's name (not a custom display name) for the topbar
  // tooltip even on lower plans, but the wordmark stays "workwrk"
  // unless they're paying for the rebrand.
  const showCustomBrand = !!branding?.whiteLabelEnabled;
  const wordmark = (showCustomBrand && (branding?.displayName || branding?.name)) || "workwrk";
  const logoUrl = showCustomBrand ? branding?.logo : null;

  // Hydration boundary for the theme toggle: we can't render the
  // sun/moon icon on the server because we don't know the resolved
  // theme yet, and rendering the wrong one would flash on hydrate.
  // The setState-in-effect is the standard "I'm mounted" pattern;
  // useSyncExternalStore would be more verbose here.
  useEffect(() => {
    setThemeMounted(true);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", collapsed ? "64px" : "232px");
  }, [collapsed]);

  // Close mobile drawer on route change. This IS the textbook
  // "subscribe to external state (router pathname), call setState"
  // case the rule's docs describe — but since Next exposes pathname
  // as a derived hook value rather than a subscribe API, the only
  // way to react to it is from inside an effect.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [mobileOpen]);

  // Swipe-left to close the mobile drawer. Only fires on touch and only
  // when the drawer is open. Threshold is 50px of leftward motion within
  // a single touch — short enough to feel responsive, long enough that
  // a vertical scroll inside the nav doesn't trigger an accidental close.
  const swipeStartX = React.useRef<number | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!mobileOpen) return;
    swipeStartX.current = e.touches[0]?.clientX ?? null;
  }, [mobileOpen]);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!mobileOpen || swipeStartX.current === null) return;
    const dx = (e.touches[0]?.clientX ?? swipeStartX.current) - swipeStartX.current;
    if (dx < -50) {
      swipeStartX.current = null;
      setMobileOpen(false);
    }
  }, [mobileOpen]);
  const onTouchEnd = useCallback(() => {
    swipeStartX.current = null;
  }, []);

  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);
  const [announcementCount, setAnnouncementCount] = useState(0);
  const [unreadByType, setUnreadByType] = useState<Record<string, number>>({});

  // SOPs nav entry expands to show the user's accessible folders.
  // We persist expansion in localStorage so it doesn't slam shut on
  // every route change. Folders are lazy-loaded on first expand.
  type SopFolder = {
    id: string;
    name: string;
    parentId: string | null;
    sopCountDeep?: number;
  };
  const [sopsExpanded, setSopsExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("sidebar:sopsExpanded") === "1";
  });
  const [sopFolders, setSopFolders] = useState<SopFolder[] | null>(null);
  const [sopFoldersLoading, setSopFoldersLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("sidebar:sopsExpanded", sopsExpanded ? "1" : "0");
  }, [sopsExpanded]);

  // Lazy-load SOP folders on first expand. Folded into the toggle
  // handler instead of a `useEffect([sopsExpanded])` because the load
  // is a user action, not state-sync — react-hooks/set-state-in-effect
  // (rightly) flags the latter.
  const toggleSopsExpanded = useCallback(() => {
    setSopsExpanded((wasExpanded) => {
      const willExpand = !wasExpanded;
      if (willExpand && sopFolders === null && !sopFoldersLoading) {
        setSopFoldersLoading(true);
        fetch("/api/sop-folders")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            const items = (Array.isArray(d) ? d : d?.data) as SopFolder[] | undefined;
            setSopFolders(items ?? []);
          })
          .catch(() => setSopFolders([]))
          .finally(() => setSopFoldersLoading(false));
      }
      return willExpand;
    });
  }, [sopFolders, sopFoldersLoading]);

  // Edge case: if the user reloaded with sopsExpanded=true persisted
  // in localStorage, kick the same load on first mount. Ref guard
  // ensures one-shot. We disable set-state-in-effect here because the
  // alternative (Suspense / a server prefetch) is a much bigger
  // refactor for an uncommon path.
  const sopFolderHydratedRef = React.useRef(false);
  useEffect(() => {
    if (sopFolderHydratedRef.current) return;
    if (!sopsExpanded || sopFolders !== null || sopFoldersLoading) return;
    sopFolderHydratedRef.current = true;
    setSopFoldersLoading(true);
    fetch("/api/sop-folders")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = (Array.isArray(d) ? d : d?.data) as SopFolder[] | undefined;
        setSopFolders(items ?? []);
      })
      .catch(() => setSopFolders([]))
      .finally(() => setSopFoldersLoading(false));
    // Intentionally empty deps: we only want to fire this once at mount,
    // and the ref guard above prevents re-entry. Listing the deps would
    // re-fire on every state change and double-load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data?.settings?.enabledModules) {
          setEnabledModules(data.settings.enabledModules);
        }
      })
      .catch(() => {});

    fetch("/api/announcements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = Array.isArray(d) ? d : d?.data || [];
        setAnnouncementCount(items.length);
      })
      .catch(() => {});
  }, []);

  // Poll unread-by-type so sidebar section badges (Kudos / Surveys / SOPs)
  // reflect newly-arrived notifications without a page reload. 60s cadence
  // matches the topbar notification bell.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/notifications")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d?.unreadByType) setUnreadByType(d.unreadByType);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // When the user navigates into a section with unread items, mark that
  // type as read. Fire-and-forget — the sidebar's poll picks up the new
  // zero on next tick, but we also optimistically clear locally so the
  // red dot vanishes immediately. Same caveat as the drawer-close
  // effect above: pathname is a derived value, not a subscribe API.
  useEffect(() => {
    const type = PATH_TO_NOTIFICATION_TYPE[pathname];
    if (!type) return;
    if ((unreadByType[type] ?? 0) === 0) return;
    setUnreadByType((prev) => ({ ...prev, [type]: 0 }));
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllReadOfType: type }),
    }).catch(() => {});
  }, [pathname, unreadByType]);

  const { isManager: isManagerRole, isAdmin: isAdminRole, isSuperAdmin: isSuperAdminRole } = useRole();

  const visibleNav = useMemo(
    () =>
      navigation.filter((item) => {
        if (item.superAdminOnly && !isSuperAdminRole) return false;
        if (item.adminOnly && !isAdminRole) return false;
        if (item.managerOnly && !isManagerRole) return false;
        if (item.moduleKey && enabledModules && !enabledModules.includes(item.moduleKey)) return false;
        return true;
      }),
    [isSuperAdminRole, isAdminRole, isManagerRole, enabledModules],
  );

  // Lookup by key for pinned / recent rendering — we store keys in
  // localStorage but need the full NavItem to render an icon + label.
  const byKey = useMemo(() => {
    const m = new Map<string, NavItem>();
    for (const item of visibleNav) m.set(item.key, item);
    return m;
  }, [visibleNav]);

  // Pinned + recent state, kept in sync with localStorage via the
  // subscribeSidebarPrefs event so two tabs don't drift.
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

  // Hub-expanded state. Default is persona-driven (IC sees Home/Work/
  // Culture open; managers gain People/Talent; admins see everything).
  // User overrides persist in localStorage and survive across sessions.
  // We hydrate post-mount so server-rendered markup matches what React
  // generates client-side before useEffect runs.
  const HUB_STORAGE_KEY = "sidebar.hubExpanded.v1";
  const personaDefault = useMemo(
    () => defaultExpandedFor({ isAdmin: isAdminRole, isManager: isManagerRole }),
    [isAdminRole, isManagerRole],
  );
  const [hubExpanded, setHubExpanded] = useState<Record<NavSection, boolean>>(personaDefault);
  const [hubHydrated, setHubHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(HUB_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<NavSection, boolean>>;
        // Merge stored state over the persona default so a new hub added
        // in a future release inherits the persona's preference instead
        // of collapsing silently.
        setHubExpanded({ ...personaDefault, ...parsed });
      }
    } catch {
      // Quota / private mode / bad JSON — fall back to persona default.
    }
    setHubHydrated(true);
  }, [personaDefault]);

  useEffect(() => {
    if (!hubHydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(HUB_STORAGE_KEY, JSON.stringify(hubExpanded));
    } catch {
      // Best-effort persistence.
    }
  }, [hubExpanded, hubHydrated]);

  const toggleHub = useCallback((section: NavSection) => {
    setHubExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Track route visits in the recent list. Match the pathname back to a
  // nav item by `href` (longest prefix wins so /people/[id] still maps
  // to "people").
  useEffect(() => {
    if (!pathname) return;
    let bestMatch: NavItem | null = null;
    for (const item of visibleNav) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        if (!bestMatch || item.href.length > bestMatch.href.length) bestMatch = item;
      }
    }
    if (bestMatch) trackRecent(bestMatch.key);
  }, [pathname, visibleNav]);

  // Quick filter — narrows the visible list as the user types. Sections
  // collapse to nothing when their items don't match. Pinned + Recent
  // groups are hidden while a filter is active to keep the result list
  // focused on the search.
  const [filter, setFilter] = useState("");
  const filterLc = filter.trim().toLowerCase();
  const filterMatches = useCallback(
    (item: NavItem) => {
      if (!filterLc) return true;
      const label = (() => {
        try {
          return tNav(item.key).toLowerCase();
        } catch {
          return item.name.toLowerCase();
        }
      })();
      return label.includes(filterLc) || item.name.toLowerCase().includes(filterLc);
    },
    [filterLc, tNav],
  );

  const handleTogglePin = useCallback((key: string) => {
    const next = togglePinPref(key);
    setPinnedKeys(next);
  }, []);

  // Pinned items in user-defined order.
  const pinnedItems = pinnedKeys.map((k) => byKey.get(k)).filter((x): x is NavItem => !!x);
  // Recent items, excluding any that are already pinned.
  const recentItems = recentKeys
    .filter((k) => !pinnedKeys.includes(k))
    .map((k) => byKey.get(k))
    .filter((x): x is NavItem => !!x)
    .slice(0, 5);

  return (
    <>
      {/* Mobile hamburger — only visible on small screens */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="app-mobile-trigger"
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>

      {/* Mobile scrim — click-anywhere-to-close */}
      {mobileOpen && (
        <button
          type="button"
          className="app-mobile-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

    <aside
      className={cn("app-sidebar", collapsed && "is-collapsed", mobileOpen && "is-mobile-open")}
      aria-label="Dashboard navigation"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Brand — falls through to WorkwrK defaults when white-label
          isn't enabled for this org. */}
      <div className="app-sidebar-brand">
        {!collapsed ? (
          <Link href="/dashboard" className="app-sidebar-brand-full" aria-label={`${wordmark} home`}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" width={22} height={22} className="rounded-md object-contain" />
            ) : (
              <LogoMark size={22} />
            )}
            <span className="app-sidebar-wordmark truncate">{wordmark}</span>
          </Link>
        ) : (
          <Link href="/dashboard" className="app-sidebar-brand-mini" aria-label={`${wordmark} home`}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" width={26} height={26} className="rounded-md object-contain" />
            ) : (
              <LogoMark size={26} />
            )}
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="app-sidebar-collapse"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Quick filter — narrows the visible nav as the user types. Hidden
          when the sidebar is collapsed since there's no room for the
          input + the result list collapses to chips anyway. */}
      {!collapsed && (
        <div className="app-sidebar-filter">
          <SearchIcon size={11} className="app-sidebar-filter-icon" aria-hidden />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter menu…"
            className="app-sidebar-filter-input"
            aria-label="Filter sidebar"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter("")}
              className="app-sidebar-filter-clear"
              aria-label="Clear filter"
            >
              <X size={10} />
            </button>
          )}
        </div>
      )}

      {/* Main nav — grouped into ClickUp-style sections */}
      <nav className="app-sidebar-nav">
        {/* Pinned + Recent — only when not filtering, since the filter
            view is meant to be a flat result list. */}
        {!filterLc && pinnedItems.length > 0 && (
          <div className="app-sidebar-section">
            {!collapsed && (
              <div className="app-sidebar-section-label">
                <Pin size={9} style={{ marginRight: 4, display: "inline" }} aria-hidden />
                Pinned
              </div>
            )}
            {pinnedItems.map((item) =>
              renderNavLink({
                item,
                pathname,
                collapsed,
                tNav,
                unreadByType,
                announcementCount,
                pinned: true,
                onTogglePin: handleTogglePin,
                isSopsEntry: false, // Pinned section never expands SOPs
                sopsExpanded: false,
                setSopsExpanded,
                sopFolders: null,
                sopFoldersLoading: false,
              }),
            )}
          </div>
        )}
        {!filterLc && recentItems.length > 0 && (
          <div className="app-sidebar-section">
            {!collapsed && (
              <div className="app-sidebar-section-label">
                <ClockIcon size={9} style={{ marginRight: 4, display: "inline" }} aria-hidden />
                Recent
              </div>
            )}
            {recentItems.map((item) =>
              renderNavLink({
                item,
                pathname,
                collapsed,
                tNav,
                unreadByType,
                announcementCount,
                pinned: false,
                onTogglePin: handleTogglePin,
                isSopsEntry: false,
                sopsExpanded: false,
                setSopsExpanded,
                sopFolders: null,
                sopFoldersLoading: false,
              }),
            )}
          </div>
        )}

        {SECTION_ORDER.map((section) => {
          const items = visibleNav.filter((i) => i.section === section && filterMatches(i));
          if (items.length === 0) return null;
          // When the user is filtering or the sidebar is collapsed, force
          // every hub open so the search hits actually surface and the
          // collapsed icon-rail doesn't hide everything behind a chevron.
          const isOpen = collapsed || !!filterLc || hubExpanded[section];
          const HubIcon = SECTION_ICON[section];
          const visibleCount = items.length;
          return (
            <div key={section} className={cn("app-sidebar-section", "app-sidebar-hub", !isOpen && "is-collapsed")}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleHub(section)}
                  className="app-sidebar-hub-header"
                  aria-expanded={isOpen}
                  aria-controls={`hub-${section}`}
                  title={isOpen ? `Collapse ${tNav(`hub.${section}`)}` : `Expand ${tNav(`hub.${section}`)}`}
                >
                  <HubIcon size={12} className="app-sidebar-hub-icon" aria-hidden />
                  <span className="app-sidebar-section-label">{tNav(`hub.${section}`)}</span>
                  <span className="app-sidebar-hub-count" aria-hidden>{visibleCount}</span>
                  <ChevronDown
                    size={12}
                    className={cn("app-sidebar-hub-chevron", isOpen && "is-open")}
                    aria-hidden
                  />
                </button>
              )}
              {isOpen && <div id={`hub-${section}`} className="app-sidebar-hub-body">
              {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const notifType = NAV_KEY_TO_NOTIFICATION_TYPE[item.key];
          const sectionUnread = notifType ? unreadByType[notifType] ?? 0 : 0;
          const announcementBadge = item.key === "announcements" ? announcementCount : 0;
          const badgeCount = sectionUnread || announcementBadge;
          const hasBadge = badgeCount > 0;
          const isSopsEntry = item.key === "sops";
          const itemPinned = pinnedKeys.includes(item.key);

          return (
            <React.Fragment key={item.name}>
              <div className={cn("app-sidebar-link-row", isSopsEntry && "has-expander")}>
                <Link
                  href={item.href}
                  className={cn(
                    "app-sidebar-link",
                    isActive && "is-active",
                    collapsed && "is-collapsed",
                    item.hue && `hue-${item.hue}`,
                  )}
                  title={collapsed ? tNav(item.key) : undefined}
                >
                  <span className="app-sidebar-icon-chip" aria-hidden>
                    <Icon size={14} />
                  </span>
                  {!collapsed && (
                    <>
                      <span className="app-sidebar-label">{tNav(item.key)}</span>
                      {item.comingSoon && (
                        <span className="app-sidebar-soon-badge" aria-label="Coming soon">Soon</span>
                      )}
                      {hasBadge && !item.comingSoon && (
                        <span className="app-sidebar-badge">{badgeCount > 9 ? "9+" : badgeCount}</span>
                      )}
                      <button
                        type="button"
                        className={cn("app-sidebar-pin", itemPinned && "is-pinned")}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleTogglePin(item.key);
                        }}
                        aria-label={itemPinned ? "Unpin" : "Pin"}
                        title={itemPinned ? "Unpin from top" : "Pin to top"}
                      >
                        {itemPinned ? <PinOff size={10} /> : <Pin size={10} />}
                      </button>
                    </>
                  )}
                  {collapsed && hasBadge && (
                    <span className="app-sidebar-dot-pip" aria-hidden />
                  )}
                </Link>
                {isSopsEntry && !collapsed && (
                  <button
                    type="button"
                    onClick={toggleSopsExpanded}
                    className={cn("app-sidebar-expander", sopsExpanded && "is-expanded")}
                    aria-label={sopsExpanded ? "Collapse SOP folders" : "Expand SOP folders"}
                    aria-expanded={sopsExpanded}
                  >
                    <ChevronDown size={12} />
                  </button>
                )}
              </div>
              {isSopsEntry && sopsExpanded && !collapsed && (
                <div className="app-sidebar-subnav" role="group" aria-label="SOP folders">
                  {sopFoldersLoading && sopFolders === null && (
                    <div className="app-sidebar-subitem is-loading">Loading…</div>
                  )}
                  {sopFolders && sopFolders.length === 0 && (
                    <div className="app-sidebar-subitem is-empty">No folders yet</div>
                  )}
                  {sopFolders && sopFolders.length > 0 && (() => {
                    // Render roots first, then their children one level
                    // deep. Two-level cap keeps the sidebar readable; full
                    // tree navigation lives inside /sops itself.
                    const byParent = new Map<string | null, SopFolder[]>();
                    for (const f of sopFolders) {
                      const arr = byParent.get(f.parentId) ?? [];
                      arr.push(f);
                      byParent.set(f.parentId, arr);
                    }
                    const roots = byParent.get(null) ?? [];
                    const rendered: React.ReactNode[] = [];
                    for (const root of roots) {
                      const rootHref = `/sops?folderId=${root.id}`;
                      const isOnFolder =
                        pathname === "/sops" &&
                        typeof window !== "undefined" &&
                        new URLSearchParams(window.location.search).get("folderId") === root.id;
                      rendered.push(
                        <Link
                          key={root.id}
                          href={rootHref}
                          className={cn("app-sidebar-subitem", isOnFolder && "is-active")}
                        >
                          <Folder size={12} />
                          <span className="app-sidebar-sublabel">{root.name}</span>
                          {typeof root.sopCountDeep === "number" && root.sopCountDeep > 0 && (
                            <span className="app-sidebar-subcount">{root.sopCountDeep}</span>
                          )}
                        </Link>
                      );
                      const children = byParent.get(root.id) ?? [];
                      for (const child of children) {
                        const childHref = `/sops?folderId=${child.id}`;
                        rendered.push(
                          <Link
                            key={child.id}
                            href={childHref}
                            className="app-sidebar-subitem is-nested"
                          >
                            <span className="app-sidebar-sublabel">{child.name}</span>
                            {typeof child.sopCountDeep === "number" && child.sopCountDeep > 0 && (
                              <span className="app-sidebar-subcount">{child.sopCountDeep}</span>
                            )}
                          </Link>
                        );
                      }
                    }
                    return rendered;
                  })()}
                </div>
              )}
            </React.Fragment>
          );
        })}
              </div>}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="app-sidebar-bottom">
        {bottomNav.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn("app-sidebar-link", isActive && "is-active", collapsed && "is-collapsed")}
              title={collapsed ? tNav(item.key) : undefined}
            >
              <Icon size={16} />
              {!collapsed && <span className="app-sidebar-label">{tNav(item.key)}</span>}
            </Link>
          );
        })}
        {themeMounted && (() => {
          const isDark = (resolvedTheme ?? theme) === "dark";
          const label = isDark ? tNav("lightMode") : tNav("darkMode");
          return (
            <button
              type="button"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className={cn("app-sidebar-link", collapsed && "is-collapsed")}
              aria-label={label}
              title={collapsed ? label : undefined}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
              {!collapsed && <span className="app-sidebar-label">{label}</span>}
            </button>
          );
        })()}
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={cn("app-sidebar-link app-sidebar-signout", collapsed && "is-collapsed")}
          aria-label={tNav("signOut")}
        >
          <LogOut size={16} />
          {!collapsed && <span className="app-sidebar-label">{tNav("signOut")}</span>}
        </button>
      </div>
    </aside>
    </>
  );
}
