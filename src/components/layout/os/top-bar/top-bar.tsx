"use client";

// TopBar (design-system 4.3, spec-shell 2.1): one 48px navy row to the right
// of the rail. Left: back and forward, then the hierarchy breadcrumb. Centre:
// the Search field (a button styled as a field; typing happens in the
// palette). Right: the pinned personal-tool strip (Avatar > Personal tools
// decides which), the calendar peek, the timer pill while a timer runs, "+"
// Create, Ask AI, the one bell, Help and the avatar. All of them 32px chrome
// icon buttons: the one blue button on a page stays the page's own primary.
// No workspace switcher (that lives in the sidebar header).
//
// Ask AI and the calendar peek are back on the bar by name: ClickUp keeps a
// global AI door top-right and a calendar glance one click away, and both
// were on this bar before the refresh (the founder's loss list). They render
// on the chrome tokens, never in their old skin.
//
// Inside the settings takeover the search field opens the door filter rather
// than the palette and its placeholder says so.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Menu, Plus, Search, Sparkles } from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { resolveCrumbTrail, resolveHub } from "@/lib/nav/route-hub";
import { HUB_LABELS, SHELL_LABELS } from "@/lib/nav/labels";
import { isSettingsRoute } from "@/lib/settings-nav";
import { shortcutHint } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { ChromeIconButton } from "../chrome-popover";
import { CreateMenu } from "../create-menu";
import { BellPopover } from "../bell-popover";
import { HelpMenu, usePrivacyDialog } from "../help-menu";
import { AvatarMenu } from "../avatar-menu";
import { TimerPill } from "../timer-pill";
import { CalendarPeek } from "../calendar-peek";
import { usePersonalTools } from "../use-personal-tools";
import { useOsShell } from "../shell-context";
import { useDeclaredBreadcrumb, type BreadcrumbItem } from "./breadcrumb";
import { useNavHistory } from "./nav-history";
import { useHubBack } from "../use-hub-back";
import { SIDEBAR_DRAWER_ID } from "../skip-links";

export const SETTINGS_FILTER_FOCUS_EVENT = "workwrk:settings-filter-focus";

