import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { linkIds } from "./company-notifications";

describe("linkIds", () => {
  it("reads the record ids a notification link carries, wherever they sit", () => {
    expect(linkIds("/item/cmabc0000000000000000itm1?list=cmabc0000000000000000lst1")).toEqual([
      "cmabc0000000000000000itm1",
      "cmabc0000000000000000lst1",
    ]);
    expect(linkIds("/process-runs?run=cmabc0000000000000000run1")).toEqual(["cmabc0000000000000000run1"]);
    expect(linkIds("https://app.workwrk.com/reviews/cmabc0000000000000000rev1?tab=team&person=cmabc0000000000000000usr1")).toEqual([
      "cmabc0000000000000000rev1",
      "cmabc0000000000000000usr1",
    ]);
  });

  it("finds none in a link that names no record", () => {
    for (const link of ["/kudos?view=received", "/people/me?tab=kras", "/team/reviews", "/sops/my-sops", "", null, undefined]) {
      expect(linkIds(link)).toEqual([]);
    }
  });
});
