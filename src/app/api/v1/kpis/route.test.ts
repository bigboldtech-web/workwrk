// POST /api/v1/kpis. Docs-found fixes batch 3: an unknown frequency, or a
// target that is not a number, failed inside the create and answered a bare
// 500. Both answer 400 now, naming the real values; a frequency in any case
// is taken and stored in capitals, as a task's priority is.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Frequency } from "@/generated/prisma";

const st = vi.hoisted(() => ({ made: [] as Array<{ frequency: string; targetValue: number }> }));

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["WRITE"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    kRA: { findFirst: async () => ({ id: "kra1" }) },
    kPI: {
      create: async (a: { data: { frequency: string; targetValue: number; name: string } }) => {
        st.made.push(a.data);
        return { id: "kpi1", name: a.data.name, targetValue: a.data.targetValue, unit: null, frequency: a.data.frequency, createdAt: new Date() };
      },
    },
  },
}));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("https://app.test/api/v1/kpis", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => { st.made = []; });

describe("POST /api/v1/kpis frequency and target", () => {
  it("answers a body of null as an empty one, 400 with the fields it needs, never a 500", async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "kraId, name, and targetValue are required" });
    expect(st.made).toEqual([]);
  });

  it("answers 400 for a frequency outside the list, or a target that is not a number, and makes nothing", async () => {
    const f = await post({ kraId: "kra1", name: "Calls", targetValue: 10, frequency: "FORTNIGHTLY" });
    expect(f.status).toBe(400);
    expect(await f.json()).toEqual({ error: `frequency must be one of ${Object.values(Frequency).join(", ")}` });
    expect((await post({ kraId: "kra1", name: "Calls", targetValue: 10, frequency: 7 })).status).toBe(400);
    expect((await post({ kraId: "kra1", name: "Calls", targetValue: "lots" })).status).toBe(400);
    expect(st.made).toEqual([]);
  });

  it("takes a frequency in any case, stored in capitals, MONTHLY when absent, and a target as a number or a string of one", async () => {
    expect((await post({ kraId: "kra1", name: "Calls", targetValue: 10, frequency: "weekly" })).status).toBe(201);
    expect((await post({ kraId: "kra1", name: "Calls", targetValue: "12.5" })).status).toBe(201);
    expect(st.made.map((m) => [m.frequency, m.targetValue])).toEqual([["WEEKLY", 10], ["MONTHLY", 12.5]]);
  });
});
