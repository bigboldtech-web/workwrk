// PATCH /api/report-schedules/[id] on a schedule whose view went private.
//
// The walk found a dead end: a view scheduled to its owner and a colleague,
// then made private, refused EVERY edit with private_view_recipients,
// pausing included, because the rule was checked against the STORED list
// even when the edit left the recipients alone. Only Delete worked, and the
// form's Retry resent the same refused request forever.
//
// The rule now looks at what the edit sends. The route is imported for real
// with its server edges mocked (auth, prisma, the report helpers), so this
// runs the handler's own branching; the patch validator is the real one.

import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "owner-1";
const COLLEAGUE = "colleague-2";
const ORG = "org-1";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  privateOwnerId: null as string | null,
  callerCanRead: true,
  writes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/item-gate", () => ({
  itemCtx: async () => ({ userId: "owner-1", organizationId: "org-1", accessLevel: "EMPLOYEE" }),
}));
vi.mock("@/lib/dashboards/dashboard-server", () => ({ requireWorkApp: async () => ({ ok: true }) }));
vi.mock("@/lib/list-links-server", () => ({
  recipientRows: async (ids: string[], organizationId: string) =>
    ids.map((id) => ({ id, organizationId, deletedAt: null, status: "ACTIVE", orgRole: "MEMBER", accessLevel: "EMPLOYEE" })),
  viewerIsOrgAdmin: () => false,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reportSchedule: {
      findFirst: async () => state.row,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        state.writes.push(data);
        state.row = { ...state.row, ...data };
        return { count: 1 };
      },
    },
  },
}));
vi.mock("@/lib/reports/report-server", () => ({
  canEditSchedule: () => true,
  // What THIS caller can read: null models an org admin who is not the
  // private view's owner. Privacy must never depend on it.
  readableTarget: async () => (state.callerCanRead ? { name: "List: View", link: "/boards/x?view=v", privateOwnerId: state.privateOwnerId } : null),
  // Privacy from the view row itself, whoever asks.
  privateViewOwner: async () => state.privateOwnerId,
  specOf: (r: Record<string, unknown>) => ({
    cadence: r.cadence,
    weekday: r.weekday,
    monthDay: r.monthDay,
    timeOfDay: r.timeOfDay,
    timezone: r.timezone,
  }),
  toScheduleDTOs: async (rows: Array<Record<string, unknown>>) => rows.map((r) => ({ recipientUserIds: r.recipientUserIds, active: r.active })),
  withReportTable: (fn: () => Promise<Response>) => fn(),
}));

import { PATCH } from "@/app/api/report-schedules/[id]/route";

const UPDATED = "2026-09-25T10:00:00.000Z";

function patch(body: Record<string, unknown>) {
  const req = new Request("http://test/api/report-schedules/s1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: UPDATED, ...body }),
  });
  return PATCH(req, { params: Promise.resolve({ id: "s1" }) });
}

beforeEach(() => {
  state.row = {
    id: "s1",
    organizationId: ORG,
    createdById: OWNER,
    targetKind: "view",
    targetId: "v1",
    cadence: "daily",
    weekday: null,
    monthDay: null,
    timeOfDay: "09:00",
    timezone: "UTC",
    recipientUserIds: [OWNER, COLLEAGUE],
    active: true,
    nextRunAt: new Date("2026-09-26T09:00:00.000Z"),
    updatedAt: new Date(UPDATED),
  };
  // Scheduled while shared, then the view was made private.
  state.privateOwnerId = OWNER;
  state.callerCanRead = true;
  state.writes = [];
});

describe("PATCH a schedule on a view that went private", () => {
  it("pauses, leaving the stored list alone", async () => {
    const res = await patch({ active: false });
    expect(res.status).toBe(200);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({ active: false, nextRunAt: null, recipientUserIds: [OWNER, COLLEAGUE] });
  });

  it("saves a timing-only edit and trims the list to the owner", async () => {
    const res = await patch({ timeOfDay: "11:00" });
    expect(res.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ timeOfDay: "11:00", recipientUserIds: [OWNER], active: true });
    const body = (await res.json()) as { schedule: { recipientUserIds: string[] } };
    expect(body.schedule.recipientUserIds).toEqual([OWNER]);
  });

  it("resumes a paused schedule to the owner only", async () => {
    state.row = { ...state.row, active: false, nextRunAt: null };
    const res = await patch({ active: true });
    expect(res.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ active: true, recipientUserIds: [OWNER] });
  });

  it("saves the owner-only list the form sends after Send only to me", async () => {
    const res = await patch({ recipientUserIds: [OWNER] });
    expect(res.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ recipientUserIds: [OWNER] });
  });

  it("still refuses a list that names anyone but the owner", async () => {
    const res = await patch({ recipientUserIds: [OWNER, COLLEAGUE] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "private_view_recipients" });
    expect(state.writes).toHaveLength(0);
  });

  it("refuses to keep sending when trimming would leave nobody", async () => {
    state.row = { ...state.row, recipientUserIds: [COLLEAGUE] };
    const res = await patch({ timeOfDay: "11:00" });
    expect(res.status).toBe(400);
    expect(state.writes).toHaveLength(0);
    // Pausing that same schedule still works.
    expect((await patch({ active: false })).status).toBe(200);
  });

  it("holds an org admin who cannot read the private view to owner only", async () => {
    state.callerCanRead = false;
    state.row = { ...state.row, recipientUserIds: [OWNER] };
    const res = await patch({ recipientUserIds: [COLLEAGUE, "admin-3"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "private_view_recipients" });
    expect(state.writes).toHaveLength(0);
    // A timing edit from that admin still trims to the owner.
    state.row = { ...state.row, recipientUserIds: [OWNER, COLLEAGUE] };
    const ok = await patch({ timeOfDay: "11:00" });
    expect(ok.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ recipientUserIds: [OWNER] });
  });

  it("leaves a shared view's recipients untouched", async () => {
    state.privateOwnerId = null;
    const res = await patch({ timeOfDay: "11:00" });
    expect(res.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ recipientUserIds: [OWNER, COLLEAGUE] });
  });
});
