"use client";

// TaskDetailBody, everything between a host's chrome and BoardItemDetail:
// the six states, the Archived banner, the read-only banner, and the strip
// that offers back words a session lapse would otherwise have eaten.
//
// It exists so the drawer, the page and the Inbox pane cannot disagree about
// what "loading" looks like or about whether a draft is offered back. Each
// host draws its own 48px header and nothing else.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, RotateCcw, Lock } from "lucide-react";
import { BoardItemDetail, type DetailHost, type DetailPatch, type ItemModuleGating } from "./board-item-detail";
import { useTaskDraft } from "@/hooks/use-task-draft";
import type { UseTask } from "@/hooks/use-task";
import { relativeTime, type LocalePrefs } from "@/lib/item-date";
import { accessMessage } from "@/lib/access-message";
import { DEFAULT_STATUS_OPTIONS } from "@/lib/board-items-shared";
import { rankOf } from "@/lib/item-role";

export interface TaskDetailBodyProps {
  task: UseTask;
  host: DetailHost;
  currentUserId: string | null;
  locale?: LocalePrefs | null;
  isGuest?: boolean;
  moduleGating?: ItemModuleGating;
  deepLinkCommentId?: string | null;
  onDeepLinkResolved?: () => void;
  onOpenItem?: (itemId: string) => void;
  /** Opens the one share dialog at List scope, for the read-only banner. */
  onRequestAccess?: () => void;
  /** Rendered in place of nothing when the task is gone (the host decides). */
  missingView: React.ReactNode;
}

