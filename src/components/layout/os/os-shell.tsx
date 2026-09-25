"use client";

// OsShell: the frame (spec-shell 2.1, design-system 4). Reading order, left
// to right, top to bottom:
//
//   rail 64 (navy, flush)  |  bar 48 (navy) over the content column
//                          |  [offline strip]
//                          |  sidebar 264 (N50) | <main> white | Ask AI 360
//
// No gutters, no floating cards, no radius: the colour step is the edge.
// Inside the settings takeover (SETTINGS_ROUTES) the rail and the bar stay
// and the settings layout supplies its own 48px white bar, 264px list and
// content in place of the hub sidebar and main.
//
// Every overlay the frame mounts is listed in spec-shell 2.1 "Side panel /
// drawer / modal used here"; the More launcher and the legacy item drawer are
// gone. The My Work peek (the "My Work" personal tool), the Top pins strip
// (Favorite > Top) and the quick-capture chord in ShellShortcuts are back:
// all three were on the founder's loss list.

import { Children, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { recordShellPath } from "@/lib/nav/entry-path";
import { OsShellProvider, useLayer, useOsShell } from "./shell-context";
import { OsCommandPalette } from "./command-palette";
import { OsToastProvider } from "./toast";
import { CustomizePanel } from "./customize-panel";
import { ThemeApplier } from "./theme-applier";
import { Rail } from "./rail";
import { HubSidebar } from "./hub-sidebar";
import { TopBar } from "./top-bar/top-bar";
import { BreadcrumbProvider, useDeclaredBreadcrumb } from "./top-bar/breadcrumb";
import { useNavHistoryRecorder } from "./top-bar/nav-history";
import { OfflineStrip } from "./offline-strip";
import { TopPinsStrip } from "./top-pins-strip";
import { SkipLinks, MAIN_ID, SIDEBAR_ID } from "./skip-links";
import { OsSidekickPanel } from "./sidekick-panel";
import { SetStatusModal } from "./set-status-modal";
import { CreateTaskModal } from "./create-task-modal";
import { NotepadPanel } from "./notepad-panel";
import { MyWorkPeek } from "./my-work-peek";
import { ReminderPopover } from "./reminder-popover";
import { ReminderTicker } from "./reminder-ticker";
import { VoiceCapturePopover } from "./voice-capture-popover";
import { CreateListModal } from "./create-list-modal";
import { CreateSprintModal } from "./create-sprint-modal";
import { TemplateCenter } from "@/components/templates/template-center";
import { CallDock } from "@/components/calls/call-dock";
import { IncomingCallWatcher } from "@/components/calls/incoming-call-watcher";
import { RealtimeClient } from "./realtime-client";
import { ShellShortcuts } from "./shell-shortcuts";
import { SectionLinkInterceptor } from "./section-link-interceptor";
import { ShortcutsOverlay } from "./shortcuts-overlay";
import { MissionSplash } from "@/components/brand/mission-splash";
import { isSettingsRoute, resolveCrumbFallback, resolveHub } from "@/lib/nav/route-hub";
import { HUB_LABELS } from "@/lib/nav/labels";

function CustomizeMount() {
  const { customizeOpen, setCustomizeOpen } = useOsShell();
  return <CustomizePanel open={customizeOpen} onOpenChange={setCustomizeOpen} />;
}

function TemplateCenterMount() {
  const { templateCenterOpen, templateCenterOpts, closeTemplateCenter, openCreateTask } = useOsShell();
  return (
    <TemplateCenter
      mode="modal"
      open={templateCenterOpen}
      onClose={closeTemplateCenter}
      kind={templateCenterOpts?.kind ?? null}
      target={templateCenterOpts?.applyContext}
      onApplied={(result) => {
        // TASK is the one kind with no page to land on: the modal it fills is
        // the destination. Every other kind navigates itself now, so this
        // handler is no longer the reason four of them went nowhere.
        //
        // The CONFIG travels with it. openCreateTask() with no argument opened
        // a blank modal, so the apply created nothing and prefilled nothing
        // while the toast said "Template loaded into a new task".
        if (result.kind === "TASK") {
          openCreateTask(null, { name: result.name ?? "Template", config: result.config ?? {} });
        }
      }}
    />
  );
}

/**
 * Moves focus to <main> and announces the page on every client navigation.
 * The announced text is the page's own name (its last declared crumb, else
 * the ROUTE_TITLES label, else the hub), never document.title: no dashboard
 * route sets a per-page title, so the title is the constant marketing one.
 */
function NavigationAnnouncer() {
  const pathname = usePathname() || "";
  const declared = useDeclaredBreadcrumb();
  const [announce, setAnnounce] = useState("");
  // The path announced last. Seeded with the mount path, so a cold load is
  // never announced and StrictMode's second effect run (which defeats a
  // plain "first run" flag in development) is a no-op as well: only a real
  // change of pathname moves focus and speaks.
  const announcedPath = useRef(pathname);
  useNavHistoryRecorder();
  const label = declared?.[declared.length - 1]?.label ?? resolveCrumbFallback(pathname) ?? HUB_LABELS[resolveHub(pathname)];
  const labelRef = useRef(label);
  useEffect(() => { labelRef.current = label; }, [label]);
  // The tab title follows the page: "Inbox · WorkwrK". No dashboard route
  // exports its own metadata, so this is the only source of every dashboard
  // title. Next re-applies the ROOT metadata title after the router commits,
  // at a moment nothing here can schedule around: a setTimeout(0) loses that
  // race and the tab keeps the marketing tagline for the rest of the session.
  // So watch <head> and re-assert instead. Writing document.title mutates the
  // same <title> node, which re-enters the observer once and then matches, so
  // there is no loop.
  const desiredTitle = label ? `${label} · WorkwrK` : null;
  useEffect(() => {
    if (!desiredTitle) return;
    const apply = () => { if (document.title !== desiredTitle) document.title = desiredTitle; };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [desiredTitle]);
  useEffect(() => {
    if (announcedPath.current === pathname) return;
    announcedPath.current = pathname;
    const main = document.getElementById(MAIN_ID);
    if (main && !main.contains(document.activeElement)) {
      main.focus({ preventScroll: true });
    }
    // A beat later, so a page that declares its crumbs has done so.
    const t = window.setTimeout(() => setAnnounce(labelRef.current), 150);
    return () => window.clearTimeout(t);
  }, [pathname]);
  return <div className="sr-only" aria-live="polite">{announce}</div>;
}

/**
 * The tablet overlay sidebar (768 to 1023): opened from the bar's Menu
 * button; a layer, so Esc closes it (spec-shell 1.16); closes on row click.
 */
function useOverlaySidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Where focus was when the drawer opened (the bar's Menu button), so Esc,
  // the scrim and the ✕ all put focus back on it rather than on nothing.
  const openerRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  const close = useCallback(() => {
    setOpen(false);
    const opener = openerRef.current;
    openerRef.current = null;
    // After the drawer unmounts: removing the focused element sends focus to
    // <body>, so the restore has to happen on the other side of that.
    window.setTimeout(() => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    }, 0);
  }, []);
  const toggle = useCallback(() => {
    // The opener is captured in the event handler, never inside the setOpen
    // updater: an updater is render-phase work that React may run twice or
    // discard, and doing it there left the first open with no opener to
    // restore focus to (focus fell to <body> on the first close).
    if (openRef.current) {
      close();
      return;
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, [close]);
  useLayer(open, { id: "sidebar-overlay", kind: "drawer", close });
  // A row click navigates; the drawer closes right after the route commits.
  useEffect(() => {
    const t = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(t);
  }, [pathname]);
  // Crossing up past the 1024 breakpoint hides the drawer with CSS, so its
  // layer has to go with it: a live layer nobody can see swallows the next
  // Escape. The same listener closes it on the way down, which is harmless.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => { if (mq.matches) setOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return { open, close, toggle };
}

// The frame is a grid so the DOM order is the reading and tab order the spec
// fixes (skip links, rail, sidebar, bar, content, panel) while the bar still
// spans the content column above the sidebar and the page:
//
//   col 1 rail | col 2 sidebar | col 3 main | col 4 Ask AI
//   row 1 bar (cols 2 to 4)  ·  row 2 offline strip  ·  row 3 the rest
//
// The settings takeover keeps rows 1 and 2 and takes cols 2 to 4 of row 3.
const GRID_STYLE: React.CSSProperties = {
  gridTemplateColumns: "var(--os-rail-w) auto minmax(0, 1fr) auto",
  gridTemplateRows: "var(--os-top-h) auto minmax(0, 1fr)",
};

// The takeover renders neither the hub sidebar nor the Ask AI panel, so cols
// 2 and 4 are empty. They have to be pinned to 0 rather than left `auto`:
// the takeover spans 2 to 4, an `auto` track sizes to its items' min-content,
// and a wide settings page (Members) therefore stretched the whole span past
// the viewport with nothing able to scroll it back. Pinned to 0 the span is
// exactly `minmax(0, 1fr)`, so it can never exceed the viewport minus the
// rail and wide tables scroll inside their own card (spec-shell 1.16).
const SETTINGS_GRID_STYLE: React.CSSProperties = {
  gridTemplateColumns: "var(--os-rail-w) 0px minmax(0, 1fr) 0px",
  gridTemplateRows: "var(--os-top-h) auto minmax(0, 1fr)",
};

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const settingsMode = isSettingsRoute(pathname);
  const overlay = useOverlaySidebar();

  return (
    <div className="workwrk-os grid h-screen overflow-hidden bg-app text-ink" style={settingsMode ? SETTINGS_GRID_STYLE : GRID_STYLE}>
      <SkipLinks settingsMode={settingsMode} />
      <div className="col-start-1 row-span-3 row-start-1 flex min-h-0">
        <Rail />
      </div>
      {!settingsMode ? (
        <div id={SIDEBAR_ID} className="col-start-2 row-start-3 flex min-h-0 max-lg:hidden">
          <HubSidebar />
        </div>
      ) : null}
      <div className="col-span-3 col-start-2 row-start-1 flex min-w-0 flex-col">
        <TopBar onMenu={settingsMode ? undefined : overlay.toggle} menuOpen={overlay.open} />
      </div>
      <div className="col-span-3 col-start-2 row-start-2 flex min-w-0 flex-col">
        <OfflineStrip />
        {!settingsMode ? <TopPinsStrip /> : null}
      </div>
      {settingsMode ? (
        <div className="col-span-3 col-start-2 row-start-3 flex min-h-0 min-w-0">
          {children}
        </div>
      ) : (
        <>
          {overlay.open ? (
            // `contents`: the scrim and the drawer are fixed, so neither is a
            // grid item and the wrapper never claims a cell of its own.
            <div className="contents lg:hidden">
              {/* The scrim starts after the rail and below the bar, so both
                  stay visible and live while the drawer is open (1.16 keeps
                  the rail at 64 and the bar at 48 at every width). */}
              <button type="button" aria-label="Close sidebar" onClick={overlay.close} className="fixed bottom-0 end-0 start-[var(--os-rail-w)] top-[var(--os-top-h)] z-30 bg-[var(--os-scrim)]" />
              <HubSidebar overlay onClose={overlay.close} />
            </div>
          ) : null}
          <main id={MAIN_ID} tabIndex={-1} className="col-start-3 row-start-3 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-app outline-none">
            {children}
          </main>
          <div className="col-start-4 row-start-3 flex min-h-0">
            <OsSidekickPanel />
          </div>
        </>
      )}
      <NavigationAnnouncer />
    </div>
  );
}

export function OsShell({ children, drawer }: { children: React.ReactNode; drawer?: React.ReactNode }) {
  // The shell is the @drawer slot's parent, so this runs before the slot's own
  // render: it is what lets the intercepted task drawer tell a hard load of
  // /item/<id> from a click on a list row. See src/lib/nav/entry-path.ts.
  recordShellPath(usePathname());
  return (
    <OsShellProvider>
      <OsToastProvider>
        <BreadcrumbProvider>
          <ThemeApplier />
          <ReminderTicker />
          <CallDock />
          <IncomingCallWatcher />
          <RealtimeClient />
          <ShellShortcuts />
          {/* Before <Frame>, so its capture listener is registered ahead of
              any page's own guard: an object link opens in the section it
              was clicked in (section-link-interceptor.tsx). */}
          <SectionLinkInterceptor />
          <ShortcutsOverlay />
          <Frame>{children}</Frame>
          {/* The @drawer parallel slot (the intercepted task drawer). It is
              fixed-position, so it is deliberately NOT a grid item of the
              Frame: it sits over the content area and dims it through
              data-os-drawer rather than being laid out beside it.
              Children.toArray, not a bare {drawer}: Next hands a slot's value
              in as an ARRAY, and an unkeyed array child is reconciled by
              POSITION, which is how a slot silently remounts and loses its
              state on an unrelated shell re-render. It also put a React key
              warning in every user's console on every route under this
              layout. */}
          {Children.toArray(drawer)}
          <OsCommandPalette />
          <CustomizeMount />
          <SetStatusModal />
          <CreateTaskModal />
          <CreateListModal />
          <CreateSprintModal />
          <NotepadPanel />
          <MyWorkPeek />
          <ReminderPopover />
          <VoiceCapturePopover />
          <TemplateCenterMount />
          <MissionSplash />
        </BreadcrumbProvider>
      </OsToastProvider>
    </OsShellProvider>
  );
}
