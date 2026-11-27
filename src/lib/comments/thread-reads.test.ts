import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createThreadReads, FIRST_READ_ATTEMPTS } from "./thread-reads";

// Founder report 2026-11-27: "not able to tag anyone in comment section in
// edit mode". Proven in a real browser on the live build: the task page reads
// its comments again every 30 s, each read swapped the list for the loading
// skeleton, and the comment being edited was unmounted with its text and its
// "@" list. A click on a comment's menu during that read was swallowed too.

describe("which read of a task's comments may replace the list", () => {
  it("only the first read of a task shows the skeleton", () => {
    const reads = createThreadReads();
    const first = reads.start("task-1");
    expect(first.first).toBe(true);
    expect(reads.finish(first)).toBe("apply");
    reads.shown("task-1");
    const again = reads.start("task-1");
    expect(again.first).toBe(false);
  });

  it("another task starts from the skeleton again", () => {
    const reads = createThreadReads();
    reads.finish(reads.start("task-1"));
    reads.shown("task-1");
    expect(reads.start("task-2").first).toBe(true);
  });

  it("a first read that failed leaves the next one a first read too", () => {
    const reads = createThreadReads();
    reads.finish(reads.start("task-1")); // failed: never shown
    expect(reads.start("task-1").first).toBe(true);
  });

  it("an older read never replaces a newer one", () => {
    const reads = createThreadReads();
    const older = reads.start("task-1");
    const newer = reads.start("task-1");
    expect(reads.finish(older)).toBe("superseded");
    expect(reads.finish(newer)).toBe("apply");
  });

  it("a read that overlapped a change made here is stale", () => {
    const reads = createThreadReads();
    const read = reads.start("task-1");
    reads.changed(); // an edit is sent
    expect(reads.finish(read)).toBe("stale");
  });

  it("a read that began while a change was out, and ended after it landed, is stale", () => {
    const reads = createThreadReads();
    reads.changed(); // the edit is sent
    const read = reads.start("task-1"); // the server may answer before the edit commits
    reads.changed(); // the edit lands
    expect(reads.finish(read)).toBe("stale");
  });

  it("guard: a read with no change during it applies", () => {
    const reads = createThreadReads();
    reads.changed();
    reads.changed(); // an earlier edit, sent and landed
    expect(reads.finish(reads.start("task-1"))).toBe("apply");
  });

  it("a first read gives up waiting after a few tries", () => {
    expect(FIRST_READ_ATTEMPTS).toBeGreaterThan(1);
    expect(FIRST_READ_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});

describe("the thread uses it", () => {
  const thread = readFileSync("src/components/comments/comment-thread.tsx", "utf8");

  it("shows the skeleton only on a first read", () => {
    const sets = thread.match(/setLoading\(true\)/g) ?? [];
    expect(sets).toHaveLength(1);
    expect(thread).toMatch(/if \(ticket\.first\) \{\s+setLoading\(true\);/);
  });

  it("a re-read that fails keeps the comments on screen", () => {
    expect(thread).toMatch(/if \(ticket\.first\) \{\s+setLoadError\("Couldn't load comments"\);/);
  });

  it("every post, edit, delete and reaction marks a change when it starts and when it lands", () => {
    for (const fn of ["const submit", "const deleteComment", "const editComment", "const react"]) {
      const at = thread.indexOf(fn);
      expect(at, fn).toBeGreaterThan(-1);
      // Up to the next declaration at the component's own indent.
      const body = thread.slice(at, thread.indexOf("\n  const ", at + 1));
      const marks = body.match(/reads\.changed\(\)/g) ?? [];
      expect(marks.length, fn).toBe(2);
      expect(body, fn).toMatch(/finally \{\s+reads\.changed\(\);/);
    }
  });
});
