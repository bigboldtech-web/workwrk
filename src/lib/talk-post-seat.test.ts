// Talk rings only the people with a live seat in the conversation's
// workspace (docs/plans/workspace-status.md, the final review, the
// notification senders; src/lib/access/live-seats.ts). Before: every
// conversation member was rung, so someone this workspace removed through
// their membership (their account live in their own company) still got each
// message's preview in their bell. Run on the in-memory database.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/realtime-bus", () => ({ publishToConversation: () => undefined, publishToUser: () => undefined }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { afterMessageSent } from "./talk-post";

const send = (mentions: string[] = []) =>
  afterMessageSent({
    conversationId: "c1",
    conversation: { type: "CHANNEL", name: "launch" },
    message: { id: "m1", author: { firstName: "Olga", lastName: "Ng" } } as never,
    authorId: "olga",
    text: "Pricing goes out on Friday",
    mentions,
    parentId: null,
    isCallCard: false,
    now: new Date(),
  });
const rung = () => (db.tables.notification ?? []).map((n) => n.userId).sort();

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  db.seed("conversation", { id: "c1", organizationId: "b", type: "CHANNEL", name: "launch" });
  db.seed("user", { id: "olga", email: "olga@x.test", organizationId: "b", ...legacyLevelRow("SUPER_ADMIN") });
  db.seed("user", { id: "bea", email: "bea@x.test", organizationId: "b" });
  // Pat: anchored at her agency A, removed from B through her membership.
  db.seed("user", { id: "pat", email: "pat@x.test", organizationId: "a" });
  db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b", status: "INACTIVE", removedAt: new Date("2026-10-30") });
  // Cy: anchored in A, live in B.
  db.seed("user", { id: "cy", email: "cy@x.test", organizationId: "a" });
  db.seed("organizationMembership", { id: "m-cy-b", userId: "cy", organizationId: "b" });
  // Dan: anchored in B, deactivated there.
  db.seed("user", { id: "dan", email: "dan@x.test", organizationId: "b", status: "INACTIVE" });
  for (const userId of ["olga", "bea", "pat", "cy", "dan"]) db.seed("conversationMember", { id: `cm-${userId}`, conversationId: "c1", userId, notifyLevel: "all" });
});

describe("Talk's ring follows the seat here", () => {
  it("rings live seats only, a mention included", async () => {
    await send(["pat"]);
    // Before: bea, cy, dan and pat, Pat with "Olga Ng mentioned you in #launch".
    expect(rung()).toEqual(["bea", "cy"]);
  });
});
