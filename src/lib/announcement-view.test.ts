import { describe, expect, it } from "vitest";
import {
  announcementInFeed,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_PRIORITY_TONE,
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_TYPE_ICONS,
  ANNOUNCEMENT_TYPE_LABELS,
  announcementGroup,
  audienceLabel,
  compareAnnouncements,
  daysBetweenKeys,
  isAnnouncementPriority,
  isAnnouncementType,
  isExpired,
  isScheduled,
  parseAnnouncementSort,
  parseAnnouncementView,
  postedInstant,
  remindCooloff,
} from "./announcement-view";

describe("the label tables are total", () => {
  it("names every type and gives it an icon", () => {
    for (const t of ANNOUNCEMENT_TYPES) {
      expect(ANNOUNCEMENT_TYPE_LABELS[t]).toBeTruthy();
      expect(ANNOUNCEMENT_TYPE_ICONS[t]).toBeTruthy();
    }
  });
  it("gives every priority a tone", () => {
    for (const p of ANNOUNCEMENT_PRIORITIES) {
      expect(ANNOUNCEMENT_PRIORITY_TONE[p]).toBeTruthy();
    }
  });
  it("guards unknown values", () => {
    expect(isAnnouncementType("INFO")).toBe(true);
    expect(isAnnouncementType("BANANA")).toBe(false);
    expect(isAnnouncementPriority("URGENT")).toBe(true);
    expect(isAnnouncementPriority(null)).toBe(false);
  });
});

describe("parse helpers fall back rather than throw", () => {
  it("parses a view", () => {
    expect(parseAnnouncementView("ack")).toBe("ack");
    expect(parseAnnouncementView("mine")).toBe("mine");
    expect(parseAnnouncementView("nonsense")).toBe("all");
    expect(parseAnnouncementView(null)).toBe("all");
  });
  it("parses a sort", () => {
    expect(parseAnnouncementSort("expiring")).toBe("expiring");
    expect(parseAnnouncementSort(undefined)).toBe("newest");
  });
});

describe("announcementGroup", () => {
  it("puts a pinned post in Pinned whatever its date", () => {
    expect(announcementGroup({ pinned: true }, "2020-01-01", "2026-09-22")).toBe("pinned");
  });
  it("splits This week from Earlier at six days", () => {
    expect(announcementGroup({ pinned: false }, "2026-09-22", "2026-09-22")).toBe("week");
    expect(announcementGroup({ pinned: false }, "2026-09-16", "2026-09-22")).toBe("week");
    expect(announcementGroup({ pinned: false }, "2026-09-15", "2026-09-22")).toBe("earlier");
  });
  it("counts whole days between two keys", () => {
    expect(daysBetweenKeys("2026-09-15", "2026-09-22")).toBe(7);
    expect(daysBetweenKeys("2026-09-22", "2026-09-15")).toBe(-7);
    expect(daysBetweenKeys("bad", "2026-09-15")).toBe(0);
  });
});

describe("compareAnnouncements", () => {
  const a = { priority: "NORMAL" as const, postedAt: "2026-09-20T10:00:00Z", expiresAt: "2026-10-01T00:00:00Z" };
  const b = { priority: "URGENT" as const, postedAt: "2026-09-18T10:00:00Z", expiresAt: null };

  it("newest puts the later post first", () => {
    expect(compareAnnouncements("newest", a, b)).toBeLessThan(0);
  });
  it("oldest reverses that", () => {
    expect(compareAnnouncements("oldest", a, b)).toBeGreaterThan(0);
  });
  it("priority puts Urgent first regardless of date", () => {
    expect(compareAnnouncements("priority", a, b)).toBeGreaterThan(0);
  });
  it("expiring sorts a null expiry LAST, never first", () => {
    expect(compareAnnouncements("expiring", a, b)).toBeLessThan(0);
  });
  it("is stable: equal keys fall through to the posted instant", () => {
    const x = { priority: "HIGH" as const, postedAt: "2026-09-20T10:00:00Z", expiresAt: null };
    const y = { priority: "HIGH" as const, postedAt: "2026-09-19T10:00:00Z", expiresAt: null };
    expect(compareAnnouncements("priority", x, y)).toBeLessThan(0);
  });
});

describe("posted, scheduled and expired", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");
  it("prefers publishedAt over createdAt", () => {
    expect(postedInstant({ publishedAt: "2026-09-20T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" }))
      .toBe("2026-09-20T00:00:00Z");
    expect(postedInstant({ publishedAt: null, createdAt: "2026-09-01T00:00:00Z" }))
      .toBe("2026-09-01T00:00:00Z");
  });
  it("knows a future publish is still scheduled", () => {
    expect(isScheduled({ publishedAt: "2026-09-23T09:00:00Z" }, now)).toBe(true);
    expect(isScheduled({ publishedAt: "2026-09-21T09:00:00Z" }, now)).toBe(false);
    expect(isScheduled({ publishedAt: null }, now)).toBe(false);
  });
  it("treats a null expiry as never expiring", () => {
    expect(isExpired({ expiresAt: null }, now)).toBe(false);
    expect(isExpired({ expiresAt: "2026-09-21T00:00:00Z" }, now)).toBe(true);
    expect(isExpired({ expiresAt: "2026-09-23T00:00:00Z" }, now)).toBe(false);
  });
});

