// Settings clean-up Phase 1 fixes H1 and L6: an anchored Picker opens where
// it is seen whole. The numbers are the real ones from the review: a 390
// phone whose <main> starts at x=64, a stacked row's control at the left,
// a 280px popover; and a scrolling drawer with a select near its foot.

import { describe, expect, it } from "vitest";
import { clipBox, placePopover, MIN_LIST_HEIGHT, type Box, type ClipNode, type ClipStyle } from "./picker-placement";

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const phone = box(64, 0, 390, 900); // <main> on a 390 phone, after the 64px rail
const desk = box(304, 0, 1440, 900);

describe("placePopover, across (H1)", () => {
  it("flips an end-aligned popover to start when the trigger sits at a stacked row's left", () => {
    // The trigger: 96px wide at x=96 (main's 16px gutter plus the card's).
    const p = placePopover({ anchor: box(96, 300, 192, 336), pop: { width: 280, height: 160 }, bounds: phone, align: "end", side: "bottom" });
    expect(p.align).toBe("start");
    expect(p.left).toBe(0);
    // On screen and inside <main>.
    expect(96 + p.left).toBeGreaterThanOrEqual(64);
    expect(96 + p.left + 280).toBeLessThanOrEqual(390);
  });

  it("keeps the asked edge when it fits (a desktop row's control at the right)", () => {
    const p = placePopover({ anchor: box(1180, 300, 1376, 336), pop: { width: 280, height: 160 }, bounds: desk, align: "end", side: "bottom" });
    expect(p).toEqual({ align: "end", side: "bottom", left: 196 - 280 });
  });

  it("flips a start-aligned popover to end when it would run off the right", () => {
    const p = placePopover({ anchor: box(1250, 300, 1376, 336), pop: { width: 280, height: 160 }, bounds: desk, align: "start", side: "bottom" });
    expect(p.align).toBe("end");
    expect(1250 + p.left + 280).toBe(1376);
  });

  it("slides inside the box when neither edge fits, and narrows to a box smaller than itself", () => {
    // A trigger in the middle of a 326px column: start runs off the right, end off the left.
    const mid = placePopover({ anchor: box(150, 300, 250, 336), pop: { width: 300, height: 160 }, bounds: phone, align: "end", side: "bottom" });
    expect(150 + mid.left).toBeGreaterThanOrEqual(64 + 8);
    expect(150 + mid.left + 300).toBeLessThanOrEqual(390 - 8);
    const tight = placePopover({ anchor: box(80, 300, 180, 336), pop: { width: 320, height: 160 }, bounds: box(64, 0, 330, 900), align: "start", side: "bottom" });
    expect(tight.maxWidth).toBe(330 - 64 - 16);
    expect(80 + tight.left).toBe(64 + 8);
  });
});

describe("placePopover, up and down (L6)", () => {
  // The member drawer's body scrolls between y=48 and y=600 (a short window).
  const drawer = box(870, 48, 1390, 600);

  it("opens upward when there is no room below but room above", () => {
    const p = placePopover({ anchor: box(1150, 520, 1370, 556), pop: { width: 280, height: 200 }, bounds: drawer, align: "end", side: "bottom" });
    expect(p.side).toBe("top");
    expect(p.listMaxHeight).toBeUndefined();
  });

  it("stays below when it fits there", () => {
    const p = placePopover({ anchor: box(1150, 100, 1370, 136), pop: { width: 280, height: 200 }, bounds: drawer, align: "end", side: "bottom" });
    expect(p.side).toBe("bottom");
  });

  it("takes the roomier side and shortens the list when neither side holds it all", () => {
    const short = box(870, 48, 1390, 400);
    // 180px above, 110px below; the popover is 330 tall, 280 of it the list.
    const p = placePopover({ anchor: box(1150, 240, 1370, 276), pop: { width: 280, height: 330, listHeight: 280 }, bounds: short, align: "end", side: "bottom" });
    expect(p.side).toBe("top");
    const above = 240 - 4 - (48 + 8);
    expect(p.listMaxHeight).toBe(above - 50);
    // Never shorter than three rows.
    const tiny = placePopover({ anchor: box(1150, 60, 1370, 96), pop: { width: 280, height: 330, listHeight: 280 }, bounds: box(870, 48, 1390, 200), align: "end", side: "bottom" });
    expect(tiny.listMaxHeight).toBe(MIN_LIST_HEIGHT);
  });
});

// A fake element chain: each node is [tag, style, rect, client size].
function chain(nodes: { tag: string; style: Partial<ClipStyle>; rect?: [number, number, number, number] }[]): ClipNode {
  let parent: ClipNode | null = null;
  const built: ClipNode[] = [];
  for (const n of [...nodes].reverse()) {
    const [l, t, w, hgt] = n.rect ?? [0, 0, 0, 0];
    const node: ClipNode & { style: ClipStyle } = {
      tagName: n.tag,
      parentElement: parent,
      clientLeft: 0,
      clientTop: 0,
      clientWidth: w,
      clientHeight: hgt,
      getBoundingClientRect: () => ({ left: l, top: t }),
      style: { overflowX: "visible", overflowY: "visible", position: "static", transform: "none", filter: "none", contain: "none", ...n.style },
    };
    built.unshift(node);
    parent = node;
  }
  return built[0];
}
const styleOf = (el: ClipNode) => (el as ClipNode & { style: ClipStyle }).style;
const view = { width: 390, height: 900 };

describe("clipBox: what the popover can be seen in", () => {
  it("is <main>'s box when <main> scrolls (overflow-y auto clips both ways)", () => {
    const start = chain([
      { tag: "SPAN", style: { position: "relative" } },
      { tag: "DIV", style: {} },
      { tag: "MAIN", style: { overflowX: "auto", overflowY: "auto" }, rect: [64, 56, 326, 844] },
      { tag: "BODY", style: { overflowX: "hidden", overflowY: "hidden" }, rect: [0, 0, 10, 10] },
    ]);
    expect(clipBox(start, view, styleOf)).toEqual(box(64, 56, 390, 900));
  });

  it("skips a clipping ancestor that an absolute box between them escapes", () => {
    const start = chain([
      { tag: "SPAN", style: { position: "relative" } },
      { tag: "DIV", style: { position: "absolute" } },
      { tag: "DIV", style: { overflowX: "hidden", overflowY: "hidden" }, rect: [100, 100, 50, 50] },
      { tag: "DIV", style: { position: "relative", overflowX: "auto", overflowY: "auto" }, rect: [0, 40, 390, 800] },
    ]);
    expect(clipBox(start, view, styleOf)).toEqual(box(0, 40, 390, 840));
  });

  it("stops at a fixed dialog: its own scroll box clips, the page behind it does not", () => {
    const start = chain([
      { tag: "SPAN", style: { position: "relative" } },
      { tag: "DIV", style: { position: "fixed", transform: "matrix(1, 0, 0, 1, -180, -200)", overflowX: "auto", overflowY: "auto" }, rect: [16, 200, 358, 500] },
      { tag: "MAIN", style: { overflowX: "auto", overflowY: "auto" }, rect: [64, 56, 326, 844] },
    ]);
    expect(clipBox(start, view, styleOf)).toEqual(box(16, 200, 374, 700));
  });

  it("is the viewport when nothing clips", () => {
    expect(clipBox(chain([{ tag: "SPAN", style: { position: "relative" } }]), view, styleOf)).toEqual(box(0, 0, 390, 900));
  });
});
