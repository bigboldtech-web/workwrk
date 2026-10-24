// Where an anchored Picker opens so it is seen whole (settings-cleanup
// Phase 1 fix H1 and L6).
//
// The Picker is a position:absolute child of its trigger, never portalled
// (design-system 5.6), so a parent that scrolls or hides its overflow cuts
// it off, and so does the edge of the screen. A settings row stacks below
// 640px and puts its control at the LEFT, where an end-aligned 280px popover
// opened off the left edge of a phone; a select near the foot of a scrolling
// drawer opened below what the drawer shows.
//
// So, measured from the trigger before the first paint: keep the asked edge
// and side when the popover fits there, take the other edge or side when
// only that fits, and when neither does, take the roomier side, shorten the
// list to the room and slide the popover inside the visible box. Pure, so
// the rules are tested without a browser; Picker does the measuring.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placement {
  align: "start" | "end";
  side: "bottom" | "top";
  /** The popover's left edge, in px from the trigger's left edge. */
  left: number;
  /** Set only when the visible box is narrower than the popover. */
  maxWidth?: number;
  /** Set only when neither side has room for the whole list. */
  listMaxHeight?: number;
}

/** Room kept between the popover and the edge of what is visible. */
export const PLACEMENT_MARGIN = 8;
/** The popover's distance from its trigger (mt-1 / mb-1). */
export const PLACEMENT_GAP = 4;
/** A shortened list still shows three 36px rows. */
export const MIN_LIST_HEIGHT = 108;

export function placePopover(input: {
  anchor: Box;
  pop: { width: number; height: number; listHeight?: number };
  bounds: Box;
  align: "start" | "end";
  side: "bottom" | "top";
  margin?: number;
  gap?: number;
}): Placement {
  const { anchor, pop, bounds, align, side } = input;
  const margin = input.margin ?? PLACEMENT_MARGIN;
  const gap = input.gap ?? PLACEMENT_GAP;

  // Across: the asked edge, else the other, else slid inside the box.
  const room = bounds.right - bounds.left - 2 * margin;
  const narrow = room > 0 && pop.width > room;
  const w = narrow ? room : pop.width;
  const minLeft = bounds.left + margin;
  const maxRight = bounds.right - margin;
  const leftFor = (a: "start" | "end") => (a === "start" ? anchor.left : anchor.right - w);
  const fitsAcross = (a: "start" | "end") => leftFor(a) >= minLeft - 0.5 && leftFor(a) + w <= maxRight + 0.5;
  const other = align === "start" ? "end" : "start";
  let chosenAlign: "start" | "end" = align;
  let left: number;
  if (fitsAcross(align)) left = leftFor(align);
  else if (fitsAcross(other)) {
    chosenAlign = other;
    left = leftFor(other);
  } else {
    left = Math.min(Math.max(leftFor(align), minLeft), Math.max(minLeft, maxRight - w));
  }

  // Up and down: the asked side, else the other, else the roomier one with
  // the list cut to fit.
  const below = bounds.bottom - margin - (anchor.bottom + gap);
  const above = anchor.top - gap - (bounds.top + margin);
  const roomOn = (s: "bottom" | "top") => (s === "bottom" ? below : above);
  const flip = side === "bottom" ? "top" : "bottom";
  let chosenSide: "bottom" | "top" = side;
  let listMaxHeight: number | undefined;
  if (roomOn(side) >= pop.height) chosenSide = side;
  else if (roomOn(flip) >= pop.height) chosenSide = flip;
  else {
    chosenSide = roomOn(flip) > roomOn(side) ? flip : side;
    const list = pop.listHeight ?? pop.height;
    const chrome = Math.max(0, pop.height - list);
    listMaxHeight = Math.max(MIN_LIST_HEIGHT, Math.floor(roomOn(chosenSide) - chrome));
  }

  return {
    align: chosenAlign,
    side: chosenSide,
    left: Math.round(left - anchor.left),
    ...(narrow ? { maxWidth: Math.floor(w) } : {}),
    ...(listMaxHeight !== undefined ? { listMaxHeight } : {}),
  };
}

/** The computed style fields clipBox reads. */
export interface ClipStyle {
  overflowX: string;
  overflowY: string;
  position: string;
  transform?: string;
  filter?: string;
  contain?: string;
}

/** What clipBox needs of an element (a DOM Element satisfies it). */
export interface ClipNode {
  tagName: string;
  parentElement: ClipNode | null;
  clientLeft: number;
  clientTop: number;
  clientWidth: number;
  clientHeight: number;
  getBoundingClientRect(): { left: number; top: number };
}

const makesFixedContainingBlock = (cs: ClipStyle) =>
  (!!cs.transform && cs.transform !== "none") ||
  (!!cs.filter && cs.filter !== "none") ||
  (!!cs.contain && /paint|layout|strict|content/.test(cs.contain));

/**
 * The part of the viewport an absolute popover whose containing block is
 * `start` can be seen in: the viewport cut by every ancestor that clips it.
 * An ancestor clips only when its overflow is not visible AND the popover's
 * containing-block chain runs through it, so the walk skips what an absolute
 * or fixed ancestor escapes. <body> and <html> hand their overflow to the
 * viewport, which is already the outer box.
 */
export function clipBox(
  start: ClipNode | null,
  view: { width: number; height: number },
  styleOf: (el: ClipNode) => ClipStyle,
): Box {
  const box: Box = { left: 0, top: 0, right: view.width, bottom: view.height };
  let needs: "any" | "positioned" | "fixed-cb" = "any";
  for (let el = start; el && el.tagName !== "BODY" && el.tagName !== "HTML"; el = el.parentElement) {
    const cs = styleOf(el);
    const containsChain =
      needs === "any" ? true : needs === "positioned" ? cs.position !== "static" || makesFixedContainingBlock(cs) : makesFixedContainingBlock(cs);
    if (containsChain) {
      const clipsX = cs.overflowX !== "visible";
      const clipsY = cs.overflowY !== "visible";
      if (clipsX || clipsY) {
        const r = el.getBoundingClientRect();
        const l = r.left + el.clientLeft;
        const t = r.top + el.clientTop;
        if (clipsX) {
          box.left = Math.max(box.left, l);
          box.right = Math.min(box.right, l + el.clientWidth);
        }
        if (clipsY) {
          box.top = Math.max(box.top, t);
          box.bottom = Math.min(box.bottom, t + el.clientHeight);
        }
      }
      // What this element's own box escapes, for the ancestors above it. An
      // element the chain skipped changes nothing: the chain is not in it.
      needs = cs.position === "absolute" ? "positioned" : cs.position === "fixed" ? "fixed-cb" : "any";
    }
  }
  return box;
}
