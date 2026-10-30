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
    expect(src).toMatch(/const flushNotes = useCallback\(\(\) => \{[\s\S]*?void sendNotes\(notesRef\.current\);/);
    expect(src).toMatch(/const ok = await putMeeting\(\{ notes: text \}, "notes"\);/);
    expect(src).toMatch(/keepalive: true/);
  });

  it("clears Unsaved only when the notes are still what was sent, and autosaves one at a time", () => {
    // A write that answers after more was typed must not mark the newer text saved.
    expect(src).toMatch(/if \(ok && notesRef\.current === text\) \{\s*notesDirtyRef\.current = false;\s*setNotesDirty\(false\);/);
    // The flush never clears the flag before its write lands.
    expect(src.slice(src.indexOf("const flushNotes"), src.indexOf("void sendNotes(notesRef.current);"))).not.toMatch(/notesDirtyRef\.current = false/);
    expect(src).toMatch(/const run = notesChainRef\.current\.then\(\(\) => sendNotes\(notesRef\.current\)\);/);
  });

  it("never lets a refresh replace notes still being typed", () => {
    expect(src).toMatch(/if \(!notesDirtyRef\.current\) setNotes\(data\.notes \?\? ""\);/);
    expect(src).not.toMatch(/\n\s*setNotes\(data\.notes \?\? ""\);/);
  });
});
