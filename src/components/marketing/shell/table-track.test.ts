import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MK_TASK_COLS } from "./primitives";

// The column track, and why it is tested rather than eyeballed.
//
// A marketing-lite table lays its header and its rows out as two separate
// flex rows. Before the track existed, each header label was sized to its
// own text and each body cell to its own content, so "Status" sat wherever
// the word ended while the cell under it started wherever the status chip
// began. Worse, the chips are not all one width: a row reading "In progress"
// pushed its neighbours further left than a row reading "Review", so no two
// rows lined up either. On the one table the site uses to say "this is the
// real product", the columns were ragged.
//
// The fix is a single array shared by the header and every row. These tests
// pin the two properties that make it work, because both fail silently in a
// screenshot nobody happens to open: the flexible column has to be first,
// and each fixed column has to be wide enough for the HEADER LABEL as well
// as the value, or the label renders as "O..." with an ellipsis.

/**
 * Widths below are MEASURED in the browser at the frame's own type scale,
 * not estimated from a characters-times-a-constant guess. The guess is what
 * made the first version of this file wrong in both directions at once: it
 * over-stated "Not started" and under-stated nothing, and it would have
 * passed a 92px status column that a measurement showed "In progress"
 * overflowing by 0.6px.
 */
const MEASURED = {
  /** The widest chip statusLabel() can produce: "In progress", chip and all. */
  widestStatusChip: 93,
  /** Header labels at 12px, 500 weight. */
  label: { Name: 34, Status: 41, Owner: 41, Due: 26 } as Record<string, number>,
  /** The widest due value the fixture carries: "Day 10". */
  widestDue: 44,
};

describe("the shared column track", () => {
  it("puts the one flexible column first and fixes every column after it", () => {
    expect(MK_TASK_COLS[0]).toBeNull();
    for (const w of MK_TASK_COLS.slice(1)) {
      expect(typeof w).toBe("number");
      expect(w as number).toBeGreaterThan(0);
    }
  });

  it("has exactly one flexible column, so the row cannot have two growing cells", () => {
    expect(MK_TASK_COLS.filter((w) => w === null)).toHaveLength(1);
  });

  it("gives Name, Status, Owner and Due one entry each", () => {
    expect(MK_TASK_COLS).toHaveLength(4);
  });

  it("is wide enough for each header label, not just for the value", () => {
    // Owner is the one that actually regressed: 28px fits an avatar and
    // clips the word "Owner" to "O...". The header is the wider of the two
    // things in the column, so the header is what sizes it.
    const labels = ["Name", "Status", "Owner", "Due"];
    MK_TASK_COLS.forEach((w, i) => {
      if (w == null) return;
      expect(w, `${labels[i]} column is too narrow for its own header label`).toBeGreaterThanOrEqual(
        MEASURED.label[labels[i]],
      );
    });
  });

  it("is wide enough for the widest due value, without hoarding room from the title", () => {
    // The name column is the one that has to hold a real task title inside
    // a 500px seat card, so every pixel the fixed columns do not need
    // belongs to it. Due was 64 for no measured reason and cost the title
    // an extra wrapped line in the narrowest frames.
    const due = MK_TASK_COLS[3] as number;
    expect(due).toBeGreaterThanOrEqual(MEASURED.widestDue);
    expect(due, "Due is hoarding width the task title needs").toBeLessThan(MEASURED.widestDue + 16);
  });

  it("is wide enough for the widest status chip it has to carry", () => {
    // The status column is the one that decides whether rows line up at
    // all: the chip has white-space nowrap and does not shrink, so a column
    // narrower than the widest chip spills into the owner column on exactly
    // the rows carrying the longest status, which is how the ragged look
    // started. Measured, "In progress" is 93px including dot and padding.
    expect(MK_TASK_COLS[1] as number).toBeGreaterThanOrEqual(MEASURED.widestStatusChip);
  });
});

describe("every table on the site rides a track", () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");

  it("passes widths to both the card and its rows wherever a card declares one", () => {
    // A card with a track and rows without one is the worst of both: the
    // header moves onto the track and the body does not, so the two line up
    // less well than before. Wherever a file mentions the prop at all, the
    // card count and the row count have to match.
    // home/sections.tsx used to be the second file here. It rendered the
    // rejected home page's seat cards and switch off table and is gone
    // with them; the surface library is the one place a table is drawn.
    for (const file of [["shell", "surfaces.tsx"]]) {
      const src = read(...file);
      const cards = (src.match(/<MkTableCard[^>]*widths=/g) ?? []).length;
      const allCards = (src.match(/<MkTableCard/g) ?? []).length;
      const rows = (src.match(/<MkTableRow[^>]*widths=/g) ?? []).length;
      const allRows = (src.match(/<MkTableRow/g) ?? []).length;
      expect(cards, `${file.join("/")}: every MkTableCard should declare a track`).toBe(allCards);
      expect(rows, `${file.join("/")}: every MkTableRow should ride its card's track`).toBe(allRows);
    }
  });

  it("no longer sizes a due date cell by hand", () => {
    // The old shape. If it comes back, it is fighting the track.
    const src = read("shell", "surfaces.tsx");
    expect(src).not.toContain('width: 64, textAlign: "right"');
  });
});
