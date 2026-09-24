import { describe, expect, it } from "vitest";
import { tidyMenu } from "./sheet-menu";

const sep = { separator: true } as const;
describe("tidyMenu", () => {
  it("drops leading, trailing and doubled separators", () => {
    expect(tidyMenu([sep, { label: "a" }, sep, sep, { label: "b" }, sep] as never[])).toEqual([{ label: "a" }, sep, { label: "b" }]);
  });
  it("tidies submenus and keeps an all-separator list empty", () => {
    expect(tidyMenu([{ label: "x", submenu: [sep, { label: "y" }, sep] }] as never[])).toEqual([{ label: "x", submenu: [{ label: "y" }] }]);
    expect(tidyMenu([sep, sep] as never[])).toEqual([]);
  });
});
