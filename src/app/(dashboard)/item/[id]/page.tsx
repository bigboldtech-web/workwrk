"use client";

// /item/[id] - the task, on its own page.
//
// Reached by a hard load, a new tab, Copy link, search, the command palette,
// a notification or the drawer's Expand. A SOFT navigation from a list is
// intercepted by (dashboard)/@drawer/(.)item/[id] and renders the drawer over
// that list instead, at this same URL.
//
// The title is NOT rendered here. It is body item 1 in all three hosts, and
// the 48px title row carries only a CONDENSED, non-editable label that fades
// in once the body title has scrolled away - one title, one editor, one place
// the name can be typed (spec-task-detail section 2, "Page header stack").
//
// BackButton target, in the back-map's order, first match wins:
//   1. a same-origin ?returnTo= (the Inbox pane's Expand)
//   2. a subtask -> its parent task
//   3. the task's List, when the List has a page of its own
//   4. a Personal list task -> /my-work/personal
//   5. an assignee-only viewer who cannot read the List -> the Work landing
// Every one of those is a real page, and every one was checked against the
// route tree rather than assumed. Rule 4 named /tasks/personal-list until
// Phase 2 W4 moved that page to /my-work/personal and left a 308 behind it;
// Back goes to the page, not through the redirect. Rule 5 goes through
// WORK_HOME_HREF, the one constant every in-app href reads for the landing.
// Rule 3 is guarded on `board.spaceId`, because /boards/[slug] 404s a board
// with no Space and the personal board is exactly that.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Eye, EyeOff, Link2, Sparkles } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { Breadcrumb, type BreadcrumbItem } from "@/components/layout/os/top-bar/breadcrumb";
import { useTask } from "@/hooks/use-task";
import { useBoot } from "@/components/layout/os/boot-context";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { TaskDetailBody } from "@/components/board-view/task-detail-body";
import { ItemMoreMenu, type ItemMenuListContext } from "@/components/board-view/item-more-menu";
import { TaskListsChip, useTaskLists } from "@/components/board-view/task-lists-chip";
import { ShareBoardDialog } from "@/components/layout/os/share-board-dialog";
import { emitItemChanged } from "@/lib/realtime-events";
import { openTask } from "@/lib/nav/open-task";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { DEFAULT_STATUS_OPTIONS } from "@/lib/board-items-shared";

/** Only a same-origin path is accepted, and only one that starts with a single
 *  "/": "//evil.test" is a protocol-relative URL, not a path. */
