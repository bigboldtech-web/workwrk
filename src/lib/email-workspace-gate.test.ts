// queueEmail sends nothing to a workspace that is suspended, cancelled or
// gone (src/lib/email.ts workspaceTakesEmail), a failed status read never
// drops mail, a person's own account mail always goes, and a reopened
// workspace is never refused from the cache.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  status: new Map<string, string | null>(),
  throwFor: new Set<string>(),
  created: [] as string[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (db.throwFor.has(where.id)) throw new Error("connection reset");
        const s = db.status.get(where.id);
        return s === undefined || s === null ? null : { status: s };
      },
    },
    emailLog: {
      create: async ({ data }: { data: { organizationId?: string } }) => {
        db.created.push(data.organizationId ?? "none");
        return {};
      },
    },
    emailPreference: { findUnique: async () => null },
  },
}));

import { queueEmail } from "./email";

const send = (organizationId?: string) =>
  queueEmail({ to: "p@example.test", subject: "S", html: "<p>x</p>", template: "overdue-manager", variables: {}, organizationId });

beforeEach(() => {
  db.created.length = 0;
});

describe("queueEmail and the workspace's status", () => {
  it("queues for a live workspace, and for mail tagged with none", async () => {
    db.status.set("o-active", "ACTIVE");
    db.status.set("o-trial", "TRIAL");
    await send("o-active");
    await send("o-trial");
    await send(undefined);
    expect(db.created).toEqual(["o-active", "o-trial", "none"]);
  });

  it("queues nothing for a suspended, cancelled or deleted workspace", async () => {
    db.status.set("o-susp", "SUSPENDED");
    db.status.set("o-canc", "CANCELLED");
    await send("o-susp");
    await send("o-canc");
    await send("o-gone");
    expect(db.created).toEqual([]);
  });

  it("lets mail through when the status cannot be read", async () => {
    db.throwFor.add("o-flaky");
    await send("o-flaky");
    expect(db.created).toEqual(["o-flaky"]);
  });

  it("always sends a person's own account mail, whatever their anchored workspace's status", async () => {
    db.status.set("o-closed", "SUSPENDED");
    for (const template of ["password-reset", "verify-email"]) {
      await queueEmail({ to: "p@example.test", subject: "S", html: "<p>x</p>", template, variables: {}, organizationId: "o-closed" });
    }
    expect(db.created).toEqual(["o-closed", "o-closed"]);
  });

  it("sends at once to a workspace staff reopen: a closed answer is never kept", async () => {
    db.status.set("o-reopened", "SUSPENDED");
    await send("o-reopened");
    db.status.set("o-reopened", "ACTIVE");
    await send("o-reopened");
    expect(db.created).toEqual(["o-reopened"]);
  });
});
