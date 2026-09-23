// The Talk outbox: a message that failed to send must outlive the page.
//
// WHY THIS TEST EXISTS. The "Not sent · Retry · Delete" row was correct on
// screen and lived only in React state, so clicking another conversation and
// coming back threw the person's words away with no prompt and no trace. The
// save-path rule is that a failed send is never a silent drop, and these are
// the four things that rule reduces to: it is remembered, it is remembered
// per conversation, a retry that fails again does not stack duplicates, and
// a browser that refuses storage does not take the page down with it.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  forgetFailedSend,
  readTalkOutbox,
  rememberFailedSend,
  talkOutboxKey,
  writeTalkOutbox,
} from "./talk-keys";

/** The smallest localStorage that behaves like one, for the node env. */
function installStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  const base: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  (globalThis as unknown as { window: { localStorage: Storage } }).window = {
    localStorage: { ...base, ...impl },
  };
  return store;
}

const entry = (id: string, body: string) => ({ id, body, createdAt: "2026-09-22T10:00:00.000Z" });

describe("the Talk outbox", () => {
  beforeEach(() => { installStorage(); });
  // Leave the global as we found it, so no other suite inherits a window.
  afterEach(() => { delete (globalThis as unknown as { window?: unknown }).window; });

  it("remembers a message that failed to send", () => {
    rememberFailedSend("c1", entry("t1", "the thing I typed"));
    expect(readTalkOutbox("c1").map((e) => e.body)).toEqual(["the thing I typed"]);
  });

  it("keeps each conversation's failures apart", () => {
    rememberFailedSend("c1", entry("t1", "for sales"));
    rememberFailedSend("c2", entry("t2", "for design"));
    expect(readTalkOutbox("c1").map((e) => e.id)).toEqual(["t1"]);
    expect(readTalkOutbox("c2").map((e) => e.id)).toEqual(["t2"]);
    expect(talkOutboxKey("c1")).not.toBe(talkOutboxKey("c2"));
  });

  it("does not stack duplicates when a retry fails again", () => {
    rememberFailedSend("c1", entry("t1", "first attempt"));
    rememberFailedSend("c1", { ...entry("t1", "first attempt"), createdAt: "2026-09-22T10:05:00.000Z" });
    expect(readTalkOutbox("c1")).toHaveLength(1);
  });

  it("forgets one when it finally sends, and leaves the others", () => {
    rememberFailedSend("c1", entry("t1", "one"));
    rememberFailedSend("c1", entry("t2", "two"));
    forgetFailedSend("c1", "t1");
    expect(readTalkOutbox("c1").map((e) => e.id)).toEqual(["t2"]);
  });

  it("clears the key entirely rather than leaving an empty array behind", () => {
    const store = installStorage();
    rememberFailedSend("c1", entry("t1", "one"));
    forgetFailedSend("c1", "t1");
    expect(store.has(talkOutboxKey("c1"))).toBe(false);
  });

  it("reads corrupt storage as an empty outbox", () => {
    const store = installStorage();
    store.set(talkOutboxKey("c1"), "{not json");
    expect(readTalkOutbox("c1")).toEqual([]);
    store.set(talkOutboxKey("c1"), JSON.stringify({ not: "an array" }));
    expect(readTalkOutbox("c1")).toEqual([]);
    store.set(talkOutboxKey("c1"), JSON.stringify([{ id: 1 }, { body: "no id" }]));
    expect(readTalkOutbox("c1")).toEqual([]);
  });

  it("survives a browser that refuses site data", () => {
    installStorage({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(() => rememberFailedSend("c1", entry("t1", "one"))).not.toThrow();
    expect(readTalkOutbox("c1")).toEqual([]);
  });

  it("caps what it stores, so one broken network cannot fill the quota", () => {
    writeTalkOutbox("c1", Array.from({ length: 40 }, (_, i) => entry(`t${i}`, `m${i}`)));
    expect(readTalkOutbox("c1")).toHaveLength(20);
  });

  // The cap used to keep the FRONT of the list while rememberFailedSend
  // appended to the back, so once twenty entries had piled up the message
  // somebody had just typed was the one thrown away while twenty stale ones
  // survived. Which twenty survive is the whole point of the cap, so it is
  // asserted rather than just the count.
  it("keeps the newest failures when the cap is reached, not the oldest", () => {
    writeTalkOutbox("c1", Array.from({ length: 40 }, (_, i) => entry(`t${i}`, `m${i}`)));
    const kept = readTalkOutbox("c1").map((e) => e.id);
    expect(kept[0]).toBe("t20");
    expect(kept[kept.length - 1]).toBe("t39");
  });

  it("still remembers a failure once the conversation is at the cap", () => {
    for (let i = 0; i < 20; i++) rememberFailedSend("c1", entry(`t${i}`, `m${i}`));
    rememberFailedSend("c1", entry("t20", "the one I am looking at"));
    const stored = readTalkOutbox("c1");
    expect(stored).toHaveLength(20);
    expect(stored.map((e) => e.id)).toContain("t20");
    expect(stored.map((e) => e.id)).not.toContain("t0");
  });

  // A failed thread reply and an unsaved edit are user content too. Both are
  // stored here and both need a reader that can tell them apart from a
  // top-level send, which is what parentId and editOf are for.
  it("keeps a reply's thread and an edit's target on the entry", () => {
    rememberFailedSend("c1", { ...entry("t1", "in the thread"), parentId: "m9" });
    rememberFailedSend("c1", { ...entry("m4", "the rewritten paragraph"), editOf: "m4" });
    const stored = readTalkOutbox("c1");
    expect(stored.find((e) => e.id === "t1")?.parentId).toBe("m9");
    expect(stored.find((e) => e.id === "m4")?.editOf).toBe("m4");
  });
});
