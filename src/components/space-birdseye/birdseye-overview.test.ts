// The overview's empty-column line: Hide closed is a filter, so a List whose
// tasks are all closed must never be described as having no tasks at all.

import { describe, expect, it } from "vitest";
import { emptyColumnCopy } from "./birdseye-overview";

describe("emptyColumnCopy", () => {
  it("says the List is empty only when no filter is on", () => {
    expect(emptyColumnCopy(false)).toBe("No tasks yet");
    expect(emptyColumnCopy(false, false)).toBe("No tasks yet");
  });

  it("never says No tasks yet while Hide closed is on", () => {
    expect(emptyColumnCopy(false, true)).toBe("No open tasks");
    expect(emptyColumnCopy(true, true)).toBe("No matching open tasks");
    for (const searching of [false, true]) expect(emptyColumnCopy(searching, true)).not.toBe("No tasks yet");
  });

  it("keeps the search wording focus mode relies on", () => {
    expect(emptyColumnCopy(true)).toBe("No matching tasks");
    expect(emptyColumnCopy(true, false)).toBe("No matching tasks");
  });
});
