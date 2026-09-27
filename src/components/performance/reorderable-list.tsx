"use client";

// ReorderableList (spec-teams-performance section 3): an ordered list with
// THREE ways to reorder, never one, so no builder in this unit can ship with
// only a drag handle (CG-10):
//   pointer   drag the grip (a 120ms press and 8px slop on touch, so a page
//             scroll is never taken for a drag)
//   keyboard  the grip is a real button: Space or Enter picks the row up,
//             Up and Down move it, Space, Enter or Tab drop it, Esc puts it
//             back; a polite live region announces every step
//   menu      renderRow receives moveUp / moveDown (absent at the ends) for
//             the row's "..." menu, the path that works on touch without a
//             long press and the one the old chevron buttons became

import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReorderRowApi {
  moveUp?: () => void;
  moveDown?: () => void;
  index: number;
  count: number;
  grip: ReactNode;
}

export function ReorderableList<T>({
  items,
  onReorder,
  renderRow,
  itemLabel,
  itemKey,
  noun = "Question",
  disabled = false,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  renderRow: (item: T, api: ReorderRowApi) => ReactNode;
  itemLabel: (item: T) => string;
  itemKey: (item: T) => string;
  noun?: string;
  disabled?: boolean;
}) {
  const [grabbed, setGrabbed] = useState<number | null>(null);
  const [origin, setOrigin] = useState<number | null>(null);
  const [live, setLive] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const gripRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const press = useRef<{ x: number; y: number; t: number; index: number; active: boolean } | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = items.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onReorder(next);
    return to;
  };

  const announce = (text: string) => setLive(text);

  const onGripKey = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    if (grabbed === null) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setGrabbed(index);
        setOrigin(index);
        announce(`${noun} ${index + 1} of ${items.length} grabbed, use up and down arrows to move, space to drop`);
      }
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const to = move(grabbed, grabbed + (e.key === "ArrowUp" ? -1 : 1));
      if (to !== undefined) {
        setGrabbed(to);
        announce(`${noun} ${to + 1} of ${items.length}`);
        requestAnimationFrame(() => gripRefs.current[to]?.focus());
      }
    } else if (e.key === " " || e.key === "Enter" || e.key === "Tab") {
      if (e.key !== "Tab") e.preventDefault();
      announce(`${noun} dropped at ${grabbed + 1} of ${items.length}`);
      setGrabbed(null);
      setOrigin(null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (origin !== null && origin !== grabbed) move(grabbed, origin);
      announce("Move cancelled");
      const back = origin;
      setGrabbed(null);
      setOrigin(null);
      if (back !== null) requestAnimationFrame(() => gripRefs.current[back]?.focus());
    }
  };

  // Pointer drag: the row under the pointer's y takes the dragged row's place.
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (disabled || e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, index, active: e.pointerType === "mouse" };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.active) {
      const far = Math.abs(e.clientX - p.x) > 8 || Math.abs(e.clientY - p.y) > 8;
      if (far && e.timeStamp - p.t < 120) { press.current = null; return; }
      if (e.timeStamp - p.t >= 120) p.active = true; else return;
    }
    setDragIndex(p.index);
    const rows = rowRefs.current;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]?.getBoundingClientRect();
      if (!r) continue;
      if (e.clientY >= r.top && e.clientY <= r.bottom && i !== p.index) {
        const to = move(p.index, i);
        if (to !== undefined) p.index = to;
        break;
      }
    }
  };
  const onPointerUp = () => {
    if (press.current?.active && dragIndex !== null) announce(`${noun} dropped at ${(press.current.index ?? 0) + 1} of ${items.length}`);
    press.current = null;
    setDragIndex(null);
  };

  return (
    <>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item, i) => {
          const lifted = grabbed === i || dragIndex === i;
          const grip = disabled ? null : (
            <button
              ref={(el) => { gripRefs.current[i] = el; }}
              type="button"
              aria-label={`Reorder ${itemLabel(item) || `${noun.toLowerCase()} ${i + 1}`}`}
              aria-pressed={grabbed === i}
              onKeyDown={(e) => onGripKey(e, i)}
              onBlur={() => { if (grabbed === i) { setGrabbed(null); setOrigin(null); } }}
              onPointerDown={(e) => onPointerDown(e, i)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="inline-flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink-2 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
          );
          return (
            <li
              key={itemKey(item)}
              ref={(el) => { rowRefs.current[i] = el; }}
              className={cn("rounded-md", lifted && "bg-raised shadow-[var(--os-shadow-pop)]")}
            >
              {renderRow(item, {
                index: i,
                count: items.length,
                grip,
                moveUp: i > 0 && !disabled ? () => { move(i, i - 1); announce(`${noun} ${i} of ${items.length}`); } : undefined,
                moveDown: i < items.length - 1 && !disabled ? () => { move(i, i + 1); announce(`${noun} ${i + 2} of ${items.length}`); } : undefined,
              })}
            </li>
          );
        })}
      </ol>
      <span className="sr-only" aria-live="polite">{live}</span>
    </>
  );
}
