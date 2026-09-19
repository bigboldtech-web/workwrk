"use client";

// WorkTaskRow: one task inside the Home "My work" widget.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/home, widget 1):
// "18px checkbox (checking sets the task's first done status via PATCH
// /api/items/[id] { status }, with a 5s Undo toast), title 15/400 (15/500 when
// Urgent) as a link opening the task drawer, List name 13/400 --os-ink-2 ('in
// Q4 leads'; a plain label when the viewer cannot read the List), due date
// chip 12/500 (--os-danger-text text when overdue, paired with the date),
// Flag priority glyph 16px. Content budget: one chip, one glyph, nothing
// taller than row minus 12."
//
// THE CHECKBOX IS THE WHOLE POINT and it is why this is a component rather
// than a few divs. Ticking a task from Home has to (a) apply immediately, (b)
// survive a failed request without lying about it, and (c) be undoable for
// five seconds, because the one thing worse than a slow list is a list that
// silently marks the wrong task done. The optimistic state lives here; the
// caller owns the request and the toast.
//
// OPENING GOES THROUGH `openTask`, which arms the drawer intent and pushes
// `/item/<id>`. One task, one URL: the drawer over this page, the full page on
// a refresh, and Copy link always works.

import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { openTask } from "@/lib/nav/open-task";
import { dueChipLabel, type LocaleContext } from "@/lib/work-buckets";
import type { HomeTaskRow } from "@/lib/home-payload";

const PRIORITY_TONE: Readonly<Record<string, string>> = {
  URGENT: "text-danger-text",
  HIGH: "text-warning-text",
  NORMAL: "text-ink-3",
  LOW: "text-ink-4",
};

export function WorkTaskRow({
  item,
  locale,
  now,
  overdue,
  completing,
  onComplete,
}: {
  item: HomeTaskRow;
  locale: LocaleContext;
  /** Passed in so every row in one render bucket dates from the same instant. */
  now: Date;
  overdue: boolean;
  /** True while the completion request is in flight: the row dims, nothing jumps. */
  completing?: boolean;
  onComplete: (item: HomeTaskRow) => void;
}) {
  const router = useRouter();
  const due = dueChipLabel(item.dueAt, now, locale);
  const urgent = item.priority === "URGENT";

  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover",
        completing && "opacity-50",
      )}
      style={{ minHeight: "var(--os-row-h)" }}
    >
      <input
        type="checkbox"
        className="h-[18px] w-[18px] shrink-0 accent-[var(--os-brand)]"
        checked={false}
        disabled={completing}
        onChange={() => onComplete(item)}
        aria-label={`Mark "${item.title}" done`}
      />

      <button
        type="button"
        onClick={() => openTask(router, item.id)}
        className="min-w-0 flex-1 truncate text-start text-ink hover:underline"
        style={{ fontWeight: urgent ? 500 : 400 }}
        title={item.title}
      >
        {item.title}
      </button>

      {item.list ? (
        // A label, not a link. The List chip on Home is context, and a chip
        // that navigates competes with the row's own click target.
        <span className="hidden shrink-0 truncate text-sm text-ink-2 sm:inline" style={{ maxWidth: 140 }}>
          in {item.list.name}
        </span>
      ) : null}

      {due ? (
        <span className={cn("shrink-0 text-xs font-medium", overdue ? "text-danger-text" : "text-ink-2")}>{due}</span>
      ) : null}

      {item.priority ? (
        <Flag
          className={cn("h-4 w-4 shrink-0", PRIORITY_TONE[item.priority] ?? "text-ink-4")}
          strokeWidth={1.5}
          aria-label={`Priority ${item.priority.toLowerCase()}`}
        />
      ) : null}
    </div>
  );
}
