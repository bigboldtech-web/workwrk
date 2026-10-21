// A connection ends when the account's sessions end, except at an ordinary
// log out (docs/plans/mcp-server.md Decision 10, review H1, step 1 tests
// "auth-signout: an ordinary sign out keeps a grant; any other bump revokes").

import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ session: null as null | { user: Record<string, unknown> } }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth-test-db")).testDb.prisma }));
vi.mock("next-auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("next-auth")>()), getServerSession: async () => st.session }));
vi.mock("@/lib/agents/acting", async () => {
  const { actingAs } = await import("./oauth-test-db");
  return { resolveActingPerson: async (organizationId: string, userId: string) => ({ ok: true, person: actingAs(organizationId, userId) }) };
});

import { POST as changePassword } from "@/app/api/me/change-password/route";
import { POST as signOutEverywhere } from "@/app/api/me/sign-out-everywhere/route";
import { authOptions } from "@/lib/auth";
import { grantStanding, type GrantForStanding } from "./eligibility";
import { seed, seedWorld, sessionOf, testDb as db, useMcpEnv } from "./oauth-test-db";
import { hashSecret } from "./tokens";

const saved = { ...process.env };
beforeEach(() => {
  useMcpEnv();
  seedWorld(db, hashSecret);
  st.session = sessionOf("u-max", "org-a", "max@acme.test", 3);
  seed(db, "oAuthGrant", {
    id: "g-live", clientId: "c", organizationId: "org-a", userId: "u-max", scopes: ["mcp:read"], appName: "Claude", redirectHost: "claude.ai",
    familyId: "f", tokenVersion: 3, authorizedAt: new Date(Date.now() - 60_000), endsBy: new Date(Date.now() + 86_400_000),
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const grant = () => db.rows.oAuthGrant.find((g) => g.id === "g-live")!;
const account = () => db.rows.user.find((u) => u.id === "u-max")!;
const stands = () => grantStanding(grant() as unknown as GrantForStanding, { disabledAt: null });
const signOutEvent = () => authOptions.events!.signOut!({ token: { id: "u-max", organizationId: "org-a" }, session: null } as never);

describe("an ordinary log out (the accepted risk)", () => {
  it("bumps the account and its matching grants together, so the app stays connected", async () => {
    expect(await stands()).toMatchObject({ ok: true });
    await signOutEvent();
    expect(account().tokenVersion).toBe(4);
    expect(grant().tokenVersion).toBe(4);
    expect(await stands()).toMatchObject({ ok: true });
    // Under the person's lock, in one transaction.
    expect(db.raw.some((s) => s.includes("pg_advisory_xact_lock") && s.includes("73050"))).toBe(true);
  });

  it("never carries a grant an earlier bump left behind", async () => {
    grant().tokenVersion = 2;
    await signOutEvent();
    expect(grant().tokenVersion).toBe(2);
    expect(await stands()).toEqual({ ok: false, revoke: "sessions_ended" });
  });

  it("still signs the account out when the grant table cannot be written, and the app then ends (the safe side)", async () => {
    db.failing.add("oAuthGrant");
    await signOutEvent();
    db.failing.clear();
    expect(account().tokenVersion).toBe(4);
    expect(grant().tokenVersion).toBe(3);
    expect(await stands()).toEqual({ ok: false, revoke: "sessions_ended" });
  });
});

describe("every other bump", () => {
  it("Sign out everywhere revokes the person's apps at once", async () => {
    const res = await signOutEverywhere(new Request("https://app.workwrk.com/api/me/sign-out-everywhere", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(account().tokenVersion).toBe(4);
    expect(grant()).toMatchObject({ revokedReason: "sessions_ended", revokedById: "u-max" });
    // The client's own sign out after it has nothing left to carry.
    await signOutEvent();
    expect(grant().revokedAt).toBeInstanceOf(Date);
  });

  it("a password change revokes them at once", async () => {
    account().passwordHash = bcrypt.hashSync("Old-password-1", 4);
    const res = await changePassword(new Request("https://app.workwrk.com/api/me/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "Old-password-1", newPassword: "Brand-New-Passw0rd" }),
    }));
    expect(res.status).toBe(200);
    expect(grant()).toMatchObject({ revokedReason: "sessions_ended" });
  });

  it("a bump with no revocation of its own (a demotion, a staff action) ends the app at its next request", async () => {
    account().tokenVersion = (account().tokenVersion as number) + 1;
    expect(await stands()).toEqual({ ok: false, revoke: "sessions_ended" });
  });
});
