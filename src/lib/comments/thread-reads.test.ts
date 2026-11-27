import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appendOnce, createThreadReads, FIRST_READ_ATTEMPTS, readThread, type ThreadReads } from "./thread-reads";

// Founder report 2026-11-27: "not able to tag anyone in comment section in
// edit mode". Proven in a real browser on the live build: the task page reads
// its comments again every 30 s, each read swapped the list for the loading
// skeleton, and the comment being edited was unmounted with its text and its
// "@" list. A click on a comment's menu during that read was swallowed too.

/** A read whose answer the test releases by hand. */
function gate<T>() {
  let release!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { release = res; fail = rej; });
  return { promise, release, fail };
}

function recorder<T>() {
  const log: string[] = [];
  const applied: T[] = [];
  return {
    log,
    applied,
    hooks: {
      showSkeleton: () => log.push("skeleton"),
      apply: (r: T) => { applied.push(r); log.push("apply"); },
      failFirst: () => log.push("error"),
    },
  };
}

/** The first read of task-1, landed, so the next read is a re-read. */
async function shown(reads: ThreadReads, id = "task-1") {
  const r = recorder<string>();
  await readThread(reads, id, async () => "first", r.hooks);
}

describe("which read of a task's comments may replace the list", () => {
  it("only the first read of a task shows the skeleton", async () => {
    const reads = createThreadReads();
    const first = recorder<string>();
    await readThread(reads, "task-1", async () => "a", first.hooks);
    expect(first.log).toEqual(["skeleton", "apply"]);
    const again = recorder<string>();
    await readThread(reads, "task-1", async () => "b", again.hooks);
    expect(again.log).toEqual(["apply"]);
  });

  it("a re-read that fails keeps the comments on screen, with no error row", async () => {
    const reads = createThreadReads();
    await shown(reads);
    const r = recorder<string>();
    await readThread(reads, "task-1", async () => { throw new Error("500"); }, r.hooks);
    expect(r.log).toEqual([]);
  });

  it("a first read that fails shows the error, and Retry is a first read again", async () => {
    const reads = createThreadReads();
    const r = recorder<string>();
    await readThread(reads, "task-1", async () => { throw new Error("500"); }, r.hooks);
    expect(r.log).toEqual(["skeleton", "error"]);
    const retry = recorder<string>();
    await readThread(reads, "task-1", async () => "ok", retry.hooks);
    expect(retry.log).toEqual(["skeleton", "apply"]);
  });

  it("an older read never replaces a newer one", async () => {
    const reads = createThreadReads();
    await shown(reads);
    const slow = gate<string>();
    const r = recorder<string>();
    const older = readThread(reads, "task-1", () => slow.promise, r.hooks);
    await readThread(reads, "task-1", async () => "newer", r.hooks);
    slow.release("older");
    await older;
    expect(r.applied).toEqual(["newer"]);
  });

  it("a re-read during an edit is dropped, so it never puts the old words back", async () => {
    const reads = createThreadReads();
    await shown(reads);
    const slow = gate<string>();
    const r = recorder<string>();
    const read = readThread(reads, "task-1", () => slow.promise, r.hooks);
    reads.begin(); // the edit is sent
    reads.end(); // and lands
    slow.release("before the edit");
    await read;
    expect(r.applied).toEqual([]);
  });

  it("a re-read that falls wholly inside a post is dropped (review medium)", async () => {
    // The post saves the comment, then logs, notifies and answers: a read can
    // start and end in that gap and already hold the comment.
    const reads = createThreadReads();
    await shown(reads);
    reads.begin(); // the post is out
    const r = recorder<string>();
    await readThread(reads, "task-1", async () => "holds the new comment", r.hooks);
    reads.end();
    expect(r.applied).toEqual([]);
  });

  it("a read that began while a change was out, and ended after it landed, is dropped", async () => {
    const reads = createThreadReads();
    await shown(reads);
    reads.begin();
    const slow = gate<string>();
    const r = recorder<string>();
    const read = readThread(reads, "task-1", () => slow.promise, r.hooks);
    reads.end();
    slow.release("may predate the change");
    await read;
    expect(r.applied).toEqual([]);
  });

  it("guard: a re-read after the change landed applies", async () => {
    const reads = createThreadReads();
    await shown(reads);
    reads.begin();
    reads.end();
    const r = recorder<string>();
    await readThread(reads, "task-1", async () => "fresh", r.hooks);
    expect(r.applied).toEqual(["fresh"]);
  });

  it("a stale first read reads again, and lands after a few tries at most", async () => {
    const reads = createThreadReads();
    reads.begin(); // a post sent before the thread ever loaded, still out
    const r = recorder<string>();
    let calls = 0;
    await readThread(reads, "task-1", async () => `read ${++calls}`, r.hooks);
    expect(calls).toBe(FIRST_READ_ATTEMPTS);
    expect(r.applied).toEqual([`read ${FIRST_READ_ATTEMPTS}`]);
    expect(r.log.at(-1)).toBe("apply");
  });

  it("another task starts from the skeleton again", async () => {
    const reads = createThreadReads();
    await shown(reads, "task-1");
    const r = recorder<string>();
    await readThread(reads, "task-2", async () => "b", r.hooks);
    expect(r.log).toEqual(["skeleton", "apply"]);
  });

  it("switching to another task and back never leaves the skeleton up (review low)", async () => {
    const reads = createThreadReads();
    await shown(reads, "task-1");
    const y = gate<string>();
    const r = recorder<string>();
    const readY = readThread(reads, "task-2", () => y.promise, r.hooks); // skeleton up
    const back = recorder<string>();
    // Back on task-1 before task-2's read lands: a first read, which takes
    // its own skeleton down even when it fails.
    await readThread(reads, "task-1", async () => { throw new Error("offline"); }, back.hooks);
    y.release("task-2's comments");
    await readY;
    expect(back.log).toEqual(["skeleton", "error"]);
    expect(r.applied).toEqual([]);
  });
});

