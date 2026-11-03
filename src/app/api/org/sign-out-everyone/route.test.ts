// POST /api/org/sign-out-everyone counts, in its audit row and its answer,
// the people whose sessions acting here it ends: everyone anchored here, and
// everyone here through a membership whose seat here is live
// (docs/plans/workspace-status.md D12). A membership this workspace
// deactivated or removed has no session acting here. Run on the in-memory
// database.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ audits: [] as Array<{ metadata?: Record<string, unknown> }> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "bo", organizationId: "b" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/workspace-admin", () => ({
  sessionMayManageOwnerPage: async () => true,
  freshWorkspaceActor: async () => ({ ok: true }),
  freshActorRefusal: () => null,
  freshMayManageOwnerPage: () => true,
}));
vi.mock("@/lib/access/access-grant-store", () => ({ lockOrgSettings: async () => undefined }));
vi.mock("@/lib/org-settings-write", () => ({ settingsKey: () => ({}), writeOrgSettingsKeys: async () => undefined }));
vi.mock("@/lib/oauth/grants", () => ({ revokeLeftBehind: async () => undefined }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: (e: { metadata?: Record<string, unknown> }) => { st.audits.push(e); } }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { POST } from "./route";

beforeEach(() => {
  db.reset();
  st.audits = [];
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  db.seed("user", { id: "bo", email: "bo@x.test", organizationId: "b" });
  db.seed("user", { id: "cy", email: "cy@x.test", organizationId: "a" });
  db.seed("organizationMembership", { id: "m-cy", userId: "cy", organizationId: "b" });
  db.seed("user", { id: "dee", email: "dee@x.test", organizationId: "a" });
  db.seed("organizationMembership", { id: "m-dee", userId: "dee", organizationId: "b", status: "INACTIVE" });
  db.seed("user", { id: "eve", email: "eve@x.test", organizationId: "a" });
  db.seed("organizationMembership", { id: "m-eve", userId: "eve", organizationId: "b", removedAt: new Date("2026-10-01") });
});

describe("sign everyone out counts the seats it ends (D12)", () => {
  it("counts a member here through a live seat, never one this workspace ended", async () => {
    const res = await POST(new Request("https://app.test/api/org/sign-out-everyone", { method: "POST", body: JSON.stringify({ confirm: "SIGN OUT" }) }));
    // Before: 4, Dee and Eve counted though B had ended both.
    expect(await res.json()).toEqual({ ok: true, signedOut: 2 });
    expect(st.audits[0]?.metadata).toMatchObject({ people: 2, anchoredHere: 1, membersElsewhere: 1 });
    // The members anchored elsewhere keep their account's tokenVersion.
    expect(db.row("user", "cy").tokenVersion).toBe(0);
    expect(db.row("user", "bo").tokenVersion).toBe(1);
  });
});
