"use client";

// CommentThread, the one thread (spec-task-detail section 2, design-system
// 5.19). Replaces ItemThread, which lived only inside the task drawer.
//
// What it is responsible for, and why each one is here rather than in a host:
//
//   THE ?comment= CONTRACT. `deepLinkId` makes the first request
//   `?around=<id>` instead of the plain first page, scrolls the row into view,
//   pulses it ONCE and moves focus to it, then calls `onDeepLinkResolved` so
//   the host can strip the query. Its three failure paths (the comment was
//   deleted or is not on this task; the thread failed to load; the thread has
//   not loaded yet) are this component's, not the host's, a host cannot know
//   which one happened.
//
//   ERRORS ARE NEVER SWALLOWED. The thread this replaces did
//   `catch { /* best-effort */ }` around both fetches and rendered "No
//   comments yet." on a 500, so a broken thread and an empty one looked
//   identical (critic #11). Every failure here is a row with Retry.
//
//   THE DRAFT IS NEVER LOST. It is held per task in memory (so closing and
//   reopening the drawer keeps it) and handed to the host for the
//   session-lapse flush. A failed POST keeps every character.
//
// What it deliberately does NOT do: threaded replies, resolve, and assigning a
// comment. All three are reserved slots in the design system, and a control
// with no backing table is exactly the fabricated chrome this refresh removes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Send, SmilePlus, X } from "lucide-react";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Picker, type PickerSectionDef } from "@/components/ui/picker";
import { MarkdownLite } from "@/components/ui/markdown-lite";
import { Avatar, personLabel } from "@/components/ui/avatar-stack";
import { Dots } from "@/components/ui/dots";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { accessMessage } from "@/lib/access-message";
import { describeItemActivity } from "@/lib/item-activity-describe";
import { ITEM_ACTIVITY_KINDS, isItemActivityKind, type ItemActivityKind } from "@/lib/item-activity-kinds";
import { relativeTime, formatTaskDate, type LocalePrefs } from "@/lib/item-date";
import { surviving, type MentionRef } from "@/lib/mention-token";
import { useMentionTypeahead } from "./mention-typeahead";
import { DEFAULT_STATUS_OPTIONS, type StatusOption } from "@/lib/board-items-shared";
import type { ThreadActivity, ThreadUpdate } from "@/lib/item-thread";

/** The eight the spec names, and no picker of every emoji in Unicode. */
export const REACTION_EMOJI = ["👍", "❤️", "✅", "👀", "🎉", "🙏", "😄", "🚀"] as const;

const ACTIVITY_FILTER_LABELS: Record<ItemActivityKind | "all", string> = {
  all: "All activity",
  status: "Status",
  assignees: "Assignees",
  dates: "Dates",
  fields: "Fields",
  comments: "Comments",
  attachments: "Attachments",
  lifecycle: "Lifecycle",
};

type Tab = "comments" | "activity";

/**
 * Bring `el` into view inside its nearest scrollable ancestor, leaving
 * `headroom` px above it, without touching any scroller further up the tree.
 *
 * Falls back to `scrollIntoView({ block: "nearest" })` when the element is in
 * no scroll container of its own: "nearest" still scrolls ancestors, but only
 * by the minimum needed, so it cannot tear the frame the way "center" did.
 */
function scrollWithinScroller(el: HTMLElement, headroom: number): void {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const scrolls = /(auto|scroll|overlay)/.test(`${style.overflowY}`);
    if (scrolls && node.scrollHeight > node.clientHeight) {
      const top = el.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
      node.scrollTo({ top: Math.max(0, top - headroom) });
      return;
    }
    node = node.parentElement;
  }
  el.scrollIntoView({ block: "nearest" });
}

export interface CommentThreadProps {
  entityType: "BOARD_ITEM";
  entityId: string;
  /** May the viewer post? The thread's own endpoint answers this; the prop is
   *  the first guess so the composer does not flash in and out. */
  canComment: boolean;
  currentUserId: string | null;
  statuses?: StatusOption[];
  locale?: LocalePrefs | null;
  /** `?comment=<updateId>`. */
  deepLinkId?: string | null;
  /** Fires once the deep link has been honoured (or found missing). */
  onDeepLinkResolved?: () => void;
  /** The draft, lifted so the host can flush it on a session lapse. */
  draft?: string;
  onDraftChange?: (value: string) => void;
  /** The composer sticks to the bottom of the drawer rather than scrolling. */
  stickyComposer?: boolean;
  /** Bumped by the host on an SSE item event: re-read without remounting. */
  refreshToken?: number;
  /** The List this thread hangs off, so @mentions offer the people who can
   *  reach it rather than the author's own report tree. */
  boardId?: string | null;
}

