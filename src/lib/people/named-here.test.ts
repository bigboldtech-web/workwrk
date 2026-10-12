import { describe, expect, it } from "vitest";
import { dottedElsewhereWords, namedHere, namedIds } from "./named-here";

describe("namedHere (batch 6: a person record names only this workspace's people)", () => {
  const card = {
    manager: { id: "m-elsewhere", firstName: "Dana" },
    dottedManagers: [
      { id: "d-here", deletedAt: null },
      { id: "d-elsewhere", deletedAt: null },
      { id: "d-removed", deletedAt: new Date("2026-10-01T00:00:00Z") },
    ],
    directReports: [{ id: "r-here" }, { id: "r-elsewhere" }],
  };

  it("leaves out a manager, dotted manager or report who holds no level here, and a removed dotted manager", () => {
    const here = new Map([["d-here", "EMPLOYEE"], ["d-removed", "EMPLOYEE"], ["r-here", "EMPLOYEE"]]);
    expect(namedHere(card, here)).toEqual({ manager: null, managerElsewhere: false, dottedManagers: [{ id: "d-here", deletedAt: null }], dottedElsewhere: 0, directReports: [{ id: "r-here" }] });
  });

  it("names everyone who holds a level here", () => {
    const here = new Map(namedIds(card).map((id) => [id, "EMPLOYEE"]));
    const out = namedHere(card, here);
    expect(out.manager?.id).toBe("m-elsewhere");
    expect(out.directReports.map((r) => r.id)).toEqual(["r-here", "r-elsewhere"]);
    expect(out.dottedManagers.map((d) => d.id)).toEqual(["d-here", "d-elsewhere"]);
  });

  it("asks about every person it may name", () => {
    expect(namedIds(card)).toEqual(["m-elsewhere", "d-here", "d-elsewhere", "d-removed", "r-here", "r-elsewhere"]);
    expect(namedIds({ manager: null, dottedManagers: [], directReports: [] })).toEqual([]);
  });

  // Batch 7, from the batch 6 review: "Reports to: Nobody" for a manager in
  // the person's other workspace let an Admin here pick someone, believing
  // the line empty, and overwrite the line that workspace counts.
  it("says a manager is in another workspace, without naming them, only when that workspace relies on the line", () => {
    const here = new Map([["d-here", "EMPLOYEE"], ["r-here", "EMPLOYEE"]]);
    const out = namedHere(card, here, { managerElsewhere: true });
    expect(out.manager).toBeNull();
    expect(out.managerElsewhere).toBe(true);
    expect(JSON.stringify(out)).not.toContain("Dana");
    // Nobody relies on it: Nobody, as before.
    expect(namedHere(card, here).managerElsewhere).toBe(false);
    // A manager who holds a level here is named, never "elsewhere".
    expect(namedHere(card, new Map([["m-elsewhere", "AGENT"]]), { managerElsewhere: true })).toMatchObject({ manager: { id: "m-elsewhere" }, managerElsewhere: false });
    // No manager at all: nothing elsewhere either.
    expect(namedHere({ ...card, manager: null }, here, { managerElsewhere: true }).managerElsewhere).toBe(false);
  });

  it("leaves out the dotted lines kept for another workspace, as the dotted-lines GET does, and counts them", () => {
    // d-here is an Agent here and a manager in the other workspace: kept.
    const here = new Map([["d-here", "AGENT"], ["r-here", "EMPLOYEE"]]);
    const out = namedHere(card, here, { dottedKept: new Set(["d-here", "d-elsewhere"]) });
    // Before: d-here was listed, the dialog let it be taken off, and the PUT kept it.
    expect(out.dottedManagers).toEqual([]);
    expect(out.dottedElsewhere).toBe(2);
    expect(dottedElsewhereWords(out.dottedElsewhere, false)).toBe("2 lines kept for another workspace");
    expect(dottedElsewhereWords(1, true)).toBe("and 1 line kept for another workspace");
    expect(dottedElsewhereWords(0, false)).toBeNull();
  });
});
