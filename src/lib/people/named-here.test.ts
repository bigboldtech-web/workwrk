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
    expect(namedHere(card, here)).toEqual({ manager: null, dottedManagers: [{ id: "d-here", deletedAt: null }], directReports: [{ id: "r-here" }] });
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

  // workspace-status-2 E6, step 3: the record reads THIS workspace's line,
  // dotted lines and reports, so the batch 7 answers about another
  // workspace's line ("Reports to someone in another workspace", "N lines
  // kept for another workspace") are gone with the line itself. Before:
  // namedHere took the other workspace's standing and answered
  // managerElsewhere and dottedElsewhere.
  it("answers only who it names, never anything about another workspace's line", () => {
    const here = new Map([["d-here", "AGENT"], ["r-here", "EMPLOYEE"]]);
    const out = namedHere(card, here);
    expect(Object.keys(out).sort()).toEqual(["directReports", "dottedManagers", "manager"]);
    expect(out).toEqual({ manager: null, dottedManagers: [{ id: "d-here", deletedAt: null }], directReports: [{ id: "r-here" }] });
    expect(JSON.stringify(out)).not.toContain("Dana");
    // A manager who holds a seat here, an Agent included, is named.
    expect(namedHere(card, new Map([["m-elsewhere", "AGENT"]])).manager).toEqual({ id: "m-elsewhere", firstName: "Dana" });
  });

  it("keeps the words for a count of kept lines that only the dotted-lines PUT still answers (until step 4)", () => {
    expect(dottedElsewhereWords(2, false)).toBe("2 lines kept for another workspace");
    expect(dottedElsewhereWords(1, true)).toBe("and 1 line kept for another workspace");
    expect(dottedElsewhereWords(0, false)).toBeNull();
  });
});