export function CommentThread({
  entityId,
  canComment,
  currentUserId,
  statuses,
  locale = null,
  deepLinkId = null,
  onDeepLinkResolved,
  draft: draftProp,
  onDraftChange,
  stickyComposer = false,
  refreshToken = 0,
  boardId = null,
}: CommentThreadProps) {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>(deepLinkId ? "comments" : "comments");
  const [updates, setUpdates] = useState<ThreadUpdate[]>([]);
  const [activity, setActivity] = useState<ThreadActivity[]>([]);
  const [activityKind, setActivityKind] = useState<ItemActivityKind | "all">("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [anchorMissing, setAnchorMissing] = useState(false);
  const [can, setCan] = useState<{ comment: boolean; moderate: boolean }>({ comment: canComment, moderate: false });
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  // The draft: controlled by the host when it wants to flush it on expiry,
  // otherwise held here so closing and reopening the drawer keeps it.
  const [localDraft, setLocalDraft] = useState("");
  const draft = draftProp ?? localDraft;
  const setDraft = useCallback(
    (v: string) => {
      if (onDraftChange) onDraftChange(v);
      else setLocalDraft(v);
    },
    [onDraftChange],
  );
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  const [staged, setStaged] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadUpdates = useCallback(
    async (opts: { around?: string | null } = {}) => {
      const url = opts.around
        ? `/api/items/${entityId}/updates?around=${encodeURIComponent(opts.around)}`
        : `/api/items/${entityId}/updates`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json() as Promise<{
        updates?: ThreadUpdate[];
        missing?: boolean;
        can?: { comment: boolean; moderate: boolean };
      }>;
    },
    [entityId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadUpdates({ around: deepLinkId });
      if (data.can) setCan({ comment: !!data.can.comment, moderate: !!data.can.moderate });
      const missing = Boolean(deepLinkId && data.missing);
      setAnchorMissing(missing);
      if (missing) {
        // Failure path 1: the comment was deleted, or is not on this task.
        // The task still renders, on the Comments tab, with the whole thread.
        const all = await loadUpdates();
        setUpdates(all.updates ?? []);
      } else {
        setUpdates(data.updates ?? []);
      }
    } catch {
      // Failure path 2: the thread itself failed. One row, with Retry.
      setLoadError("Couldn't load comments");
    } finally {
      setLoading(false);
    }
  }, [loadUpdates, deepLinkId]);

  const loadActivity = useCallback(async () => {
    setActivityError(null);
    try {
      const qs = activityKind === "all" ? "" : `?kind=${activityKind}`;
      const res = await fetch(`/api/items/${entityId}/activity${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setActivity((await res.json()).activity ?? []);
    } catch {
      setActivityError("Couldn't load activity");
    }
  }, [entityId, activityKind]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity, refreshToken]);

  // ── the deep-link pulse ────────────────────────────────────────────
  const anchorRef = useRef<HTMLLIElement>(null);
  const [pulsed, setPulsed] = useState(false);
  useEffect(() => {
    if (!deepLinkId || loading) return;
    if (anchorMissing) {
      onDeepLinkResolved?.();
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    // Scroll the PAGE's own scroll container, never the document.
    // `scrollIntoView` walks every ancestor scroller including <html>, so on
    // the task page it dragged the whole app frame up: the top bar and the
    // rail scrolled off the top of the window and 130px of white appeared
    // under the shell. Every mention row, comment notification and "Copy link
    // to comment" lands on this URL shape, so it was the first thing a
    // notification showed. 96px of headroom inside the scroller, per the spec.
    scrollWithinScroller(el, 96);
    el.focus({ preventScroll: true });
    setPulsed(true);
    // One pulse, then the query is stripped so a refresh does not pulse again
    // and Copy link copies the clean task URL.
    const t = setTimeout(() => {
      setPulsed(false);
      onDeepLinkResolved?.();
    }, 1200);
    return () => clearTimeout(t);
  }, [deepLinkId, loading, anchorMissing, updates.length, onDeepLinkResolved]);

  // ── composer ───────────────────────────────────────────────────────
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typeahead = useMentionTypeahead({ value: draft, setValue: setDraft, textareaRef, side: stickyComposer ? "top" : "bottom", boardId });
  const typeaheadMentions = typeahead.mentions;
  useEffect(() => {
    setMentions(typeaheadMentions);
  }, [typeaheadMentions]);

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body && staged.length === 0) return;
    setPosting(true);
    setPostError(null);
    try {
      const res = await fetch(`/api/items/${entityId}/updates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body,
          ...(mentions.length ? { mentionedUserIds: surviving(mentions, body) } : {}),
          ...(staged.length ? { attachmentIds: staged.map((s) => s.id) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The draft is never cleared on a failure.
        setPostError(accessMessage(data, "Couldn't post that comment."));
        return;
      }
      setDraft("");
      setStaged([]);
      setMentions([]);
      typeahead.reset();
      if (data.update) setUpdates((prev) => [...prev, data.update as ThreadUpdate]);
      void loadActivity();
    } catch {
      setPostError("Couldn't post that comment.");
    } finally {
      setPosting(false);
    }
  }, [draft, staged, mentions, entityId, setDraft, typeahead, loadActivity]);

  const uploadFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        if (!up.ok) continue;
        const upData = await up.json();
        const s3Key = upData.s3Key ?? upData.data?.s3Key ?? null;
        const entry = await fetch("/api/files", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: upData.name ?? file.name,
            mimeType: file.type || "application/octet-stream",
            size: upData.size ?? file.size,
            url: upData.url,
            ...(typeof s3Key === "string" ? { s3Key } : {}),
          }),
        });
        if (!entry.ok) continue;
        const entryData = await entry.json();
        const fileId = entryData?.id ?? entryData?.data?.id;
        if (fileId) setStaged((prev) => [...prev, { id: fileId, name: upData.name ?? file.name }]);
      }
    } finally {
      setUploading(false);
    }
  }, []);

  const deleteComment = useCallback(
    async (updateId: string) => {
      const ok = await confirm({
        title: "Delete comment",
        description: "Delete this comment? It cannot be brought back.",
        destructive: true,
        confirmLabel: "Delete",
      });
      if (!ok) return;
      const res = await fetch(`/api/items/${entityId}/updates/${updateId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPostError(accessMessage(data, "Couldn't delete that comment."));
        return;
      }
      setUpdates((prev) => prev.filter((u) => u.id !== updateId));
    },
    [entityId, confirm],
  );

  const editComment = useCallback(
    async (updateId: string, body: string): Promise<boolean> => {
      const res = await fetch(`/api/items/${entityId}/updates/${updateId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPostError(accessMessage(data, "Couldn't save that edit."));
        return false;
      }
      setUpdates((prev) => prev.map((u) => (u.id === updateId ? (data.update as ThreadUpdate) : u)));
      return true;
    },
    [entityId],
  );

  const react = useCallback(
    async (updateId: string, emoji: string, on: boolean) => {
      const res = await fetch(`/api/items/${entityId}/updates/${updateId}/reactions`, {
        method: on ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      // The server answers with the whole set, so the chips show truth rather
      // than an optimistic guess that a second tab has already invalidated.
      if (Array.isArray(data.reactions)) {
        setUpdates((prev) => prev.map((u) => (u.id === updateId ? { ...u, reactions: data.reactions } : u)));
      }
    },
    [entityId],
  );

  const statusList = statuses?.length ? statuses : [...DEFAULT_STATUS_OPTIONS];

  return (
    <section>
      <div className="mb-2 flex items-center gap-1">
        <TabPill active={tab === "comments"} onClick={() => setTab("comments")} label="Comments" count={updates.length} />
        <TabPill active={tab === "activity"} onClick={() => setTab("activity")} label="Activity" count={activity.length} />
        {tab === "activity" ? (
          <ActivityFilter value={activityKind} onChange={setActivityKind} />
        ) : null}
      </div>

      {postError ? (
        <p className="mb-2 text-sm text-danger-text" role="alert">{postError}</p>
      ) : null}

      {tab === "comments" ? (
        <>
          {anchorMissing ? (
            <p className="mb-2 text-sm text-ink-2">That comment was deleted.</p>
          ) : null}
          {loadError ? (
            <div className="mb-2 flex items-center gap-2 text-sm text-ink-2">
              {deepLinkId ? <span>Opening a comment.</span> : null}
              <span>{loadError}</span>
              <button type="button" onClick={() => void load()} className="font-medium text-brand-deep hover:underline">
                Retry
              </button>
            </div>
          ) : null}

          {loading ? (
            <ThreadSkeleton />
          ) : updates.length === 0 && !loadError ? (
            <p className="py-2 text-row text-ink-2">No comments yet</p>
          ) : (
            <ul className="space-y-4">
              {updates.map((u) => (
                <CommentRow
                  key={u.id}
                  update={u}
                  currentUserId={currentUserId}
                  canModerate={can.moderate}
                  locale={locale}
                  anchored={deepLinkId === u.id}
                  pulsing={deepLinkId === u.id && pulsed}
                  anchorRef={deepLinkId === u.id ? anchorRef : undefined}
                  onDelete={deleteComment}
                  onEditSave={editComment}
                  onReact={react}
                  entityId={entityId}
                />
              ))}
            </ul>
          )}

          {/* In the drawer the composer PINS to the bottom edge with `sticky`,
              so a thread longer than the drawer never scrolls it out of reach.
              Sticky rather than a nested scroller: the body is already the one
              scroll container, and a second one would give the reader two
              scrollbars and a thread that could not be read past its own box. */}
          {can.comment ? (
            <div
              className={
                stickyComposer
                  ? "sticky bottom-0 z-10 -mx-5 mt-4 border-t border-line bg-raised px-5 pb-5 pt-3"
                  : "mt-4 border-t border-line pt-3"
              }
            >
              {staged.length ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {staged.map((f) => (
                    <span key={f.id} className="inline-flex h-6 items-center gap-1 rounded-md bg-hover px-2 text-xs font-medium text-ink">
                      <Paperclip className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                      <span className="max-w-[160px] truncate">{f.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setStaged((prev) => prev.filter((s) => s.id !== f.id))}
                        className="text-ink-2 hover:text-ink"
                      >
                        <X className="h-3 w-3" strokeWidth={1.5} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="relative">
                {typeahead.popover}
                <textarea
                  ref={textareaRef}
                  value={draft}
                  rows={2}
                  aria-label="Add a comment"
                  placeholder="Add a comment… @ to mention"
                  onChange={(e) => typeahead.onValueChange(e.target.value)}
                  onClick={typeahead.onCaretMove}
                  onKeyUp={typeahead.onCaretMove}
                  onKeyDown={(e) => {
                    if (typeahead.onKeyDown(e)) return;
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  className="w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
                />
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink" title="Attach a file">
                  <Paperclip className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                  <span className="sr-only">Attach a file</span>
                  <input type="file" multiple className="hidden" onChange={(e) => void uploadFiles(e.target.files)} />
                </label>
                <EmojiInsert onPick={(e) => setDraft(`${draft}${e}`)} />
                {uploading ? <Dots variant="pending" className="ms-1" /> : null}
                <span className="ms-auto inline-flex items-center gap-2">
                  <kbd className="hidden h-[18px] items-center rounded border border-line bg-[var(--os-kbd-bg)] px-1 text-micro font-medium text-ink-2 sm:inline-flex">⌘↵</kbd>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={posting || (!draft.trim() && staged.length === 0)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink transition-colors hover:bg-hover disabled:opacity-50"
                  >
                    {posting ? <Dots variant="pending" /> : <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />}
                    Send
                  </button>
                </span>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <ActivityList
          activity={activity}
          statuses={statusList}
          locale={locale}
          error={activityError}
          onRetry={() => void loadActivity()}
        />
      )}
    </section>
  );
}

// ── pieces ───────────────────────────────────────────────────────────

function TabPill({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-base transition-colors ${
        active ? "bg-active font-medium text-ink" : "text-ink-2 hover:bg-hover"
      }`}
    >
      {label}
      <span className="text-xs font-medium text-ink-2">{count}</span>
    </button>
  );
}

function ThreadSkeleton() {
  return (
    <div className="space-y-4 py-1" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="flex gap-3">
          <span className="h-6 w-6 shrink-0 rounded-full bg-skeleton" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-[40%] rounded bg-skeleton" />
            <span className="block h-3 w-[80%] rounded bg-skeleton" />
          </span>
        </div>
      ))}
    </div>
  );
}

function EmojiInsert({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Emoji"
        aria-label="Emoji"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      >
        <SmilePlus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open ? <EmojiPad onPick={(e) => { onPick(e); setOpen(false); }} onClose={() => setOpen(false)} side="top" /> : null}
    </span>
  );
}

function EmojiPad({ onPick, onClose, side = "bottom" }: { onPick: (e: string) => void; onClose: () => void; side?: "top" | "bottom" }) {
  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} aria-hidden="true" />
      <div
        className={`absolute z-[61] flex gap-0.5 rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)] ${
          side === "top" ? "bottom-full mb-1" : "top-full mt-1"
        } start-0`}
        role="group"
        aria-label="React"
      >
        {REACTION_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            aria-label={`React ${e}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-row transition-colors hover:bg-hover"
          >
            {e}
          </button>
        ))}
      </div>
    </>
  );
}

function CommentRow({
  update,
  currentUserId,
  canModerate,
  locale,
  anchored,
  pulsing,
  anchorRef,
  onDelete,
  onEditSave,
  onReact,
  entityId,
}: {
  update: ThreadUpdate;
  currentUserId: string | null;
  canModerate: boolean;
  locale: LocalePrefs | null;
  anchored: boolean;
  pulsing: boolean;
  anchorRef?: React.RefObject<HTMLLIElement | null>;
  onDelete: (id: string) => void;
  onEditSave: (id: string, body: string) => Promise<boolean>;
  onReact: (id: string, emoji: string, on: boolean) => void;
  entityId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(update.body);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);

  const isOwn = Boolean(currentUserId && update.authorId === currentUserId);
  const canDelete = isOwn || canModerate;
  const edited = new Date(update.updatedAt).getTime() - new Date(update.createdAt).getTime() > 5_000;
  const person = update.author ?? { id: update.authorId ?? "?", firstName: null, lastName: null, avatar: null };

  const save = async () => {
    const body = editDraft.trim();
    if (!body) return;
    setSaving(true);
    const ok = await onEditSave(update.id, body);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <li
      id={`c-${update.id}`}
      ref={anchorRef}
      tabIndex={anchored ? -1 : undefined}
      className={`group flex gap-3 rounded-lg outline-none transition-colors ${
        pulsing ? "-mx-2 bg-brand-soft px-2 py-1.5 duration-[1200ms]" : anchored ? "-mx-2 px-2 py-1.5" : ""
      }`}
      style={pulsing ? { transitionTimingFunction: "var(--os-ease-out)" } : undefined}
    >
      <Avatar person={person} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium text-ink">{update.author ? personLabel(update.author) : "Someone"}</span>
          <span className="text-xs font-medium text-ink-2" title={formatTaskDate(update.createdAt, locale, { withTime: true })}>
            {relativeTime(update.createdAt, locale)}
          </span>
          {edited ? <span className="text-xs text-ink-3">(edited)</span> : null}
          <span className="relative ms-auto inline-flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setReactOpen((v) => !v)}
              aria-label="React"
              title="React"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <SmilePlus className="h-4 w-4" strokeWidth={1.5} />
            </button>
            {reactOpen ? (
              <EmojiPad
                onPick={(e) => {
                  onReact(update.id, e, true);
                  setReactOpen(false);
                }}
                onClose={() => setReactOpen(false)}
              />
            ) : null}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Comment actions"
              title="More"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-row leading-none text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              ⋯
            </button>
            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-[60]" onMouseDown={() => setMenuOpen(false)} aria-hidden="true" />
                <div className="absolute end-0 top-full z-[61] mt-1 w-[200px] rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)]">
                  <MenuList>
                    {isOwn ? (
                      <MenuItem
                        label="Edit"
                        onClick={() => {
                          setEditDraft(update.body);
                          setEditing(true);
                          setMenuOpen(false);
                        }}
                      />
                    ) : null}
                    <MenuItem
                      label="Copy link to comment"
                      onClick={() => {
                        void navigator.clipboard?.writeText(`${window.location.origin}/item/${entityId}?comment=${update.id}`);
                        setMenuOpen(false);
                      }}
                    />
                    {canDelete ? (
                      <MenuItem
                        label="Delete"
                        tone="destructive"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete(update.id);
                        }}
                      />
                    ) : null}
                  </MenuList>
                </div>
              </>
            ) : null}
          </span>
        </div>

        {editing ? (
          <div className="mt-1">
            <textarea
              value={editDraft}
              autoFocus
              rows={2}
              aria-label="Edit comment"
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void save();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
              className="w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !editDraft.trim()}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-sm font-medium text-ink transition-colors hover:bg-hover disabled:opacity-50"
              >
                {saving ? <Dots variant="pending" /> : null}
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex h-7 items-center rounded-md px-2.5 text-sm text-ink-2 transition-colors hover:bg-hover"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <MarkdownLite source={update.body} meId={currentUserId} className="mt-0.5" />
        )}

        {update.attachments?.length ? (
          <ul className="mt-1.5 space-y-0.5">
            {update.attachments.map((a) => (
              <li key={a.id}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-base text-ink transition-colors hover:bg-hover"
                >
                  <Paperclip className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden="true" />
                  <span className="max-w-[260px] truncate">{a.name}</span>
                  <span className="text-xs text-ink-2">{formatBytes(a.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {update.reactions?.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {update.reactions.map((r) => {
              const mine = Boolean(currentUserId && r.userIds.includes(currentUserId));
              return (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onReact(update.id, r.emoji, !mine)}
                  aria-pressed={mine}
                  className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${
                    mine ? "bg-brand-soft text-brand-deep" : "bg-hover text-ink"
                  }`}
                >
                  <span aria-hidden="true">{r.emoji}</span>
                  {r.userIds.length}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ActivityFilter({
  value,
  onChange,
}: {
  value: ItemActivityKind | "all";
  onChange: (v: ItemActivityKind | "all") => void;
}) {
  const [open, setOpen] = useState(false);
  const sections: PickerSectionDef[] = useMemo(
    () => [
      {
        options: [
          { value: "all", label: ACTIVITY_FILTER_LABELS.all },
          ...ITEM_ACTIVITY_KINDS.map((k) => ({ value: k, label: ACTIVITY_FILTER_LABELS[k] })),
        ],
      },
    ],
    [],
  );
  return (
    <span className="relative ms-auto inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-hover"
      >
        {ACTIVITY_FILTER_LABELS[value]}
        <span aria-hidden="true" className="text-rail">▾</span>
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        sections={sections}
        selected={value}
        align="end"
        ariaLabel="Filter activity"
        onSelect={(v) => onChange(v === "all" || !isItemActivityKind(v) ? "all" : v)}
      />
    </span>
  );
}

function ActivityList({
  activity,
  statuses,
  locale,
  error,
  onRetry,
}: {
  activity: ThreadActivity[];
  statuses: StatusOption[];
  locale: LocalePrefs | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-ink-2">
        <span>{error}</span>
        <button type="button" onClick={onRetry} className="font-medium text-brand-deep hover:underline">Retry</button>
      </div>
    );
  }
  if (activity.length === 0) return <p className="py-2 text-row text-ink-2">Nothing here yet</p>;
  return (
    <ul className="space-y-1">
      {activity.map((a) => {
        // A cron-driven row (a recurrence spawn, a due-date roll-forward) has
        // no actor and reads "Automatically", never "System".
        const actor = a.actor ? `${a.actor.firstName} ${a.actor.lastName}`.trim() : "Automatically";
        return (
          <li key={a.id} className="flex min-h-8 items-baseline gap-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium text-ink">{actor}</span>{" "}
              <span className="text-ink-2">
                {describeItemActivity(a, {
                  statusLabel: (v) => statuses.find((o) => o.value === v)?.label ?? v,
                  personName: (id) => a.people?.[id] ?? null,
                  dateLabel: (iso) => formatTaskDate(iso, locale, { withWeekday: false }) || iso,
                })}
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs text-ink-2">{relativeTime(a.createdAt, locale)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
