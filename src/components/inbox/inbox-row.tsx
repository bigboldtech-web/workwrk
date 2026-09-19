"use client";

// InboxRow: the 64px two-line row of the Inbox list.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox, List) and
// section 3 (`InboxRow`).
//
// WHAT IT REPLACES. The old row drew a decorative `Circle` as its lead glyph
// (it selected nothing and meant nothing), painted its kind colour from a
// ten-entry hex map that knew a third of the types the app writes, and printed
// the keyboard hints "⇧1" to "⇧4" for shortcuts that had no handler anywhere
// in the file. Here the glyph is the kind's real icon, the lead position is a
// real multi-select checkbox, and every action drawn has a handler.
//
// THE THREE ACTIONS ARE THREE THINGS. "Mark read" and "Clear" used to be the
// same write with two labels. They are now distinct: Mark read leaves the row
// where it is with its weight dropped, Snooze moves it to Snoozed until a
// time, Clear marks it read AND moves it to Cleared. "Mark unread" is new, and
// so is the endpoint behind it.

import { createElement, type MouseEvent } from "react";
import * as Icons from "lucide-react";
import { Check, Clock, Mail, MailOpen, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dots } from "@/components/ui/dots";
import { inboxRowTime, type LocaleContext } from "@/lib/work-buckets";
import type { UnreadableReason } from "@/lib/notification-target";

export interface InboxNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  /** Filed away in the Cleared tab. Distinct from `read` since 2026-09-18. */
  cleared?: boolean;
  link: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  kind: { label: string; icon: string; tab: string; filterGroup: string };
  target: {
    kind: string;
    id: string | null;
    href: string | null;
    anchor: string | null;
    anchorIsComment: boolean;
    readable: boolean;
    reason: UnreadableReason | null;
  };
}

/**
 * The kind's Lucide glyph, resolved by NAME.
 *
 * `inbox-kinds.ts` carries an icon name rather than a component because it is
 * import-free (the API routes and the completeness test both load it), so the
 * name is resolved here, at the edge. It renders through `createElement` and
 * not as `<Glyph/>`: assigning a component to a local and rendering it is a
 * component created during render, which resets its state on every keystroke
 * somewhere else on the page.
 */
export function KindIcon({
  name,
  className,
  label,
}: {
  name: string;
  className?: string;
  label?: string;
}) {
  // A Lucide icon is a `forwardRef` OBJECT, not a function, so a
  // `typeof === "function"` guard here quietly turned every glyph in the
  // Inbox into the same bell.
  const candidate = (Icons as unknown as Record<string, unknown>)[name];
  const resolved = typeof candidate === "function" || (typeof candidate === "object" && candidate !== null);
  const Icon = (resolved ? candidate : Icons.Bell) as Icons.LucideIcon;
  return createElement(Icon, {
    className,
    strokeWidth: 1.5,
    ...(label ? { "aria-label": label } : { "aria-hidden": true }),
  });
}

export function InboxRow({
  notification,
  selected,
  checked,
  anyChecked,
  now,
  locale,
  onSelect,
  onCheck,
  onMarkRead,
  onMarkUnread,
  onSnooze,
  onClear,
  cleared = false,
}: {
  notification: InboxNotification;
  selected: boolean;
  checked: boolean;
  /** Once anything is checked, every row shows its checkbox at rest. */
  anyChecked: boolean;
  now: Date;
  locale: LocaleContext;
  onSelect: () => void;
  onCheck: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onSnooze: (e: MouseEvent) => void;
  onClear: () => void;
  /** On the Cleared tab the third action puts the row back, not away. */
  cleared?: boolean;
}) {
  const n = notification;
  const unread = !n.read;

  function stop(e: MouseEvent, run: () => void) {
    e.stopPropagation();
    e.preventDefault();
    run();
  }

  return (
    <li>
      <div
        role="option"
        aria-selected={selected}
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          // 64 PIXELS, written in pixels. `h-16` is 4rem, and the OS root font
          // size is 14px, so the rem form rendered a 56px row and the Talk
          // unit's thread list, which is meant to share this geometry, would
          // have inherited the drift.
          "group os-row flex h-[64px] cursor-pointer items-center gap-2.5 border-b border-line-soft px-3",
          selected ? "bg-selected" : unread ? "bg-raised hover:bg-hover" : "bg-subtle hover:bg-hover",
        )}
      >
        {/* The lead slot: an unread dot at rest, a real checkbox once any row
            is checked or this one is hovered. One position, two meanings, and
            both of them do something. */}
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <input
            type="checkbox"
            checked={checked}
            onClick={(e) => e.stopPropagation()}
            onChange={onCheck}
            aria-label={`Select "${n.title}"`}
            className={cn(
              "h-[18px] w-[18px] accent-[var(--os-brand)]",
              anyChecked || checked ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
          />
          {!anyChecked && !checked && unread ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center group-hover:hidden">
              <Dots variant="unread" />
            </span>
          ) : null}
        </span>

        <KindIcon name={n.kind.icon} className="h-5 w-5 shrink-0 text-ink-2" label={n.kind.label} />

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-ink", unread ? "font-medium" : "font-normal")}>
              {n.title}
            </span>

            {/* The hover actions. They replace the time, so the row never
                grows and nothing below it moves. */}
            <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
              <RowAction
                label={unread ? "Mark read" : "Mark unread"}
                Icon={unread ? MailOpen : Mail}
                onClick={(e) => stop(e, unread ? onMarkRead : onMarkUnread)}
              />
              <RowAction label="Snooze" Icon={Clock} onClick={(e) => stop(e, () => onSnooze(e))} />
              <RowAction
                label={cleared ? "Move back to Inbox" : "Clear"}
                Icon={cleared ? Undo2 : Check}
                onClick={(e) => stop(e, onClear)}
              />
            </span>
            <span className="shrink-0 text-xs text-ink-2 group-hover:hidden group-focus-within:hidden">
              {inboxRowTime(n.createdAt, now, locale)}
            </span>
          </span>

          <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink-2">
            <span className="min-w-0 truncate">{n.message}</span>
          </span>
        </span>
      </div>
    </li>
  );
}

function RowAction({
  label,
  Icon,
  onClick,
}: {
  label: string;
  Icon: Icons.LucideIcon;
  onClick: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-active hover:text-ink"
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}

/** The one-line compact form, for the Home widget and the bell popover. */
export function InboxRowCompact({
  notification,
  now,
  locale,
  onSelect,
}: {
  notification: InboxNotification;
  now: Date;
  locale: LocaleContext;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="os-row flex w-full items-center gap-2.5 border-b border-line-soft px-3 text-start last:border-b-0 hover:bg-hover"
      style={{ minHeight: "var(--os-row-h)" }}
    >
      <KindIcon name={notification.kind.icon} className="h-4 w-4 shrink-0 text-ink-2" label={notification.kind.label} />
      <span className={cn("min-w-0 flex-1 truncate text-ink", notification.read ? "" : "font-medium")}>
        {notification.title}
      </span>
      <span className="shrink-0 text-xs text-ink-2">{inboxRowTime(notification.createdAt, now, locale)}</span>
    </button>
  );
}
