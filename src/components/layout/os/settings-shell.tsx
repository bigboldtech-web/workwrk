"use client";

// SettingsShell (spec-shell 2.8, design-system 4.6, sidebar-map 8): the
// settings takeover. The rail and the navy bar stay mounted (OsShell keeps
// them); this frame replaces only the hub sidebar and the content column:
//
//   a 48px white bar with the one "Back to app" ghost button at the left and
//   nothing at the right (no close; that button plus Esc is the whole exit),
//   a 264px N50 list with a "Find a setting" filter (focused by ⌘K and ⌘/
//   inside a door), 11/600 uppercase group labels with a rule and 36px rows
//   with 20px icons and the N200 active pill, then <main> with the page.
//
// The breadcrumb lives on the navy bar, declared from here as
// Settings › {Door} › {Page}. Below 900px the list becomes a "Pages" select
// in the takeover bar. Exits call closeSettings() (the origin rule, settings
// spec 8.3); nothing here names a destination.
//
// The row table keeps every destination that has a page today (the settings
// unit re-parents the pages onto the registry in Phase 8); labels follow
// the registry where the row is that page.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { useShortcut } from "@/lib/shortcuts";
import { resolveSettingsPage } from "@/lib/settings-registry";
import { setLeaveConfirmer } from "@/lib/dirty-guard";
import { HUB_LABELS, SHELL_LABELS } from "@/lib/nav/labels";
import { useConfirm } from "@/components/ui/dialog-provider";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, LayoutGrid, Building2, Tag, Shapes, Users, Globe, CreditCard, Boxes, Key, Calendar, FileCheck, Plug,
  Download, BarChart3, Shield, ShieldCheck, Network, User, Bell, Palette, Database, Lock, AppWindow,
  Search, X, Import, type LucideIcon,
} from "lucide-react";
import { Breadcrumb, type BreadcrumbItem } from "./top-bar/breadcrumb";
import { SETTINGS_FILTER_FOCUS_EVENT } from "./top-bar/top-bar";
import { MAIN_ID, SIDEBAR_ID } from "./skip-links";
import { useViewerRole } from "./boot-context";

type NavItem = {
  label: string;
  icon: LucideIcon;
  href: string;
  /** Highlight only on an exact pathname match (the Overview). */
  exact?: boolean;
  /** Also active on these prefixes (Data owns /imports until it folds in). */
  alsoActiveOn?: string[];
  /** Search terms beyond the label. */
  keywords?: string[];
};
type NavGroup = { label?: string; items: NavItem[] };
type NavDoor = { key: "workspace" | "me"; label: string; adminOnly: boolean; groups: NavGroup[] };

const DOORS: NavDoor[] = [
  {
    key: "workspace",
    label: SHELL_LABELS.workspaceSettings,
    adminOnly: true,
    groups: [
      {
        items: [{ label: "Overview", icon: LayoutGrid, href: "/settings", exact: true, keywords: ["all settings", "workspace"] }],
      },
      {
        label: "Workspace",
        items: [
          { label: "Identity & culture", icon: Building2, href: "/settings/identity", keywords: ["name", "logo", "mission", "values", "splash", "branding"] },
          { label: "Locale & work week", icon: Globe, href: "/settings/locale", keywords: ["timezone", "currency", "fiscal", "language", "week"] },
          { label: "Apps & modules", icon: AppWindow, href: "/settings/apps", keywords: ["rail", "hubs", "hide", "floor"] },
          { label: "Modules", icon: Boxes, href: "/settings/modules", keywords: ["talk", "tables", "premium"] },
          { label: "Defaults & locks", icon: Lock, href: "/settings/defaults", keywords: ["density", "theme", "locked"] },
        ],
      },
      {
        label: "People",
        items: [
          { label: "Members", icon: Users, href: "/settings/members", keywords: ["invite", "guests", "teams", "deactivate"] },
          { label: "Structure", icon: Network, href: "/settings/structure", keywords: ["departments", "job titles", "offices"] },
          { label: "Reporting hierarchy", icon: Network, href: "/settings/hierarchy", keywords: ["manager", "reports to", "org chart"] },
          { label: "Access", icon: ShieldCheck, href: "/settings/permissions", keywords: ["permissions", "roles", "people team"] },
        ],
      },
      {
        label: "Work",
        items: [
          { label: "Task system", icon: Shapes, href: "/settings/task-types", keywords: ["task types", "statuses"] },
          { label: "Tags", icon: Tag, href: "/settings/tags", keywords: ["labels"] },
          { label: "Scoring & reviews", icon: BarChart3, href: "/settings/scoring", keywords: ["weights", "bands", "cadence", "kpi"] },
        ],
      },
      {
        label: "Security & data",
        items: [
          { label: "Data", icon: Database, href: "/settings/data", alsoActiveOn: ["/imports"], keywords: ["export", "import", "retention", "privacy", "gdpr"] },
          { label: "Import", icon: Import, href: "/imports", keywords: ["csv", "migrate", "clickup", "asana"] },
          { label: "Import / Export", icon: Download, href: "/settings/import-export", keywords: ["csv", "backup"] },
          { label: "Audit log", icon: FileCheck, href: "/settings/audit", keywords: ["activity", "history", "who did what"] },
          { label: "API & webhooks", icon: Key, href: "/settings/api", keywords: ["api keys", "tokens", "byok"] },
          { label: "Integrations", icon: Plug, href: "/settings/integrations", keywords: ["connect", "slack", "google"] },
        ],
      },
      {
        label: "Billing",
        items: [{ label: "Plan & billing", icon: CreditCard, href: "/settings/billing", keywords: ["plan", "invoice", "seats", "upgrade"] }],
      },
    ],
  },
  {
    key: "me",
    label: SHELL_LABELS.mySettings,
    adminOnly: false,
    groups: [
      {
        items: [
          { label: "Profile", icon: User, href: "/account/profile", keywords: ["name", "avatar", "photo"] },
          { label: "Notifications", icon: Bell, href: "/settings/notifications", keywords: ["inbox", "email", "mute", "quiet hours"] },
          { label: "Preferences", icon: Palette, href: "/account/appearance", keywords: ["theme", "dark", "density", "language"] },
          { label: "Security", icon: Shield, href: "/account/security", keywords: ["password", "two step", "sessions"] },
          // Phase 4: this row moved out of Workspace settings > Security &
          // data. Every row the page writes (CalendarSubscription, the ICS
          // token) belongs to ONE PERSON, so it is a My settings row, which
          // is where the settings registry has always declared it
          // (src/lib/settings-registry.ts, door "me").
          { label: "Calendar & connections", icon: Calendar, href: "/account/connections", keywords: ["ics", "feed", "sync", "google calendar"] },
        ],
      },
    ],
  },
];

