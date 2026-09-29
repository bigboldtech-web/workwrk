import { describe, it, expect, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";

// The workspace-move notice (Phase 9 walk, group 3 finding 1). When a person
// is moved out of a suspended or closed company into another workspace they
// belong to, the token carries a one-shot marker that reaches the session as
// a sentence, and only an ack for THAT marker clears it. The ack must never
// touch revocation: session.update() cannot revive anything through it.

const db = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  orgFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
}));

vi.mock("./prisma", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => db.userFindUnique(...a),
      findFirst: (...a: unknown[]) => db.userFindFirst(...a),
      update: (...a: unknown[]) => db.userUpdate(...a),
    },
    organization: { findUnique: (...a: unknown[]) => db.orgFindUnique(...a) },
    organizationMembership: { findFirst: (...a: unknown[]) => db.membershipFindFirst(...a) },
  },
}));
vi.mock("./activity", () => ({ logActivity: vi.fn() }));

import { authOptions } from "./auth";

type Tok = Record<string, unknown>;
const jwt = (args: Record<string, unknown>) =>
  (authOptions.callbacks!.jwt as unknown as (a: Record<string, unknown>) => Promise<Tok>)(args);
const sessionOf = (token: Tok) =>
  (authOptions.callbacks!.session as unknown as (a: Record<string, unknown>) => Promise<Record<string, unknown>>)({
    session: { user: { name: "x" }, expires: "2099-01-01" },
    token,
  });

const SUS = { id: "org-sus", name: "Sus Co", status: "SUSPENDED" };
const HOME = { id: "org-home", name: "Home Co", status: "TRIAL" };

function account(org: { id: string; name: string; status: string }, tokenVersion = 0) {
  return {
    deletedAt: null,
    status: "ACTIVE",
    accessLevel: "COMPANY_ADMIN",
    tokenVersion,
    organizationId: org.id,
    organization: { status: org.status, name: org.name },
  };
}

beforeEach(() => {
  for (const f of Object.values(db)) f.mockReset();
  db.userUpdate.mockResolvedValue({});
});

describe("workspace move notice", () => {
  it("stamps the move out of a suspended anchored company and says it in the session", async () => {
    db.userFindUnique.mockResolvedValue(account(SUS));
    db.membershipFindFirst.mockResolvedValue({ organizationId: HOME.id, organization: { name: HOME.name } });
    const token = await jwt({ token: { id: "u1", organizationId: SUS.id, organizationName: SUS.name, tokenVersion: 0 } });
    expect(token.organizationId).toBe(HOME.id);
    expect(token.revoked).toBe(false);
    const s = await sessionOf(token);
    const move = s.workspaceMove as { at: number; message: string } | undefined;
    expect(move?.message).toBe(
      "Sus Co is suspended, so you are now in Home Co. Contact Sus Co's Owner or WorkwrK support.",
    );
    expect(typeof move?.at).toBe("number");
  });

  it("stamps the return from a stale suspended workspace to the healthy anchored one", async () => {
    db.userFindUnique.mockResolvedValue(account(HOME));
    db.orgFindUnique.mockResolvedValue({ status: "CANCELLED", name: "Sus Co" });
    const token = await jwt({ token: { id: "u1", organizationId: SUS.id, organizationName: SUS.name, tokenVersion: 0 } });
    expect(token.organizationId).toBe(HOME.id);
    const s = await sessionOf(token);
    expect((s.workspaceMove as { message: string }).message).toBe(
      "Sus Co is closed, so you are now in Home Co. Contact Sus Co's Owner or WorkwrK support.",
    );
  });

  it("says nothing when the workspace is healthy", async () => {
    db.userFindUnique.mockResolvedValue(account(HOME));
    const token = await jwt({ token: { id: "u1", organizationId: HOME.id, organizationName: HOME.name, tokenVersion: 0 } });
    expect((await sessionOf(token)).workspaceMove).toBeUndefined();
  });

  it("clears only on an ack for the same move, and the ack never revives a revoked token", async () => {
    db.userFindUnique.mockImplementation((args: { include?: unknown }) =>
      Promise.resolve(args.include ? { tokenVersion: 0, organizationId: HOME.id, accessLevel: "COMPANY_ADMIN", organization: { name: HOME.name } } : account(HOME)),
    );
    const marker = { from: "Sus Co", status: "SUSPENDED", to: "Home Co", at: 1234 };
    const base = { id: "u1", organizationId: HOME.id, organizationName: HOME.name, tokenVersion: 0, checkedAt: Date.now() };

    const wrong = await jwt({ token: { ...base, workspaceMove: marker }, trigger: "update", session: { workspaceMoveAck: 999 } });
    expect(wrong.workspaceMove).toEqual(marker);

    const right = await jwt({ token: { ...base, workspaceMove: marker }, trigger: "update", session: { workspaceMoveAck: 1234 } });
    expect(right.workspaceMove).toBeUndefined();
    expect((await sessionOf(right)).workspaceMove).toBeUndefined();

    const revoked = await jwt({
      token: { ...base, revoked: true, workspaceMove: marker },
      trigger: "update",
      session: { workspaceMoveAck: 1234 },
    });
    expect(revoked.revoked).toBe(true);
    expect((await sessionOf(revoked)).user).toBeUndefined();
  });

  it("stamps the move at sign-in when the anchored company is suspended", async () => {
    const passwordHash = bcrypt.hashSync("pw-for-test", 4);
    db.userFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      firstName: "A",
      lastName: "B",
      avatar: null,
      accessLevel: "COMPANY_ADMIN",
      tokenVersion: 0,
      passwordHash,
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: [],
      deletedAt: null,
      status: "ACTIVE",
      organization: { ...SUS, settings: {} },
    });
    db.membershipFindFirst.mockResolvedValue({ organizationId: HOME.id, organization: { ...HOME, settings: {} } });
    const provider = authOptions.providers[0] as unknown as {
      options: { authorize: (c: Record<string, string>, r: unknown) => Promise<Record<string, unknown>> };
    };
    const user = await provider.options.authorize({ email: "a@b.c", password: "pw-for-test" }, { headers: {} });
    expect(user.organizationId).toBe(HOME.id);
    db.userFindUnique.mockResolvedValue(account(HOME));
    const token = await jwt({ token: {}, user });
    expect((await sessionOf(token)).workspaceMove).toMatchObject({
      message: "Sus Co is suspended, so you are now in Home Co. Contact Sus Co's Owner or WorkwrK support.",
    });
  });
});
