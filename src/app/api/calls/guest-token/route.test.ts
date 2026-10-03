// POST /api/calls/guest-token: an archived conversation's guest link is
// over. Nobody inside an archived conversation may start or join a call
// (archive caps everyone at view), so its link must not mint a token either.

import { beforeEach, describe, expect, it, vi } from "vitest";

let conversation: { id: string; organizationId: string; callEpoch: number; archivedAt: Date | null } | null = null;

vi.mock("@/lib/prisma", () => ({
  prisma: { conversation: { findUnique: async () => conversation }, meeting: { findFirst: async () => null } },
}));
vi.mock("@/lib/api-helpers", () => ({
  jsonError: (error: string, status = 400) => ({ status, error }),
  jsonSuccess: (data: unknown, status = 200) => ({ status, data }),
}));
vi.mock("@/lib/meeting-room", () => ({
  verifyChatGuestCode: () => ({ conversationId: "conv_1", epoch: 3, expiresAt: null }),
  verifyMeetingGuestCode: () => null,
  guestCodeExpired: () => false,
  chatRoomName: () => "room_conv_1",
  meetingRoomName: () => "room_meeting",
}));
vi.mock("@/lib/call-session", () => ({ ensureCallSession: async () => undefined }));
vi.mock("livekit-server-sdk", () => ({
  AccessToken: class {
    addGrant() {}
    async toJwt() { return "jwt"; }
  },
}));

import { POST } from "./route";

const ask = () => POST({ json: async () => ({ code: "c.conv_1.3.0.sig", name: "Guest" }) } as never) as unknown as Promise<{ status: number; error?: string; data?: { token?: string } }>;

describe("POST /api/calls/guest-token", () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = "wss://example.invalid";
    process.env.LIVEKIT_API_KEY = "key";
    process.env.LIVEKIT_API_SECRET = "secret";
    conversation = { id: "conv_1", organizationId: "org_1", callEpoch: 3, archivedAt: null };
  });

  it("mints a token for a live conversation's link", async () => {
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.data?.token).toBe("jwt");
  });

  it("answers 410 for an archived conversation's link, and mints nothing", async () => {
    conversation = { id: "conv_1", organizationId: "org_1", callEpoch: 3, archivedAt: new Date() };
    const r = await ask();
    expect(r.status).toBe(410);
    expect(r.error).toMatch(/archived/);
    expect(r.data).toBeUndefined();
  });
});
