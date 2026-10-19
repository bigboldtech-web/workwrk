// POST /api/v1/kudos. Found while refreshing the API reference (2026-10-19):
// a body of null answered a 500. It reads as an empty body now.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["WRITE"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/kudos-give", () => ({ kudosAftermath: async () => undefined }));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("https://app.test/api/v1/kudos", { method: "POST", body: JSON.stringify(body) }) as never);

describe("POST /api/v1/kudos", () => {
  it("answers a body of null as an empty one, 400 with the fields it needs, never a 500", async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "giverId, receiverId, and message are required" });
  });
});
