// Meeting notes typed in the 2.5 seconds before leaving were lost: leaving
// cancelled the pending save and nothing saved on tab close (launch audit,
// 2026-10-31). Read from the source, as the page is a client component.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src/app/(dashboard)/meetings/[id]/page.tsx"), "utf8");

describe("meeting notes are saved when the page goes away", () => {
  it("sends unsaved notes on pagehide, when the tab is hidden, and on unmount", () => {
    expect(src).toMatch(/window\.addEventListener\("pagehide", onHide\)/);
    expect(src).toMatch(/document\.visibilityState === "hidden"\) flushNotes\(\)/);
    // The effect's cleanup (unmount, in-app navigation) flushes too.
    expect(src).toMatch(/document\.removeEventListener\("visibilitychange", onVis\);\s*flushNotes\(\);/);
  });

  it("flushes through the one write path, which is keepalive and reports a failure", () => {
    expect(src).toMatch(/const flushNotes = useCallback\(\(\) => \{[\s\S]*?putMeeting\(\{ notes: notesRef\.current \}, "notes"\)/);
    expect(src).toMatch(/keepalive: true/);
    // A failed flush stays unsaved, so the next chance sends it again.
    expect(src).toMatch(/else notesDirtyRef\.current = true;/);
  });
});
