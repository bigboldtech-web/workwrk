import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { generateSecret, generateSync } from "otplib";

// Two sign-in gaps closed in src/lib/auth.ts (Phase 8 walk, group 1):
//
//   1. Case. Signup keeps the address as typed ("Priya@Co.com") and refuses
//      a second one that differs only by case, but log in and forgot
//      password looked it up with exact case. "priya@co.com" plus the right
//      password read as a wrong password (and counted toward the lockout),
//      and forgot password said "check your inbox" and sent nothing.
//   2. TOTP replay. One authenticator code signed in twice, each time with
//      a session of its own, for as long as the code stayed valid.
//
// The database is mocked to behave like Postgres does for these queries: an
// `equals` with mode "insensitive" matches regardless of case, a plain
// string matches exactly. So the old exact-case code fails these tests.

type Row = {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  accessLevel: string;
  status: string;
  deletedAt: Date | null;
  tokenVersion: number;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaBackupCodes: string[];
  organizationId: string;
  organization: { id: string; name: string; status: string; settings: unknown };
};

const db: { users: Row[]; tokens: { email: string; token: string; used: boolean }[] } = { users: [], tokens: [] };

function emailMatches(where: unknown, email: string): boolean {
  if (typeof where === "string") return where === email;
  const w = where as { equals?: string; mode?: string } | undefined;
  if (!w || typeof w.equals !== "string") return false;
  return w.mode === "insensitive" ? w.equals.toLowerCase() === email.toLowerCase() : w.equals === email;
}
function userMatches(where: { email?: unknown; deletedAt?: null } | undefined, u: Row): boolean {
  if (!where) return true;
  if ("email" in where && !emailMatches(where.email, u.email)) return false;
  if ("deletedAt" in where && where.deletedAt === null && u.deletedAt) return false;
  return true;
}

const sendEmail = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where }: { where?: { email?: unknown; deletedAt?: null } }) => db.users.filter((u) => userMatches(where, u))),
      findFirst: vi.fn(async ({ where }: { where?: { email?: unknown; deletedAt?: null } }) => db.users.find((u) => userMatches(where, u)) ?? null),
      update: vi.fn(async () => ({})),
    },
    passwordResetToken: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: { email: string; token: string } }) => {
        db.tokens.push({ ...data, used: false });
        return data;
      }),
    },
    organizationMembership: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(), logAuditEvent: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

import { authOptions, claimTotpStep, pickAccountForEmail } from "./auth";
import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";

const PASSWORD = "Walkpass2026y!";
const HASH = bcrypt.hashSync(PASSWORD, 4);

function user(over: Partial<Row> = {}): Row {
  return {
    id: "u1",
    email: "Priya@Co.com",
    passwordHash: HASH,
    firstName: "Priya",
    lastName: "Rao",
    avatar: null,
    accessLevel: "EMPLOYEE",
    status: "ACTIVE",
    deletedAt: null,
    tokenVersion: 0,
    mfaEnabled: false,
    mfaSecret: null,
    mfaBackupCodes: [],
    organizationId: "o1",
    organization: { id: "o1", name: "Co", status: "ACTIVE", settings: {} },
    ...over,
  };
}

type Authorize = (c: Record<string, string>, req: unknown) => Promise<{ id: string; email: string } | null>;
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize;
let ip = 0;
// A fresh source address per call, so the lockout never decides a result.
const signIn = (c: Record<string, string>) => authorize(c, { headers: { "x-forwarded-for": `10.200.0.${++ip}` } });

beforeEach(() => {
  db.users = [];
  db.tokens = [];
  sendEmail.mockReset();
  delete process.env.ENFORCE_MFA_AT_LOGIN;
});