function Crumbs({ items }: { items: BreadcrumbItem[] }) {
  // Past 4 levels the middle crumbs collapse into one "…" crumb.
  type Crumb = BreadcrumbItem & { hidden?: BreadcrumbItem[] };
  const collapsed: Crumb[] = items.length > 4 ? [items[0], { label: "…", hidden: items.slice(1, -2) }, ...items.slice(-2)] : items;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1 text-base">
        {collapsed.map((c, i) => {
          const last = i === collapsed.length - 1;
          const hidden = c.hidden;
          return (
            // THE HUB CRUMB NEVER TRUNCATES. Every crumb used to be
            // `min-w-0` with the same 160 cap, so flexbox shrank them all
            // equally and a four-deep trail rendered the app's own first
            // crumb as "W..." next to "Design ...", "Dashboard R..." and
            // "Ship the Q4 prici...". Principle 16 asks for one label per
            // destination, spelled the same everywhere; "W..." is not a
            // label. The hub label is one short word by construction (Work,
            // Docs, Teams, Planner, Settings), so it is the crumb that can
            // afford to keep all of its letters, and the deepest crumbs are
            // the ones that give way.
            <li
              key={`${c.label}-${i}`}
              className={cn(
                "flex items-center gap-1",
                i === 0 ? "shrink-0" : "min-w-0",
                i < collapsed.length - 2 && "max-lg:hidden",
              )}
            >
              {i > 0 ? (
                <span className={cn("inline-block shrink-0 text-chrome-fg-2 opacity-50 rtl:rotate-180", i === collapsed.length - 2 && "max-lg:hidden")} aria-hidden>›</span>
              ) : null}
              {hidden ? (
                <span className="shrink-0 text-chrome-fg-2" title={hidden.map((h) => h.label).join(" › ")}>…</span>
              ) : last || !c.href ? (
                <span
                  className="flex min-w-0 items-center gap-1.5 truncate font-medium text-chrome-fg"
                  aria-current={last ? "page" : undefined}
                  style={i === 0 ? undefined : { maxWidth: 160 }}
                  title={c.label}
                >
                  {c.tile ? <EntityTile size="xs" {...c.tile} /> : null}
                  <span className={i === 0 ? "whitespace-nowrap" : "truncate"}>{c.label}</span>
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="flex min-w-0 items-center gap-1.5 truncate rounded px-0.5 text-chrome-fg-2 hover:text-chrome-fg"
                  style={i === 0 ? undefined : { maxWidth: 160 }}
                  title={c.label}
                >
                  {c.tile ? <EntityTile size="xs" {...c.tile} /> : null}
                  <span className={i === 0 ? "whitespace-nowrap" : "truncate"}>{c.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function TopBar({ onMenu, menuOpen }: { onMenu?: () => void; menuOpen?: boolean }) {
  const pathname = usePathname() || "";
  const { openPalette, hubHref, toggleSidekick, sidekickOpen, railApps } = useOsShell();
  const tools = usePersonalTools();
  const aiVisible = railApps.some((a) => a.key === "ai");
  const { canBack, canForward, back, forward } = useNavHistory();
  const declared = useDeclaredBreadcrumb();
  const [createOpen, setCreateOpen] = useState(false);
  const privacy = usePrivacyDialog();
  const inSettings = isSettingsRoute(pathname);

  // The hub crumb is the hub whose sidebar actually renders: the URL's hub
  // when this viewer has it, else Work (the same fallback the sidebar and
  // the BackButton use), so the two chrome elements never disagree and the
  // crumb never links a Member to a hub they cannot open.
  const { hub, fallbackHref: hubLandingHref } = useHubBack();
  const hubVisible = hub === resolveHub(pathname);
  const hubCrumb: BreadcrumbItem = { label: HUB_LABELS[hub], href: hubVisible ? hubHref(hub) : hubLandingHref };
  // No declaration: the trail of owning ROUTE_TITLES rows (the hierarchy of
  // static directories), minus a first crumb that would only repeat the hub.
  // On a hub the viewer cannot open, its ancestor crumbs are text, not links:
  // every one of them is a page behind the same gate.
  const trail = resolveCrumbTrail(pathname).map((c) => (hubVisible ? c : { label: c.label }));
  const fallback = trail.length > 0 && trail[0].label === HUB_LABELS[hub] ? trail.slice(1) : trail;
  // Inside the takeover SettingsShell declares the whole trail, including its
  // own root crumb: the workspace door is "Settings › Workspace settings ›
  // {Page}" but the personal door is "{First name} › My settings › {Page}",
  // which must NOT carry a leading Settings crumb (sidebar-map 8). Only the
  // shell knows which door it is in, so the bar stops prepending there.
  const items: BreadcrumbItem[] = declared
    ? (inSettings ? declared : [hubCrumb, ...declared])
    : fallback.length > 0
      ? [hubCrumb, ...fallback]
      : [{ label: HUB_LABELS[hub] }];

  const onSearch = () => {
    if (inSettings) {
      window.dispatchEvent(new CustomEvent(SETTINGS_FILTER_FOCUS_EVENT));
      return;
    }
    openPalette();
  };

  return (
    <header
      aria-label="Page bar"
      className={cn(
        "os-chrome flex h-[var(--os-top-h)] shrink-0 items-center gap-2 bg-chrome px-3 text-chrome-fg",
        "[html[data-chrome=light]_&]:border-b [html[data-chrome=light]_&]:border-line",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {onMenu ? (
          <ChromeIconButton label="Menu" onClick={onMenu} aria-expanded={menuOpen ?? false} aria-controls={menuOpen ? SIDEBAR_DRAWER_ID : undefined} active={menuOpen} className="lg:hidden">
            <Menu className="h-5 w-5" strokeWidth={1.5} />
          </ChromeIconButton>
        ) : null}
        <ChromeIconButton label="Back" onClick={back} aria-disabled={!canBack} className={cn("max-lg:hidden", !canBack && "opacity-40 hover:bg-transparent hover:text-chrome-fg-2")}>
          <ChevronLeft className="h-5 w-5 rtl:rotate-180" strokeWidth={1.5} />
        </ChromeIconButton>
        <ChromeIconButton label="Forward" onClick={forward} aria-disabled={!canForward} className={cn("max-lg:hidden", !canForward && "opacity-40 hover:bg-transparent hover:text-chrome-fg-2")}>
          <ChevronRight className="h-5 w-5 rtl:rotate-180" strokeWidth={1.5} />
        </ChromeIconButton>
        <div className="ms-1 min-w-0 flex-1">
          <Crumbs items={items} />
        </div>
      </div>

      <button
        type="button"
        onClick={onSearch}
        aria-label={inSettings ? SHELL_LABELS.settingsSearchPlaceholder : SHELL_LABELS.search}
        className="hidden h-8 w-[240px] shrink-0 items-center gap-2 rounded-md border border-chrome-line bg-chrome-field px-3 text-start text-base text-chrome-field-ph hover:bg-chrome-hov lg:flex xl:w-[400px]"
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{inSettings ? SHELL_LABELS.settingsSearchPlaceholder : SHELL_LABELS.searchPlaceholder}</span>
        {/* dir="ltr": the hint is a key sequence, not prose, so it must keep
            its order under html[dir=rtl] ("⌘K", never "K⌘"). */}
        <kbd dir="ltr" className="font-sans text-xs text-chrome-fg-2">{shortcutHint("search")}</kbd>
      </button>
      <ChromeIconButton label={SHELL_LABELS.search} onClick={onSearch} className="lg:hidden">
        <Search className="h-5 w-5" strokeWidth={1.5} />
      </ChromeIconButton>

      <div className="flex flex-1 items-center justify-end gap-1">
        {/* The pinned tools: one click each, the person's own pick. Hidden
            under lg so the bar never wraps; the tools stay in "+" there. */}
        {!inSettings && tools.pinned.length > 0 ? (
          <div className="flex items-center gap-1 max-lg:hidden" aria-label="Pinned tools">
            {tools.pinned.map((t) => (
              <ChromeIconButton
                key={t.key}
                label={t.shortcutId ? `${t.label} (${shortcutHint(t.shortcutId)})` : t.label}
                onClick={() => { void tools.run(t); }}
              >
                <t.Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              </ChromeIconButton>
            ))}
            <span aria-hidden className="mx-0.5 h-4 w-px bg-chrome-line" />
          </div>
        ) : null}
        {!inSettings ? <CalendarPeek /> : null}
        <TimerPill />
        <CreateMenu
          open={createOpen}
          onOpenChange={setCreateOpen}
          trigger={
            <ChromeIconButton label={SHELL_LABELS.create} aria-haspopup="menu" aria-expanded={createOpen} active={createOpen}>
              <Plus className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            </ChromeIconButton>
          }
        />
        {aiVisible && !inSettings ? (
          <ChromeIconButton
            label={`${SHELL_LABELS.askAi} (${shortcutHint("ask-ai")})`}
            onClick={toggleSidekick}
            active={sidekickOpen}
            aria-pressed={sidekickOpen}
          >
            <Sparkles className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          </ChromeIconButton>
        ) : null}
        <BellPopover />
        <HelpMenu onPrivacy={privacy.open} />
        <AvatarMenu onPrivacy={privacy.open} />
      </div>
      {privacy.node}
    </header>
  );
}
