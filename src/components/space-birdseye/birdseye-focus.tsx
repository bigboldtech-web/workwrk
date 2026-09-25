"use client";

// Bird's eye FOCUS: one List's statuses as columns, its own order and
// colours, the same tinted cards grouped by status.
//
// Focus renders its OWN columns rather than embedding the List's Board view.
// That view refetches the whole List on every change and has no paging, so a
// 5,000-task List would load whole, and its card is not this view's card.
// What focus shares with the Board is everything behavioural: the status
// write (PATCH /api/items/[id] { status }, the Board's own path), the column
// rule (a null or undeclared status sits in the first column), top-level
// cards only, and the subtask count's scope.
//
// The strip names where you are: "Lists" (every List, searchable), every List
// as a letter chip, the focused one expanded with its name and the active
// Focus control that leaves focus (as Esc and browser Back do), and "Open
// List". The chips scroll sideways with buttons, edge fades and the mouse
// wheel when there are more than fit (review #21).
//
// Contributors drag a card between columns, change it from the glyph, and add
// a task at the top of any column and, once it has cards, at the bottom too.

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight, LocateFixed } from "lucide-react";
import { EntityTile } from "@/components/ui/entity-tile";
import { StatusGlyph } from "@/components/board-view/status-glyph";
import { cn } from "@/lib/utils";
import { bucketFor, isClosedStatus, type BirdseyeCard as Card, type BirdseyeList } from "@/lib/work/birdseye";
import { AddTaskRow } from "./add-task-row";
import { BirdseyeCard, CARD_DRAG_TYPE } from "./birdseye-card";
import { BirdseyeGrid, type GridColumn } from "./birdseye-grid";
import { BirdseyeListSwitcher } from "./birdseye-list-switcher";
import { EmptyColumnLine, ShowMore, type CardActions } from "./birdseye-overview";
import { BirdseyeSkeleton } from "./birdseye-skeleton";
import type { FocusState, LoadMoreTarget, SubtaskEntry } from "./use-birdseye";
import { ErrorState } from "@/components/ui/error-state";

