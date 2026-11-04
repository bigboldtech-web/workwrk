// The daily "KPI scores are waiting" nudge (docs/plans/workspace-status-2.md,
// the final review, product M5, and the fixes review, finding 6), through
// the real route on the in-memory database (seat-test-db.ts).
//
// The case. Pat is anchored at her agency A and owes two of A's KPI scores
// (one never sent, one sent back); she also holds an open record of client
// B's KPI, from when her account was in B. Lee, anchored in B, owes B's. Max
// and Kim owe nothing (approved, and sent for review). The nudge counts the
// records of the workspace the account is in, where its link opens.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));
vi.mock("@/lib/email", () => ({ queueEmail: async () => {} }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { POST } from "./route";

const run = async () => (await POST(new Request("https://app.test/api/cron/kpi-reminders", { method: "POST" }) as never)).json();
const nudges = () => (db.tables.notification ?? []).filter((n) => n.type === "kpi_score_due").map((n) => [n.userId, n.title]).sort();

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id.toUpperCase()}`, status: "ACTIVE" });
  for (const [id, organizationId] of [["pat", "a"], ["max", "a"], ["kim", "a"], ["lee", "b"]] as const) {
    db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "Ng", organizationId, status: "ACTIVE", deletedAt: null });
  }
  for (const [id, organizationId] of [["kpi-a1", "a"], ["kpi-a2", "a"], ["kpi-b1", "b"]] as const) db.seed("kPI", { id, organizationId, name: id });
  const record = (id: string, kpiId: string, userId: string, status: string) => db.seed("kPIRecord", { id, kpiId, userId, period: "2026-10", targetValue: 1, status });
  record("r1", "kpi-a1", "pat", "PENDING");
  record("r2", "kpi-a2", "pat", "REJECTED");
  record("r3", "kpi-b1", "pat", "PENDING");
  record("r4", "kpi-b1", "lee", "PENDING");
  record("r5", "kpi-a1", "max", "APPROVED");
  record("r6", "kpi-a2", "kim", "SUBMITTED");
});

describe("the KPI reminders count what each person owes in the workspace their account is in", () => {
  it("nudges Pat for A's two and Lee for B's one, counted by the database, never by reading every open record", async () => {
    const body = await run();
    expect(body).toMatchObject({ ran: true, usersOwed: 2, nudgesCreated: 2 });
    // Pat's open record of B's KPI is not counted in A (part B's rule, as before).
    expect(nudges()).toEqual([["lee", "A KPI score is waiting"], ["pat", "2 KPI scores are waiting"]]);
    // Before (the fixes review, finding 6): one findMany of every open KPI record, with two relations, every day.
    expect(db.log.filter((e) => e.startsWith("kPIRecord."))).toEqual(["kPIRecord.groupBy", "kPIRecord.groupBy"]);
    expect(db.log).toContain("kPI.groupBy");
  });

  it("nudges nobody when nothing is owed, and a person nudged in the last six days is not nudged again", async () => {
    for (const r of db.tables.kPIRecord) if (r.userId !== "lee") r.status = "APPROVED";
    db.seed("notification", { id: "n-lee", userId: "lee", type: "kpi_score_due", title: "A KPI score is waiting", createdAt: new Date() });
    expect(await run()).toMatchObject({ usersOwed: 1, nudgesCreated: 0 });
    db.tables.kPIRecord.find((r) => r.id === "r4")!.status = "SUBMITTED";
    expect(await run()).toMatchObject({ usersOwed: 0, nudgesCreated: 0 });
    expect(db.log.filter((e) => e.startsWith("kPIRecord.")).every((e) => e === "kPIRecord.groupBy")).toBe(true);
  });
});
