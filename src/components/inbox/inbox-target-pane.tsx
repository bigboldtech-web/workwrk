"use client";

// InboxTargetPane: the thing the notification is about, open beside the list.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox, Detail
// pane) and section 3 (`InboxTargetPane`): "picks the task panel, the mention
// excerpt card, the access-request card or the summary card by kind", so that
// "the user never leaves the Inbox to act".
//
// FOUR CASES, AND THE FOURTH IS THE IMPORTANT ONE.
//
//   task       `TaskDetailBody host="panel"`: the drawer's body with no
//              drawer chrome. The one task detail, third host.
//   mention    the excerpt the notification's own message carries, in a
//              bordered card, with one secondary "Open" to the block anchor.
//   summary    kind glyph, title, message, time, one secondary "Open {kind}".
//   unreadable the SAME summary card built from the notification's own stored
//              title and message, one sentence saying which case it is, and NO
//              Open button.
//
// That last case is why the pane takes `target.readable` from the server
// rather than asking the object itself. A notification is a permanent record
// of something that happened to you, written when you could still see the
// thing; tasks get deleted, Lists get restricted, people leave. The row must
// stay in the list and stay clearable, hiding it would leave an unread count
// nobody could clear: while the pane stops pretending the object is there.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock, Link2, Maximize2, MailOpen, Undo2 } from "lucide-react";
import { useTask } from "@/hooks/use-task";
import { TaskDetailBody } from "@/components/board-view/task-detail-body";
import { DotsArt } from "@/components/ui/dots-art";
import { useOsToast } from "@/components/layout/os/toast";
import { TARGET_NOUN, UNREADABLE_SENTENCE } from "@/lib/notification-target";
import { inboxRowTime, type LocaleContext } from "@/lib/work-buckets";
import { KindIcon, type InboxNotification } from "./inbox-row";
// The Inbox is Work: a notification's doc, table, canvas, SOP or form opens
// in Work. Its stored href is canonical and is mapped before returnTo is
// appended; Copy link copies the share form (src/lib/nav/object-href.ts).
import { shareHrefNow, useObjectHref } from "@/components/layout/os/use-object-href";

