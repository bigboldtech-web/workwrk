import { describe, expect, it } from "vitest";
import { choiceFromStored, storedFromChoice } from "./console-columns";

const KEYS = ["company", "domain", "plan", "status"];

describe("console column choices", () => {
  it("null is the defaults, with the off-by-default columns hidden", () => {
    expect(choiceFromStored(KEYS, null, ["domain"])).toEqual({ shown: [], hidden: ["domain"] });
  });
  it("a stored list shows exactly those columns", () => {
    expect(choiceFromStored(KEYS, ["company", "domain"], ["domain"])).toEqual({ shown: ["company", "domain"], hidden: ["plan", "status"] });
  });
  it("a reset or a choice equal to the defaults stores null", () => {
    expect(storedFromChoice(KEYS, { shown: [], hidden: [] }, ["domain"])).toBeNull();
    expect(storedFromChoice(KEYS, { shown: ["company"], hidden: ["domain"] }, ["domain"])).toBeNull();
  });
  it("any other choice stores the visible keys in table order", () => {
    expect(storedFromChoice(KEYS, { shown: ["domain"], hidden: ["plan"] }, ["domain"])).toEqual(["company", "domain", "status"]);
  });
});
