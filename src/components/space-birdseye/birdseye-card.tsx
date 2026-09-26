"use client";

// One Bird's eye card: a top-level task, its surface TINTED BY ITS STATUS.
//
// The tint is the founder's explicit ask and it overrides the design
// system's "no colour as emphasis" for this view only: a pale mix of the
// List's own status colour over the theme surface, for the background, the
// border and the subtasks pill, with the shares per theme in TINT_MIX
// (birdseye.test.ts holds the title to AA and the glyph to 3:1 on every
// status swatch, light and dark). Status is never colour alone: the glyph
// and its tooltip name it.
//
// A click anywhere on the card opens the task in the existing drawer over
// this view (openTask), with the task in the URL, so refresh and Back work
// and closing it lands on the same scroll position. The title is a real link,
// so a modified click still opens a new tab.

import { memo, useState, type DragEvent, type MouseEvent } from "react";
import { AlignLeft, Calendar as CalendarIcon, ChevronDown, ListTree } from "lucide-react";
import { Avatar } from "@/components/ui/avatar-stack";
import { SkeletonLines } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  CARD_TINT_CLASS,
  TINT_BG,
  TINT_LINE,
  TINT_PILL,
  dueLabel,
  isOverdue,
  liftedColor,
  resolveCardStatus,
  tintVars,
  type BirdseyeCard as Card,
  type BirdseyeList,
} from "@/lib/work/birdseye";
import { StatusPicker } from "./status-picker";
import type { SubtaskEntry } from "./use-birdseye";

/** The drag payload type, so a drop only ever accepts a Bird's eye card. */
export const CARD_DRAG_TYPE = "application/x-workwrk-birdseye-card";

function isInteractive(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.("a,button,input,textarea,select,[role='menu']");
}

export const BirdseyeCard = memo(function BirdseyeCard({
  card,
  list,
  subtasks,
  now,
  onOpen,
  onChangeStatus,
  onLoadSubtasks,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  list: BirdseyeList;
  subtasks?: SubtaskEntry;
  now: Date;
  onOpen: (id: string) => void;
  onChangeStatus: (card: Card, next: string) => void;
  onLoadSubtasks: (id: string) => void;
  /** Focus mode, for someone who may write: the card drags between status columns. */
  draggable?: boolean;
  onDragStart?: (card: Card) => void;
  onDragEnd?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const option = resolveCardStatus(list.statuses, card.status);
  const due = dueLabel(card.dueAt, now);
  const overdue = isOverdue(card.dueAt, now, option.group === "ACTIVE");
  const people = card.assignees;
  const extraPeople = Math.max(0, card.assigneeCount - people.length);
  const hasMeta = card.hasDescription || !!due || people.length > 0;

  const openCard = (e: MouseEvent) => {
    if (isInteractive(e.target)) return;
    onOpen(card.id);
  };
  const toggleSubtasks = (e: MouseEvent) => {
    e.stopPropagation();
    const next = !expanded;
    setExpanded(next);
    if (next && (!subtasks || subtasks.state === "error")) onLoadSubtasks(card.id);
  };

  return (
    <li className="[content-visibility:auto] [contain-intrinsic-size:auto_96px]">
      <div
        className={cn(
          "group/card relative flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 transition-colors",
          CARD_TINT_CLASS,
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        )}
        style={{ ...tintVars(option.color), backgroundColor: TINT_BG, borderColor: TINT_LINE }}
        onClick={openCard}
        draggable={draggable || undefined}
        onDragStart={
          draggable
            ? (e: DragEvent) => {
                e.dataTransfer.setData(CARD_DRAG_TYPE, card.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart?.(card);
              }
            : undefined
        }
        onDragEnd={draggable ? () => onDragEnd?.() : undefined}
      >
        <div className="flex items-start gap-2">
          <StatusPicker
            option={option}
            statuses={list.statuses}
            canChange={list.canContribute}
            onPick={(value) => onChangeStatus(card, value)}
            className="mt-px"
          />
          <a
            href={`/item/${card.id}`}
            draggable={false}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              e.stopPropagation();
              onOpen(card.id);
            }}
            className="min-w-0 flex-1 break-words text-base leading-5 text-ink line-clamp-3 hover:underline underline-offset-2"
            title={card.title}
          >
            {card.title}
          </a>
        </div>

        {hasMeta ? (
          <div className="flex min-w-0 items-center gap-2 ps-7 text-xs text-ink-2">
            {card.hasDescription ? (
              <span className="inline-flex" title="Has a description">
                <AlignLeft className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">Has a description</span>
              </span>
            ) : null}
            {due ? (
              <span
                className={cn("inline-flex min-w-0 items-center gap-1 tabular-nums", overdue ? "text-danger-text" : "text-ink-2")}
                title={overdue ? `Overdue, due ${due}` : `Due ${due}`}
              >
                <CalendarIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="truncate">{due}</span>
                {overdue ? <span className="sr-only">, overdue</span> : null}
              </span>
            ) : null}
            {people.length > 0 ? (
              <span className="ms-auto flex shrink-0 items-center -space-x-1.5" aria-label={`${card.assigneeCount} assigned`}>
                {people.map((p) => (
                  <Avatar key={p.id} person={p} size={20} ring />
                ))}
                {extraPeople > 0 ? <span className="ps-2 text-xs text-ink-3">+{extraPeople}</span> : null}
              </span>
            ) : null}
          </div>
        ) : null}

        {card.subtaskCount > 0 ? (
          <button
            type="button"
            onClick={toggleSubtasks}
            aria-expanded={expanded}
            className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-2 hover:text-ink"
            style={{ backgroundColor: TINT_PILL }}
          >
            <ListTree className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="tabular-nums">
              {card.subtaskCount} {card.subtaskCount === 1 ? "subtask" : "subtasks"}
            </span>
            <ChevronDown
              className={cn("ms-auto h-3.5 w-3.5 shrink-0 transition-transform", expanded ? "rotate-180" : null)}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        ) : null}

        {expanded && card.subtaskCount > 0 ? (
          <SubtaskList entry={subtasks} list={list} onOpen={onOpen} onRetry={() => onLoadSubtasks(card.id)} />
        ) : null}
      </div>
    </li>
  );
});

function SubtaskList({
  entry,
  list,
  onOpen,
  onRetry,
}: {
  entry: SubtaskEntry | undefined;
  list: BirdseyeList;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  if (!entry || (entry.state === "loading" && entry.rows.length === 0)) {
    return <SkeletonLines lines={2} className="px-1 py-1" />;
  }
  if (entry.state === "error" && entry.rows.length === 0) {
    return (
      <p className="flex items-center gap-2 px-1 text-xs text-ink-3">
        Couldn&rsquo;t load the subtasks.
        <button
          type="button"
          className="font-medium text-brand-deep hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          Try again
        </button>
      </p>
    );
  }
  if (entry.rows.length === 0) return <p className="px-1 text-xs text-ink-3">No subtasks left.</p>;
  return (
    <ul className="flex flex-col" aria-label="Subtasks">
      {entry.rows.map((row) => {
        const option = resolveCardStatus(list.statuses, row.status);
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(row.id);
              }}
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-start text-sm text-ink hover:bg-[color-mix(in_srgb,var(--be-c)_var(--be-pill),transparent)]"
              title={`${row.title} (${option.label})`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: liftedColor(option.color) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
              <span className="sr-only">, {option.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
