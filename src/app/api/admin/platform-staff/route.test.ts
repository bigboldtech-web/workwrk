// Contract test for POST /api/admin/platform-staff when two staff members add
// the same email at the same moment.
//
// The duplicate check is a findUnique followed by a create. Two adds at once
// both pass the findUnique, and the loser's create hits the unique index on
// email (Prisma P2002). That loser used to get a bare 500 with an empty body,
// which the Staff dialog reads as "Something went wrong on our side". It must
// get the same 409 as a sequential duplicate. The database is mocked: the
// test decides what the transaction sees and reads what the route answers.

import { legacyTestSession } from "@/lib/access/test-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Race = "none" | "sequential-duplicate" | "unique-violation" | "other-error";
let race: Race;
const logStaffAction = vi.fn();
const sendEmail = vi.fn(async () => undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        platformAdmin: {
          findUnique: async () => (race === "sequential-duplicate" ? { id: "existing" } : null),
          create: async (args: { data: { email: string; name: string | null } }) => {
            // What the Prisma client throws when the unique index refuses the
            // row: an error object carrying code P2002.
            if (race === "unique-violation") throw Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), { code: "P2002" });
            if (race === "other-error") throw Object.assign(new Error("connection reset"), { code: "P1017" });
            return { id: "new-1", email: args.data.email, name: args.data.name, createdAt: new Date(0) };
          },
          findMany: async () => [{ email: "other.staff@example.com" }],
        },
      };
      return fn(tx);
    },
  },
}));

vi.mock("@/lib/api-helpers", async () => {
  const { NextResponse } = await import("next/server");
  return {
    getSessionOrFail: async () => ({ error: null, session: legacyTestSession("staff-1", "COMPANY_ADMIN", "org-1") }),
    jsonError: (message: string, status = 400) => NextResponse.json({ error: message }, { status }),
    jsonSuccess: (data: unknown, status = 200) => NextResponse.json(data, { status }),
  };
});
vi.mock("@/lib/platform-admin", () => ({ requirePlatformAdminApi: async () => null }));
vi.mock("@/lib/staff-audit", async () => {
  const helpers = await vi.importActual<typeof import("@/lib/staff-audit-helpers")>("@/lib/staff-audit-helpers");
  return {
    escapeHtml: helpers.escapeHtml,
    requestIp: () => "127.0.0.1",
    staffActorFromSession: () => ({ userId: "staff-1", email: "staff@example.com" }),
    logStaffAction: (...args: unknown[]) => logStaffAction(...args),
  };
});
vi.mock("@/lib/email", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...(args as [])) }));
vi.mock("@/lib/admin/company-detail", () => ({ staffNames: async () => new Map() }));
vi.mock("@/lib/admin/console-prefs", () => ({ readConsolePrefs: () => ({}) }));

import { POST } from "./route";

async function add(email = "new.staff@example.com") {
  const req = new Request("http://x/api/admin/platform-staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const res = await POST(req as never);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> | null };
}

beforeEach(() => {
  race = "none";
  logStaffAction.mockClear();
  sendEmail.mockClear();
});

describe("POST /api/admin/platform-staff", () => {
  it("adds a new email with 201 and notifies the rest of the list", async () => {
    const { status, body } = await add();
    expect(status).toBe(201);
    expect((body?.staff as { email: string }).email).toBe("new.staff@example.com");
    expect(logStaffAction).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("answers a sequential duplicate with 409", async () => {
    race = "sequential-duplicate";
    const { status, body } = await add();
    expect(status).toBe(409);
    expect(body?.error).toBe("That email is already on the staff list");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("answers the loser of a simultaneous add with the same 409, not a 500", async () => {
    race = "unique-violation";
    const { status, body } = await add();
    expect(status).toBe(409);
    expect(body?.error).toBe("That email is already on the staff list");
    // Nobody is told about an add that did not happen.
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still lets any other database failure surface as an error", async () => {
    race = "other-error";
    await expect(add()).rejects.toThrow("connection reset");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
