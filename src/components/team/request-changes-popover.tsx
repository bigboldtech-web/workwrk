"use client";

// RequestChangesPopover (spec-goals section 3): the 280px anchored popover
// behind every "Request changes" button on a manager surface (the Alignment
// board, Sub-teams, KPI reviews, and the weekly queue by choice). The note
// is REQUIRED: a person told "change this" with no word of what is worse off
// than one told nothing, so Send stays disabled until there is text.
//
// Esc and an outside click close it; with unsaved text either asks first,
// so a slip of the hand never throws a written note away. Send is secondary,
// not blue: the page that hosts it has no primary to compete with.
//
// Rendered in place, never in a portal, so it stays inside any drawer or
// dialog focus trap and the outside-click check below still counts it as
// inside. But it is position FIXED, placed from its anchor's box (the
// element it is rendered into, or `anchorRef`): the buttons it hangs off
// sit in a TableCard row, and the card's body is overflow auto inside an
// overflow hidden card. An absolute popover there was clipped by the card
// and made the body scroll to fit it, so the row being judged scrolled out
// of view and Send sat half under the table footer. Fixed escapes that
// clipping; it opens below the anchor and flips above when there is no
// room, and follows the anchor on every scroll and resize. When its row
// scrolls out of the table's visible area it hides (it never floats loose
// over the top bar), and stays mounted, so a note being typed is still
// there when the row scrolls back.

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useConfirm } from "@/components/ui/dialog-provider";

export interface AnchorBox { top: number; bottom: number; left: number; right: number }

/**
 * Where a popover of `size` goes next to `anchor` inside a viewport, in
 * viewport px. Pure, so it is tested (request-changes-popover.test.ts).
 * `prefer` side first; the other side when only it has room; else the side
 * with more room. Always clamped `margin` px inside the viewport, so Send is
 * never off screen. `align` is logical: "end" lines the popover's inline end
 * up with the anchor's (the right edge, or the left one in RTL).
 */
export function placePopover(
  anchor: AnchorBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { align?: "start" | "end"; prefer?: "below" | "above"; rtl?: boolean; gap?: number; margin?: number } = {},
): { top: number; left: number; side: "below" | "above" } {
  const { align = "start", prefer = "below", rtl = false, gap = 4, margin = 8 } = opts;
  const roomBelow = viewport.height - margin - (anchor.bottom + gap);
  const roomAbove = anchor.top - gap - margin;
  const fitsBelow = size.height <= roomBelow;
  const fitsAbove = size.height <= roomAbove;
  const side: "below" | "above" =
    prefer === "below"
      ? (fitsBelow || (!fitsAbove && roomBelow >= roomAbove) ? "below" : "above")
      : (fitsAbove || (!fitsBelow && roomAbove >= roomBelow) ? "above" : "below");
  const rawTop = side === "below" ? anchor.bottom + gap : anchor.top - gap - size.height;
  const top = Math.max(margin, Math.min(rawTop, viewport.height - margin - size.height));
  const alignRight = (align === "end") !== rtl;
  const rawLeft = alignRight ? anchor.right - size.width : anchor.left;
  const left = Math.max(margin, Math.min(rawLeft, viewport.width - margin - size.width));
  return { top, left, side };
}

/**
 * Whether any of `anchor` is inside every clipping box around it (the
 * scrolling table body, the card). Pure, so it is tested. A zero-size anchor
 * counts as hidden.
 */
export function anchorVisibleIn(anchor: AnchorBox, clips: AnchorBox[]): boolean {
  if (anchor.bottom <= anchor.top || anchor.right <= anchor.left) return false;
  return clips.every((c) => anchor.bottom > c.top && anchor.top < c.bottom && anchor.right > c.left && anchor.left < c.right);
}

/**
 * The boxes that clip `el`: every ancestor whose overflow is not visible, up
 * to the first position fixed one. A fixed box (the TableCard bulk bar) is
 * placed against the viewport, so the overflow of the boxes above it never
 * clips it or what it holds.
 */