describe("pickAccountForEmail", () => {
  const a = { email: "Priya@Co.com", deletedAt: null };
  const b = { email: "PRIYA@co.com", deletedAt: null };
  const gone = { email: "priya@co.com", deletedAt: new Date() };

  it("matches the stored spelling whatever case was typed", () => {
    expect(pickAccountForEmail([a], "priya@co.com")).toBe(a);
    expect(pickAccountForEmail([a], "  PRIYA@CO.COM ")).toBe(a);
  });
  it("prefers the exact spelling when two accounts differ only by case", () => {
    expect(pickAccountForEmail([a, b], "PRIYA@co.com")).toBe(b);
    expect(pickAccountForEmail([a, b], "Priya@Co.com")).toBe(a);
  });
  it("matches nothing when a third spelling would be a guess between two live accounts", () => {
    expect(pickAccountForEmail([a, b], "priya@co.com")).toBeNull();
  });
  it("prefers a live account over a removed one, and still returns a removed one alone", () => {
    expect(pickAccountForEmail([gone, a], "PRIYA@CO.COM")).toBe(a);
    expect(pickAccountForEmail([gone], "Priya@Co.com")).toBe(gone);
  });
  it("matches nothing for a different address", () => {
    expect(pickAccountForEmail([a], "priya@co.co")).toBeNull();
  });
});

describe("credentials sign in, email case", () => {
  it("signs in with the address in a different case than signup stored", async () => {
    db.users = [user()];
    const r = await signIn({ email: "priya@co.com", password: PASSWORD });
    expect(r?.id).toBe("u1");
    expect(r?.email).toBe("Priya@Co.com");
  });
  it("still refuses a wrong password", async () => {
    db.users = [user()];
    await expect(signIn({ email: "priya@co.com", password: "nope-nope-nope" })).rejects.toThrow("Invalid credentials");
  });
});

describe("forgot password, email case", () => {
  const post = (email: string) =>
    forgotPassword(new Request("http://localhost/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.201.0.${++ip}` }, body: JSON.stringify({ email }) }));

  it("sends the reset link for a lowercase request, and the token carries the stored spelling", async () => {
    db.users = [user()];
    const res = await post("priya@co.com");
    expect(res.status).toBe(200);
    expect(db.tokens).toHaveLength(1);
    // reset-password finds the account again by an exact match on this.
    expect(db.tokens[0].email).toBe("Priya@Co.com");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0][0] as { to: string }).to).toBe("Priya@Co.com");
  });
  it("sends nothing for an unknown address and answers the same", async () => {
    db.users = [user()];
    const res = await post("someone@else.com");
    expect(res.status).toBe(200);
    expect(db.tokens).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("authenticator codes are one-time", () => {
  it("claimTotpStep accepts a step once and refuses it, or any earlier one, again", () => {
    expect(claimTotpStep("claim-a", 100)).toBe(true);
    expect(claimTotpStep("claim-a", 100)).toBe(false);
    expect(claimTotpStep("claim-a", 99)).toBe(false);
    expect(claimTotpStep("claim-a", 101)).toBe(true);
    // Per person: someone else's step is their own.
    expect(claimTotpStep("claim-b", 100)).toBe(true);
  });

  it("refuses the same code a second time at sign in", async () => {
    process.env.ENFORCE_MFA_AT_LOGIN = "true";
    const secret = generateSecret();
    db.users = [user({ id: "u-mfa", email: "mfa@co.com", mfaEnabled: true, mfaSecret: secret })];
    const code = generateSync({ secret });
    const first = await signIn({ email: "mfa@co.com", password: PASSWORD, mfaCode: code });
    expect(first?.id).toBe("u-mfa");
    await expect(signIn({ email: "mfa@co.com", password: PASSWORD, mfaCode: code })).rejects.toThrow("Invalid authentication code");
  });

  it("still asks for a code, and still refuses a wrong one", async () => {
    process.env.ENFORCE_MFA_AT_LOGIN = "true";
    const secret = generateSecret();
    db.users = [user({ id: "u-mfa2", email: "mfa2@co.com", mfaEnabled: true, mfaSecret: secret })];
    await expect(signIn({ email: "mfa2@co.com", password: PASSWORD })).rejects.toThrow("MFA_REQUIRED");
    const real = generateSync({ secret });
    const wrong = real === "000000" ? "111111" : "000000";
    await expect(signIn({ email: "mfa2@co.com", password: PASSWORD, mfaCode: wrong })).rejects.toThrow("Invalid authentication code");
  });
});
