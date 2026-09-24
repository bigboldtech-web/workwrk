import { describe, expect, it } from "vitest";
import { PresenceBoard, PRESENCE_TTL_MS, presenceLabel } from "./table-presence";

describe("PresenceBoard", () => {
  it("lists everyone but the asker, most recent first", () => {
    const b = new PresenceBoard();
    b.beat("t", { userId: "a", name: "Priya Shah", avatar: null, at: 1000 });
    b.beat("t", { userId: "b", name: "Sam Lee", avatar: null, at: 2000 });
    b.beat("t", { userId: "me", name: "Me", avatar: null, at: 2500 });
    expect(b.others("t", "me", 3000).map((e) => e.userId)).toEqual(["b", "a"]);
  });
  it("drops a heartbeat older than the TTL and a person who left", () => {
    const b = new PresenceBoard();
    b.beat("t", { userId: "a", name: "A", avatar: null, at: 0 });
    b.beat("t", { userId: "b", name: "B", avatar: null, at: 0 });
    b.leave("t", "b");
    expect(b.others("t", "me", PRESENCE_TTL_MS - 1).map((e) => e.userId)).toEqual(["a"]);
    expect(b.others("t", "me", PRESENCE_TTL_MS + 1)).toEqual([]);
  });
  it("keeps tables apart", () => {
    const b = new PresenceBoard();
    b.beat("t1", { userId: "a", name: "A", avatar: null, at: 0 });
    expect(b.others("t2", "me", 1)).toEqual([]);
  });
});

describe("presenceLabel", () => {
  it("names one, two, or one and a count, by first name", () => {
    expect(presenceLabel([])).toBe("");
    expect(presenceLabel(["Priya Shah"])).toBe("Priya is editing");
    expect(presenceLabel(["Priya Shah", "Sam Lee"])).toBe("Priya and Sam are editing");
    expect(presenceLabel(["Priya", "Sam", "Ann"])).toBe("Priya and 2 others are editing");
  });
});
