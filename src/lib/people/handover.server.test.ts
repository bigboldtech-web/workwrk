// The handover (runHandover) and its preview for the transfer dialog
// (previewReportHandover). Docs-found fixes batch 2: an Agent is never
// anyone's manager (access 2.4), so an Agent recipient takes the work as
// asked, while the reports go up to the leaver's own manager; before, they
// went to the Agent.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  levels: {} as Record<string, string>,
  names: {} as Record<string, string>,
  managers: new Map<string, string | null>(),
  userWrites: [] as Array<{ ids: string[]; managerId: string | null }>,
  ownerWrites: [] as string[],
}));

vi.mock("@/lib/prisma", () => {
  const user = {
    findMany: async (a: { where: { id?: { in: string[] } }; select: Record<string, boolean> }) => {
      const ids = a.where.id?.in ?? [];
      if ("accessLevel" in a.select) return ids.filter((id) => st.levels[id]).map((id) => ({ id, ...legacyLevelRow(st.levels[id]) }));
      return ids.map((id) => ({ id, firstName: st.names[id] ?? id, lastName: "" }));
    },
    updateMany: async (a: { where: { id: { in: string[] } }; data: { managerId: string | null } }) => {
      st.userWrites.push({ ids: a.where.id.in, managerId: a.data.managerId });
      return { count: a.where.id.in.length };
    },
  };
  const owned = { updateMany: async (a: { data: { ownerId: string } }) => { st.ownerWrites.push(a.data.ownerId); return { count: 1 }; } };
  return {
    prisma: {
      user,
      item: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
      space: owned,
      folder: owned,
      board: owned,
      $transaction: async (ops: unknown[]) => Promise.all(ops),
    },
  };
});
vi.mock("@/lib/people/person-access.server", () => ({ managerMapFor: async () => new Map(st.managers) }));
vi.mock("@/lib/performance/review-cycle.server", () => ({ followReportingLine: async () => undefined }));
vi.mock("@/lib/access/membership", () => ({ unattendedRecipient: async () => null, wouldRemoveLastOwner: async () => false }));

import { previewReportHandover, runHandover } from "./handover.server";

beforeEach(() => {
  // boss > leaver > r1, r2; sam is on the Agent tier.
  st.managers = new Map([["boss", null], ["leaver", "boss"], ["r1", "leaver"], ["r2", "leaver"], ["sam", "boss"]]);
  st.levels = { boss: "DIRECTOR", leaver: "MANAGER", sam: "AGENT", rae: "MANAGER" };
  st.names = { boss: "Dana Lee", sam: "Sam Agent" };
  st.managers.set("rae", "boss");
  st.userWrites = [];
  st.ownerWrites = [];
});

describe("runHandover to an Agent", () => {
  it("sends the work to the Agent but the reports to the leaver's own manager", async () => {
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    // Spaces, Folders and Lists go to the Agent, as asked.
    expect(st.ownerWrites).toEqual(["sam", "sam", "sam"]);
    // No report is ever written under the Agent.
    expect(st.userWrites.some((w) => w.managerId === "sam" && w.ids.length > 0)).toBe(false);
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "boss" });
    expect(r.reportsRehomed.map((x) => [x.id, x.managerId])).toEqual([["r1", "boss"], ["r2", "boss"]]);
  });

  it("still gives the reports to a recipient who may manage", async () => {
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "rae" });
  });

  it("never sends the reports up to a manager who is an Agent", async () => {
    st.levels.boss = "AGENT";
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: null });
    expect(st.userWrites.some((w) => w.managerId === "boss")).toBe(false);
  });
});

describe("previewReportHandover", () => {
  it("tells the dialog exactly what the run will do, by name", async () => {
    expect(await previewReportHandover("org", "leaver", "sam")).toEqual({ reports: 2, toRecipient: 0, recipientIsAgent: true, rehomed: [{ to: "Dana Lee", count: 2 }] });
    expect(await previewReportHandover("org", "leaver", "rae")).toEqual({ reports: 2, toRecipient: 2, recipientIsAgent: false, rehomed: [] });
  });
});
