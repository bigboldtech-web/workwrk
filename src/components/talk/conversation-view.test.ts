// The one rule the "Not sent" row has to get right: offer a Retry only when
// the message really is not there.
//
// WHY THIS TEST EXISTS. The POST carries no key the server can dedupe on, so
// a response lost AFTER the row was committed leaves this device holding a
// failed copy of a message the conversation already has. The outbox then
// makes that copy survive a reload, and pressing its Retry the next morning
// writes the same words into the history a second time. hasLandedCopy is how
// the view recognises the copy the poll brought back, and the thing it must
// never do is swallow a message somebody meant to send twice.
//
// Node-only, like the rest of the suite: the view is a component and this
// covers the pure function its bookkeeping rests on.

import { describe, expect, it } from "vitest";
import { hasLandedCopy } from "./conversation-view";
import type { FeedMessage } from "./message-feed";

const author = { id: "u1", firstName: "Ada", lastName: "L", avatar: null };

const row = (over: Partial<FeedMessage> & { id: string }): FeedMessage => ({
  body: "on my way",
  authorId: "u1",
  createdAt: "2026-09-23T10:00:00.000Z",
  parentId: null,
  author,
  replyCount: 0,
  ...over,
});

const failed = row({ id: "temp-1", failed: true });

describe("hasLandedCopy", () => {
  it("spots the committed copy the poll brought back", () => {
    const landed = row({ id: "m1", createdAt: "2026-09-23T10:00:01.000Z" });
    expect(hasLandedCopy([landed, failed], failed)).toBe(true);
  });

  it("does not swallow the same words somebody sent EARLIER on purpose", () => {
    // "on my way" at 09:59 was a real message. The 10:00 one failed, and its
    // words are still unsent: dropping the row here would delete them.
    const earlier = row({ id: "m1", createdAt: "2026-09-23T09:59:00.000Z" });
    expect(hasLandedCopy([earlier, failed], failed)).toBe(false);
  });

  it("does not count another person's identical message", () => {
    const theirs = row({ id: "m1", authorId: "u2", createdAt: "2026-09-23T10:00:05.000Z" });
    expect(hasLandedCopy([theirs, failed], failed)).toBe(false);
  });

  it("does not count the same words posted in a different place", () => {
    const inThread = row({ id: "m1", parentId: "m9", createdAt: "2026-09-23T10:00:05.000Z" });
    expect(hasLandedCopy([inThread, failed], failed)).toBe(false);
    const reply = row({ id: "temp-2", parentId: "m9", failed: true });
    expect(hasLandedCopy([inThread, reply], reply)).toBe(true);
  });

  it("does not count a row that is itself unsent, or one that was removed", () => {
    const pending = row({ id: "temp-2", pending: true, createdAt: "2026-09-23T10:00:05.000Z" });
    const alsoFailed = row({ id: "temp-3", failed: true, createdAt: "2026-09-23T10:00:05.000Z" });
    const removed = row({ id: "m1", deletedAt: "2026-09-23T10:01:00.000Z", createdAt: "2026-09-23T10:00:05.000Z" });
    expect(hasLandedCopy([pending, alsoFailed, removed, failed], failed)).toBe(false);
  });

  it("never matches the row against itself", () => {
    expect(hasLandedCopy([failed], failed)).toBe(false);
  });
});