describe("audienceLabel", () => {
  it("names the whole company", () => {
    expect(audienceLabel({ type: "ALL", ids: [] }, [], "Acme")).toBe("Everyone at Acme");
    expect(audienceLabel(null, [], "Acme")).toBe("Everyone at Acme");
  });
  it("lists up to three names and then counts", () => {
    expect(audienceLabel({ type: "DEPARTMENTS", ids: ["1", "2"] }, ["Sales", "Marketing"], "Acme"))
      .toBe("Sales, Marketing");
    expect(audienceLabel({ type: "USERS", ids: [] }, ["A", "B", "C", "D", "E"], "Acme"))
      .toBe("A, B, C and 2 more");
  });
  it("names a Space", () => {
    expect(audienceLabel({ type: "SPACE", ids: ["s1"] }, ["Q4 launch"], "Acme"))
      .toBe("People in Q4 launch");
  });
  it("falls back to the kind when no name resolved", () => {
    expect(audienceLabel({ type: "OFFICES", ids: ["x"] }, [], "Acme")).toBe("Selected offices");
    expect(audienceLabel({ type: "SPACE", ids: ["x"] }, [], "Acme")).toBe("People in a Space");
  });
});

describe("remindCooloff", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");
  it("allows a first reminder", () => {
    expect(remindCooloff(null, now)).toEqual({ blocked: false, label: "Remind pending" });
  });
  it("blocks for 24 hours and says how long ago", () => {
    expect(remindCooloff("2026-09-22T09:00:00Z", now)).toEqual({ blocked: true, label: "Reminded 3h ago" });
    expect(remindCooloff("2026-09-22T11:50:00Z", now)).toEqual({ blocked: true, label: "Reminded 10m ago" });
  });
  it("unblocks after 24 hours", () => {
    expect(remindCooloff("2026-09-21T11:00:00Z", now).blocked).toBe(false);
  });
  it("ignores a malformed instant rather than blocking for ever", () => {
    expect(remindCooloff("not a date", now).blocked).toBe(false);
  });
});

/* ── announcementInFeed ───────────────────────────────────────────── */

describe("announcementInFeed", () => {
  const NOW = Date.parse("2026-09-23T12:00:00.000Z");
  const base = {
    authorId: "author",
    publishedAt: new Date(NOW - 60_000),
    createdAt: new Date(NOW - 120_000),
    expiresAt: null,
  };
  const reader = { viewerId: "reader", oversight: false, inAudience: true, now: NOW };

  it("shows a published post to somebody in its audience", () => {
    expect(announcementInFeed(base, reader)).toBe(true);
  });

  it("HIDES a post from somebody outside its audience", () => {
    // The defect this function exists for: /api/search returned every
    // announcement in the org to every member, audience ignored.
    expect(announcementInFeed(base, { ...reader, inAudience: false })).toBe(false);
  });

  it("HIDES a scheduled post from everyone but its author", () => {
    const scheduled = { ...base, publishedAt: new Date(NOW + 3_600_000) };
    expect(announcementInFeed(scheduled, reader)).toBe(false);
    expect(announcementInFeed(scheduled, { ...reader, viewerId: "author" })).toBe(true);
  });

  it("lets an oversight reader see an out-of-audience post, but NOT a scheduled one", () => {
    const oversight = { ...reader, oversight: true, inAudience: false };
    expect(announcementInFeed(base, oversight)).toBe(true);
    expect(announcementInFeed({ ...base, publishedAt: new Date(NOW + 1) }, oversight)).toBe(false);
  });

  it("hides an expired post and keeps one expiring in the future", () => {
    expect(announcementInFeed({ ...base, expiresAt: new Date(NOW) }, reader)).toBe(false);
    expect(announcementInFeed({ ...base, expiresAt: new Date(NOW - 1) }, reader)).toBe(false);
    expect(announcementInFeed({ ...base, expiresAt: new Date(NOW + 1) }, reader)).toBe(true);
  });

  it("falls back to createdAt when the row has no publishedAt", () => {
    const noPublish = { ...base, publishedAt: null };
    expect(announcementInFeed(noPublish, reader)).toBe(true);
    expect(announcementInFeed({ ...noPublish, createdAt: new Date(NOW + 1) }, reader)).toBe(false);
  });

  it("accepts ISO strings as well as Dates, so a serialized row gates the same", () => {
    const iso = {
      authorId: "author",
      publishedAt: new Date(NOW + 3_600_000).toISOString(),
      createdAt: new Date(NOW - 1).toISOString(),
      expiresAt: null,
    };
    expect(announcementInFeed(iso, reader)).toBe(false);
  });
});
