import { describe, expect, it } from "vitest";
import { DEFAULT_STATUS_OPTIONS, type StatusOption } from "@/lib/board-items-shared";
import { groupCardsByStatus } from "@/lib/kanban-columns";
import {
  CARD_TINT_CLASS,
  TINT_GLYPH,
  TINT_MIX,
  applyStatusMove,
  bucketFor,
  bucketRank,
  cardFromRow,
  cardMatchesFilters,
  closedValuesPresent,
  countDelta,
  decodeBucketCursor,
  decodeListCursor,
  descriptionPresent,
  dueLabel,
  encodeBucketCursor,
  encodeListCursor,
  isClosedStatus,
  isOverdue,
  keepJustAdded,
  liftedColor,
  likePattern,
  mergeFocusPage,
  mergeOverviewPage,
  moveStatusCounts,
  newTaskStatus,
  parseBirdseyeQuery,
  prettyStatusLabel,
  resolveCardStatus,
  safeStatusColor,
  tintVars,
  type BirdseyeCard,
} from "./birdseye";

const S: StatusOption[] = [
  { value: "TODO", label: "To do", color: "#98A2B3", group: "ACTIVE" },
  { value: "DOING", label: "Doing", color: "#0073EA", group: "ACTIVE" },
  { value: "DONE", label: "Done", color: "#15803D", group: "DONE" },
  { value: "DROPPED", label: "Dropped", color: "#6B7280", group: "CLOSED" },
];

function card(id: string, status: string | null, position: number, extra: Partial<BirdseyeCard> = {}): BirdseyeCard {
  return {
    id, boardId: "b", title: `Task ${id}`, status, position, rank: 0, dueAt: null,
    hasDescription: false, subtaskCount: 0, assignees: [], assigneeCount: 0, ...extra,
  };
}

describe("statuses", () => {
  it("resolves a declared status to the List's own option", () => {
    expect(resolveCardStatus(S, "DOING")).toBe(S[1]);
  });

  it("names an undeclared value in words, neutral, and reads a done name as Done", () => {
    expect(resolveCardStatus(S, "IN_REVIEW")).toEqual({ value: "IN_REVIEW", label: "In review", color: "var(--os-ink-3)", group: "ACTIVE" });
    expect(resolveCardStatus(S.slice(0, 2), "complete").group).toBe("DONE");
    expect(resolveCardStatus(S, null).label).toBe("No status");
    expect(prettyStatusLabel("in-progress")).toBe("In progress");
  });

  it("calls done and closed statuses closed, through the one done rule", () => {
    expect(isClosedStatus(S, "DONE")).toBe(true);
    expect(isClosedStatus(S, "DROPPED")).toBe(true);
    expect(isClosedStatus(S, "DOING")).toBe(false);
    expect(isClosedStatus(S, null)).toBe(false);
    // An undeclared value falls back to the name heuristic, as isDoneStatus does.
    expect(isClosedStatus(S, "completed")).toBe(true);
  });

  it("hands SQL exactly the closed values present", () => {
    expect(closedValuesPresent(S, ["TODO", "DONE", null, "DONE", "completed", "DROPPED"]).sort()).toEqual(["DONE", "DROPPED", "completed"]);
  });

  it("creates new tasks in the List's default when it declares it, else its first status", () => {
    expect(newTaskStatus(S, "DOING")).toBe("DOING");
    expect(newTaskStatus(S, "GONE")).toBe("TODO");
    expect(newTaskStatus(S, null)).toBe("TODO");
  });
});

