// The app frame never scrolls as a page (founder report 2026-11-28: on
// Directory the whole app, rail and top bar included, slid up past the
// bottom). The cause was a screen-reader live region ("51 people") at the
// end of a long page: absolutely placed with no positioned ancestor, it was
// placed against the page instead of the scrolling column and made the
// document taller than the screen. The frame, the main column and the
// settings takeover are `relative`, and the frame clips, so that cannot
// happen again whatever a page renders.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const shell = readFileSync(path.join(ROOT, "src/components/layout/os/os-shell.tsx"), "utf8");

const classOf = (needle: string): string[] => {
  const line = shell.split("\n").find((l) => l.includes(needle));
  expect(line, `no line with ${needle}`).toBeTruthy();
  const m = /className="([^"]+)"/.exec(line!);
  expect(m, `no className on the ${needle} line`).toBeTruthy();
  return m![1].split(/\s+/);
};

describe("the app frame never grows the page", () => {
  it("the frame is a positioned, clipping, screen-high box", () => {
    const c = classOf("workwrk-os");
    expect(c).toContain("relative");
    expect(c).toContain("h-screen");
    expect(c).toContain("overflow-hidden");
  });

  it("the main column is positioned and is the one that scrolls", () => {
    const c = classOf("<main id={MAIN_ID}");
    expect(c).toContain("relative");
    expect(c).toContain("overflow-y-auto");
    expect(c).toContain("min-h-0");
  });

  it("the settings takeover is positioned too", () => {
    const c = classOf("col-span-3 col-start-2 row-start-3");
    expect(c).toContain("relative");
    expect(c).toContain("min-h-0");
  });
});