describe("a post the server answers after a read already brought it in", () => {
  it("is one row, the server's copy", () => {
    const list = [{ id: "a", v: 1 }, { id: "c", v: 1 }];
    expect(appendOnce(list, { id: "c", v: 2 })).toEqual([{ id: "a", v: 1 }, { id: "c", v: 2 }]);
  });

  it("guard: a new one is added at the end", () => {
    expect(appendOnce([{ id: "a" }], { id: "b" })).toEqual([{ id: "a" }, { id: "b" }]);
  });
});

describe("the thread uses it", () => {
  const thread = readFileSync("src/components/comments/comment-thread.tsx", "utf8");

  it("reads through readThread, and shows the skeleton only from its first-read hook", () => {
    expect(thread).toMatch(/readThread\(\s+reads,\s+entityId,/);
    expect(thread.match(/setLoading\(true\)/g) ?? []).toHaveLength(1);
    expect(thread).toMatch(/showSkeleton: \(\) => \{\s+setLoading\(true\);/);
  });

  it("adds a posted comment once", () => {
    expect(thread).toMatch(/setUpdates\(\(prev\) => appendOnce\(prev, data\.update as ThreadUpdate\)\)/);
  });

  it("every post, edit, delete and reaction marks when it is sent and when it lands", () => {
    for (const fn of ["const submit", "const deleteComment", "const editComment", "const react"]) {
      const at = thread.indexOf(fn);
      expect(at, fn).toBeGreaterThan(-1);
      // Up to the next declaration at the component's own indent.
      const body = thread.slice(at, thread.indexOf("\n  const ", at + 1));
      expect(body.match(/reads\.begin\(\)/g)?.length, fn).toBe(1);
      expect(body, fn).toMatch(/finally \{\s+reads\.end\(\);/);
    }
  });
});