export function InboxTargetPane({
  notification,
  currentUserId,
  isGuest,
  returnTo,
  now,
  locale,
  onMarkRead,
  onSnooze,
  onClear,
  clearLabel = "Clear",
}: {
  notification: InboxNotification | null;
  currentUserId: string | null;
  isGuest: boolean;
  /** Where a full-page "Open" should send the viewer back to. */
  returnTo: string;
  now: Date;
  locale: LocaleContext;
  onMarkRead: () => void;
  onSnooze: () => void;
  onClear: () => void;
  /** "Move back to Inbox" on the Cleared tab, where Clear has nothing to do. */
  clearLabel?: string;
}) {
  if (!notification) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <DotsArt arrangement="row" size={72} />
        <p className="text-base text-ink-2">Pick a notification to see it here</p>
      </div>
    );
  }

  const isTask = notification.target.kind === "item" && notification.target.id !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader
        notification={notification}
        returnTo={returnTo}
        onMarkRead={onMarkRead}
        onSnooze={onSnooze}
        onClear={onClear}
        clearLabel={clearLabel}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {!notification.target.readable ? (
          <SummaryCard notification={notification} now={now} locale={locale} />
        ) : isTask ? (
          <TaskPanel
            itemId={notification.target.id!}
            currentUserId={currentUserId}
            isGuest={isGuest}
            commentId={notification.target.anchorIsComment ? notification.target.anchor : null}
            locale={locale}
          />
        ) : notification.type === "mention" ? (
          <MentionCard notification={notification} returnTo={returnTo} now={now} locale={locale} />
        ) : (
          <SummaryCard notification={notification} now={now} locale={locale} returnTo={returnTo} />
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── header ───────────────────────────── */

function PaneHeader({
  notification,
  returnTo,
  onMarkRead,
  onSnooze,
  onClear,
  clearLabel,
}: {
  notification: InboxNotification;
  returnTo: string;
  onMarkRead: () => void;
  onSnooze: () => void;
  onClear: () => void;
  clearLabel: string;
}) {
  const { toast } = useOsToast();
  const { map: sectionLink } = useObjectHref();
  const stored = notification.target.readable ? notification.target.href : null;
  const href = stored ? sectionLink(stored) : null;
  const withReturn = href ? `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}` : null;

  return (
    <header className="os-row flex h-12 shrink-0 items-center gap-1 border-b border-line px-6">
      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{notification.kind.label}</span>
      {withReturn ? (
        <Link
          href={withReturn}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
        >
          <Maximize2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          Expand
        </Link>
      ) : null}
      {href ? (
        <button
          type="button"
          onClick={() => {
            try {
              void navigator.clipboard.writeText(shareHrefNow(href));
              toast("Link copied");
            } catch {
              toast("Couldn't copy that link", { tone: "danger" });
            }
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          title="Copy link"
          aria-label="Copy link"
        >
          <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
      ) : null}
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <HeaderAction label="Mark read" Icon={MailOpen} onClick={onMarkRead} />
      <HeaderAction label="Snooze" Icon={Clock} onClick={onSnooze} />
      <HeaderAction label={clearLabel} Icon={clearLabel === "Clear" ? Check : Undo2} onClick={onClear} />
    </header>
  );
}

function HeaderAction({
  label,
  Icon,
  onClick,
}: {
  label: string;
  Icon: typeof Check;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}

/* ─────────────────────────── the task panel ─────────────────────── */

function TaskPanel({
  itemId,
  currentUserId,
  isGuest,
  commentId,
  locale,
}: {
  itemId: string;
  currentUserId: string | null;
  isGuest: boolean;
  commentId: string | null;
  locale: LocaleContext;
}) {
  const router = useRouter();
  // No poll: the pane is one of several things on screen and the list beside
  // it already re-reads on the shell's item events.
  const task = useTask(itemId);
  return (
    <TaskDetailBody
      task={task}
      host="panel"
      currentUserId={currentUserId}
      isGuest={isGuest}
      locale={{ timezone: locale.timeZone ?? null, weekStart: locale.weekStart ?? null }}
      deepLinkCommentId={commentId}
      onOpenItem={(id) => router.push(`/item/${id}`)}
      missingView={
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <DotsArt arrangement="row" size={72} />
          <p className="text-base text-ink-2">{UNREADABLE_SENTENCE.deleted}</p>
        </div>
      }
    />
  );
}

/* ────────────────────────── the mention card ────────────────────── */

function MentionCard({
  notification,
  returnTo,
  now,
  locale,
}: {
  notification: InboxNotification;
  returnTo: string;
  now: Date;
  locale: LocaleContext;
}) {
  const { map: sectionLink } = useObjectHref();
  const href = notification.target.href ? sectionLink(notification.target.href) : notification.target.href;
  const withReturn = href ? `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}` : null;
  return (
    <div className="mx-auto w-full max-w-[760px]">
      <h2 className="text-lg font-semibold text-ink">{notification.title}</h2>
      <p className="mt-1 text-xs text-ink-2">{inboxRowTime(notification.createdAt, now, locale)}</p>
      <blockquote className="mt-4 rounded-lg border border-line bg-subtle p-4 text-base text-ink">
        {notification.message}
      </blockquote>
      {withReturn ? (
        <Link
          href={withReturn}
          className="mt-4 inline-flex h-9 items-center rounded-md border border-line px-3 text-base font-medium text-ink hover:bg-hover"
        >
          Open
        </Link>
      ) : null}
    </div>
  );
}

/* ────────────────────────── the summary card ────────────────────── */

function SummaryCard({
  notification,
  now,
  locale,
  returnTo,
}: {
  notification: InboxNotification;
  now: Date;
  locale: LocaleContext;
  /** Present only when the target is readable: no Open button otherwise. */
  returnTo?: string;
}) {
  const { map: sectionLink } = useObjectHref();
  const readable = notification.target.readable;
  const href = readable && notification.target.href ? sectionLink(notification.target.href) : null;
  const withReturn =
    href && returnTo ? `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}` : href;
  const noun = TARGET_NOUN[notification.target.kind as keyof typeof TARGET_NOUN] ?? "";

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <KindIcon
        name={notification.kind.icon}
        className={readable ? "h-5 w-5 text-ink-2" : "h-5 w-5 text-ink-3"}
        label={notification.kind.label}
      />
      <h2 className="mt-3 text-lg font-semibold text-ink">{notification.title}</h2>
      <p className="mt-2 text-base text-ink">{notification.message}</p>
      <p className="mt-3 text-xs text-ink-2">{inboxRowTime(notification.createdAt, now, locale)}</p>

      {!readable && notification.target.reason ? (
        // Its OWN words, not an error: this is a record of something that
        // happened, and the object it pointed at is no longer reachable.
        <p className="mt-4 text-sm text-ink-2">{UNREADABLE_SENTENCE[notification.target.reason]}</p>
      ) : withReturn ? (
        <Link
          href={withReturn}
          className="mt-4 inline-flex h-9 items-center rounded-md border border-line px-3 text-base font-medium text-ink hover:bg-hover"
        >
          {noun ? `Open ${noun}` : "Open"}
        </Link>
      ) : null}
    </div>
  );
}