function isActive(item: NavItem, pathname: string): boolean {
  if (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  return (item.alsoActiveOn ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The active row for `pathname`: the longest matching href wins. */
function activeItem(pathname: string, doors: NavDoor[]): { door: NavDoor; item: NavItem } | null {
  let best: { door: NavDoor; item: NavItem; len: number } | null = null;
  for (const door of doors) {
    for (const group of door.groups) {
      for (const item of group.items) {
        if (!isActive(item, pathname)) continue;
        const len = item.href.length;
        if (!best || len > best.len) best = { door, item, len };
      }
    }
  }
  return best ? { door: best.door, item: best.item } : null;
}

export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { data: session } = useSession();
  const { isAdmin } = useViewerRole();
  const { closeSettings } = useSettingsNav();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  // The dirty guard's confirm, on the app's own dialog.
  useEffect(() => {
    setLeaveConfirmer(async () => {
      const discard = await confirm({
        title: "Discard unsaved changes?",
        description: "You have changes that have not been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      return discard ? "discard" : "stay";
    });
    return () => setLeaveConfirmer(null);
  }, [confirm]);

  // Esc leaves settings (after any open layer, through the registry).
  useShortcut({
    id: "settings.close",
    keys: "escape",
    label: SHELL_LABELS.backToApp,
    scope: "page",
    run: () => { void closeSettings(); },
  });

  // ⌘K and ⌘/ inside a door focus the filter (the bar dispatches this).
  useEffect(() => {
    const onFocus = () => { filterRef.current?.focus(); filterRef.current?.select(); };
    window.addEventListener(SETTINGS_FILTER_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(SETTINGS_FILTER_FOCUS_EVENT, onFocus);
  }, []);

  const doors = useMemo(() => DOORS.filter((d) => !d.adminOnly || isAdmin), [isAdmin]);
  const active = activeItem(pathname, doors);
  const registryPage = resolveSettingsPage(pathname, typeof window !== "undefined" ? window.location.search : "");
  const pageLabel = active?.item.label ?? registryPage?.label ?? null;
  const doorLabel = active?.door.label ?? (registryPage ? (registryPage.door === "workspace" ? SHELL_LABELS.workspaceSettings : SHELL_LABELS.mySettings) : null);
  const firstName = (session?.user as { firstName?: string } | undefined)?.firstName;

  // The whole trail, root included: the bar prepends nothing inside the
  // takeover. Two shapes and only two (sidebar-map 8):
  //   Settings > Workspace settings > {Page}
  //   {First name} > My settings > {Page}
  const crumbs = useMemo<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [];
    const personal = active?.door.key === "me";
    const doorHref = personal ? "/account/profile" : "/settings";
    if (personal) {
      if (firstName) items.push({ label: firstName, href: doorHref });
    } else {
      items.push({ label: HUB_LABELS.settings, href: "/settings" });
    }
    if (doorLabel) items.push({ label: doorLabel, href: doorHref });
    if (pageLabel && pageLabel !== "Overview") items.push({ label: pageLabel });
    return items;
  }, [active, doorLabel, pageLabel, firstName]);

  const q = query.trim().toLowerCase();
  const matches = useCallback((item: NavItem) => {
    if (!q) return true;
    if (item.label.toLowerCase().includes(q)) return true;
    return (item.keywords ?? []).some((k) => k.includes(q));
  }, [q]);

  const onBack = () => { void closeSettings(); };

  // The "Pages" select below 900px.
  const flatRows = doors.flatMap((d) => d.groups.flatMap((g) => g.items.map((i) => ({ door: d, group: g, item: i }))));

  return (
    <div className="os-chrome flex min-h-0 min-w-0 flex-1 flex-col bg-app text-ink">
      <Breadcrumb items={crumbs} />
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-raised px-3">
        <button
          type="button"
          onClick={onBack}
          title={`${SHELL_LABELS.backToApp} (Esc)`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} aria-hidden />
          {SHELL_LABELS.backToApp}
        </button>
        <label className="ms-2 hidden max-[900px]:flex items-center gap-2 text-sm text-ink-2">
          <span className="sr-only">Pages</span>
          <select
            aria-label="Pages"
            value={active?.item.href ?? ""}
            onChange={(e) => { if (e.target.value) router.push(e.target.value); }}
            className="h-9 rounded-md border border-line-strong bg-raised px-2 text-base text-ink"
          >
            {!active ? <option value="">Pages</option> : null}
            {doors.map((d) => (
              <optgroup key={d.key} label={d.label}>
                {d.groups.flatMap((g) => g.items).map((i) => (
                  <option key={i.href} value={i.href}>{i.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="flex-1" />
      </div>

      {/* min-w-0 on both this row and the shell root: without it a flex
          item keeps min-width:auto, so a wide settings page (Members) pushed
          the whole takeover past the viewport instead of letting its table
          scroll inside its own card (spec-shell 1.16). */}
      <div className="flex min-h-0 min-w-0 flex-1">
        <nav
          id={SIDEBAR_ID}
          tabIndex={-1}
          aria-label="Settings"
          className="os-row flex w-[var(--os-side-w)] shrink-0 flex-col border-e border-line bg-side outline-none max-[900px]:hidden"
        >
          <div className="px-3 pb-2 pt-3">
            <div className="flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]">
              <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
              <input
                ref={filterRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={SHELL_LABELS.settingsSearchPlaceholder}
                aria-label={SHELL_LABELS.settingsSearchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink">
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {doors.map((door) => {
              const visibleGroups = door.groups
                .map((g) => ({ ...g, items: g.items.filter(matches) }))
                .filter((g) => g.items.length > 0);
              if (visibleGroups.length === 0) return null;
              return (
                <div key={door.key}>
                  {doors.length > 1 ? (
                    <div className="mb-2 mt-4 flex h-5 items-center gap-2 ps-3 pe-1 first:mt-1">
                      <span className="text-micro uppercase tracking-[0.06em] text-ink-2">{door.label}</span>
                      <span className="h-px flex-1 bg-line" aria-hidden />
                    </div>
                  ) : null}
                  {visibleGroups.map((group, gi) => (
                    <div key={group.label ?? `g${gi}`}>
                      {group.label ? (
                        <div className="mb-1 mt-3 flex h-5 items-center gap-2 ps-3 pe-1">
                          <span className="text-micro uppercase tracking-[0.06em] text-ink-2">{group.label}</span>
                          <span className="h-px flex-1 bg-line" aria-hidden />
                        </div>
                      ) : null}
                      <ul>
                        {group.items.map((item) => {
                          const on = active?.item === item;
                          const Icon = item.icon;
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                aria-current={on ? "page" : undefined}
                                className={cn(
                                  "flex h-9 items-center gap-3 rounded-lg px-3 transition-colors",
                                  on ? "bg-side-pill font-medium text-ink" : "text-ink hover:bg-hover",
                                )}
                              >
                                <Icon className={cn("h-5 w-5 shrink-0", on ? "text-ink" : "text-ink-2")} strokeWidth={1.5} aria-hidden />
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })}
            {q && flatRows.every((r) => !matches(r.item)) ? (
              <div className="flex h-9 items-center px-3 text-sm text-ink-2">No settings match</div>
            ) : null}
          </div>
        </nav>

        {/* Pages inside the takeover are the settings unit's and keep the
            14px-root scale: the chrome scoping stops at this element. */}
        <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto bg-app outline-none [--spacing:0.25rem] [--radius-md:0.375rem] [--radius-lg:0.5rem] [--radius-sm:0.25rem] [--radius-xl:0.75rem] [--radius-xs:0.125rem]">{children}</main>
      </div>
    </div>
  );
}
