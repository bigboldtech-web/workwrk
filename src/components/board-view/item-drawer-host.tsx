"use client";

// ItemDrawerHost - the task, in the Drawer, at its own URL.
//
// It replaces `BoardItemDrawer`, whose file comment claimed a "right-slide-in,
// 480px" drawer and whose code rendered a centred 1000x88vh modal with a
// scrim and a 400px icon-strip rail. The comment is now true.
//
// What "at its own URL" buys, and what it costs:
//
//   The URL is `/item/<id>` whether the task is open beside a list or on its
//   own page, so Copy link always works, a refresh gives the full page, and
//   Back closes the drawer because no history entry of our own was pushed.
//   This host is rendered by the `@drawer/(.)item/[id]` intercept, which only
//   matches a SOFT navigation - a hard load falls through to the page.
//
//   THE INTERCEPT ALWAYS RENDERS THE TASK. An earlier revision returned null
//   unless a sessionStorage "intent" written by the pushing host named this
//   task, which meant every door that was not one of four migrated list
//   surfaces put the task's URL in the bar and left the previous surface on
//   screen: Next had already matched the intercept and held `children` behind
//   it. Nothing here may return null on the strength of where the navigation
//   came from. The recorded intent survives for one job only, naming the URL
//   the drawer was opened FROM so Close can land there.
//
//   Expand does not navigate. The URL is already right, so Expand only widens
//   this container into the content area, the body centres its 760 column and
//   the header becomes the page title row with a BackButton to the host list.
//
// Closing: the BackButton primitive owns the history check, so all three doors
// (the X, a click on the dimmed list, browser Back) land on the host list.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Breadcrumb, type BreadcrumbItem } from "@/components/layout/os/top-bar/breadcrumb";
import { useSession } from "next-auth/react";
import { Eye, EyeOff, Link2, Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import { Drawer, DRAWER_DEFAULT_W, clampDrawerWidth } from "@/components/ui/drawer";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useTask } from "@/hooks/use-task";
import { useBoot } from "@/components/layout/os/boot-context";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { clearTaskDrawer, openTask, readTaskDrawer } from "@/lib/nav/open-task";
import { isInitialEntryPath } from "@/lib/nav/entry-path";
import { emitItemChanged } from "@/lib/realtime-events";
import { BackButton, goBackOr } from "@/components/ui/back-button";
import { ShareBoardDialog } from "@/components/layout/os/share-board-dialog";
import { TaskDetailBody } from "./task-detail-body";
import { ItemMoreMenu } from "./item-more-menu";
import { DEFAULT_STATUS_OPTIONS } from "@/lib/board-items-shared";

/** The intent is read once per mount and never changes under us. */
function subscribeNever(): () => void {
  return () => {};
}