function ChipRow({
  lists,
  focusedId,
  onPick,
  onLeave,
}: {
  lists: BirdseyeList[];
  focusedId: string;
  onPick: (id: string) => void;
  onLeave: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // A vertical wheel over the chips scrolls them sideways. Registered by
    // hand because only a non-passive listener may keep the page from also
    // taking the scroll.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro?.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure]);

  // Keep the focused chip in view when focus moves.
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>("[data-focused='true']");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
  }, [focusedId, measure]);

  const scrollBy = (dir: -1 | 1) => {
    const el = rowRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: "smooth" });
  };

  const mask =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? "transparent 0, black 28px" : "black 0"}, ${edges.end ? "black calc(100% - 28px), transparent 100%" : "black 100%"})`
      : undefined;

  // On a phone the strip has room for one chip, so it shows the focused List
  // whole (its name and the control that leaves focus) and the other Lists
  // stay one tap away in "Lists", named and counted. Letter chips that had to
  // be swiped past, half hidden under the fades, found nobody their List.
  // The scroll buttons are for a mouse anyway.
  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      {edges.start ? (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label="Scroll the Lists back"
          title="Scroll back"
          className="me-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink max-sm:hidden"
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
      <div
        ref={rowRef}
        onScroll={measure}
        className="os-no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {lists.map((l) =>
          l.id === focusedId ? (
            <span
              key={l.id}
              data-focused="true"
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-line bg-raised ps-2 pe-1"
            >
              <EntityTile size="sm" icon={l.icon} color={l.color} name={l.name} />
              <span className="max-w-[200px] truncate text-sm font-semibold text-ink max-sm:max-w-[140px]" title={l.name}>
                {l.name}
              </span>
              <span className="text-xs tabular-nums text-ink-3 max-sm:hidden">{l.total}</span>
              <button
                type="button"
                onClick={onLeave}
                aria-pressed="true"
                aria-label={`Leave focus on ${l.name}`}
                title="Leave focus (Esc)"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-active text-ink hover:bg-hover"
              >
                <LocateFixed className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            </span>
          ) : (
            <button
              key={l.id}
              type="button"
              onClick={() => onPick(l.id)}
              title={`${l.name} (${l.total})`}
              aria-label={`Focus ${l.name}`}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-hover max-sm:hidden"
            >
              <EntityTile size="sm" icon={l.icon} color={l.color} name={l.name} />
            </button>
          ),
        )}
      </div>
      {edges.end ? (
        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label="Scroll the Lists forward"
          title="Scroll forward"
          className="ms-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink max-sm:hidden"
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export function BirdseyeFocus({
  lists,
  focusedId,
  focus,
  status,
  subtasks,
  q,
  hideClosed,
  actions,
  onSwitch,
  onLeave,
  onLoadMore,
  onCreate,
  onRetry,
}: {
  lists: BirdseyeList[];
  focusedId: string;
  focus: FocusState | null;
  status: "loading" | "ready" | "error";
  subtasks: Record<string, SubtaskEntry>;
  q: string;
  hideClosed: boolean;
  actions: CardActions;
  onSwitch: (id: string) => void;
  onLeave: () => void;
  onLoadMore: (target: LoadMoreTarget) => void;
  onCreate: (boardId: string, title: string, status: string, place: "top" | "bottom") => Promise<{ ok: true } | { ok: false; error: string }>;
  onRetry: () => void;
}) {
  const list = lists.find((l) => l.id === focusedId) ?? null;
  const dragging = useRef<Card | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const strip = (
    <nav aria-label="Lists in this Space" className="flex h-11 min-w-0 shrink-0 items-center gap-2 border-b border-line-soft px-6">
      <BirdseyeListSwitcher lists={lists} focusedId={focusedId} onPick={onSwitch} />
      <ChipRow lists={lists} focusedId={focusedId} onPick={onSwitch} onLeave={onLeave} />
      {list ? (
        <Link
          href={`/boards/${list.slug}`}
          title={`Open ${list.name}`}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
        >
          {/* Words on a desktop, the arrow alone on a phone: the name stays
              the link's accessible name either way. */}
          <span className="max-sm:sr-only">Open List</span>
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
      ) : null}
    </nav>
  );

  if (!focus || !list) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {lists.length > 0 ? strip : null}
        {status === "error" ? <ErrorState what="this List" onRetry={onRetry} /> : <BirdseyeSkeleton columns={4} />}
      </div>
    );
  }

  const statuses = list.statuses.filter((s) => !hideClosed || !isClosedStatus(list.statuses, s.value));
  const canWrite = list.canContribute;

  const dropProps = (value: string) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      const card = dragging.current;
      if (!card || !e.dataTransfer.types.includes(CARD_DRAG_TYPE)) return;
      if (bucketFor(list.statuses, card.status) === value) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== value) setOver(value);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((cur) => (cur === value ? null : cur));
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const card = dragging.current;
      setOver(null);
      if (!card || e.dataTransfer.getData(CARD_DRAG_TYPE) !== card.id) return;
      e.preventDefault();
      dragging.current = null;
      if (bucketFor(list.statuses, card.status) !== value) actions.onChangeStatus(card, value);
    },
  });

  const columns: GridColumn[] = statuses.map((s) => {
    const col = focus.columns[s.value] ?? { cards: [], justAdded: [], nextCursor: null, total: 0, loadingMore: false, moreError: false };
    const shown = [...col.justAdded, ...col.cards];
    const header = (
      <div className="flex h-10 min-w-0 items-center gap-2" title={s.label}>
        <StatusGlyph current={s} statuses={list.statuses} />
        <span className="min-w-0 truncate text-base font-semibold text-ink">{s.label}</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-3" aria-label={`${col.total} ${col.total === 1 ? "task" : "tasks"}`}>
          {col.total}
        </span>
      </div>
    );
    const body = (
      <div className="flex min-h-[160px] flex-col">
        <ul className="flex flex-col gap-2" aria-label={`${s.label} tasks`}>
          {canWrite ? (
            <li>
              <AddTaskRow
                label={`${s.label} task`}
                inputLabel={`New ${s.label} task in ${list.name}`}
                color={s.color}
                onCreate={(title) => onCreate(list.id, title, s.value, "top")}
              />
            </li>
          ) : null}
          {shown.map((card) => (
            <BirdseyeCard
              key={card.id}
              card={card}
              list={list}
              subtasks={subtasks[card.id]}
              now={actions.now}
              onOpen={actions.onOpen}
              onChangeStatus={actions.onChangeStatus}
              onLoadSubtasks={actions.onLoadSubtasks}
              draggable={canWrite}
              onDragStart={(c) => {
                dragging.current = c;
              }}
              onDragEnd={() => {
                dragging.current = null;
                setOver(null);
              }}
            />
          ))}
          {canWrite && shown.length > 0 && !col.nextCursor ? (
            <li>
              <AddTaskRow
                label={`${s.label} task`}
                inputLabel={`New ${s.label} task at the end of ${list.name}`}
                color={s.color}
                onCreate={(title) => onCreate(list.id, title, s.value, "bottom")}
              />
            </li>
          ) : null}
        </ul>
        {shown.length === 0 ? <EmptyColumnLine searching={!!q} /> : null}
        {col.nextCursor ? (
          <ShowMore loading={col.loadingMore} failed={col.moreError} onClick={() => onLoadMore({ kind: "focus", status: s.value })} />
        ) : null}
      </div>
    );
    return {
      key: s.value,
      label: `${s.label}, ${col.total} ${col.total === 1 ? "task" : "tasks"}`,
      header,
      body,
      dropProps: canWrite ? dropProps(s.value) : undefined,
      highlighted: over === s.value,
    };
  });

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col")}>
      {strip}
      <BirdseyeGrid columns={columns} label={`${list.name} by status`} />
    </div>
  );
}