function safeReturnTo(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { boot } = useBoot();
  const { openSidekick } = useOsShell();
  const { toast } = useOsToast();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  // Phase 5b: `?list=` opens the task IN a List it is shown in through a
  // link (its own fields and values, every write naming it).
  const listParam = searchParams?.get("list") ?? null;
  const task = useTask(id, { poll: true, listId: listParam });
  const taskLists = useTaskLists(id);
  const { item, board, decision, breadcrumb, watcherIds, createdById, missing, denied, context } = task;

  const [comment, setComment] = useState<string | null>(() => searchParams?.get("comment") ?? null);
  const [shareOpen, setShareOpen] = useState(false);
  const returnTo = safeReturnTo(searchParams?.get("returnTo") ?? null);

  // The condensed title label fades in once the body title has scrolled out.
  const [scrolled, setScrolled] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 56);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const listHasPage = Boolean(board?.spaceId && board.slug);
  const back = useMemo(() => {
    if (returnTo) return { href: returnTo, label: returnTo === "/inbox" || returnTo.startsWith("/inbox?") ? "Inbox" : "Back" };
    if (task.parent) return { href: `/item/${task.parent.id}`, label: task.parent.title };
    if (board && listHasPage && breadcrumb?.list.readable) return { href: `/boards/${board.slug}`, label: board.name };
    // /my-work/personal, not /tasks/personal-list: Phase 2 W4 moved the page
    // and left a 308 behind it, and routing the client router through a
    // redirect handler costs a hop for a destination this file already knows.
    if (board && !board.spaceId) return { href: "/my-work/personal", label: "Personal list" };
    return { href: WORK_HOME_HREF, label: "Home" };
  }, [returnTo, task.parent, board, breadcrumb, listHasPage]);

  // The top bar's hierarchy crumb. The bar's static table can only say "Task",
  // so without this the Space and the Folder are not reachable from a task at
  // all - which matters, because the spec removed the old board-name link
  // beside Back on the promise that the crumb would carry it.
  const crumbs = useMemo<BreadcrumbItem[] | null>(() => {
    if (!item || !breadcrumb) return null;
    const rows: BreadcrumbItem[] = [];
    const space = breadcrumb.space;
    if (space) {
      rows.push({
        label: space.name,
        href: space.readable ? `/spaces/${space.slug}` : undefined,
        tile: { name: space.name, icon: space.icon ?? undefined, size: "xs" },
      });
    }
    if (breadcrumb.folder) {
      rows.push({
        label: breadcrumb.folder.name,
        href: breadcrumb.folder.readable ? `/folders/${breadcrumb.folder.id}` : undefined,
      });
    }
    rows.push({
      label: breadcrumb.list.name,
      href: breadcrumb.list.readable && listHasPage ? `/boards/${breadcrumb.list.slug}` : undefined,
    });
    // The last crumb is the page itself: never clickable.
    rows.push({ label: item.title });
    return rows;
  }, [item, breadcrumb, listHasPage]);

  const onDeepLinkResolved = useCallback(() => {
    setComment(null);
    const params = new URLSearchParams();
    if (returnTo) params.set("returnTo", returnTo);
    // Which List the task is open in stays; only the comment anchor goes.
    if (listParam) params.set("list", listParam);
    const qs = params.toString();
    router.replace(`/item/${id}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, id, returnTo, listParam]);

  // THE ONE PATH for "it just left the List it is open in" (the menu's Remove
  // from this List, and the Lists chip's Remove on the Here row): every host
  // List hears it, then the page leaves when the viewer reached the task only
  // through that List, else shows it in its home.
  const linkedHere = context?.kind === "linked" ? context : null;
  const homeId = context && context.home.readable ? context.home.id : null;
  const onRemovedFromList = useCallback(() => {
    if (!linkedHere || !id) return;
    emitItemChanged(id, homeId, false, { leftListIds: [linkedHere.boardId] });
    if (!linkedHere.home.readable) {
      router.push(back.href);
      return;
    }
    router.replace(`/item/${id}`, { scroll: false });
  }, [linkedHere, homeId, id, router, back.href]);
  const onLinkMoved = useCallback((targetId: string) => {
    if (!linkedHere || !id) return;
    router.replace(`/item/${id}?list=${encodeURIComponent(targetId)}`, { scroll: false });
  }, [linkedHere, id, router]);

  // The two doors say two different things, in the user's words, because they
  // ARE two different things and the server has always answered them
  // differently (404 for a row that is gone, 403 for one you may not open).
  // One sentence for both told half the readers something false, and the Inbox
  // pane next door already said "This was deleted" on its own, so the product
  // stated the same state two ways. One control either way: the shell's
  // generic NotFoundView put a blue "Search" link beside the back button,
  // which is the second primary design-system section 4 forbids.
  // What the 404 branch may NOT say is "This task was deleted". The server
  // answers 404 for three different states it cannot tell apart: a row that
  // was hard-deleted, an id that never existed (a typo, a stale link), and an
  // id belonging to another organisation. Saying "deleted" to the second and
  // third readers is a false statement about their data, and it sends them
  // hunting through Trash for something that was never there. A task reached
  // through the legacy /tasks/<id> forwarder is the same story again: on a
  // workspace whose migration has not run the row is sitting in the `Task`
  // table, undeleted, waiting for scripts/migrate-legacy-tasks.ts.
  //
  // So one sentence, true in every one of those states, and the reader is
  // told where to look rather than what happened.
  const missingSentence = "We couldn't find that task";
  // A link that came through /tasks/<oldId> with no forwarding address is the
  // one case the reader CAN act on: the row is on the old task list, waiting
  // for the workspace's migration, and everything already moved is on My
  // work. Say which system the link is from and point at the page that has
  // the rest, rather than a bare not-found the founder read as "could not
  // load".
  // Two ways to know it is a legacy task: the forwarder's trail on the URL,
  // and, since the gate learned to look, the server's own answer. The second
  // is the one that holds for a bare /item/<oldId> pasted with no trail, and
  // it is the server's word rather than a guess from how the reader arrived.
  const fromLegacy = searchParams?.get("from") === "legacy-task" || task.missingReason === "legacy_task_not_migrated";

  const gone = (sentence: string, legacy = false) => (
    <div className="mx-auto w-full max-w-[760px] py-16 text-center">
      <QuietDots />
      <p className="mt-3 text-row text-ink-2">{sentence}</p>
      {legacy ? (
        <p className="mx-auto mt-2 max-w-[520px] text-sm text-ink-3">
          It has not been moved across yet; nothing was deleted. Your workspace admin finishes the move, and every task
          already moved is on{" "}
          <Link href="/my-work" className="font-medium text-brand-deep hover:underline">My work</Link>.
        </p>
      ) : null}
      <div className="mt-3 flex justify-center">
        <BackButton fallbackHref={legacy ? "/my-work" : WORK_HOME_HREF} label={legacy ? "My work" : "Home"} />
      </div>
    </div>
  );

  if (missing) {
    return (
      <div className="os-chrome h-full overflow-y-auto bg-app px-6">
        {fromLegacy ? gone("This link is from the old task system", true) : gone(missingSentence)}
      </div>
    );
  }
  if (denied) {
    return <div className="os-chrome h-full overflow-y-auto bg-app px-6">{gone("You no longer have access to this")}</div>;
  }

  const statuses = board?.statuses?.length ? board.statuses : [...DEFAULT_STATUS_OPTIONS];
  const aiOn = Boolean(boot.prefs?.modules?.activeAppKeys?.includes("ai"));
  const isWatching = Boolean(currentUserId && watcherIds.includes(currentUserId));

  // The menu's link flags come from the task's own Lists answer.
  const pageListContext = ((): ItemMenuListContext | undefined => {
    if (!context || !item) return undefined;
    const lists = taskLists.data;
    if (linkedHere) {
      const entry = lists?.linked.find((l) => l.boardId === linkedHere.boardId);
      const canShare = Boolean(lists?.canShare);
      return {
        boardId: linkedHere.boardId,
        kind: "linked",
        homeBoardId: homeId,
        homeStatuses: linkedHere.homeStatuses,
        canRemoveFromList: Boolean(entry?.canRemove),
        canLinkMove: Boolean(entry?.canRemove) && canShare,
        canAddToList: canShare,
        linkedSubtask: Boolean(item.parentItemId),
      };
    }
    return lists?.canShare && board?.spaceId && !item.parentItemId
      ? { boardId: context.boardId, kind: "home", canAddToList: true }
      : undefined;
  })();

  return (
    <div ref={scrollerRef} className="os-chrome h-full overflow-y-auto bg-app">
      {crumbs ? <Breadcrumb items={crumbs} /> : null}
      <div className="sticky top-0 z-10 flex h-12 items-center gap-3 bg-app px-6">
        <BackButton fallbackHref={back.href} label={back.label} />
        {/* Where else it is (Phase 5b); nothing for a task in no other List. */}
        {item ? (
          <TaskListsChip
            itemId={item.id}
            lists={taskLists}
            contextBoardId={linkedHere?.boardId ?? null}
            onRemovedHere={onRemovedFromList}
            homeBoardId={homeId}
          />
        ) : null}
        <span
          className="min-w-0 max-w-[320px] flex-1 truncate text-base font-medium text-ink transition-opacity"
          style={{ opacity: scrolled && item ? 1 : 0, transitionDuration: "var(--os-dur-base)", transitionTimingFunction: "var(--os-ease-out)" }}
          aria-hidden={!scrolled}
        >
          {item?.title ?? ""}
        </span>
        <span className="ms-auto flex shrink-0 items-center gap-0.5">
          {task.saveStatus !== "idle" ? (
            <AutosaveIndicator
              status={task.saveStatus}
              lastSavedAt={task.lastSavedAt}
              labels={{ saving: "Saving", saved: "Saved", error: "Not saved, retrying" }}
              className="me-1 max-sm:hidden"
            />
          ) : null}
          {item && currentUserId ? (
            <button
              type="button"
              title={isWatching ? "Unwatch this task" : "Watch this task · you get comments and status changes"}
              aria-label={isWatching ? "Unwatch this task" : "Watch this task"}
              aria-pressed={isWatching}
              onClick={() =>
                void task.patch({
                  watcherIds: isWatching ? watcherIds.filter((w) => w !== currentUserId) : [...watcherIds, currentUserId],
                })
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              {isWatching
                ? <Eye className="h-4 w-4 text-brand-deep" strokeWidth={1.5} aria-hidden="true" />
                : <EyeOff className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
            </button>
          ) : null}
          {item ? (
            <button
              type="button"
              title="Copy link"
              aria-label="Copy link"
              onClick={() => {
                void navigator.clipboard?.writeText(`${window.location.origin}/item/${item.id}`);
                toast("Link copied");
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
          {item && decision ? (
            <ItemMoreMenu
              item={{ id: item.id, boardId: item.boardId, title: item.title, status: item.status, assigneeIds: item.assigneeIds, itemTypeId: item.itemTypeId, parentItemId: item.parentItemId ?? null }}
              role={decision.role}
              host="page"
              listContext={pageListContext}
              onRemovedFromList={onRemovedFromList}
              onMoved={linkedHere ? onLinkMoved : undefined}
              currentUserId={currentUserId}
              statuses={statuses}
              watcherIds={watcherIds}
              personalList={!board?.spaceId}
              assigneeOnly={decision.via === "assignee"}
              isCreator={Boolean(currentUserId && createdById === currentUserId)}
              isAgent={boot.viewer.isAgent}
              isGuest={boot.viewer.orgRole === "GUEST"}
              archived={Boolean(item.archivedAt)}
              timeTrackingOn={task.moduleGating?.timeTracking ?? true}
              onPatch={(body) => void task.patch(body)}
              onRenameRequested={() => document.querySelector<HTMLElement>("[data-task-title]")?.click()}
              onShare={board?.spaceId ? () => setShareOpen(true) : undefined}
              onRestored={() => void task.reload()}
              onArchived={() => {
                emitItemChanged(item.id, item.boardId ?? null, true);
                router.push(back.href);
              }}
              onDeleted={() => {
                emitItemChanged(item.id, item.boardId ?? null, true);
                router.push(back.href);
              }}
            />
          ) : null}
          {aiOn && item ? (
            <button
              type="button"
              title="Ask AI"
              aria-label="Ask AI"
              onClick={() => openSidekick(`Help me with the task: ${item.title}`)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Ask AI
            </button>
          ) : null}
        </span>
      </div>

      <div className="px-6 pb-16 pt-2">
        <TaskDetailBody
          task={task}
          host="page"
          currentUserId={currentUserId}
          locale={boot.prefs?.home?.locale ?? null}
          isGuest={boot.viewer.orgRole === "GUEST"}
          moduleGating={task.moduleGating}
          deepLinkCommentId={comment}
          onDeepLinkResolved={onDeepLinkResolved}
          onOpenItem={(itemId) => openTask(router, itemId)}
          // Not in a linked context: the dialog would be the linked List's,
          // which cannot give edit on this task (see the drawer host).
          onRequestAccess={board?.spaceId && !linkedHere ? () => setShareOpen(true) : undefined}
          // Only ?list= goes; ?returnTo= stays, so the back target is the
          // one the reader arrived with.
          onOpenInHome={
            linkedHere?.home.readable && id
              ? () => router.replace(`/item/${id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`, { scroll: false })
              : undefined
          }
          missingView={gone(missingSentence)}
        />
      </div>
      {board?.spaceId ? (
        <ShareBoardDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          boardId={board.id}
          boardName={board.name}
          initialVisibility={board.visibility ?? "WORKSPACE"}
          onChanged={() => void task.reload()}
        />
      ) : null}
    </div>
  );
}

/** The four-dot row the design system's quiet empty and error states use. */
function QuietDots() {
  return (
    <span className="inline-flex items-center gap-1.5" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="h-2 w-2 rounded-full border-[1.5px] border-[var(--os-line-strong)]" />
      ))}
    </span>
  );
}