export function ItemDrawerHost({ itemId }: { itemId: string }) {
  // The URL this drawer was opened from, when a host recorded one. It is a
  // Close fallback and NOTHING else: whether the drawer renders is Next's
  // decision, taken when the intercept matched.
  // useSyncExternalStore, not an effect: the server snapshot is null, so the
  // markup a hard load streams never disagrees with the client's first render.
  const intentFrom = useSyncExternalStore(
    subscribeNever,
    () => readTaskDrawer(itemId)?.from ?? null,
    () => null,
  );

  const router = useRouter();
  const searchParams = useSearchParams();
  // The ONE case that must not render: the document itself was loaded at this
  // task's URL, which Next still routes through the intercept when the URL
  // carries a query string. `children` is the full task page in that case, so
  // returning nothing here shows the task, never a blank surface. Every other
  // arrival is a soft navigation and gets the drawer, whatever pushed it.
  const hardLoad = isInitialEntryPath(`/item/${itemId}`);
  const { data: session } = useSession();
  const { boot } = useBoot();
  const { openSidekick } = useOsShell();
  const { toast } = useOsToast();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const task = useTask(hardLoad ? null : itemId, { poll: true });
  const [expanded, setExpanded] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [width, setWidth] = useState<number>(() => clampDrawerWidth(boot.prefs?.home?.work?.drawerWidth ?? DRAWER_DEFAULT_W));
  const [comment, setComment] = useState<string | null>(() => searchParams?.get("comment") ?? null);

  // Single use: a stale entry left armed for the rest of the tab session would
  // send a later Close to a list nobody is on any more.
  useEffect(() => {
    clearTaskDrawer();
  }, [itemId]);

  const { item, board, decision, breadcrumb, watcherIds, createdById } = task;

  // Close lands on the recorded host URL, else on the task's own List, else on
  // the one place every task is reachable from. The history check itself lives
  // in ui/back-button.tsx, the one file allowed to call router.back().
  // /boards/[slug] 404s a board with no Space, and the personal board is
  // exactly that, so a personal task's fallback is its own page, which lives
  // at /my-work/personal since Phase 2 W4. The old /tasks/personal-list is a
  // 308 now, and closing a drawer into a redirect handler is a wasted hop.
  const hostUrl =
    intentFrom ??
    (board?.spaceId && board.slug ? `/boards/${board.slug}` : board && !board.spaceId ? "/my-work/personal" : "/everything");
  const close = useCallback(() => {
    clearTaskDrawer();
    goBackOr(router, hostUrl);
  }, [router, hostUrl]);

  const saveWidth = useCallback((px: number) => {
    setWidth(px);
    void apiFetch("/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ home: { work: { drawerWidth: px } } }),
    });
  }, []);

  // Strip ?comment= once the thread has landed on it, so a refresh does not
  // pulse again and Copy link copies the clean task URL.
  const onDeepLinkResolved = useCallback(() => {
    setComment(null);
    router.replace(`/item/${itemId}`, { scroll: false });
  }, [router, itemId]);

  // A click on the dimmed list closes the drawer (a click on another ROW
  // navigates, which swaps the task, and that click never reaches here).
  useEffect(() => {
    if (expanded) return;
    const onDocClick = (e: MouseEvent) => {
      const main = document.getElementById("main");
      if (!main) return;
      const target = e.target as Node | null;
      if (!target || !main.contains(target)) return;
      if ((target as HTMLElement).closest?.("a,button,[role='button'],input,textarea,select")) return;
      close();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [close, expanded]);

  const statuses = board?.statuses?.length ? board.statuses : [...DEFAULT_STATUS_OPTIONS];
  const aiOn = Boolean(boot.prefs?.modules?.activeAppKeys?.includes("ai"));
  const isWatching = Boolean(currentUserId && watcherIds.includes(currentUserId));
  const gone = useCallback(() => {
    if (item) emitItemChanged(item.id, item.boardId ?? null, true);
    close();
  }, [item, close]);

  // The Space's module toggles. The board page hands these to its renderers as
  // props; this host is in another slot and cannot be handed anything, so they
  // arrive with the task. Without them a Space with Priority, Tags or Time
  // tracking switched off still rendered those fields, because item-fields.ts
  // falls back to ALL_ON when the prop is absent.
  const gating = task.moduleGating;

  if (hardLoad) return null;

  const crumb = (
    <nav aria-label="Task location" className="flex min-w-0 flex-1 items-center gap-1 text-sm text-ink-2">
      {breadcrumb?.list ? (
        breadcrumb.list.readable && board?.spaceId && board.slug ? (
          <a href={`/boards/${board.slug}`} className="max-w-[160px] truncate hover:text-ink">{breadcrumb.list.name}</a>
        ) : (
          <span className="max-w-[160px] truncate">{breadcrumb.list.name}</span>
        )
      ) : null}
      {item ? (
        <>
          {/* One separator for one idea: the same chevron the top bar and the
              Space tree use, not a slash. */}
          <span aria-hidden="true" className="text-ink-3">&rsaquo;</span>
          <span className="max-w-[200px] truncate text-ink">{item.title}</span>
        </>
      ) : null}
    </nav>
  );

  const header = (
    <>
      {/* Expanded, the drawer IS the page, so its header is the page title
          row: a labelled way back to the list the task was opened from
          (spec drawer block, Expand). */}
      {expanded ? (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <BackButton fallbackHref={hostUrl} label={board?.name ?? "Back"} />
          <span className="min-w-0 max-w-[320px] truncate text-base font-medium text-ink">{item?.title ?? ""}</span>
        </span>
      ) : (
        crumb
      )}
      <span className="flex shrink-0 items-center gap-0.5">
        {task.saveStatus !== "idle" ? (
          <AutosaveIndicator
            status={task.saveStatus}
            lastSavedAt={task.lastSavedAt}
            labels={{ saving: "Saving", saved: "Saved", error: "Not saved, retrying" }}
            className="me-1 max-sm:hidden"
          />
        ) : null}
        {aiOn && item ? (
          <HeaderIcon
            label="Ask AI"
            onClick={() => openSidekick(`Help me with the task: ${item.title}`)}
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.5} />
          </HeaderIcon>
        ) : null}
        {item && currentUserId ? (
          <HeaderIcon
            label={isWatching ? "Unwatch this task" : "Watch this task · you get comments and status changes"}
            onClick={() =>
              void task.patch({
                watcherIds: isWatching ? watcherIds.filter((w) => w !== currentUserId) : [...watcherIds, currentUserId],
              })
            }
          >
            {isWatching ? <Eye className="h-4 w-4 text-brand-deep" strokeWidth={1.5} /> : <EyeOff className="h-4 w-4" strokeWidth={1.5} />}
          </HeaderIcon>
        ) : null}
        {item ? (
          <HeaderIcon
            label="Copy link"
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}/item/${item.id}`);
              toast("Link copied");
            }}
          >
            <Link2 className="h-4 w-4" strokeWidth={1.5} />
          </HeaderIcon>
        ) : null}
        {item && decision ? (
          <ItemMoreMenu
            item={{ id: item.id, boardId: item.boardId, title: item.title, status: item.status, assigneeIds: item.assigneeIds, itemTypeId: item.itemTypeId }}
            role={decision.role}
            host="drawer"
            currentUserId={currentUserId}
            statuses={statuses}
            watcherIds={watcherIds}
            personalList={!board?.spaceId}
            assigneeOnly={decision.via === "assignee"}
            isCreator={Boolean(currentUserId && createdById === currentUserId)}
            isAgent={boot.viewer.isAgent}
            isGuest={boot.viewer.orgRole === "GUEST"}
            archived={Boolean(item.archivedAt)}
            timeTrackingOn={gating?.timeTracking ?? true}
            onPatch={(body) => void task.patch(body)}
            onRenameRequested={() => document.querySelector<HTMLElement>("[data-task-title]")?.click()}
            onShare={board?.spaceId ? () => setShareOpen(true) : undefined}
            onArchived={gone}
            onDeleted={gone}
          />
        ) : null}
        <HeaderIcon label={expanded ? "Collapse" : "Expand · full page"} onClick={() => setExpanded((v) => !v)} className="max-lg:hidden">
          {expanded ? <Minimize2 className="h-4 w-4" strokeWidth={1.5} /> : <Maximize2 className="h-4 w-4" strokeWidth={1.5} />}
        </HeaderIcon>
        <HeaderIcon label="Close · Esc" onClick={close}>
          <X className="h-4 w-4" strokeWidth={1.5} />
        </HeaderIcon>
      </span>
    </>
  );

  // The top bar's hierarchy crumb, the same one the full page declares.
  // Without it the bar reads the static table's "Work > Task" while the drawer
  // is open, so the one URL named the task on a hard load and named nothing on
  // a soft one. The sidebar row the reader came from is the shell resolver's
  // job and is unaffected by this.
  const crumbs: BreadcrumbItem[] | null = (() => {
    if (!item || !breadcrumb) return null;
    const rows: BreadcrumbItem[] = [];
    if (breadcrumb.space) {
      rows.push({
        label: breadcrumb.space.name,
        href: breadcrumb.space.readable ? `/spaces/${breadcrumb.space.slug}` : undefined,
        tile: { name: breadcrumb.space.name, icon: breadcrumb.space.icon ?? undefined, size: "xs" },
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
      href: breadcrumb.list.readable && board?.spaceId && board.slug ? `/boards/${board.slug}` : undefined,
    });
    // The last crumb is the thing itself: never clickable.
    rows.push({ label: item.title });
    return rows;
  })();

  return (
    <>
      {crumbs ? <Breadcrumb items={crumbs} /> : null}
      <Drawer
        open
        onClose={close}
        header={header}
        width={width}
        onWidthChange={saveWidth}
        expanded={expanded}
        ariaLabel={item ? item.title : "Task"}
      >
        {/* Expanded, the drawer IS the page: the body centres the same 760
            column the page host uses, so Expand changes the geometry and
            nothing else (spec-task-detail, drawer block: "the column widens to
            760 centred"). */}
        <div className={expanded ? "mx-auto w-full max-w-[760px] px-6 py-6" : "px-5 py-5"}>
          <TaskDetailBody
            task={task}
            host="drawer"
            currentUserId={currentUserId}
            locale={boot.prefs?.home?.locale ?? null}
            isGuest={boot.viewer.orgRole === "GUEST"}
            moduleGating={gating}
            deepLinkCommentId={comment}
            onDeepLinkResolved={onDeepLinkResolved}
            onOpenItem={(id) => openTask(router, id)}
            onRequestAccess={board?.slug ? () => setShareOpen(true) : undefined}
            missingView={
              <div className="py-8 text-center">
                {/* The drawer says what the page says, for the same reasons
                    the page's comment gives: a 404 is a row that is gone, an
                    id that never existed, another org's id, OR a legacy task
                    the migration has not moved yet. "This task was deleted"
                    was a false statement to three of those four readers, and
                    the fourth (the legacy case) is the one the server now
                    names, so it is the one this says out loud. */}
                <p className="text-row text-ink-2">
                  {task.denied
                    ? "You no longer have access to this"
                    : task.missingReason === "legacy_task_not_migrated"
                      ? "This link is from the old task system"
                      : "We couldn't find that task"}
                </p>
                {task.missingReason === "legacy_task_not_migrated" ? (
                  <p className="mx-auto mt-2 max-w-[420px] text-sm text-ink-3">
                    It has not been moved across yet; nothing was deleted. Your workspace admin finishes the move, and
                    every task already moved is on My work.
                  </p>
                ) : null}
                <button type="button" onClick={close} className="mt-1 text-base font-medium text-brand-deep hover:underline">
                  Close
                </button>
              </div>
            }
          />
        </div>
      </Drawer>
      {board?.slug ? (
        <ShareBoardDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          boardId={board.id}
          boardName={board.name}
          initialVisibility={board.visibility ?? "WORKSPACE"}
          onChanged={() => void task.reload()}
        />
      ) : null}
    </>
  );
}

function HeaderIcon({
  label,
  onClick,
  children,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink ${className}`}
    >
      {children}
    </button>
  );
}
