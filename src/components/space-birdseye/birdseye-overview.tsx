"use client";

// Bird's eye OVERVIEW: one column per List the viewer can read, in the Work
// tree's order, each headed by the List's own tile, its name, its task count,
// a Focus button and a "..." menu, with the true status mix under it.
//
// Cards come in the List's Board order: its status columns in order, then its
// position inside each (the List's own order read through its Board, every
// List's default view). A List that declares its open statuses before its
// closed ones therefore puts current work on the first page (review #14).
// "+ New task" sits at the top for the people who may write in that List,
// and a task added in this visit stays at the top of its column until a
// reload shows it in its own place.

import { forwardRef, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, LocateFixed, MoreHorizontal } from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { Dots } from "@/components/ui/dots";
import { cardMatchesFilters, type BirdseyeCard as Card, type BirdseyeList } from "@/lib/work/birdseye";
import { AddTaskRow } from "./add-task-row";
import { BirdseyeCard } from "./birdseye-card";
import { BirdseyeGrid, type GridColumn } from "./birdseye-grid";
import { BirdseyeStatusStrip } from "./birdseye-status-strip";
import type { ColumnState, LoadMoreTarget, SubtaskEntry } from "./use-birdseye";

export interface CardActions {
  now: Date;
  onOpen: (id: string) => void;
  onChangeStatus: (card: Card, next: string) => void;
  onLoadSubtasks: (id: string) => void;
}

function ListMenu({ list, onFocus }: { list: BirdseyeList; onFocus: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${list.name}`}
        title="More"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </button>
      <MorePortal anchorRef={anchorRef} width={200} open={open} placement="below" onClose={() => setOpen(false)}>
        <MenuList aria-label={`${list.name} options`}>
          <MenuItem icon={ArrowUpRight} label="Open List" href={`/boards/${list.slug}`} onClick={() => setOpen(false)} />
          <MenuItem
            icon={LocateFixed}
            label="Focus"
            onClick={() => {
              setOpen(false);
              onFocus(list.id);
            }}
          />
        </MenuList>
      </MorePortal>
    </>
  );
}

/** "Show more" at the foot of a column, with its own in-flight and failure states. */
export function ShowMore({
  loading,
  failed,
  onClick,
}: {
  loading: boolean;
  failed: boolean;
  onClick: () => void;
}) {
  if (failed) {
    return (
      <p className="flex items-center gap-2 px-1 pt-2 text-xs text-ink-3" role="alert">
        Couldn&rsquo;t load more.
        <button type="button" onClick={onClick} className="font-medium text-brand-deep hover:underline">
          Try again
        </button>
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:cursor-default"
    >
      {loading ? <Dots variant="pending" label="Loading more" /> : "Show more"}
    </button>
  );
}

export function EmptyColumnLine({ searching }: { searching: boolean }) {
  return <p className="px-1 py-2 text-xs text-ink-3">{searching ? "No matching tasks" : "No tasks yet"}</p>;
}

export const BirdseyeOverview = forwardRef<
  HTMLDivElement,
  {
    lists: BirdseyeList[];
    columns: Record<string, ColumnState>;
    subtasks: Record<string, SubtaskEntry>;
    q: string;
    hideClosed: boolean;
    actions: CardActions;
    onFocus: (id: string) => void;
    onLoadMore: (target: LoadMoreTarget) => void;
    onCreate: (boardId: string, title: string, status: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  }
>(function BirdseyeOverview({ lists, columns, subtasks, q, hideClosed, actions, onFocus, onLoadMore, onCreate }, ref) {
  const gridColumns: GridColumn[] = lists.map((list) => {
    const col = columns[list.id];
    const cards = col?.cards ?? [];
    const added = (col?.justAdded ?? []).filter((c) => cardMatchesFilters(c, q, hideClosed, list.statuses));
    const header: ReactNode = (
      <div className="flex flex-col gap-1.5">
        <div className="flex h-10 min-w-0 items-center gap-2">
          <EntityTile size="sm" icon={list.icon} color={list.color} name={list.name} />
          <span className="min-w-0 truncate text-base font-semibold text-ink" title={list.name}>
            {list.name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-ink-3" aria-label={`${list.total} ${list.total === 1 ? "task" : "tasks"}`}>
            {list.total}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => onFocus(list.id)}
            title="Focus"
            aria-label={`Focus ${list.name}`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
          >
            <LocateFixed className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </button>
          <ListMenu list={list} onFocus={onFocus} />
        </div>
        <BirdseyeStatusStrip listName={list.name} statuses={list.statuses} statusCounts={list.statusCounts} total={list.total} />
      </div>
    );
    const body: ReactNode = (
      <>
        <ul className="flex flex-col gap-2" aria-label={`Tasks in ${list.name}`}>
          {list.canContribute ? (
            <li>
              <AddTaskRow
                label="New task"
                inputLabel={`New task in ${list.name}`}
                onCreate={(title) => onCreate(list.id, title, list.newTaskStatus)}
              />
            </li>
          ) : null}
          {[...added, ...cards].map((card) => (
            <BirdseyeCard
              key={card.id}
              card={card}
              list={list}
              subtasks={subtasks[card.id]}
              now={actions.now}
              onOpen={actions.onOpen}
              onChangeStatus={actions.onChangeStatus}
              onLoadSubtasks={actions.onLoadSubtasks}
            />
          ))}
        </ul>
        {cards.length === 0 && added.length === 0 ? <EmptyColumnLine searching={!!q} /> : null}
        {col?.nextCursor ? (
          <ShowMore
            loading={col.loadingMore}
            failed={col.moreError}
            onClick={() => onLoadMore({ kind: "list", boardId: list.id })}
          />
        ) : null}
      </>
    );
    return { key: list.id, label: list.name, header, body };
  });

  return <BirdseyeGrid ref={ref} columns={gridColumns} label="Every List in this Space" />;
});
