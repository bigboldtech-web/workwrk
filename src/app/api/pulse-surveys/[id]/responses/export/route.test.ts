// GET /api/pulse-surveys/[id]/responses/export. Docs-found fixes batch 2:
// the survey pages hide Export CSV from an Agent, but the route let one
// through who was a culture organiser (in the People team, or with reports)
// or the survey's creator. It refuses an Agent first now.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ level: "AGENT", organiserAsked: 0 }));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: legacyTestSession("u1", st.level) }),
  getOrgId: () => "org",
  getUserId: () => "u1",
  isManager: () => false,
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
}));
vi.mock("@/lib/people/culture-gate", () => ({ cultureOrganiserFromSession: async () => { st.organiserAsked += 1; return true; } }));
vi.mock("@/lib/people/review-cycle-access", () => ({ isPeopleTeamOrAdmin: async () => true }));
vi.mock("@/lib/people/survey-audience", () => ({ canManageSurvey: () => true }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    pulseSurvey: { findFirst: async () => ({ id: "p1", title: "Pulse", questions: [{ id: "q1", text: "How?" }], anonymous: false, createdById: "u1" }) },
    surveyResponse: { findMany: async () => [] },
    user: { findMany: async () => [] },
  },
}));

import { GET } from "./route";

const get = () => GET(new Request("https://app.test/api/pulse-surveys/p1/responses/export") as never, { params: Promise.resolve({ id: "p1" }) });

beforeEach(() => { st.organiserAsked = 0; });

describe("survey responses export", () => {
  it("refuses an Agent, whatever else would let them in", async () => {
    st.level = "AGENT";
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Agents can't export survey responses." });
    expect(st.organiserAsked).toBe(0);
  });

  it("still serves the survey's organiser", async () => {
    st.level = "MANAGER";
    const res = await get();
    expect(res.status).not.toBe(403);
    expect(st.organiserAsked).toBe(1);
  });
});
