import { describe, expect, it } from "vitest";
import { namedHere, namedIds } from "./named-here";

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
});
