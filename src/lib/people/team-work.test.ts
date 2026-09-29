import { describe, expect, it } from "vitest";
import { aggregateWork, attentionRows, parseTeamSort, sortTeam, weekStartLocal, NO_WORK } from "./team-work";

const doneOn = (doneByBoard: Record<string, string[]>) => (boardId: string, status: string | null) =>
  !!status && (doneByBoard[boardId] ?? []).includes(status);

describe("aggregateWork", () => {
  it("uses each List's own done set, never a name guess", () => {
    const isDone = doneOn({ b1: ["Shipped"], b2: ["Done"] });
    const m = aggregateWork(
      [
        { personId: "p", boardId: "b1", status: "Shipped", n: 2, overdue: 2, recent: 1 },
        { personId: "p", boardId: "b1", status: "Done", n: 3, overdue: 1, recent: 0 },
        { personId: "p", boardId: "b2", status: "Done", n: 4, overdue: 0, recent: 4 },
      ],
      isDone,
    );
    // "Done" on b1 is an open status there; "Shipped" is b1's done state.
    expect(m.get("p")).toEqual({ open: 3, done: 6, doneThisWeek: 5, overdue: 1 });
  });

  it("never counts a done item as overdue", () => {
    const m = aggregateWork([{ personId: "p", boardId: "b", status: "Done", n: 5, overdue: 5, recent: 0 }], doneOn({ b: ["Done"] }));
    expect(m.get("p")?.overdue).toBe(0);
  });

  it("keeps people apart and treats an unset status as open", () => {
    const m = aggregateWork(
      [
        { personId: "a", boardId: "b", status: null, n: 1, overdue: 0, recent: 1 },
        { personId: "b", boardId: "b", status: "Todo", n: 2, overdue: 1, recent: 0 },
      ],
      doneOn({ b: ["Done"] }),
    );
    expect(m.get("a")).toEqual({ ...NO_WORK, open: 1 });
    expect(m.get("b")).toEqual({ ...NO_WORK, open: 2, overdue: 1 });
  });
});

describe("sortTeam", () => {
  const w = (open: number, overdue = 0) => ({ open, done: 0, doneThisWeek: 0, overdue });
  const people = [
    { id: "3", name: "Chen", work: w(1, 1), lastActive: 30 },
    { id: "1", name: "anita", work: w(5), lastActive: null },
    { id: "2", name: "Bea", work: w(5, 2), lastActive: 50 },
  ];
  it("sorts by name, case blind", () => expect(sortTeam(people, "name").map((p) => p.id)).toEqual(["1", "2", "3"]));
  it("most open work, ties by name", () => expect(sortTeam(people, "open").map((p) => p.id)).toEqual(["1", "2", "3"]));
  it("most overdue first", () => expect(sortTeam(people, "overdue").map((p) => p.id)).toEqual(["2", "3", "1"]));
  it("last active, never active last", () => expect(sortTeam(people, "active").map((p) => p.id)).toEqual(["2", "3", "1"]));
  it("breaks a full tie by id so pages never overlap", () => {
    const same = [{ id: "b", name: "X", work: w(0), lastActive: null }, { id: "a", name: "X", work: w(0), lastActive: null }];
    expect(sortTeam(same, "open").map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("unknown sort reads as name", () => expect(parseTeamSort("weird")).toBe("name"));
});

describe("attentionRows", () => {
  it("drops zero rows so an all-zero queue renders nothing", () => {
    expect(attentionRows({ weeklyReviews: 0, kpiRecords: 0, noKras: 0 })).toEqual([]);
  });
  it("writes the three sentences with singular and plural", () => {
    const rows = attentionRows({ weeklyReviews: 1, kpiRecords: 2, noKras: 1 });
    expect(rows.map((r) => `${r.count} ${r.sentence}`)).toEqual([
      "1 weekly review awaiting your approval",
      "2 KPI records to sign off",
      "1 person has no KRAs yet",
    ]);
    expect(rows[2].href).toBe("/team?view=needs-attention&noKras=1");
  });
  it("links the weekly count to the queue that lists exactly those reviews", () => {
    expect(attentionRows({ weeklyReviews: 3, kpiRecords: 0, noKras: 0 })[0].href).toBe("/team/reviews");
  });
});

describe("weekStartLocal", () => {
  it("is the Monday of the week", () => {
    const d = weekStartLocal(new Date(2026, 8, 27, 15)); // Sunday 27 Sep 2026
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 21, 0]);
  });
});