describe("the bucket rule is the List's own Board rule", () => {
  it("puts declared values in their column and everything else in the first", () => {
    expect(bucketFor(S, "DONE")).toBe("DONE");
    expect(bucketFor(S, "LEGACY")).toBe("TODO");
    expect(bucketFor(S, null)).toBe("TODO");
    expect(bucketRank(S, "DROPPED")).toBe(3);
    expect(bucketRank(S, "LEGACY")).toBe(0);
  });

  it("agrees with groupCardsByStatus for every value", () => {
    const rows = ["TODO", "DOING", "DONE", "DROPPED", "LEGACY", null].map((status, i) => ({ id: `r${i}`, status }));
    const grouped = groupCardsByStatus(rows, S.map((s) => s.value));
    for (const row of rows) {
      const column = [...grouped.entries()].find(([, rs]) => rs.some((r) => r.id === row.id))?.[0];
      expect(bucketFor(S, row.status)).toBe(column);
    }
  });
});

describe("applyStatusMove", () => {
  const cols = () => ({
    TODO: { cards: [card("a", "TODO", 1), card("b", "TODO", 3)], total: 2 },
    DONE: { cards: [card("c", "DONE", 2), card("d", "DONE", 4)], total: 9 },
  });

  it("moves a card into (position, id) order and adjusts both totals", () => {
    const next = applyStatusMove(cols(), "b", "TODO", "DONE", "DONE");
    expect(next.TODO.cards.map((c) => c.id)).toEqual(["a"]);
    expect(next.TODO.total).toBe(1);
    expect(next.DONE.cards.map((c) => c.id)).toEqual(["c", "b", "d"]);
    expect(next.DONE.cards[1].status).toBe("DONE");
    expect(next.DONE.total).toBe(10);
  });

  it("rolls back with the inverse move, keeping an update that landed in between", () => {
    const moved = applyStatusMove(cols(), "b", "TODO", "DONE", "DONE");
    const withOther = { ...moved, DONE: { ...moved.DONE, cards: moved.DONE.cards.map((c) => (c.id === "c" ? { ...c, title: "Renamed" } : c)) } };
    const back = applyStatusMove(withOther, "b", "DONE", "TODO", "TODO");
    expect(back.TODO.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(back.DONE.cards.find((c) => c.id === "c")?.title).toBe("Renamed");
    expect(back.TODO.total).toBe(2);
    expect(back.DONE.total).toBe(9);
  });

  it("breaks position ties by id, and leaves an unknown card alone", () => {
    const tied = { A: { cards: [card("x", "A", 5)], total: 1 }, B: { cards: [card("m", "B", 5), card("z", "B", 5)], total: 2 } };
    expect(applyStatusMove(tied, "x", "A", "B", "B").B.cards.map((c) => c.id)).toEqual(["m", "x", "z"]);
    expect(applyStatusMove(tied, "nope", "A", "B", "B")).toEqual(tied);
  });

  it("keeps the card on screen when the target column is missing", () => {
    const next = applyStatusMove({ A: { cards: [card("x", "A", 1)], total: 1 } }, "x", "A", "B", "B");
    expect(next.A.cards).toHaveLength(1);
    expect(next.A.cards[0].status).toBe("B");
  });
});

describe("mergeFocusPage", () => {
  const cols = () => ({
    TODO: { cards: [card("a", "TODO", 1)], nextCursor: "1~a", total: 5 },
    DONE: { cards: [card("moved", "DONE", 9)], nextCursor: null, total: 1 },
  });

  it("appends new cards and replaces the cursor", () => {
    const next = mergeFocusPage(cols(), "TODO", { cards: [card("b", "TODO", 2), card("c", "LEGACY", 3)], nextCursor: "3~c" }, new Map(), S);
    expect(next.TODO.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(next.TODO.nextCursor).toBe("3~c");
  });

  it("never shows a card twice, whichever column holds it", () => {
    const next = mergeFocusPage(cols(), "TODO", { cards: [card("a", "TODO", 1), card("moved", "TODO", 9)], nextCursor: null }, new Map(), S);
    expect(next.TODO.cards.map((c) => c.id)).toEqual(["a"]);
  });

  it("never repeats a task added in this visit when the last page brings it back", () => {
    const withNew = {
      TODO: { cards: [card("a", "TODO", 1)], justAdded: [card("new1", "TODO", 99)], nextCursor: "1~a", total: 6 },
      DONE: { cards: [], justAdded: [card("new2", "DONE", 98)], nextCursor: null, total: 1 },
    };
    const next = mergeFocusPage(withNew, "TODO", { cards: [card("b", "TODO", 2), card("new1", "TODO", 99), card("new2", "TODO", 98)], nextCursor: null }, new Map(), S);
    expect([...next.TODO.justAdded, ...next.TODO.cards].map((c) => c.id)).toEqual(["new1", "a", "b"]);
  });

  it("re-buckets a card whose write is still in flight", () => {
    const pending = new Map<string, string | null>([["b", "DONE"]]);
    const next = mergeFocusPage(cols(), "TODO", { cards: [card("b", "TODO", 2)], nextCursor: null }, pending, S);
    expect(next.TODO.cards.map((c) => c.id)).toEqual(["a"]);
    const intoDone = mergeFocusPage(cols(), "DONE", { cards: [card("e", "TODO", 3)], nextCursor: null }, new Map([["e", "DONE"]]), S);
    expect(intoDone.DONE.cards.map((c) => [c.id, c.status])).toEqual([["moved", "DONE"], ["e", "DONE"]]);
  });
});

describe("mergeOverviewPage and keepJustAdded", () => {
  it("appends new ids only, deduping against the column and what was just added", () => {
    const col = { cards: [card("a", "TODO", 1)], justAdded: [card("n", "TODO", 99)], nextCursor: "0~1~a" };
    const next = mergeOverviewPage(col, { cards: [card("a", "TODO", 1), card("n", "TODO", 99), card("b", "TODO", 2)], nextCursor: null });
    expect(next.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(next.nextCursor).toBeNull();
    expect(next.justAdded.map((c) => c.id)).toEqual(["n"]);
  });

  it("drops just-added cards a page now shows in place, and hides the ones the filters exclude", () => {
    const added = [card("n1", "TODO", 1, { title: "Draft plan" }), card("n2", "DONE", 2, { title: "Ship it" }), card("n3", "TODO", 3, { title: "Plan B" })];
    const r = keepJustAdded(added, new Set(["n3"]), "plan", true, S);
    expect(r.keep.map((c) => c.id)).toEqual(["n1", "n2"]);
    expect(r.visible.map((c) => c.id)).toEqual(["n1"]);
    expect(keepJustAdded(added, new Set(), "", false, S).visible).toHaveLength(3);
  });

  it("filters the way the server does", () => {
    expect(cardMatchesFilters({ title: "Quarterly REVIEW", status: "DOING" }, "review", true, S)).toBe(true);
    expect(cardMatchesFilters({ title: "Quarterly review", status: "DONE" }, "", true, S)).toBe(false);
    expect(cardMatchesFilters({ title: "Quarterly review", status: "DONE" }, "", false, S)).toBe(true);
  });
});

describe("countDelta and moveStatusCounts", () => {
  const tally = { total: 5, statusCounts: { TODO: 3, DONE: 2 } };

  it("counts a task into and out of its column", () => {
    expect(countDelta(tally, S, "DOING", 1, false)).toEqual({ total: 6, statusCounts: { TODO: 3, DONE: 2, DOING: 1 } });
    expect(countDelta(tally, S, "LEGACY", 1, false)).toEqual({ total: 6, statusCounts: { TODO: 4, DONE: 2 } });
    expect(countDelta(tally, S, "DONE", -1, false)).toEqual({ total: 4, statusCounts: { TODO: 3, DONE: 1 } });
  });

  it("never counts a closed task while Hide closed is on", () => {
    expect(countDelta(tally, S, "DONE", 1, true)).toBe(tally);
  });

  it("moves a count between columns, and a move into a hidden status only removes", () => {
    expect(moveStatusCounts(tally, S, "TODO", "DONE", false)).toEqual({ total: 5, statusCounts: { TODO: 2, DONE: 3 } });
    expect(moveStatusCounts({ total: 3, statusCounts: { TODO: 3 } }, S, "TODO", "DONE", true)).toEqual({ total: 2, statusCounts: { TODO: 2 } });
    expect(moveStatusCounts(tally, S, "TODO", "TODO", false)).toBe(tally);
  });

  it("drops a column that reaches zero and never goes negative", () => {
    expect(countDelta({ total: 1, statusCounts: { DONE: 1 } }, S, "DONE", -1, false)).toEqual({ total: 0, statusCounts: {} });
    expect(countDelta({ total: 0, statusCounts: {} }, S, "DONE", -1, false)).toEqual({ total: 0, statusCounts: {} });
  });
});

describe("colour", () => {
  it("passes plain colours and neutralises everything else", () => {
    for (const ok of ["#abc", "#abcd", "#aabbcc", "#aabbccdd", "rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "hsl(210, 50%, 40%)", "hsla(210deg,50%,40%,.5)", "var(--os-brand)", "red", "rebeccapurple"]) {
      expect(safeStatusColor(ok)).toBe(ok);
    }
    for (const bad of ["url(https://x/y.png)", "red; background: red", "#abcde", "rgb(1,2)", "var(--evil)", "expression(alert(1))", "", null, undefined, "RED", "calc(1px)"]) {
      expect(safeStatusColor(bad as string)).toBe("var(--os-ink-3)");
    }
    expect(tintVars("url(x)")).toEqual({ "--be-c": "var(--os-ink-3)" });
    expect(liftedColor("#15803D")).toBe(`color-mix(in srgb, #15803D ${TINT_MIX.light.glyph}%, var(--be-lift))`);
    expect(liftedColor("url(x)")).toContain("var(--os-ink-3)");
  });

  it("keeps the glyph in its status colour: at least half of it is the status, the rest the lift", () => {
    for (const t of [TINT_MIX.light, TINT_MIX.dark]) {
      expect(t.glyph).toBeGreaterThanOrEqual(50);
      expect(t.glyph).toBeLessThan(100);
    }
    // TINT_GLYPH is ONE string for both themes (only the lift changes), so the
    // dark share the contrast test below checks must be the share the CSS uses.
    expect(TINT_MIX.dark.glyph).toBe(TINT_MIX.light.glyph);
    expect(TINT_GLYPH).toBe(`color-mix(in srgb, var(--be-c) ${TINT_MIX.light.glyph}%, var(--be-lift))`);
  });

  it("keeps the literal tint class in step with TINT_MIX", () => {
    const want = [
      `[--be-bg:${TINT_MIX.light.bg}%]`, `dark:[--be-bg:${TINT_MIX.dark.bg}%]`,
      `hover:[--be-bg:${TINT_MIX.light.hover}%]`, `dark:hover:[--be-bg:${TINT_MIX.dark.hover}%]`,
      `[--be-line:${TINT_MIX.light.line}%]`, `dark:[--be-line:${TINT_MIX.dark.line}%]`,
      `[--be-pill:${TINT_MIX.light.pill}%]`, `dark:[--be-pill:${TINT_MIX.dark.pill}%]`,
      "[--be-lift:black]", "dark:[--be-lift:white]",
    ];
    expect(CARD_TINT_CLASS.split(" ")).toEqual(want);
  });
});

// ── Contrast: the tint must stay legible in both themes ─────────────
//
// color-mix(in srgb, ...) interpolates the gamma-encoded channels, which is
// what mix() below does, over the surface tokens of tokens.css. The palette
// is every colour a status can be given without typing a hex: the default
// trio and the status editor's swatches (board-status-editor.tsx).

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
};
const mix = (a: RGB, share: number, b: RGB): RGB => a.map((v, i) => v * (share / 100) + b[i] * (1 - share / 100)) as RGB;
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const PALETTE = [
  ...DEFAULT_STATUS_OPTIONS.map((s) => s.color),
  "#94a3b8", "#71717A", "#6B7280", "#3b82f6", "#6366F1", "#06B6D4",
  "#10b981", "#F59E0B", "#F97316", "#EAB308", "#EF4444", "#EC4899",
  "#A855F7", "#14B8A6",
];
const THEMES = {
  light: { surface: hex("#FFFFFF"), ink: hex("#1F2430"), lift: hex("#000000"), mix: TINT_MIX.light },
  dark: { surface: hex("#181B20"), ink: hex("#E6E8EC"), lift: hex("#FFFFFF"), mix: TINT_MIX.dark },
} as const;

describe("the tinted card is legible in both themes", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    it(`${name}: the title clears AA and the glyph clears 3:1 on every palette colour, at rest and on hover`, () => {
      for (const c of PALETTE) {
        for (const share of [t.mix.bg, t.mix.hover]) {
          const bg = mix(hex(c), share, t.surface);
          expect({ c, share, title: contrast(t.ink, bg) >= 4.5 }).toEqual({ c, share, title: true });
          const glyph = mix(hex(c), t.mix.glyph, t.lift);
          expect({ c, share, glyph: contrast(glyph, bg) >= 3 }).toEqual({ c, share, glyph: true });
        }
      }
    });
  }
});

describe("search and cursors", () => {
  it("escapes the LIKE wildcards and its own escape character", () => {
    expect(likePattern("50%_off!")).toBe("%50!%!_off!!%");
    expect(likePattern("plain")).toBe("%plain%");
  });

  it("round-trips list cursors, doubles included", () => {
    for (const pos of [0, 1024, -3, 0.5, 1e-7, 1.5e21, 123456.789]) {
      expect(decodeListCursor(encodeListCursor(3, pos, "cm_abc-1"))).toEqual({ rank: 3, position: pos, id: "cm_abc-1" });
      expect(decodeBucketCursor(encodeBucketCursor(pos, "id9"))).toEqual({ position: pos, id: "id9" });
    }
  });

  it("refuses anything that is not a cursor", () => {
    for (const bad of ["", "1~2", "1~2~3~4", "12345~1~a", "x~1~a", "1~NaN~a", "1~Infinity~a", "1~1~a b", `1~1~${"a".repeat(65)}`, "-1~1~a"]) {
      expect(decodeListCursor(bad)).toBeNull();
    }
    for (const bad of ["", "1", "1~a~b", "1e~a", "1~", "~a", "0x10~a"]) expect(decodeBucketCursor(bad)).toBeNull();
    expect(decodeListCursor(null)).toBeNull();
  });
});

describe("parseBirdseyeQuery", () => {
  const p = (s: string) => parseBirdseyeQuery(new URLSearchParams(s));

  it("reads the four modes", () => {
    expect(p("")).toMatchObject({ mode: "overview", q: "", hideClosed: false });
    expect(p("q=%20plan%20&closed=hide")).toMatchObject({ mode: "overview", q: "plan", hideClosed: true });
    expect(p("list=b1&after=0~1024~a1")).toMatchObject({ mode: "list-page", boardId: "b1", cursor: { rank: 0, position: 1024, id: "a1" } });
    expect(p("focus=b1")).toMatchObject({ mode: "focus", boardId: "b1" });
    expect(p("focus=b1&status=IN%20PROGRESS&after=5~x")).toMatchObject({ mode: "focus-page", boardId: "b1", status: "IN PROGRESS", cursor: { position: 5, id: "x" } });
  });

  it("caps the search at 120 and refuses a raw one over 200", () => {
    const q = "a".repeat(150);
    expect(p(`q=${q}`)).toMatchObject({ q: "a".repeat(120) });
    expect(p(`q=${"a".repeat(201)}`)).toEqual({ error: "bad_query" });
  });

  it("refuses every combination that is not one of the modes", () => {
    for (const bad of [
      "list=b1", "list=b1&after=bad", "list=b1&after=0~1~a&status=X", "list=b1&focus=b2",
      "focus=b1&status=X", "focus=b1&after=1~a", `focus=b1&status=${"s".repeat(61)}&after=1~a`, "focus=b1&status=&after=1~a",
      "focus=bad id", "status=X", "after=1~a", "list=../x&after=0~1~a",
    ]) {
      expect({ bad, r: p(bad) }).toEqual({ bad, r: { error: "bad_query" } });
    }
    expect(p(`focus=b1&status=${"s".repeat(60)}&after=1~a`)).toMatchObject({ mode: "focus-page" });
  });
});

describe("dates", () => {
  const now = new Date("2026-09-24T12:00:00Z");

  it("speaks the product's due-chip words", () => {
    expect(dueLabel("2026-09-24T09:00:00Z", now)).toBe("Today");
    expect(dueLabel("2026-09-25T09:00:00Z", now)).toBe("Tomorrow");
    expect(dueLabel("2026-10-08T09:00:00Z", now)).toBe("8 Oct");
    expect(dueLabel("2027-01-02T09:00:00Z", now)).toBe("2 Jan 2027");
    expect(dueLabel(null, now)).toBeNull();
  });

  it("calls an open task overdue once its day has passed, never a closed one", () => {
    expect(isOverdue("2026-09-23T23:00:00Z", now, true)).toBe(true);
    expect(isOverdue("2026-09-24T01:00:00Z", now, true)).toBe(false);
    expect(isOverdue("2026-09-20T00:00:00Z", now, false)).toBe(false);
    expect(isOverdue(null, now, true)).toBe(false);
  });
});

describe("cardFromRow", () => {
  it("maps a BoardItemRow", () => {
    const c = cardFromRow({
      id: "i1", boardId: "b1", title: "Plan", status: "DOING", position: 2048,
      dueAt: new Date("2026-09-30T00:00:00Z"), metadata: { description: "<p>Hello&nbsp;there</p>" },
      assigneeIds: ["u1", "u2", "u3"],
      assignees: [{ id: "u1", firstName: "A", lastName: "B", avatar: null }, { id: "u2", firstName: "C", lastName: null, avatar: "x.png" }, { id: "u3" }],
      subtaskCount: 4,
    });
    expect(c).toMatchObject({ id: "i1", boardId: "b1", status: "DOING", position: 2048, dueAt: "2026-09-30T00:00:00.000Z", hasDescription: true, subtaskCount: 4, assigneeCount: 3 });
    expect(c.assignees.map((p) => p.id)).toEqual(["u1", "u2"]);
  });

  it("falls back to the owner, and keeps an on-screen card's subtask count and place", () => {
    const prev = card("i1", "TODO", 7, { subtaskCount: 2, rank: 1 });
    const c = cardFromRow({ id: "i1", title: "Plan", status: "DONE", owner: { id: "o1", firstName: "O" }, subtaskCount: 5 }, prev);
    expect(c.assignees).toEqual([{ id: "o1", firstName: "O", lastName: null, avatar: null }]);
    expect(c.assigneeCount).toBe(1);
    expect(c.subtaskCount).toBe(2);
    expect(c.position).toBe(7);
    expect(c.boardId).toBe("b");
    expect(c.rank).toBe(1);
  });

  it("sees an empty editor body as no description", () => {
    for (const empty of [{ description: "<p></p>" }, { description: "<p><br></p>\n" }, { description: "&nbsp; " }, { description: 5 }, {}, null, []]) {
      expect(descriptionPresent(empty)).toBe(false);
    }
    expect(descriptionPresent({ description: "x" })).toBe(true);
  });
});
