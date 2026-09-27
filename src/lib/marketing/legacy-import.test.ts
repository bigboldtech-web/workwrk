import { beforeEach, describe, expect, it, vi } from "vitest";

// The importer and the Settings > Data counts against a workspace where some
// migrated tasks sit in Trash. The database is an in-memory stand-in and the
// product's creators are mocked, so each run is the rule it is: a legacy row
// whose task is in Trash, deleted or archived, is moved and never gets a
// second task, and only a row no task names is written.
//
// The workspace: four campaigns (one live, one deleted to Trash, one
// archived, one never moved), one content piece whose task went to Trash
// with its List, and one event whose task went to Trash as a subtask before
// its row was marked (the crash window, then a delete).

type Row = { id: string; organizationId: string; customFields: Record<string, unknown>; [k: string]: unknown };
type Task = { id: string; organizationId: string; boardId: string; startAt: Date | null; dueAt: Date | null; metadata: Record<string, unknown>; archivedAt: Date | null };

// vi.mock factories run before this file's own top level, so everything they
// reach is built inside vi.hoisted.
const { ORG, ACTOR, ZONE, db, seed, createBoardItem, prismaMock } = vi.hoisted(() => {
  const ORG = "org1";
  const ACTOR = "u1";
  const ZONE = "America/New_York";
  const created = new Date("2026-01-05T10:00:00.000Z");
  const prov = (kind: string, id: string, extra: Record<string, unknown> = {}) => ({ legacyMarketing: { kind, id, ...extra } });

  const db: { campaigns: Row[]; content: Row[]; events: Row[]; items: Task[]; trash: Array<{ organizationId: string; entityType: string; entityId: string; snapshot: unknown }> } = {
    campaigns: [],
    content: [],
    events: [],
    items: [],
    trash: [],
  };

  function campaign(id: string, customFields: Record<string, unknown>, dates: { startDate?: Date | null; endDate?: Date | null } = {}): Row {
    return {
      id, organizationId: ORG, customFields, name: `Campaign ${id}`, description: null, status: "ACTIVE", channel: null, budget: null, spent: null, currency: "USD",
      startDate: dates.startDate ?? null, endDate: dates.endDate ?? null, ownerId: null, goalMetric: null, goalTarget: null, goalActual: null, utmCampaign: null, workspaceId: null, createdAt: created,
    };
  }

  function seed(opts: { liveZone?: string } = {}) {
    const feb1 = new Date("2026-02-01T00:00:00.000Z");
    db.campaigns = [
      // Its task holds the start date verbatim, as an early run wrote it.
      campaign("cmp_live", { migratedItemId: "it_live" }, { startDate: feb1 }),
      campaign("cmp_deleted", { migratedItemId: "it_deleted" }),
      campaign("cmp_archived", { migratedItemId: "it_archived" }),
      campaign("cmp_new", {}),
    ];
    db.content = [{
      id: "cnt_in_list", organizationId: ORG, customFields: { migratedItemId: "it_in_list" }, title: "Case study", type: "CASE_STUDY", status: "IDEA", channel: null, ownerId: null, authorId: null,
      briefUrl: null, draftUrl: null, publishedUrl: null, scheduledFor: null, publishedAt: null, campaignId: null, notes: null, workspaceId: null, createdAt: created,
    }];
    db.events = [{
      id: "evt_unmarked", organizationId: ORG, customFields: {}, name: "Summit", description: null, type: null, format: null, startDate: null, endDate: null, location: null, capacity: null,
      registeredCount: null, attendedCount: null, budget: null, spent: null, status: "PLANNING", ownerId: null, campaignId: null, url: null, notes: null, workspaceId: null, createdAt: created,
    }];
    db.items = [
      { id: "it_live", organizationId: ORG, boardId: "b_campaigns", startAt: feb1, dueAt: null, metadata: prov("campaigns", "cmp_live", opts.liveZone ? { dateZone: opts.liveZone } : {}), archivedAt: null },
      { id: "it_archived", organizationId: ORG, boardId: "b_campaigns", startAt: null, dueAt: null, metadata: prov("campaigns", "cmp_archived"), archivedAt: new Date("2026-09-01T00:00:00.000Z") },
    ];
    db.trash = [
      { organizationId: ORG, entityType: "item", entityId: "it_deleted", snapshot: { row: { id: "it_deleted", boardId: "b_campaigns", metadata: prov("campaigns", "cmp_deleted") }, children: { subtasks: [], listLinks: [] } } },
      { organizationId: ORG, entityType: "board", entityId: "b_old", snapshot: { row: { id: "b_old" }, children: { items: [{ id: "it_in_list", metadata: prov("content", "cnt_in_list") }], views: [], members: [], listLinks: [] } } },
      { organizationId: ORG, entityType: "item", entityId: "it_parent", snapshot: { row: { id: "it_parent", metadata: {} }, children: { subtasks: [{ id: "it_sub", metadata: prov("events", "evt_unmarked") }], listLinks: [] } } },
      // Another org's trashed task naming the same row is never this org's.
      { organizationId: "org2", entityType: "item", entityId: "it_other", snapshot: { row: { id: "it_other", metadata: prov("campaigns", "cmp_new") }, children: {} } },
    ];
  }

  const inIds = (where: { id?: { in?: string[] } }) => (where.id?.in ? new Set(where.id.in) : null);

  function rowsTable(key: "campaigns" | "content" | "events") {
    return {
      count: vi.fn(async () => db[key].length),
      findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string } }) => db[key].find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null),
      findMany: vi.fn(async () => db[key].map((r) => ({ ...r }))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { customFields: Record<string, unknown> } }) => {
        const row = db[key].find((r) => r.id === where.id)!;
        row.customFields = data.customFields;
        return row;
      }),
    };
  }

  const itemUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Task> }) => {
    const t = db.items.find((i) => i.id === where.id)!;
    Object.assign(t, data);
    return t;
  });
  // The jsonb_set of the provenance zone, played on the stand-in.
  const executeRaw = vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const zone = values.find((v) => typeof v === "string" && v.includes("/")) as string;
    const itemId = values.find((v) => typeof v === "string" && db.items.some((i) => i.id === v)) as string;
    const t = db.items.find((i) => i.id === itemId);
    if (t) (t.metadata.legacyMarketing as Record<string, unknown>).dateZone = zone;
    return 1;
  });
  const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("pg_try_advisory_xact_lock")) return [{ locked: true }];
    if (sql.includes("TrashItem")) {
      const org = values[0];
      return db.trash.filter((t) => t.organizationId === org && ["item", "board", "folder", "space"].includes(t.entityType)).map((t) => ({ entityType: t.entityType, snapshot: t.snapshot }));
    }
    throw new Error(`unexpected raw query: ${sql}`);
  });

  const createBoardItem = vi.fn(async (input: { organizationId: string; boardId: string; startAt: Date | null; dueAt: Date | null; metadata: Record<string, unknown> }) => {
    const id = `it_created_${createBoardItem.mock.calls.length}`;
    db.items.push({ id, organizationId: input.organizationId, boardId: input.boardId, startAt: input.startAt, dueAt: input.dueAt, metadata: input.metadata, archivedAt: null });
    return { id };
  });

  const prismaMock = {
    organization: { findUnique: vi.fn(async () => ({ name: "Acme", settings: { currency: "USD" } })) },
    workSchedule: { findUnique: vi.fn(async () => null) },
    office: { findFirst: vi.fn(async () => null) },
    template: {
      findFirst: vi.fn(async () => ({
        payload: { lists: ["Campaigns", "Content", "Events"].map((name) => ({ name, statuses: [{ value: "PLANNING" }], fields: [{ key: "x", type: "TEXT" }] })) },
      })),
    },
    user: { findFirst: vi.fn(async () => ({ id: ACTOR })), findMany: vi.fn(async () => [{ id: ACTOR }]) },
    space: { findFirst: vi.fn(async () => ({ id: "sp1", slug: "marketing", archivedAt: null })) },
    board: {
      findMany: vi.fn(async () => (["campaigns", "content", "events"] as const).map((k) => ({ id: `b_${k}`, slug: k, settings: { legacyKind: k }, archivedAt: null }))),
    },
    campaign: rowsTable("campaigns"),
    contentItem: rowsTable("content"),
    eventBrief: rowsTable("events"),
    item: {
      findMany: vi.fn(async ({ where }: { where: { organizationId: string; id?: { in?: string[] }; boardId?: { in?: string[] } } }) => {
        const ids = inIds(where);
        const boards = where.boardId?.in ? new Set(where.boardId.in) : null;
        return db.items.filter((i) => i.organizationId === where.organizationId && (!ids || ids.has(i.id)) && (!boards || boards.has(i.boardId))).map((i) => ({ ...i }));
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string } }) => db.items.find((i) => i.id === where.id && i.organizationId === where.organizationId) ?? null),
      count: vi.fn(async ({ where }: { where: { organizationId: string; id?: { in?: string[] } } }) => {
        const ids = inIds(where);
        return db.items.filter((i) => i.organizationId === where.organizationId && (!ids || ids.has(i.id))).length;
      }),
      update: itemUpdate,
    },
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: unknown) => Promise<unknown>)({ $queryRaw: queryRaw });
    }),
  };

  return { ORG, ACTOR, ZONE, db, seed, createBoardItem, prismaMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/preferences", () => ({ getEffectivePreferences: vi.fn(async () => ({ home: { locale: { timezone: ZONE } } })) }));
vi.mock("@/lib/space", () => ({ createSpace: vi.fn(async () => { throw new Error("the Space exists; none is built"); }) }));
vi.mock("@/lib/template-center", () => ({ applyListTemplate: vi.fn(async () => { throw new Error("the Lists exist; none is built"); }) }));
vi.mock("@/lib/board-items", () => ({ createBoardItem: (input: Parameters<typeof createBoardItem>[0]) => createBoardItem(input) }));

import { importLegacyMarketing, migratedCampaignItem, pendingLegacyMarketing } from "./legacy-import";

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe("a legacy row whose task is in Trash", () => {
  it("is counted as moved on the Data page, not as waiting for Import", async () => {
    const p = await pendingLegacyMarketing(ORG, ZONE);
    expect(p.toWrite).toEqual({ campaigns: 1, content: 0, events: 0 });
    expect(p.trashed).toEqual({ campaigns: 2, content: 1, events: 1 });
    // The live task's verbatim start date still waits to be anchored.
    expect(p.toRedate).toBe(1);
  });

  it("is never written again: the dry run and the write make one task, for the one row no task names", async () => {
    const dry = await importLegacyMarketing({ organizationId: ORG, actorId: ACTOR, write: false });
    expect(dry.kinds.campaigns).toMatchObject({ read: 4, alreadyMigrated: 1, trashed: 2, written: 1, relinked: 0 });
    expect(dry.kinds.content).toMatchObject({ read: 1, alreadyMigrated: 0, trashed: 1, written: 0 });
    expect(dry.kinds.events).toMatchObject({ read: 1, alreadyMigrated: 0, trashed: 1, written: 0 });
    expect(createBoardItem).not.toHaveBeenCalled();

    const run = await importLegacyMarketing({ organizationId: ORG, actorId: ACTOR, write: true });
    expect(run.error).toBeUndefined();
    expect(run.verified).toBe(true);
    expect(createBoardItem).toHaveBeenCalledTimes(1);
    expect(createBoardItem.mock.calls[0][0]).toMatchObject({ boardId: "b_campaigns", title: "Campaign cmp_new" });
    expect(run.kinds.campaigns.written).toBe(1);
    expect(run.kinds.content.written + run.kinds.events.written).toBe(0);
    // The event that lost its mark gets it back, naming the task in Trash.
    expect(db.events[0].customFields).toEqual({ migratedItemId: "it_sub" });
    // The trashed rows keep the marks they had.
    expect(db.campaigns.find((c) => c.id === "cmp_deleted")!.customFields).toEqual({ migratedItemId: "it_deleted" });

    // Idempotent: a second write has nothing left to do.
    createBoardItem.mockClear();
    const again = await importLegacyMarketing({ organizationId: ORG, actorId: ACTOR, write: true });
    expect(createBoardItem).not.toHaveBeenCalled();
    expect(again.kinds.campaigns).toMatchObject({ alreadyMigrated: 2, trashed: 2, written: 0 });
  });

  it("sends /marketing/{id} to the Trash notice, not to the import", async () => {
    await expect(migratedCampaignItem(ORG, "cmp_deleted")).resolves.toEqual({ exists: true, itemId: null, trashed: true });
    await expect(migratedCampaignItem(ORG, "cmp_archived")).resolves.toEqual({ exists: true, itemId: null, trashed: true });
  });
});

describe("the re-date of an earlier run's task", () => {
  it("writes the zone with the dates, so a later run in another zone leaves the task alone", async () => {
    const run = await importLegacyMarketing({ organizationId: ORG, actorId: ACTOR, write: true });
    expect(run.kinds.campaigns.redated).toBe(1);
    const live = db.items.find((i) => i.id === "it_live")!;
    expect(live.startAt?.toISOString()).toBe("2026-02-01T05:00:00.000Z");
    expect(live.metadata.legacyMarketing).toMatchObject({ dateZone: ZONE });
    await expect(pendingLegacyMarketing(ORG, "Asia/Kolkata")).resolves.toMatchObject({ toRedate: 0 });
  });

  it("never moves a task an earlier run anchored where midnight is midnight", async () => {
    seed({ liveZone: "UTC" });
    const p = await pendingLegacyMarketing(ORG, ZONE);
    expect(p.toRedate).toBe(0);
    const run = await importLegacyMarketing({ organizationId: ORG, actorId: ACTOR, write: false });
    expect(run.kinds.campaigns.redated).toBe(0);
  });
});
