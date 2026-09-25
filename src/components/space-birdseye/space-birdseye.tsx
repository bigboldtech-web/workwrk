"use client";

// Bird's eye: every List of a Space the viewer can read, side by side, as
// columns of status-tinted cards, and Focus, one List's statuses as columns.
// /spaces/<slug>?view=birdseye, and &focus=<boardId> for focus mode.
//
// FOCUS IS LATCHED STATE (review #13). It starts from the page's focus param
// and changes only through enterFocus, switchFocus, exitFocus, a popstate on
// this Space's own path, a new focus param from a soft navigation, and a
// CHANGE of the URL's focus while the URL is this Space's own (a link to the
// overview clicked while in focus). It is never simply read from the search
// params: while the task drawer is open they are the drawer's, and the view
// under the drawer must keep its mode.
//
// HISTORY (reviews #15, #16). Entering focus pushes one same-path entry, so
// browser Back returns to the overview; switching Lists replaces it; leaving
// focus steps back over it when it is the entry behind, else replaces, so
// leaving never adds an entry and Back afterwards goes past Bird's eye. All
// of it goes through nav-history's same-path helpers, so BackButton and the
// bar's arrows agree with the browser.
//
// The overview stays MOUNTED while focus shows (hidden), so its pages, its
// expanded subtasks and its remembered card heights survive, and its scroll
// offsets are put back the moment focus clears (review #19).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ErrorState } from "@/components/ui/error-state";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useLayer, useOsShell } from "@/components/layout/os/shell-context";
import {
  backToSamePath,
  pushSamePath,
  recordSamePathPop,
  replaceSamePath,
} from "@/components/layout/os/top-bar/nav-history";
import { openTask } from "@/lib/nav/open-task";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import type { BirdseyeCard } from "@/lib/work/birdseye";
import { BirdseyeToolbar } from "./birdseye-toolbar";
import { BirdseyeOverview, type CardActions } from "./birdseye-overview";
import { BirdseyeFocus } from "./birdseye-focus";
import { BirdseyeSkeleton } from "./birdseye-skeleton";
import { useBirdseye, type ItemCreatedDetail, type ItemEventDetail } from "./use-birdseye";

const SEARCH_DEBOUNCE_MS = 250;

/** What the overview's ErrorState names, in "Couldn't load {what}". */
export const OVERVIEW_ERROR_WHAT = "the bird's eye view";

/** The second line when the read's own message would only repeat the title. */
export const OVERVIEW_ERROR_FALLBACK_HINT = "Something went wrong on our side. Try again in a moment.";

/** A message with its case, curly apostrophes and trailing punctuation set aside, for comparing. */
function sameWords(s: string): string {
  return s.trim().replace(/[\u2018\u2019]/g, "'").replace(/[.!\s]+$/, "").toLowerCase();
}

/**
 * The hint line under the overview's ErrorState. The route's catch-all 500
 * answers with the very sentence ErrorState already builds as its title
 * ("Couldn't load the bird's eye view."), so passing it through printed the
 * title twice. A message that only restates the title, or no message at all,
 * gives way to a line that says something new; a message that adds
 * something (offline, an expired session, no access) still shows as it is.
 */
export function overviewErrorHint(message: string | null | undefined, what: string = OVERVIEW_ERROR_WHAT): string {
  const m = message?.trim();
  if (!m || sameWords(m) === sameWords(`Couldn't load ${what}`)) return OVERVIEW_ERROR_FALLBACK_HINT;
  return m;
}

function historyFocusFrom(): string | null {
  try {
    const from = (window.history.state as { beFocusFrom?: unknown } | null)?.beFocusFrom;
    return typeof from === "string" ? from : null;
  } catch {
    return null;
  }
}

