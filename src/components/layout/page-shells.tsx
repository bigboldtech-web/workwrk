"use client";

/**
 * Page archetype shells — Phase C of the UX revamp.
 *
 * Four reusable layouts that cover every screen in the app:
 *
 *   ListPage     filter rail (left) + main content + optional drawer (right)
 *                For: Tasks, People, OKRs, Expenses, POs, etc.
 *
 *   DetailPage   back link + title row + tabs + content + related-entities rail
 *                For: Person detail, OKR detail, PO detail, Plan detail, etc.
 *
 *   HubPage      hero stat card + 2-column widget grid + activity rail
 *                For: Dashboard, Financials home, Talent home, Money home.
 *
 *   EditorPage   full-bleed editing surface + sticky save bar + metadata rail
 *                For: SOP editor, Review editor, Policy editor, Brand guide.
 *
 * Each shell takes plain children for its slots — no opinions about what
 * goes inside. Pages adopt a shell by wrapping their existing render in
 * the corresponding component; the visual rhythm + responsive behavior
 * comes for free.
 *
 * Why shells and not full page components: the *layout* is the common
 * thing, not the data fetching or the specific widgets. Shells stay
 * lean. Composition wins.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// ────────────────────────────────────────────────────────────────────
// ListPage
// ────────────────────────────────────────────────────────────────────

interface ListPageProps {
  /** Page header (use the existing PageHeader component or any node). */
  header: ReactNode;
  /** Left rail content — filter chips, saved views, faceted nav. Pass null
   *  to omit the rail and let the main content claim the width. */
  filters?: ReactNode;
  /** The list itself (table, card grid, kanban, whatever). */
  children: ReactNode;
  /** Optional right-side drawer — when a row is selected. Disappears when
   *  null so the main content reflows wide. */
  drawer?: ReactNode;
  /** Width of the filter rail in pixels. Default 240. */
  filtersWidth?: number;
  /** Width of the drawer when open. Default 380. */
  drawerWidth?: number;
}

export function ListPage({
  header,
  filters,
  children,
  drawer,
  filtersWidth = 240,
  drawerWidth = 380,
}: ListPageProps) {
  return (
    <div className="space-y-3 animate-fade-in">
      {header}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: [
            filters ? `${filtersWidth}px` : null,
            "minmax(0, 1fr)",
            drawer ? `${drawerWidth}px` : null,
          ]
            .filter(Boolean)
            .join(" "),
        }}
      >
        {filters && (
          <aside className="hidden lg:block">
            <div className="sticky top-4">{filters}</div>
          </aside>
        )}
        <main className="min-w-0">{children}</main>
        {drawer && (
          <aside className="hidden xl:block">
            <div className="sticky top-4">{drawer}</div>
          </aside>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// DetailPage
// ────────────────────────────────────────────────────────────────────

interface DetailPageProps {
  /** Where the back button should point. Often /<module>. */
  backHref: string;
  /** Optional override for the back-button label. Defaults to "Back". */
  backLabel?: string;
  /** Title + status row at the top of the page. */
  header: ReactNode;
  /** Tabs strip below the header. Pass a <Tabs> component or null. */
  tabs?: ReactNode;
  /** Main content area — the tab body or the unfocused detail surface. */
  children: ReactNode;
  /** Right-side related-entities rail (e.g. linked POs on an invoice).
   *  Null hides the rail. */
  related?: ReactNode;
  relatedWidth?: number;
}

export function DetailPage({
  backHref,
  backLabel = "Back",
  header,
  tabs,
  children,
  related,
  relatedWidth = 280,
}: DetailPageProps) {
  return (
    <div className="space-y-4 animate-fade-in">
      <Link
        href={backHref}
        className="text-xs text-muted hover:text-foreground inline-flex items-center gap-1"
      >
        <ChevronLeft size={12} /> {backLabel}
      </Link>

      <header>{header}</header>

      {tabs && <div className="border-b border-border">{tabs}</div>}

      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: related ? `minmax(0, 1fr) ${relatedWidth}px` : "minmax(0, 1fr)",
        }}
      >
        <main className="min-w-0">{children}</main>
        {related && (
          <aside className="hidden lg:block">
            <div className="sticky top-4 space-y-3">{related}</div>
          </aside>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// HubPage
// ────────────────────────────────────────────────────────────────────

interface HubPageProps {
  /** Page header — usually with kicker + title + subtitle. */
  header: ReactNode;
  /** Hero card at the top (the most important metric / call-to-action). */
  hero?: ReactNode;
  /** Two-column widget grid. Pass an array of widget nodes; we lay them
   *  out as 2-up on desktop, 1-up on mobile. */
  widgets: ReactNode[];
  /** Right-side activity stream / recent items rail. */
  activity?: ReactNode;
  activityWidth?: number;
}

export function HubPage({
  header,
  hero,
  widgets,
  activity,
  activityWidth = 320,
}: HubPageProps) {
  return (
    <div className="space-y-4 animate-fade-in">
      {header}
      {hero}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: activity ? `minmax(0, 1fr) ${activityWidth}px` : "minmax(0, 1fr)",
        }}
      >
        <main className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
          {widgets.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </main>
        {activity && (
          <aside className="hidden lg:block">
            <div className="sticky top-4">{activity}</div>
          </aside>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// EditorPage
// ────────────────────────────────────────────────────────────────────

interface EditorPageProps {
  /** Where to bail out to (Cancel / Done buttons usually go there). */
  backHref: string;
  backLabel?: string;
  /** Title row at the top. Keep it slim — the editor surface is the star. */
  header: ReactNode;
  /** The editing canvas itself. Full-bleed inside the main column. */
  children: ReactNode;
  /** Right-side metadata rail — properties, tags, related links, status. */
  metadata?: ReactNode;
  /** Sticky bar at the bottom holding Save / Publish / Discard. Pass null
   *  if your editor autosaves (e.g. SOP editor has no explicit save). */
  saveBar?: ReactNode;
  metadataWidth?: number;
}

export function EditorPage({
  backHref,
  backLabel = "Back",
  header,
  children,
  metadata,
  saveBar,
  metadataWidth = 280,
}: EditorPageProps) {
  return (
    <div className={cn("flex flex-col h-full animate-fade-in", saveBar && "pb-16")}>
      <div className="flex-shrink-0 space-y-3">
        <Link
          href={backHref}
          className="text-xs text-muted hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft size={12} /> {backLabel}
        </Link>
        <header>{header}</header>
      </div>

      <div
        className="flex-1 min-h-0 grid gap-4 mt-4"
        style={{
          gridTemplateColumns: metadata ? `minmax(0, 1fr) ${metadataWidth}px` : "minmax(0, 1fr)",
        }}
      >
        <main className="min-w-0 overflow-y-auto">{children}</main>
        {metadata && (
          <aside className="hidden lg:block overflow-y-auto">
            <div className="space-y-3">{metadata}</div>
          </aside>
        )}
      </div>

      {saveBar && (
        <div className="fixed bottom-0 left-[var(--sidebar-width,260px)] right-0 px-4 py-3 border-t border-border bg-background z-20">
          {saveBar}
        </div>
      )}
    </div>
  );
}
