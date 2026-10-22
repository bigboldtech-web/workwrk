// A copy of a logged-out cookie makes no privileged write (review of the
// longer-sessions fix, L2). A plain log out lists the session's id and bumps
// nothing (src/lib/auth/ended-sessions.ts), so the tokenVersion check in
// freshWorkspaceActor let a copy of a logged-out Owner's cookie change roles,
// the sign-in policy or the API keys until its next five-minute check; the
// old bump refused it at once. Both actors now read the list fresh through
// the helper the AI app consent uses (src/lib/auth/session-cookie.ts), and a
// failed read refuses (fail closed), except a missing table (P2021).

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ raw: null as null | Record<string, unknown> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("../oauth/oauth-test-db")).testDb.prisma }));
vi.mock("next-auth/jwt", () => ({ getToken: async () => st.raw }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }), headers: async () => new Headers() }));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/admin/company-detail", () => ({ ownerIdsFor: async () => ["u-owner"] }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => {} }));

import { legacyLevelRow, legacyTestSession } from "./test-fixtures";
import { freshWorkspaceActor } from "./workspace-admin";
import { freshDoorActor, settingsDoorAllows } from "./settings-door";
import { legacySessionId } from "@/lib/auth/ended-sessions";
import { seed, testDb as db } from "../oauth/oauth-test-db";

const SID = "AAAAAAAAAAAAAAAAAAAAAA";
const AUTH_AT = Date.parse("2026-10-20T09:00:00.000Z");
const owner = () => ({ user: { ...legacyTestSession("u-owner", "COMPANY_ADMIN", "org-a").user, tokenVersion: 3 } });
const listed = (sid: string) => seed(db, "endedSession", { sid, userId: "u-owner", endedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) });
const lookups = () => (db.prisma as unknown as { endedSession: { findUnique: (...a: unknown[]) => Promise<unknown> } }).endedSession;

beforeEach(() => {
  db.reset();
  seed(db, "organization", { id: "org-a", name: "Acme", status: "ACTIVE", settings: {} });
  seed(db, "user", { id: "u-owner", email: "o@acme.test", organizationId: "org-a", ...legacyLevelRow("COMPANY_ADMIN"), tokenVersion: 3 });
  st.raw = { id: "u-owner", authAt: AUTH_AT, sid: SID };
  vi.restoreAllMocks();
});

describe("freshWorkspaceActor, for every privileged write", () => {
  it("is fine for a session nobody logged out", async () => {
    expect(await freshWorkspaceActor(owner())).toMatchObject({ ok: true, admin: true, owner: true });
  });

  it("refuses a copy of a logged-out cookie at once", async () => {
    listed(SID);
    expect(await freshWorkspaceActor(owner())).toMatchObject({ ok: false, status: 403, code: "stale_session" });
  });

  it("refuses a copy of a cookie from before session ids, by the id it derives", async () => {
    st.raw = { id: "u-owner", authAt: AUTH_AT };
    listed(legacySessionId("u-owner", AUTH_AT));
    expect(await freshWorkspaceActor(owner())).toMatchObject({ ok: false, code: "stale_session" });
  });

  it("refuses a cookie that says it ended", async () => {
    st.raw = { id: "u-owner", authAt: AUTH_AT, sid: SID, policyEnded: true };
    expect((await freshWorkspaceActor(owner())).ok).toBe(false);
  });

  it("fails closed when the list cannot be read", async () => {
    vi.spyOn(lookups(), "findUnique").mockRejectedValue(Object.assign(new Error("pool"), { code: "P2024" }));
    expect((await freshWorkspaceActor(owner())).ok).toBe(false);
  });

  it("reads a list that is not there yet (P2021) as not listed: nothing can have been written to it", async () => {
    vi.spyOn(lookups(), "findUnique").mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "P2021" }));
    expect((await freshWorkspaceActor(owner())).ok).toBe(true);
  });

  it("lets a cookie naming another account decide nothing", async () => {
    st.raw = { id: "someone-else", authAt: AUTH_AT, sid: SID };
    listed(SID);
    expect((await freshWorkspaceActor(owner())).ok).toBe(true);
  });
});

describe("freshDoorActor, for the settings doors", () => {
  it("refuses a copy of a logged-out cookie at once, and opens no door for it", async () => {
    expect(await freshDoorActor(owner())).toMatchObject({ ok: true });
    expect(await settingsDoorAllows("members", owner())).toBe(true);
    listed(SID);
    expect(await freshDoorActor(owner())).toMatchObject({ ok: false, code: "stale_session" });
    expect(await settingsDoorAllows("members", owner())).toBe(false);
    expect(await settingsDoorAllows("security", owner())).toBe(false);
  });

  it("fails closed when the list cannot be read", async () => {
    vi.spyOn(lookups(), "findUnique").mockRejectedValue(new Error("connection reset"));
    expect((await freshDoorActor(owner()))?.ok).toBe(false);
  });
});
