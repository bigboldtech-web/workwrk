// A personal reminder's email goes under a workspace the person still works
// in (src/lib/reminders.ts): a membership whose seat there was ended
// (deactivated or removed, docs/plans/workspace-status.md D12) is not one of
// theirs, whatever that workspace's own status. Run through the real
// fireReminder on the in-memory database.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ sent: [] as Array<{ organizationId?: string }> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/email", () => ({ sendEmail: async (p: { organizationId?: string }) => { st.sent.push(p); } }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { fireReminder, personalReminderWorkspace } from "./reminders";

beforeEach(() => {
  db.reset();
  st.sent = [];
  db.seed("organization", { id: "A", name: "A", status: "SUSPENDED" });
  db.seed("organization", { id: "B", name: "B", status: "ACTIVE" });
  db.seed("organization", { id: "C", name: "C", status: "ACTIVE" });
  db.seed("user", { id: "pat", email: "pat@x.test", organizationId: "A" });
  db.seed("organizationMembership", { id: "m-b", userId: "pat", organizationId: "B", createdAt: new Date("2026-01-01") });
  db.seed("organizationMembership", { id: "m-c", userId: "pat", organizationId: "C", createdAt: new Date("2026-02-01") });
  db.seed("reminder", { id: "r1", userId: "pat", status: "PENDING", title: "Call back", body: null, notifyEmail: true, organizationId: "B" });
});

const fire = () => fireReminder({ id: "r1", userId: "pat", title: "Call back", body: null, notifyEmail: true, entityType: null, entityId: null, organizationId: "B" });

describe("a personal reminder's email goes under a workspace the person still works in (D12)", () => {
  it("goes under the workspace it was made in while their seat there is live", async () => {
    await fire();
    expect(st.sent.map((e) => e.organizationId)).toEqual(["B"]);
  });

  it("passes over a workspace that deactivated or removed them, open as it is", async () => {
    // Before: B is open, so the email went under B, which had ended Pat's seat.
    db.row("organizationMembership", "m-b").status = "INACTIVE";
    await fire();
    expect(st.sent.map((e) => e.organizationId)).toEqual(["C"]);
  });

  it("judges a membership row that carries its seat, the anchored workspace's own stale row never counting", () => {
    const user = {
      organizationId: "A",
      organization: { status: "CANCELLED" },
      organizationMemberships: [
        { organizationId: "A", organization: { status: "CANCELLED" }, status: "ACTIVE", removedAt: null },
        { organizationId: "B", organization: { status: "ACTIVE" }, status: "ACTIVE", removedAt: new Date("2026-10-01") },
        { organizationId: "C", organization: { status: "TRIAL" }, status: "ON_LEAVE", removedAt: null },
      ],
    };
    // Before: B, removed there, was the workspace it was made in.
    expect(personalReminderWorkspace(user, "B")).toBe("C");
  });
});
