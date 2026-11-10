// Tagging someone while editing (src/lib/items/item-mentions.ts): a description
// autosaves every two seconds and a comment can be rewritten, so a person is
// told once, when the saved text names them and the text before it did not.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  notices: [] as Array<{ userId: string; message: string; link: string }>,
  watcherWrites: [] as string[][],
  metadata: { watchers: [] as string[] } as Record<string, unknown>,
}));

const PEOPLE = new Map([
  ["ravi", { id: "ravi", firstName: "Ravi", lastName: "Kumar" }],
  ["asha", { id: "asha", firstName: "Asha", lastName: "Rao" }],
  ["me", { id: "me", firstName: "Me", lastName: "Myself" }],
]);

vi.mock("@/lib/access/seated-here", () => ({
  peopleHereAmong: async (_org: string, ids: string[]) => new Map(ids.filter((i) => PEOPLE.has(i)).map((i) => [i, PEOPLE.get(i)])),
  seatedHereAmong: async (_org: string, ids: string[]) => new Set(ids.filter((i) => PEOPLE.has(i))),
}));
vi.mock("@/lib/notify-prefs", () => ({ filterNotifyUsers: async (ids: string[]) => new Set(ids) }));
vi.mock("@/lib/notify-item", () => ({ taskReaders: async (_o: string, _i: string, ids: string[]) => new Set(ids) }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async () => [{ metadata: db.metadata }],
    item: {
      update: async (a: { data: { metadata: { watchers: string[] } } }) => {
        db.watcherWrites.push(a.data.metadata.watchers);
        return {};
      },
    },
  };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      user: { findUnique: async () => ({ firstName: "Me", lastName: "Myself" }) },
      notification: {
        createMany: async (a: { data: Array<{ userId: string; message: string; link: string }> }) => {
          db.notices.push(...a.data);
          return { count: a.data.length };
        },
      },
    },
  };
});

import { announceAddedMentions } from "./item-mentions";

const base = { organizationId: "org", authorId: "me", item: { id: "t1", title: "Ship it" }, where: "description" as const };

beforeEach(() => {
  db.notices = [];
  db.watcherWrites = [];
  db.metadata = { watchers: [] };
});

describe("announceAddedMentions", () => {
  it("tells a person the new text names, and has them watch the task", async () => {
    await announceAddedMentions({ ...base, before: "", after: "For @Ravi Kumar please", claimed: ["ravi"] });
    expect(db.notices.map((n) => n.userId)).toEqual(["ravi"]);
    expect(db.notices[0].message).toBe("Me Myself mentioned you in a task description");
    expect(db.notices[0].link).toBe("/item/t1");
    expect(db.watcherWrites).toEqual([["ravi"]]);
  });

  it("the next autosave of the same words tells nobody again", async () => {
    await announceAddedMentions({ ...base, before: "For @Ravi Kumar", after: "For @Ravi Kumar please", claimed: ["ravi"] });
    expect(db.notices).toEqual([]);
    expect(db.watcherWrites).toEqual([]);
  });

  it("a half-typed name already autosaved does not count as the tag", async () => {
    await announceAddedMentions({ ...base, before: "For @Ravi", after: "For @Ravi Kumar", claimed: ["ravi"] });
    expect(db.notices.map((n) => n.userId)).toEqual(["ravi"]);
  });

  it("someone else with the same first name does not count as the tag", async () => {
    await announceAddedMentions({ ...base, before: "For @Ravi Sharma", after: "For @Ravi Sharma and @Ravi Kumar", claimed: ["ravi"] });
    expect(db.notices.map((n) => n.userId)).toEqual(["ravi"]);
  });

  it("a longer name that starts the same does not count as the tag", async () => {
    await announceAddedMentions({ ...base, before: "For @Ravi Kumarswamy", after: "For @Ravi Kumarswamy and @Ravi Kumar", claimed: ["ravi"] });
    expect(db.notices.map((n) => n.userId)).toEqual(["ravi"]);
  });

  it("adding a second person tells only that person", async () => {
    await announceAddedMentions({ ...base, before: "For @Ravi Kumar", after: "For @Ravi Kumar and @Asha Rao", claimed: ["ravi", "asha"] });
    expect(db.notices.map((n) => n.userId)).toEqual(["asha"]);
  });

  it("an id the text does not name is ignored, whatever the browser claims", async () => {
    await announceAddedMentions({ ...base, before: "", after: "No names here", claimed: ["ravi"] });
    expect(db.notices).toEqual([]);
  });

  it("never tells the person who wrote it", async () => {
    await announceAddedMentions({ ...base, before: "", after: "Note to @Me Myself", claimed: ["me"] });
    expect(db.notices).toEqual([]);
  });

  it("a comment's row names the comment and lands on it", async () => {
    await announceAddedMentions({ ...base, where: "comment", updateId: "u9", before: "Hello", after: "Hello @Asha Rao", claimed: ["asha"] });
    expect(db.notices[0].message).toBe("Me Myself mentioned you in a comment");
    expect(db.notices[0].link).toBe("/item/t1?comment=u9");
  });
});
