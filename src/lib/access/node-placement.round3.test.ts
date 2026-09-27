// Round three, break 1 (node-placement lockFolderBranch): a Folder created
// while its parent's ancestor moved to another Space kept the old Space, and
// the subtree split. The move read the branch BEFORE it took its row locks, a
// create holding a share lock on the parent committed while the move waited,
// and the new sub-folder was never rewritten (a live race split 14 Folders).
// lockFolderBranch reads the branch again after every lock until nothing new
// appears, so the ids it answers are the whole branch under the locks.
//
// node-placement.ts is server code; its database and resolver imports are
// stubbed so the lock loop runs against a fake database in node.

import { describe, expect, it, vi } from "vitest";

vi.mock("../prisma", () => ({ prisma: {} }));
vi.mock("./node-world", () => ({ loadWorld: vi.fn() }));
vi.mock("./node-access", () => ({ listVisibleSpaces: vi.fn(), viewerPathContainers: vi.fn() }));

import { BRANCH_LOCK_ROUNDS, PlacementConflict, lockFolderBranch } from "./node-placement";

/**
 * A fake Folder table behind $queryRaw: the branch query answers the live
 * children of the root at any depth; a FOR UPDATE lock records what it locked
 * and runs `onLock`, which is where a concurrent create commits while the
 * lock waits for its share lock.
 */
function fakeDb(parents: Map<string, string | null>, onLock: (round: number, ids: string[]) => void) {
  const locks: string[][] = [];
  const db = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes("FOR UPDATE")) {
        const ids = values[0] as string[];
        locks.push([...ids]);
        onLock(locks.length, ids);
        return ids.map((id) => ({ id }));
      }
      if (sql.includes("WITH RECURSIVE down")) {
        const rootId = values[0] as string;
        const out: Array<{ id: string; depth: number }> = [];
        const walk = (id: string, depth: number) => {
          for (const [child, parent] of parents) {
            if (parent === id) {
              out.push({ id: child, depth });
              walk(child, depth + 1);
            }
          }
        };
        walk(rootId, 1);
        return out;
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { db: db as unknown as Parameters<typeof lockFolderBranch>[0], locks };
}

describe("break 1: the move locks the whole branch as it stands under the locks", () => {
  it("a sub-folder committed while the move waited on its first lock is locked and moved too", async () => {
    // FA1 > FA2. While the move waits on FA1 and FA2, a create under FA2 commits FNEW.
    const parents = new Map<string, string | null>([["FA1", null], ["FA2", "FA1"]]);
    const { db, locks } = fakeDb(parents, (round) => { if (round === 1) parents.set("FNEW", "FA2"); });
    const ids = await lockFolderBranch(db, "org-1", "FA1");
    expect(ids[0]).toBe("FA1");
    expect(new Set(ids)).toEqual(new Set(["FA1", "FA2", "FNEW"]));
    // The second lock took exactly the one Folder the first read never named.
    expect(locks).toEqual([["FA1", "FA2"], ["FNEW"]]);
  });

  it("a whole new level made in the gap (a child of the new child) is found the same way", async () => {
    const parents = new Map<string, string | null>([["FA1", null], ["FA2", "FA1"]]);
    const { db } = fakeDb(parents, (round) => {
      if (round === 1) parents.set("N1", "FA2");
      if (round === 2) parents.set("N2", "N1");
    });
    const ids = await lockFolderBranch(db, "org-1", "FA1");
    expect(new Set(ids)).toEqual(new Set(["FA1", "FA2", "N1", "N2"]));
  });

  it("a branch nothing is added to is locked once and read twice", async () => {
    const parents = new Map<string, string | null>([["FA1", null], ["FA2", "FA1"], ["FA3", "FA2"]]);
    const { db, locks } = fakeDb(parents, () => {});
    const ids = await lockFolderBranch(db, "org-1", "FA1");
    expect(new Set(ids)).toEqual(new Set(["FA1", "FA2", "FA3"]));
    expect(locks).toHaveLength(1);
  });

  it("a branch that keeps growing under it is refused after a bounded number of rounds, never moved half", async () => {
    const parents = new Map<string, string | null>([["FA1", null]]);
    let n = 0;
    const { db, locks } = fakeDb(parents, () => { n += 1; parents.set(`G${n}`, "FA1"); });
    await expect(lockFolderBranch(db, "org-1", "FA1")).rejects.toBeInstanceOf(PlacementConflict);
    expect(locks).toHaveLength(BRANCH_LOCK_ROUNDS);
  });
});
