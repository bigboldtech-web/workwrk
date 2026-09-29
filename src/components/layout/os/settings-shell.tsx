"use client";

// SettingsShell (spec-shell 2.8, design-system 4.6 and 4.8, settings spec
// 1.2 and 8.1): the settings takeover. The rail and the navy bar stay
// mounted (OsShell keeps them); this frame replaces only the hub sidebar and
// the content column:
//
//   a 48px white bar with the one "Back to app" ghost button at the left and
//   nothing at the right (no close; that button plus Esc is the whole exit),
//   a 264px N50 list with a "Find a setting" filter (focused by the bar's
//   Cmd K and Cmd /), 11/600 uppercase group labels with a rule and 36px rows
//   with 20px icons and the N200 active pill, then <main> with the page.
//
// EVERY ROW COMES FROM THE REGISTRY (src/lib/settings-registry.ts): label,
// href, group, icon and order. The shell holds no row table and no role
// logic of its own beyond which door's list to show, so a page's sidebar
// row, its title and its crumb are one string by construction.
//
// `door` is the segment's door. The Workspace list shows only for Owners and
// Admins; everyone else, on any settings URL, sees the My settings list (the
// Workspace door's shape never leaks). Owners and Admins get one extra row
// in My settings, under a rule: "Workspace settings", so the two doors are
// one click apart. The active row is derived from the URL alone.
//
// The breadcrumb lives on the navy bar, declared from here:
//   Settings > Workspace settings > {Page}
//   {First name} > My settings > {Page}     (the name links to /people/me)
// Below 900px the list becomes a "Pages" select in the takeover bar. Exits
// call closeSettings() (the origin rule, settings spec 8.3); rows and the
// Pages select ask the dirty guard first.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { useShortcut } from "@/lib/shortcuts";
import {
  DOOR_LABELS,
  filterSettingsEntries,
  filterSettingsPages,
  resolveSettingsPage,
  type SettingEntry,
} from "@/lib/settings-registry";
import { settingsShellGroups, type SettingsDoorProp, type SettingsShellIconName } from "@/lib/settings-shell-groups";
import { hasDirty, leaveThen, setLeaveConfirmer, type LeaveDecision } from "@/lib/dirty-guard";
import { HUB_LABELS, SHELL_LABELS } from "@/lib/nav/labels";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, BarChart3, Bell, Boxes, Building2, CalendarCheck, CircleUser, CreditCard, Database, FileCheck, Globe,
  Key, Keyboard, LayoutGrid, List, Network, Search, Shapes, Shield, ShieldCheck, SlidersHorizontal, Users, X,
  type LucideIcon,
} from "lucide-react";
import { Breadcrumb, type BreadcrumbItem } from "./top-bar/breadcrumb";
import { SETTINGS_FILTER_FOCUS_EVENT } from "./top-bar/top-bar";
import { MAIN_ID, SIDEBAR_ID } from "./skip-links";
import { useViewerRole } from "./boot-context";

const ICONS: Record<SettingsShellIconName, LucideIcon> = {
  LayoutGrid, Building2, Globe, Boxes, Users, Network, ShieldCheck, Shapes, BarChart3, Shield, Database, FileCheck,
  Key, CreditCard, List, CircleUser, SlidersHorizontal, Bell, CalendarCheck, Keyboard,
};

/** The three-choice leave dialog the dirty guard asks (settings spec 8.5). */
function useLeaveDialog() {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((d: LeaveDecision) => void) | null>(null);
  const ask = useCallback(() => {
    return new Promise<LeaveDecision>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
  }, []);
  const answer = useCallback((d: LeaveDecision) => {
    setOpen(false);
    const r = resolver.current;
    resolver.current = null;
    r?.(d);
  }, []);
  return { open, ask, answer };
}


/** Crumb for a route shown inside another page's row (its alsoActiveOn). */
const ALSO_ACTIVE_CRUMBS: Record<string, string> = { "/imports": "Import" };

