import { describe, expect, it } from "vitest";
import { placePopover, anchorVisibleIn } from "./request-changes-popover";

// The Request changes popover used to be absolute inside a TableCard cell,
// so the card's overflow clipped it and Send sat under the table footer.
// It is now fixed and placed from its anchor's box by placePopover.

const VIEW = { width: 1440, height: 900 };
const POP = { width: 280, height: 150 };
const box = (top: number, left: number, w = 200, h = 28) => ({ top, bottom: top + h, left, right: left + w });

describe("placePopover", () => {
  it("opens below the anchor, lined up with its end edge", () => {
    const p = placePopover(box(200, 1200), POP, VIEW, { align: "end" });
    expect(p).toEqual({ top: 232, left: 1120, side: "below" });
  });

  it("lines up with the start edge by default", () => {
    expect(placePopover(box(200, 600), POP, VIEW).left).toBe(600);
  });

  it("flips above when there is no room below (a row near the bottom)", () => {
    const p = placePopover(box(800, 1200), POP, VIEW, { align: "end" });
    expect(p.side).toBe("above");
    expect(p.top).toBe(800 - 4 - 150);
    // the whole popover, Send included, is on screen
    expect(p.top + POP.height).toBeLessThanOrEqual(VIEW.height - 8);
  });

  it("prefers above for a bar at the bottom, and falls back below when above has no room", () => {
    expect(placePopover(box(820, 600), POP, VIEW, { prefer: "above" }).side).toBe("above");
    expect(placePopover(box(40, 600), POP, VIEW, { prefer: "above" }).side).toBe("below");
  });

  it("stays inside the viewport when neither side fits", () => {
    const p = placePopover(box(100, 10, 50, 20), { width: 280, height: 400 }, { width: 400, height: 500 });
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + 400).toBeLessThanOrEqual(500 - 8);
    expect(p.left).toBe(10);
  });

  it("clamps horizontally so the popover never leaves the screen", () => {
    expect(placePopover(box(200, 20, 100), POP, VIEW, { align: "end" }).left).toBe(8);
    expect(placePopover(box(200, 1400, 30), POP, VIEW).left).toBe(1440 - 8 - 280);
  });

  it("mirrors in RTL: end means the anchor's left edge", () => {
    expect(placePopover(box(200, 600), POP, VIEW, { align: "end", rtl: true }).left).toBe(600);
    expect(placePopover(box(200, 600), POP, VIEW, { align: "start", rtl: true }).left).toBe(800 - 280);
  });
});

describe("anchorVisibleIn (the popover hides when its row scrolls away)", () => {
  const body = { top: 200, bottom: 600, left: 100, right: 900 };
  it("is visible while any of the row is inside every clipping box", () => {
    expect(anchorVisibleIn({ top: 580, bottom: 620, left: 700, right: 760 }, [body])).toBe(true);
    expect(anchorVisibleIn({ top: 300, bottom: 330, left: 700, right: 760 }, [body, { top: 0, bottom: 900, left: 0, right: 1440 }])).toBe(true);
  });
  it("hides once the row has left the table body, above or below", () => {
    expect(anchorVisibleIn({ top: -533, bottom: -505, left: 700, right: 760 }, [body])).toBe(false);
    expect(anchorVisibleIn({ top: 600, bottom: 630, left: 700, right: 760 }, [body])).toBe(false);
  });
  it("treats a collapsed anchor as hidden", () => {
    expect(anchorVisibleIn({ top: 300, bottom: 300, left: 700, right: 700 }, [body])).toBe(false);
  });
});