export function TaskDetailBody({
  task,
  host,
  currentUserId,
  locale = null,
  isGuest = false,
  moduleGating,
  deepLinkCommentId = null,
  onDeepLinkResolved,
  onOpenItem,
  onRequestAccess,
  missingView,
}: TaskDetailBodyProps) {
  const { item, board, decision, breadcrumb, watcherIds, listOwner, loading, error, missing, patch, reload, refreshToken } = task;

  // The three dirty fields, lifted here so one flush covers all of them.
  const [drafts, setDrafts] = useState<{ title?: string; description?: string; comment?: string }>({});
  // On the way OUT, EVERYTHING dirty is kept, the title and the description
  // included.
  //
  // This used to drop them, on the stated ground that "the title and the
  // description commit themselves on unmount". They try to; that is not the
  // same thing. The unmount commit can be refused, can 403, can lose its
  // network, and nothing downstream of it was watching the answer, so the one
  // copy of a person's words was thrown away on the assumption the request
  // would land. A draft that turns out to be redundant costs one strip the
  // reader can dismiss; the other way round costs the words.
  //
  // The redundant case is then removed for real rather than guessed at: the
  // effect below compares the stored draft with what the server actually holds
  // and discards it only when they match.
  const draft = useTaskDraft({
    itemId: item?.id ?? null,
    getDraft: () => {
      const any = [drafts.title, drafts.description, drafts.comment].some((v) => v && v.trim());
      return any ? drafts : null;
    },
    baseVersion: item?.updatedAt ?? null,
  });

  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // An EMPTY string is clean, not a draft. The fields hand "" back the moment
  // a save succeeds, and a draft of "" is not nullish, so keeping it pinned
  // `draft ?? local` to the empty string: the box blanked itself on every
  // successful autosave and the next keystroke was committed as the WHOLE
  // description. Storing nothing instead lets the field's own local state,
  // which is re-synced to the server value, be what renders.
  const onDraftChange = useCallback((patchDraft: { title?: string; description?: string; comment?: string }) => {
    setDrafts((prev) => {
      const next = { ...prev, ...patchDraft };
      for (const key of ["title", "description", "comment"] as const) {
        if (next[key] === "") delete next[key];
      }
      return next;
    });
  }, []);

  // Unmount is the other way words are lost, and it is the common one: Esc,
  // the drawer's X, a click on the list, browser Back. The editors flush their
  // own autosave on the way out (board-item-detail), but an unsent COMMENT
  // cannot be posted on somebody's behalf, so it is written to the same
  // localStorage key a session lapse uses and offered back by the Restore
  // strip the next time this task is opened, in any host.
  const flushRef = useRef(draft.flush);
  useEffect(() => {
    flushRef.current = draft.flush;
  });
  useEffect(() => () => { flushRef.current(); }, []);

  // A draft the server already has is NOT an unsaved change.
  //
  // The title and the description do commit themselves on the way out, and
  // when that commit lands the stored draft is stale by a second. Rather than
  // assume either outcome, compare: a draft field that matches what came back
  // from the server is dropped, and the strip appears only for words the
  // server genuinely does not hold. A dirty comment always keeps it, because a
  // comment is never posted on somebody's behalf.
  const storedDescription =
    typeof item?.metadata?.description === "string" ? (item.metadata.description as string) : "";
  const discardRef = useRef(draft.discard);
  useEffect(() => {
    discardRef.current = draft.discard;
  });
  const pendingDraft = draft.pending;
  useEffect(() => {
    if (!pendingDraft || !item) return;
    const titleSaved = !pendingDraft.title?.trim() || pendingDraft.title === item.title;
    const descSaved = !pendingDraft.description?.trim() || pendingDraft.description === storedDescription;
    const noComment = !pendingDraft.comment?.trim();
    if (titleSaved && descSaved && noComment) discardRef.current();
  }, [pendingDraft, item, storedDescription]);

  const restoreTask = useCallback(async () => {
    if (!item || restoring) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/items/${item.id}/restore`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRestoreError(accessMessage(data, "Couldn't restore this task."));
        return;
      }
      setRestoreError(null);
      await reload();
    } finally {
      setRestoring(false);
    }
  }, [item, restoring, reload]);

  const statuses = useMemo(
    () => (board?.statuses?.length ? board.statuses : [...DEFAULT_STATUS_OPTIONS]),
    [board?.statuses],
  );

  if (missing) return <>{missingView}</>;

  if (loading && !item) return <TaskSkeleton host={host} />;

  if (error && !item) {
    return (
      <div className="py-8 text-center">
        <QuietDots />
        <p className="mt-3 text-row text-ink-2">Couldn&apos;t load this task</p>
        <button type="button" onClick={() => void reload()} className="mt-1 text-base font-medium text-brand-deep hover:underline">
          Retry
        </button>
      </div>
    );
  }

  if (!item || !decision) return null;

  const archived = Boolean(item.archivedAt);
  const canRestore = decision.roleBeforeArchive === "EDIT" || decision.roleBeforeArchive === "FULL";
  const readOnly = rankOf(decision.role) < rankOf("EDIT");
  const roleWord = decision.role === "COMMENT" ? "Can comment" : "View only";
  const ownerName = [listOwner?.firstName, listOwner?.lastName].filter(Boolean).join(" ").trim() || listOwner?.email || null;
  // The banners sit INSIDE the same column as the body, or on the page host
  // they run the full 1075px content width above a 760px column.
  const column = host === "page" ? "mx-auto w-full max-w-[760px]" : "w-full";

  return (
    <div className={`${column} space-y-4`}>
      {draft.pending ? (
        <div className="flex min-h-9 flex-wrap items-center gap-3 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning-text">
          <span>
            You have unsaved changes{draft.savedAt ? ` from ${relativeTime(draft.savedAt, locale)}` : ""}
          </span>
          <button
            type="button"
            className="font-medium underline-offset-2 hover:underline"
            onClick={() => {
              const value = draft.restore();
              if (value) setDrafts(value);
            }}
          >
            Restore
          </button>
          <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={draft.discard}>
            Discard
          </button>
        </div>
      ) : null}

      {archived ? (
        <div className="flex min-h-9 items-center gap-3 rounded-md bg-warning-bg px-3 py-2">
          <Archive className="h-4 w-4 shrink-0 text-warning-text" strokeWidth={1.5} aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm text-warning-text">
            {/* Rule 12 caps everyone BELOW Full at Can view on an archived
                task, so telling a creator or an admin that it is read-only,
                directly above a live editor, is simply false. */}
            {readOnly
              ? "Archived. It is read-only and hidden from list views."
              : "Archived. It is hidden from list views."}
          </p>
          {canRestore ? (
            <button
              type="button"
              onClick={() => void restoreTask()}
              disabled={restoring}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-sm font-medium text-ink transition-colors hover:bg-hover disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              Restore
            </button>
          ) : null}
        </div>
      ) : readOnly ? (
        <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md bg-subtle px-3 py-2 text-sm text-ink-2">
          <Lock className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden="true" />
          <span>{roleWord}. Ask {ownerName ?? "the list owner"} for edit access.</span>
          {onRequestAccess ? (
            <button
              type="button"
              onClick={onRequestAccess}
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              Request access
            </button>
          ) : null}
        </div>
      ) : null}

      {restoreError ? <p className="text-sm text-danger-text" role="alert">{restoreError}</p> : null}

      <BoardItemDetail
        item={item}
        role={decision.role}
        currentUserId={currentUserId}
        customFields={board?.fields ?? []}
        statusOptions={statuses}
        onPatch={patch as (b: DetailPatch, o?: Partial<typeof item>) => void}
        host={host}
        deepLinkCommentId={deepLinkCommentId}
        onDeepLinkResolved={onDeepLinkResolved}
        onOpenItem={onOpenItem}
        moduleGating={moduleGating}
        createdBy={task.createdBy}
        listContext={
          board
            ? { id: board.id, slug: board.slug, name: board.name, readable: breadcrumb?.list.readable ?? true }
            : null
        }
        watcherIds={watcherIds}
        locale={locale}
        isGuest={isGuest}
        refreshToken={refreshToken}
        titleDraft={drafts.title ?? null}
        descriptionDraft={drafts.description ?? null}
        commentDraft={drafts.comment}
        onDraftChange={onDraftChange}
      />
    </div>
  );
}

/** The skeleton heights the spec names: title bar, four 36px field rows at
 *  40/80/40/60 width, a 96px description block, one row. No "Loading…". */
function TaskSkeleton({ host }: { host: DetailHost }) {
  const widths = ["40%", "80%", "40%", "60%"];
  return (
    <div className={`${host === "page" ? "mx-auto w-full max-w-[760px]" : "w-full"} space-y-6`} aria-hidden="true">
      <div className="h-7 w-[60%] rounded bg-skeleton" />
      <div className="space-y-2">
        {widths.map((w, i) => (
          <div key={i} className="flex h-9 items-center gap-3">
            <div className="h-3 w-[110px] shrink-0 rounded bg-skeleton" />
            <div className="h-3 rounded bg-skeleton" style={{ width: w }} />
          </div>
        ))}
      </div>
      <div className="h-24 rounded bg-skeleton" />
      <div className="h-9 w-[70%] rounded bg-skeleton" />
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