function clipBoxes(el: HTMLElement): AnchorBox[] {
  const out: AnchorBox[] = [];
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") out.push(n.getBoundingClientRect());
    if (cs.position === "fixed") break;
  }
  return out;
}

/**
 * Keeps a position-fixed element `ref` next to its anchor: `anchorRef`, or
 * the element it is rendered into. Written straight to the style before
 * paint (no state, no flash at 0,0) and again on any scroll (capture, so a
 * scrolling table body counts), a resize, or the popover growing (a textarea
 * pulled taller, the "Not sent" line appearing).
 */
export function useAnchoredPosition(
  ref: RefObject<HTMLElement | null>,
  opts: { anchorRef?: RefObject<HTMLElement | null>; align?: "start" | "end"; prefer?: "below" | "above" } = {},
): void {
  const { anchorRef, align, prefer } = opts;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const anchor = anchorRef?.current ?? el.parentElement;
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const shown = anchorVisibleIn(a, clipBoxes(anchor));
      el.style.visibility = shown ? "" : "hidden";
      el.style.pointerEvents = shown ? "" : "none";
      if (!shown) return;
      const p = placePopover(
        a,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { align, prefer, rtl: getComputedStyle(anchor).direction === "rtl" },
      );
      // Fixed is relative to the viewport unless an ancestor has a transform
      // (the TableCard bulk bar is centred with one). So park the element at
      // 0,0, read where that lands, and offset by it: right in both cases.
      el.style.top = "0px";
      el.style.left = "0px";
      const o = el.getBoundingClientRect();
      el.style.top = `${p.top - o.top}px`;
      el.style.left = `${p.left - o.left}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      ro?.disconnect();
    };
  }, [ref, anchorRef, align, prefer]);
}

export function RequestChangesPopover({
  personFirstName,
  subject,
  onSend,
  onCancel,
  busy = false,
  align = "start",
  prefer = "below",
  anchorRef,
}: {
  personFirstName: string;
  /** What the note is about (the KPI's name), so a manager with many rows
   *  knows where it lands. */
  subject?: string;
  /** Resolve true when the note was saved; the popover closes on true. */
  onSend: (note: string) => Promise<boolean> | boolean;
  onCancel: () => void;
  busy?: boolean;
  align?: "start" | "end";
  /** The side to open on when both have room (a bar at the bottom wants "above"). */
  prefer?: "below" | "above";
  /** The element to hang off; the element it is rendered into by default. */
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const confirm = useConfirm();
  const labelId = useId();
  const dirty = note.trim().length > 0;
  useAnchoredPosition(ref, { anchorRef, align, prefer });

  const tryClose = async () => {
    if (dirty) {
      const ok = await confirm({ title: "Discard this note?", confirmLabel: "Discard", destructive: true });
      if (!ok) return;
    }
    onCancel();
  };

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      void tryClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) void tryClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  });

  const send = async () => {
    const text = note.trim();
    if (!text || busy) return;
    setFailed(false);
    const ok = await onSend(text);
    if (!ok) setFailed(true);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={labelId}
      className="fixed z-[60] w-[280px] rounded-lg border border-line bg-raised p-3 text-ink shadow-[var(--os-shadow-pop)]"
    >
      <label id={labelId} htmlFor={`${labelId}-note`} className="mb-1.5 block text-sm font-medium text-ink">
        {subject ? <>What should {personFirstName} change on {subject}?</> : <>What should {personFirstName} change?</>}
      </label>
      <textarea
        id={`${labelId}-note`}
        ref={textRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
        }}
        rows={2}
        maxLength={5000}
        className="block w-full resize-y rounded-md border border-line bg-raised px-2 py-1.5 text-base text-ink outline-none placeholder:text-ink-3 focus:border-brand"
        placeholder="A sentence is enough"
      />
      {failed ? <p className="mt-1.5 text-xs text-danger-text">Not sent. Your note is kept; try again.</p> : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void tryClose()}
          className="inline-flex h-8 items-center rounded-md px-3 text-sm text-ink-2 hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!dirty || busy}
          className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50"
        >
          {busy ? "Sending" : "Send"}
        </button>
      </div>
    </div>
  );
}
