// The breadcrumb's give-way rule. The bar is a component and this suite is
// node-only by design (vitest.config.ts), so what is tested here is the pure
// rule the crumbs and their separators both read: below lg the trail keeps
// its last two crumbs, below sm only the current page. The regression this
// guards: at 390px the current-page crumb had 8px and rendered "AI › A".

import { describe, expect, it } from "vitest";
import { crumbHideClass } from "./top-bar";

describe("crumbHideClass", () => {
  it("keeps a lone hub crumb at every width", () => {
    expect(crumbHideClass(0, 1)).toBeUndefined();
  });

  it("never hides the current page", () => {
    for (const count of [1, 2, 3, 4]) expect(crumbHideClass(count - 1, count)).toBeUndefined();
  });

  it("hides the hub below sm on a two-crumb trail, so the page crumb gets the room", () => {
    // "AI › Ask AI" on a phone: the rail already lights AI.
    expect(crumbHideClass(0, 2)).toBe("max-sm:hidden");
  });

  it("keeps the last two below lg and only the last below sm on a deep trail", () => {
    // "Settings › Workspace settings › Members"
    expect(crumbHideClass(0, 3)).toBe("max-lg:hidden");
    expect(crumbHideClass(1, 3)).toBe("max-sm:hidden");
    expect(crumbHideClass(2, 3)).toBeUndefined();
  });

  it("gives the separator before crumb i the fate of crumb i-1", () => {
    // The separator sits inside crumb i and points back at crumb i-1, so it
    // must vanish exactly when that crumb does, never leaving "› Members".
    // Separator inside crumb 1 of "AI › Ask AI": goes with the hub below sm.
    expect(crumbHideClass(1 - 1, 2)).toBe("max-sm:hidden");
    // Separator inside crumb 2 of a three-deep trail: goes below sm with
    // crumb 1; the one inside crumb 1 goes below lg with crumb 0.
    expect(crumbHideClass(2 - 1, 3)).toBe("max-sm:hidden");
    expect(crumbHideClass(1 - 1, 3)).toBe("max-lg:hidden");
    // The current page's own separator never outlives its crumb: hidden
    // exactly when the crumb before it is hidden, at every depth.
    for (const count of [2, 3, 4]) expect(crumbHideClass(count - 2, count)).toBe("max-sm:hidden");
  });
});
