// peopleCtx for an Agent (docs-found fixes batch 3). relationTo gave an
// Agent with reports stored before rule 6 "chain" or "chain-view" over them:
// their phone, birthday, KPI history, reviews and score (GET /api/users/[id]),
// and every people route that reads relationTo. An Agent is never anyone's
// manager (AGENT_TIER_BLURB), so their chain is empty, whatever tree a viewer
// carries and whatever the legacy walker finds.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/access/acting-workspace", () => ({ levelHeldIn: async (id: string) => (id === "sam" ? "AGENT" : "MANAGER") }));
// The legacy walker as it was: it still names the stored reports.
vi.mock("@/lib/team", () => ({ getTeamUserIds: async (_org: string, id: string) => [id, "ida", "kim"] }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { peopleCtxForViewer, relationTo } from "./person-access.server";
import type { Viewer } from "@/lib/access/types";

const viewer = (userId: string, isAgent: boolean): Viewer =>
  ({ userId, organizationId: "org", orgRole: "MEMBER", isAgent, adminScopes: [], reportTree: new Set(["ida", "kim"]) }) as unknown as Viewer;

describe("peopleCtx for an Agent", () => {
  it("has no chain and no chain-view over the people still listed under them", async () => {
    const ctx = await peopleCtxForViewer(viewer("sam", true));
    expect(ctx.chain.size).toBe(0);
    expect(ctx.writeChain.size).toBe(0);
    expect(relationTo(ctx, "ida")).toBe("none");
    expect(relationTo(ctx, "kim")).toBe("none");
    expect(relationTo(ctx, "sam")).toBe("self");
  });

  it("a manager who is no Agent keeps their chain", async () => {
    const ctx = await peopleCtxForViewer(viewer("mona", false));
    expect(relationTo(ctx, "ida")).toBe("chain");
  });
});
