"use client";

// The list column of AI teammates (docs/plans/ai-teammates.md 5.1, 5.2,
// 5.4): 320px with a border at its end on a wide screen, the whole width
// under 1024px (where the chat replaces it). Rows are buttons
// (teammate-row.tsx), most recent chat first (the route sorts them).
//
//   loading        six skeleton rows at the row height
//   load error     "Couldn't load your teammates · Try again"
//   no teammates   the empty view, its one link "Start from a template"
//   search empty   "No teammates match · Clear search"
//   Waiting empty  "Nothing is waiting for you"
//
// "Show removed" sits at its foot (Chats only: a removed teammate has
// nothing waiting) and adds the removed ones, whose chats are kept.

import type { ReactNode } from "react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TEAMMATE_LIST, TEAMMATES_PAGE } from "@/lib/agents/teammate-copy";
import { filterTeammates } from "@/lib/agents/teammate-thread";
import type { TeammateRow as TeammateRowData } from "@/lib/agents/teammate-views";
import { cn } from "@/lib/utils";
import { TeammateRow } from "./teammate-row";

const LINK = "font-medium text-brand-deep hover:underline";

export function TeammateList({
  rows,
  error,
  onRetry,
  query,
  onClearQuery,
  waitingOnly,
  showRemoved,
  onShowRemoved,
  selectedSlug,
  onSelect,
  onNewTeammate,
  className,
}: {
  /** Null while the first read is out. */
  rows: TeammateRowData[] | null;
  error: boolean;
  onRetry: () => void;
  query: string;
  onClearQuery: () => void;
  waitingOnly: boolean;
  showRemoved: boolean;
  onShowRemoved: (on: boolean) => void;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onNewTeammate: () => void;
  className?: string;
}) {
  const shown = rows ? filterTeammates(rows, query, { waitingOnly }) : null;

  let body: ReactNode;
  if (rows === null && error) {
    body = (
      <div className="flex h-11 items-center gap-2 px-3 text-row text-ink-2">
        {TEAMMATE_LIST.loadError} ·
        <button type="button" className={LINK} onClick={onRetry}>{TEAMMATE_LIST.tryAgain}</button>
      </div>
    );
  } else if (rows === null || shown === null) {
    body = <SkeletonRows rows={6} rowHeight="56px" />;
  } else if (rows.length === 0) {
    body = (
      <OsEmptyView
        title={TEAMMATE_LIST.emptyTitle}
        hint={TEAMMATE_LIST.emptyHint}
        action={{ label: TEAMMATE_LIST.emptyLink, onClick: onNewTeammate }}
      />
    );
  } else if (shown.length === 0 && query.trim()) {
    body = (
      <div className="flex h-11 items-center gap-2 px-3 text-row text-ink-2">
        {TEAMMATE_LIST.searchEmpty} ·
        <button type="button" className={LINK} onClick={onClearQuery}>{TEAMMATE_LIST.clearSearch}</button>
      </div>
    );
  } else if (shown.length === 0 && waitingOnly) {
    body = <OsEmptyView title={TEAMMATE_LIST.waitingEmpty} compact />;
  } else {
    body = (
      <ul aria-label={TEAMMATES_PAGE.title} className="flex flex-col py-1">
        {shown.map((t) => (
          <li key={t.id}>
            <TeammateRow teammate={t} active={t.slug === selectedSlug} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col border-line bg-app", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      {waitingOnly ? null : (
        <label className="flex h-11 shrink-0 cursor-pointer items-center justify-between gap-3 border-t border-line px-3 text-sm font-medium text-ink-2">
          {TEAMMATE_LIST.showRemoved}
          <Switch checked={showRemoved} onChange={onShowRemoved} aria-label={TEAMMATE_LIST.showRemoved} />
        </label>
      )}
    </div>
  );
}
