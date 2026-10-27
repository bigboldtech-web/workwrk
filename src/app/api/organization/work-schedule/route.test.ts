// GET and PUT /api/organization/work-schedule (settings-cleanup Phase 5
// review, H1, the route's half): a read that fails is never answered as the
// defaults, a PUT never merges over defaults standing in for a failed read,
// and a PUT whose `base` is no longer the record writes nothing (409). The
// one forgiving case stays: no table yet (P2021) still answers the defaults,
// so a release ahead of its SQL file never breaks a Workload grid.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORK_SCHEDULE_CHANGED, WORK_SCHEDULE_DEFAULTS, WORK_SCHEDULE_READ_FAILED, type WorkSchedule } from "@/lib/work-schedule";

const st = vi.hoisted(() => ({
  /** What findUnique answers, or throws when it is an Error or a coded object. */
  row: null as null | Record<string, unknown>,
  readThrows: null as unknown,
  upserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workSchedule: {
      findUnique: async () => {
        if (st.readThrows) throw st.readThrows;
        return st.row;
      },
      upsert: async (a: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        st.upserts.push(a.update);
        return { ...a.update };
      },
    },
  },
}));
vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u1", organizationId: "org1" } } }),
  getOrgId: () => "org1",
  getUserId: () => "u1",
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/access/settings-write", () => ({ settingsWriteGate: async () => ({ ok: true }), sessionMayEditSettings: () => true }));
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));

import { GET, PUT } from "./route";

/** A four-day week, as the row holds it (the Decimal read back as a number). */
const ROW = { workdays: [1, 2, 3, 4], hoursPerDay: 7.5, timezone: "Europe/London", holidays: [{ date: "2026-09-23", name: "Founders Day" }] };
const REAL: WorkSchedule = { workdays: [1, 2, 3, 4], hoursPerDay: 7.5, timezone: "Europe/London", holidays: [{ date: "2026-09-23", name: "Founders Day" }] };
const put = (body: unknown) => PUT(new NextRequest("http://x/api/organization/work-schedule", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  st.row = { ...ROW };
  st.readThrows = null;
  st.upserts = [];
});

describe("GET: a failed read is an error, never the defaults", () => {
  it("answers 503 when the query fails, and still the defaults only when the table is not there yet", async () => {
    st.readThrows = new Error("Can't reach database server");
    const failed = await GET();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: WORK_SCHEDULE_READ_FAILED });

    // The one forgiving case is unchanged: no table (P2021) or column (P2022) yet.
    for (const code of ["P2021", "P2022"]) {
      st.readThrows = Object.assign(new Error("missing"), { code });
      const r = await GET();
      expect(r.status, code).toBe(200);
      expect(await r.json()).toEqual({ schedule: WORK_SCHEDULE_DEFAULTS, configured: false, canEdit: true });
    }
    // And a real row is the record.
    st.readThrows = null;
    expect(await (await GET()).json()).toEqual({ schedule: REAL, configured: true, canEdit: true });
  });
});

describe("PUT: nothing is written over a record it did not read", () => {
  it("a failed read of the record writes nothing (503), rather than merging the body over the defaults", async () => {
    st.readThrows = new Error("timeout");
    const r = await put({ holidays: [] });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain("Nothing was saved.");
    expect(st.upserts).toEqual([]);
  });

  it("a base that is not the record (the defaults a card never really read) is refused with 409 and nothing is written", async () => {
    const r = await put({ ...WORK_SCHEDULE_DEFAULTS, base: WORK_SCHEDULE_DEFAULTS });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: WORK_SCHEDULE_CHANGED });
    expect(st.upserts).toEqual([]);
    // Another admin's change since this card read: refused too.
    const stale = await put({ ...REAL, hoursPerDay: 6, base: { ...REAL, hoursPerDay: 8 } });
    expect(stale.status).toBe(409);
    expect(st.upserts).toEqual([]);

    // The base it read saves, and `base` itself is never stored.
    const good = await put({ ...REAL, hoursPerDay: 6, base: REAL });
    expect(good.status).toBe(200);
    expect(st.upserts).toEqual([{ workdays: [1, 2, 3, 4], hoursPerDay: 6, timezone: "Europe/London", holidays: REAL.holidays }]);
    // A value the card holds un-normalised (7.333 typed, the column keeps 7.33) is still the record it read.
    st.row = { ...ROW, hoursPerDay: 7.33 };
    expect((await put({ ...REAL, hoursPerDay: 7, base: { ...REAL, hoursPerDay: 7.333 } })).status).toBe(200);
    // An older client that sends no base keeps the old behaviour.
    expect((await put({ holidays: [] })).status).toBe(200);
    expect(st.upserts.at(-1)).toEqual({ workdays: [1, 2, 3, 4], hoursPerDay: 7.33, timezone: "Europe/London", holidays: [] });
  });

  it("with no row yet, the defaults ARE the record, so a first save over them goes through", async () => {
    st.row = null;
    const r = await put({ ...REAL, base: WORK_SCHEDULE_DEFAULTS });
    expect(r.status).toBe(200);
    expect(st.upserts).toHaveLength(1);
    // And a base claiming a week that is not there is refused.
    expect((await put({ ...REAL, base: REAL })).status).toBe(409);
    expect(st.upserts).toHaveLength(1);
  });
});