export function SettingsShell({ children, door = "me" }: { children: ReactNode; door?: SettingsDoorProp }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { data: session } = useSession();
  const { isAdmin } = useViewerRole();
  const { closeSettings } = useSettingsNav();
  const leave = useLeaveDialog();
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  // The dirty guard's question: Save your changes? Save / Discard / Keep editing.
  const askLeave = leave.ask;
  useEffect(() => {
    setLeaveConfirmer(() => askLeave());
    return () => setLeaveConfirmer(null);
  }, [askLeave]);

  // Esc leaves settings (after any open layer, through the registry).
  useShortcut({
    id: "settings.close",
    keys: "escape",
    label: SHELL_LABELS.backToApp,
    scope: "page",
    run: () => { void closeSettings(); },
  });

  // Cmd K and Cmd / inside a door focus the filter (the bar dispatches this).
  useEffect(() => {
    const onFocus = () => { filterRef.current?.focus(); filterRef.current?.select(); };
    window.addEventListener(SETTINGS_FILTER_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(SETTINGS_FILTER_FOCUS_EVENT, onFocus);
  }, []);

  const shownDoor: SettingsDoorProp = door === "workspace" && isAdmin ? "workspace" : "me";
  const groups = useMemo(() => settingsShellGroups(door, isAdmin), [door, isAdmin]);
  // The pathname alone decides the row: the only query-conditioned aliases
  // (/settings?tab=themes, ?tab=shortcuts) redirect before they render, and
  // reading the query here would need a Suspense boundary around the frame.
  const current = resolveSettingsPage(pathname);
  const activeKey = current && current.door === shownDoor ? current.key : null;
  const firstName = (session?.user as { firstName?: string } | undefined)?.firstName;

  const crumbs = useMemo<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [];
    // Below Admin the Workspace door is never offered (sidebar-map 8a:
    // "nobody else ever sees this sidebar"), so a Manager reading Members or
    // an Employee on any /settings/* URL gets the My settings crumbs, whose
    // links they can open, not two crumbs into the AdminOnly card.
    const pageDoor = isAdmin ? (current?.door ?? shownDoor) : "me";
    if (pageDoor === "me") {
      if (firstName) items.push({ label: firstName, href: "/people/me" });
      items.push({ label: DOOR_LABELS.me, href: "/account/profile" });
    } else {
      items.push({ label: HUB_LABELS.settings, href: "/settings" });
      items.push({ label: DOOR_LABELS.workspace, href: "/settings" });
    }
    if (current && current.key !== "overview") {
      // A route that renders inside another page's row (Data owns /imports
      // until S5) names itself under that page: Data > Import.
      const extra = ALSO_ACTIVE_CRUMBS[pathname.replace(/\/+$/, "")];
      if (extra && current.href !== pathname) {
        items.push({ label: current.label, href: current.href });
        items.push({ label: extra });
      } else {
        items.push({ label: current.label });
      }
    }
    return items;
  }, [current, shownDoor, firstName, isAdmin, pathname]);

  // Filter: rows by label, keyword, group and alias; plus the individual
  // settings (registry entries) the viewer's door lists beneath them.
  const q = query.trim();
  const matchKeys = useMemo(() => new Set(filterSettingsPages(q, shownDoor).map((p) => p.key)), [q, shownDoor]);
  const entryMatches: SettingEntry[] = useMemo(
    () => (q ? filterSettingsEntries(q, { door: shownDoor, allowedExternalGates: isAdmin ? ["manage_process"] : [] }) : []),
    [q, shownDoor, isAdmin],
  );
  const visibleGroups = groups
    .map((g) => ({
      ...g,
      rows: q ? g.rows.filter((r) => (r.pageKey ? matchKeys.has(r.pageKey) : r.label.toLowerCase().includes(q.toLowerCase()))) : g.rows,
    }))
    .filter((g) => g.rows.length > 0);

  const go = useCallback(
    (href: string) => {
      void leaveThen(() => router.push(href));
    },
    [router],
  );
  const onRowClick = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (!hasDirty()) return; // a plain Link navigation
    e.preventDefault();
    go(href);
  };

  const flatRows = groups.flatMap((g) => g.rows);
  const activeHref = flatRows.find((r) => r.pageKey === activeKey)?.href ?? "";

  return (
    <div className="os-chrome flex min-h-0 min-w-0 flex-1 flex-col bg-app text-ink">
      <Breadcrumb items={crumbs} />
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-raised px-3">
        <button
          type="button"
          onClick={() => { void closeSettings(); }}
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
            value={activeHref}
            onChange={(e) => { if (e.target.value) go(e.target.value); }}
            className="h-9 max-w-[60vw] rounded-md border border-line-strong bg-raised px-2 text-base text-ink"
          >
            {!activeHref ? <option value="">Pages</option> : null}
            {groups.map((g, gi) => (
              <optgroup key={g.label ?? `g${gi}`} label={g.label ?? (shownDoor === "me" && gi === 0 ? DOOR_LABELS.me : DOOR_LABELS.workspace)}>
                {g.rows.map((r) => (
                  <option key={r.key} value={r.href}>{r.label}</option>
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
          aria-label={DOOR_LABELS[shownDoor]}
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
            {/* No door heading above the rows: Overview is ungrouped (8a) and
                My settings is flat, no group labels (8b). The nav's
                aria-label names the door for assistive tech. */}
            {visibleGroups.map((group, gi) => (
              <div key={group.label ?? `g${gi}`}>
                {group.label ? (
                  <div className="mb-1 mt-3 flex h-5 items-center gap-2 ps-3 pe-1">
                    <span className="text-micro uppercase tracking-[0.06em] text-ink-2">{group.label}</span>
                    <span className="h-px flex-1 bg-line" aria-hidden />
                  </div>
                ) : group.ruleAbove ? (
                  <div className="mx-3 my-2 h-px bg-line" aria-hidden />
                ) : null}
                <ul>
                  {group.rows.map((row) => {
                    const on = !!row.pageKey && row.pageKey === activeKey;
                    const Icon = ICONS[row.icon] ?? List;
                    return (
                      <li key={row.key}>
                        <Link
                          href={row.href}
                          onClick={(e) => onRowClick(e, row.href)}
                          aria-current={on ? "page" : undefined}
                          className={cn(
                            "flex h-9 items-center gap-3 rounded-lg px-3 transition-colors",
                            on ? "bg-side-pill font-medium text-ink" : "text-ink hover:bg-hover",
                          )}
                        >
                          <Icon className={cn("h-5 w-5 shrink-0", on ? "text-ink" : "text-ink-2")} strokeWidth={1.5} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{row.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {entryMatches.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1 flex h-5 items-center gap-2 ps-3 pe-1">
                  <span className="text-micro uppercase tracking-[0.06em] text-ink-2">Settings</span>
                  <span className="h-px flex-1 bg-line" aria-hidden />
                </div>
                <ul>
                  {entryMatches.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={e.href}
                        onClick={(ev) => onRowClick(ev, e.href)}
                        className="flex min-h-8 items-center rounded-lg px-3 py-1 text-sm text-ink-2 hover:bg-hover hover:text-ink"
                      >
                        <span className="min-w-0 flex-1 truncate">{e.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {q && visibleGroups.length === 0 && entryMatches.length === 0 ? (
              <div className="flex h-9 items-center px-3 text-sm text-ink-2">No settings match</div>
            ) : null}
          </div>
        </nav>

        {/* Pages inside the takeover are the settings unit's and keep the
            14px-root scale: the chrome scoping stops at this element. */}
        <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto bg-app outline-none [--spacing:0.25rem] [--radius-md:0.375rem] [--radius-lg:0.5rem] [--radius-sm:0.25rem] [--radius-xl:0.75rem] [--radius-xs:0.125rem]">{children}</main>
      </div>

      <Dialog open={leave.open} onOpenChange={(o) => { if (!o) leave.answer("stay"); }}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save your changes?</DialogTitle>
            <DialogDescription>You have changes on this page that have not been saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => leave.answer("stay")}
              className="inline-flex h-9 items-center rounded-lg px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => leave.answer("discard")}
              className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3 text-base font-medium text-ink hover:bg-hover"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => leave.answer("save")}
              className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-base font-medium text-white hover:bg-brand-hover"
            >
              Save changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
