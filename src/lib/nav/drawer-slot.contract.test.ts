// The @drawer slots close on any other page (parallel-routes.md, "Closing the
// modal"): without a page that renders nothing for every other URL, a soft
// navigation away from a task or person drawer kept it open over the new
// page, and its Close then walked back one page at a time.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import DrawerElsewhere from "@/app/(dashboard)/@drawer/[...rest]/page";

const SLOT = join(process.cwd(), "src/app/(dashboard)/@drawer");

describe("the (dashboard) @drawer slot", () => {
  it("has a catch-all page for every other URL, and it renders nothing", () => {
    expect(existsSync(join(SLOT, "[...rest]/page.tsx"))).toBe(true);
    expect(DrawerElsewhere()).toBeNull();
  });

  it("keeps its intercepts and its hard-load fallback", () => {
    for (const f of ["(.)item/[id]/page.tsx", "(.)people/[id]/page.tsx", "default.tsx"]) {
      expect(existsSync(join(SLOT, f))).toBe(true);
    }
  });
});
