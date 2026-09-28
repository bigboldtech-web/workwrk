import { describe, expect, it } from "vitest";
import { metaAfterRemove, type FeedMeta } from "./kudos-client";

// The group headers on /kudos read meta.groups, the server's counts for
// the whole filtered set. Deleting a kudos in place has to lower the group
// the card sat in, or the header shows a number the feed no longer has.
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const DAY = 86_400_000;
const base: FeedMeta = { total: 6, nextCursor: null, groups: { thisWeek: 6, earlier: 0 }, reactions: 4 };

describe("metaAfterRemove", () => {
  it("lowers This week, the total and the card's reactions for a recent kudos", () => {
    const next = metaAfterRemove(base, { createdAt: new Date(NOW - 2 * 3_600_000).toISOString(), totalReactions: 3 }, NOW);
    expect(next).toEqual({ total: 5, nextCursor: null, groups: { thisWeek: 5, earlier: 0 }, reactions: 1 });
  });

  it("lowers Earlier for a kudos older than a week", () => {
    const m: FeedMeta = { ...base, groups: { thisWeek: 4, earlier: 2 } };
    const next = metaAfterRemove(m, { createdAt: new Date(NOW - 10 * DAY).toISOString(), totalReactions: 0 }, NOW);
    expect(next?.groups).toEqual({ thisWeek: 4, earlier: 1 });
    expect(next?.total).toBe(5);
  });

  it("treats exactly seven days as This week, the same rule the render uses", () => {
    const next = metaAfterRemove(base, { createdAt: new Date(NOW - 7 * DAY).toISOString() }, NOW);
    expect(next?.groups).toEqual({ thisWeek: 5, earlier: 0 });
  });

  it("never goes below zero and keeps unknown reactions unknown", () => {
    const m: FeedMeta = { total: 0, nextCursor: "c", groups: { thisWeek: 0, earlier: 0 }, reactions: null };
    const next = metaAfterRemove(m, { createdAt: new Date(NOW).toISOString(), totalReactions: 5 }, NOW);
    expect(next).toEqual({ total: 0, nextCursor: "c", groups: { thisWeek: 0, earlier: 0 }, reactions: null });
    expect(metaAfterRemove({ ...base, reactions: 1 }, { createdAt: new Date(NOW).toISOString(), totalReactions: 5 }, NOW)?.reactions).toBe(0);
  });

  it("leaves a feed that has not loaded alone", () => {
    expect(metaAfterRemove(null, { createdAt: new Date(NOW).toISOString() }, NOW)).toBeNull();
  });
});