export function SpaceBirdseye({
  spaceId,
  spaceSlug,
  overviewHref,
  initialFocusId,
  canCreateList,
}: {
  spaceId: string;
  spaceSlug: string;
  /** Bird's eye's own URL without a focus: the bare Space URL when it is the pinned default. */
  overviewHref: string;
  initialFocusId: string | null;
  canCreateList: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useOsToast();
  const { openCreateList } = useOsShell();
  const basePath = `/spaces/${encodeURIComponent(spaceSlug)}`;

  // ── Focus, latched ────────────────────────────────────────────────
  const [focusId, setFocusId] = useState<string | null>(initialFocusId);
  const [seenInitial, setSeenInitial] = useState(initialFocusId);
  if (seenInitial !== initialFocusId) {
    // A soft navigation brought a different focus link: follow it.
    setSeenInitial(initialFocusId);
    setFocusId(initialFocusId);
  }
  // A link to this page's own URL while in focus (the Bird's eye tab, or the
  // sidebar's Space row when Bird's eye is pinned) changes the URL but never
  // re-renders the page: the router still holds the tree it last rendered,
  // which the same-path entries below do not touch, so the prop above does
  // not move. The URL's focus is therefore followed too, but only when it
  // CHANGES, and only while the URL is this page's own: under the task drawer
  // the pathname and search are the drawer's (review #13), and during the
  // one render after a same-path push the router's URL still lags behind.
  const searchParams = useSearchParams();
  const urlFocus = pathname === basePath ? searchParams.get("focus") : undefined;
  const [seenUrlFocus, setSeenUrlFocus] = useState(urlFocus);
  if (urlFocus !== undefined && urlFocus !== seenUrlFocus) {
    setSeenUrlFocus(urlFocus);
    setFocusId(urlFocus);
  }
  const userLeftFocus = useRef(false);

  // ── Filters ───────────────────────────────────────────────────────
  const [queryInput, setQueryInput] = useState("");
  const [q, setQ] = useState("");
  const [hideClosed, setHideClosed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(queryInput.trim().slice(0, 120)), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [queryInput]);

  const focusHref = useCallback(
    (id: string) => `${basePath}?view=birdseye&focus=${encodeURIComponent(id)}`,
    [basePath],
  );

  // A focus the server will not show (never readable, or no longer): back to
  // the overview, and say so.
  const onFocusMissing = useCallback(() => {
    replaceSamePath(overviewHref, null);
    setFocusId(null);
    toast("That List isn't available to you.", { tone: "danger" });
  }, [overviewHref, toast]);

  // A Space with exactly one List has nothing to see from above: open it in
  // focus, once, unless the person has already left focus here (review #27).
  const autoFocused = useRef(false);
  const onOverviewLoaded = useCallback(
    (lists: Array<{ id: string }>) => {
      if (autoFocused.current || userLeftFocus.current || lists.length !== 1) return;
      if (new URLSearchParams(window.location.search).get("focus")) return;
      autoFocused.current = true;
      replaceSamePath(focusHref(lists[0].id), { beFocusFrom: null });
      setFocusId(lists[0].id);
    },
    [focusHref],
  );

  const data = useBirdseye({ spaceId, focusId, q, hideClosed, onFocusMissing, onOverviewLoaded });
  const [now] = useState(() => new Date());

  // ── Overview scroll, kept across focus ────────────────────────────
  const overviewScroller = useRef<HTMLDivElement>(null);
  const savedScroll = useRef<{ left: number; top: number } | null>(null);
  const saveScroll = () => {
    const el = overviewScroller.current;
    if (el && !el.closest("[hidden]")) savedScroll.current = { left: el.scrollLeft, top: el.scrollTop };
  };
  useLayoutEffect(() => {
    if (focusId !== null) return;
    const el = overviewScroller.current;
    const saved = savedScroll.current;
    if (!el || !saved) return;
    el.scrollLeft = saved.left;
    el.scrollTop = saved.top;
  }, [focusId]);

  const enterFocus = useCallback(
    (id: string) => {
      saveScroll();
      pushSamePath(focusHref(id), { beFocusFrom: overviewHref });
      setFocusId(id);
    },
    [focusHref, overviewHref],
  );

  const switchFocus = useCallback(
    (id: string) => {
      replaceSamePath(focusHref(id), { beFocusFrom: historyFocusFrom() });
      setFocusId(id);
    },
    [focusHref],
  );

  const exitFocus = useCallback(() => {
    userLeftFocus.current = true;
    // The entry behind this one is the overview we came from: step back over
    // it (the popstate below clears focus). Otherwise (a shared link opened
    // straight into focus) the entry becomes the overview, adding nothing.
    if (historyFocusFrom() === overviewHref && backToSamePath(overviewHref)) return;
    replaceSamePath(overviewHref, null);
    setFocusId(null);
  }, [overviewHref]);

  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname !== basePath) return;
      setFocusId(new URLSearchParams(window.location.search).get("focus"));
      recordSamePathPop();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [basePath]);

  // Esc leaves focus, when nothing on top of it (the drawer, a menu, a field
  // that consumed the key) took it first.
  useLayer(focusId !== null, { kind: "panel", close: exitFocus });

  // ── Opening a task ────────────────────────────────────────────────
  // The drawer opens OVER this view with the task in the URL. When it closes
  // and the path is this Space again, the card it was opened from is re-read,
  // with its subtasks, so whatever changed in the drawer shows at once.
  const lastOpened = useRef<string | null>(null);
  const wasAway = useRef(false);
  const { refreshCard, loadSubtasks } = data;
  useEffect(() => {
    if (pathname !== basePath) {
      if (lastOpened.current) wasAway.current = true;
      return;
    }
    if (!wasAway.current || !lastOpened.current) return;
    const id = lastOpened.current;
    wasAway.current = false;
    lastOpened.current = null;
    void refreshCard(id);
    void loadSubtasks(id);
  }, [pathname, basePath, refreshCard, loadSubtasks]);

  const onOpen = useCallback(
    (id: string) => {
      lastOpened.current = id;
      openTask(router, id);
    },
    [router],
  );

  // ── Other people's changes, and this tab's drawer ─────────────────
  const { applyItemEvent, applyItemCreated } = data;
  useEffect(() => {
    const onRealtime = (e: Event) => applyItemEvent((e as CustomEvent<ItemEventDetail>).detail);
    const onCreated = (e: Event) => applyItemCreated((e as CustomEvent<ItemCreatedDetail>).detail);
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    window.addEventListener("workwrk:item-created", onCreated);
    return () => {
      window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
      window.removeEventListener("workwrk:item-created", onCreated);
    };
  }, [applyItemEvent, applyItemCreated]);

  const { changeStatus } = data;
  const onChangeStatus = useCallback((card: BirdseyeCard, next: string) => void changeStatus(card, next), [changeStatus]);
  const actions: CardActions = { now, onOpen, onChangeStatus, onLoadSubtasks: loadSubtasks };

  // ── Render ────────────────────────────────────────────────────────
  const toolbar = (
    <BirdseyeToolbar
      query={queryInput}
      onQuery={setQueryInput}
      hideClosed={hideClosed}
      onHideClosed={setHideClosed}
      refreshing={data.refreshing}
    />
  );

  const noLists = data.status === "ready" && data.lists.length === 0;

  return (
    <div className="os-chrome flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Nothing to search or filter until there is a List. */}
      {noLists ? null : toolbar}
      {noLists ? (
        <OsEmptyView
          context="board"
          title="No Lists to show here yet"
          hint="Lists you can open in this Space show up here."
          action={canCreateList ? { label: "New List", onClick: () => openCreateList({ spaceId }) } : undefined}
        />
      ) : (
        <>
          <div hidden={focusId !== null} className="flex min-h-0 min-w-0 flex-1 flex-col">
            {data.overviewReady ? (
              <BirdseyeOverview
                ref={overviewScroller}
                lists={data.overviewLists}
                columns={data.overview}
                subtasks={data.subtasks}
                q={q}
                hideClosed={hideClosed}
                actions={actions}
                onFocus={enterFocus}
                onLoadMore={data.loadMore}
                onCreate={(boardId, title, status) => data.createTask(boardId, title, status, "top")}
              />
            ) : focusId === null && data.status === "error" ? (
              <ErrorState what={OVERVIEW_ERROR_WHAT} onRetry={data.reload} hint={overviewErrorHint(data.error)} />
            ) : focusId === null ? (
              <BirdseyeSkeleton />
            ) : null}
          </div>
          {focusId !== null ? (
            <BirdseyeFocus
              lists={data.lists}
              focusedId={focusId}
              focus={data.focus}
              status={data.status}
              subtasks={data.subtasks}
              q={q}
              hideClosed={hideClosed}
              actions={actions}
              onSwitch={switchFocus}
              onLeave={exitFocus}
              onLoadMore={data.loadMore}
              onCreate={data.createTask}
              onRetry={data.reload}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
