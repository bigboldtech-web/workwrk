// Giving a kudos follows the kudos wall's rules, and whichever surface gives
// it, the person thanked is told and "kudos.created" fires. The database,
// the role and every side effect are mocked; the test reads what was done.

import { beforeEach, describe, expect, it, vi } from "vitest";

const done: string[] = [];
let role: "MEMBER" | "GUEST" | null = "MEMBER";
let receiver: { id: string; firstName: string; lastName: string; email: string } | null = { id: "u-lea", firstName: "Lea", lastName: "Alpha", email: "lea@x.com" };
let dupe: Record<string, unknown> | null = null;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: async () => receiver },
    kudos: {
      findFirst: async () => dupe,
      create: async (args: { data: Record<string, unknown> }) => {
        done.push("create");
        return { id: "k-1", createdAt: new Date(0), ...args.data, giver: { id: "u-eve", firstName: "Eve", lastName: "Reader", avatar: null }, receiver: { id: "u-lea", firstName: "Lea", lastName: "Alpha", avatar: null } };
      },
    },
    notification: { create: async () => { done.push("notify"); return {}; } },
  },
}));
// The giver (u-eve) has `role`; the receiver (u-lea) has `receiverRole` and `receiverStatus`.
let receiverRole: "MEMBER" | "GUEST" = "MEMBER";
let receiverStatus = "ACTIVE";
vi.mock("@/lib/access/viewer", () => ({
  viewerForUser: async (_org: string, userId: string) =>
    userId === "u-lea" ? { userId, orgRole: receiverRole, status: receiverStatus } : role ? { userId, orgRole: role, status: "ACTIVE" } : null,
}));
vi.mock("@/lib/notify-prefs", () => ({ shouldNotify: async () => true, shouldEmail: async () => true }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => { done.push("email"); } }));
vi.mock("@/lib/email-templates", () => ({ kudosTemplate: () => ({ subject: "s", html: "h" }) }));
vi.mock("@/lib/activity", () => ({ logActivity: () => { done.push("log"); } }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => { done.push("score"); } }));
vi.mock("@/services/slackNotifier", () => ({ notifyKudosPosted: async () => { done.push("slack"); } }));
vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async (e: { event: string }) => { done.push(`event:${e.event}`); } }));

const { giveKudos, kudosAftermath } = await import("./kudos-give");
const base = { organizationId: "org-1", giverId: "u-eve", receiverId: "u-lea", message: "  Thanks for the launch  " };

beforeEach(() => {
  done.length = 0;
  role = "MEMBER";
  receiver = { id: "u-lea", firstName: "Lea", lastName: "Alpha", email: "lea@x.com" };
  dupe = null;
  receiverRole = "MEMBER";
  receiverStatus = "ACTIVE";
});

describe("giveKudos", () => {
  it("a Member's kudos is saved, the person thanked is told and emailed, and kudos.created fires", async () => {
    const r = await giveKudos(base);
    expect(r).toMatchObject({ ok: true, duplicate: false, kudos: { message: "Thanks for the launch" } });
    expect(done).toEqual(["create", "notify", "email", "log", "score", "slack", "event:kudos.created"]);
  });

  it("never a Guest, nor someone no longer in the workspace", async () => {
    role = "GUEST";
    expect(await giveKudos(base)).toEqual({ ok: false, status: 404, error: "Not found" });
    role = null;
    expect(await giveKudos(base)).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(done).toEqual([]);
  });

  it("never to yourself, never past 500 characters, never empty, never to someone removed", async () => {
    expect(await giveKudos({ ...base, receiverId: "u-eve" })).toMatchObject({ ok: false, status: 400 });
    expect(await giveKudos({ ...base, message: "x".repeat(501) })).toMatchObject({ ok: false, status: 400 });
    expect(await giveKudos({ ...base, message: "   " })).toMatchObject({ ok: false, status: 400 });
    receiver = null;
    expect(await giveKudos(base)).toEqual({ ok: false, status: 404, error: "User not found" });
    expect(done).toEqual([]);
  });

  it("a resend of the same kudos answers with the one that exists and does nothing twice", async () => {
    dupe = { id: "k-0", message: "Thanks for the launch" };
    expect(await giveKudos(base)).toMatchObject({ ok: true, duplicate: true, kudos: { id: "k-0" } });
    expect(done).toEqual([]);
  });
});

describe("thanks reach only a teammate who can open the wall", () => {
  it("the wall and Ask AI never thank a Guest or someone deactivated", async () => {
    receiverRole = "GUEST";
    expect(await giveKudos(base)).toEqual({ ok: false, status: 400, error: "You can only thank a teammate who can sign in." });
    receiverRole = "MEMBER";
    receiverStatus = "INACTIVE";
    expect(await giveKudos(base)).toMatchObject({ ok: false, status: 400 });
    expect(done).toEqual([]);
  });

  it("a kudos the public API made for someone deactivated is logged and fires, but tells and emails no one", async () => {
    receiverStatus = "INACTIVE";
    await kudosAftermath({
      organizationId: "org-1",
      kudos: { id: "k-2", message: "Thanks", companyValue: null, giverId: "u-eve", receiverId: "u-lea", createdAt: new Date(0) },
      giver: { id: "u-eve", firstName: "Eve", lastName: "Reader" },
      receiver: { id: "u-lea", firstName: "Lea", lastName: "Alpha", email: "lea@x.com" },
    });
    expect(done).toEqual(["log", "score", "slack", "event:kudos.created"]);
  });

  it("someone on leave can still be thanked and told", async () => {
    receiverStatus = "ON_LEAVE";
    expect(await giveKudos(base)).toMatchObject({ ok: true });
    expect(done).toContain("notify");
  });
});
