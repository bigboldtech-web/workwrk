// Pictures of pages (src/lib/browser/shots.ts, Decision 23): sealed files
// outside the database, read back only by their person in their workspace
// before they expire, at most 20 a session, and swept with their files, and
// files no row names, by the cron.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({ shots: [] as Array<Record<string, unknown>>, finds: 0 }));

vi.mock("@/lib/prisma", () => {
  const cmp = (v: unknown) => (v instanceof Date ? v.getTime() : (v as string));
  const where = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, c]) => {
      if (c && typeof c === "object" && !(c instanceof Date)) {
        const cond = c as { in?: unknown[]; gt?: Date | string; lte?: Date };
        if (cond.in) return cond.in.includes(r[k]);
        if (cond.gt !== undefined) return cmp(r[k]) > cmp(cond.gt);
        if (cond.lte) return (r[k] as Date).getTime() <= cond.lte.getTime();
      }
      return r[k] === c;
    });
  const byId = (rows: Row[], orderBy?: Row) => (orderBy?.id === "asc" ? [...rows].sort((x, y) => String(x.id).localeCompare(String(y.id))) : rows);
  return {
    prisma: {
      teammateBrowserShot: {
        count: async (a: { where: Row }) => st.shots.filter((r) => where(r, a.where)).length,
        create: async (a: { data: Row }) => {
          st.shots.push({ ...a.data });
          return a.data;
        },
        findFirst: async (a: { where: Row }) => st.shots.find((r) => where(r, a.where)) ?? null,
        findMany: async (a: { where: Row; take?: number; orderBy?: Row }) => {
          st.finds += 1;
          return byId(st.shots.filter((r) => where(r, a.where)), a.orderBy).slice(0, a.take ?? Infinity);
        },
        aggregate: async (a: { where: Row }) => {
          const hit = st.shots.filter((r) => where(r, a.where));
          return { _sum: { bytes: hit.length ? hit.reduce((n, r) => n + Number(r.bytes ?? 0), 0) : null } };
        },
        updateMany: async (a: { where: Row; data: Row }) => {
          const hit = st.shots.filter((r) => where(r, a.where));
          for (const r of hit) Object.assign(r, a.data);
          return { count: hit.length };
        },
        deleteMany: async (a: { where: Row }) => {
          const before = st.shots.length;
          st.shots = st.shots.filter((r) => !where(r, a.where));
          return { count: before - st.shots.length };
        },
      },
    },
  };
});

import { deleteShotsOfSessions, readShot, resetShotScanForTests, saveShot, sweepShots } from "./shots";

const GB = 1024 ** 3;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("a picture of a page with a code 482913")]);
const ROW = { id: "bs1", organizationId: "org1", userId: "u-max" };
let dir = "";

/** A disk with this much free of this much (statfs), so no test depends on the machine's own. */
function disk(freeBytes: number, totalBytes = 500 * GB) {
  const bsize = 4096;
  return vi.spyOn(fs, "statfs").mockResolvedValue({ type: 0, bsize, blocks: Math.floor(totalBytes / bsize), bfree: Math.floor(freeBytes / bsize), bavail: Math.floor(freeBytes / bsize), files: 0, ffree: 0 } as never);
}

beforeEach(async () => {
  st.shots = [];
  st.finds = 0;
  resetShotScanForTests();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wk-shots-test-"));
  process.env.BROWSER_SHOTS_DIR = dir;
  process.env.SECRETS_ENCRYPTION_KEY = "7".repeat(64);
  delete process.env.BROWSER_SHOTS_MAX_BYTES;
  vi.spyOn(console, "error").mockImplementation(() => {});
  disk(200 * GB);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.BROWSER_SHOTS_DIR;
  delete process.env.BROWSER_SHOTS_MAX_BYTES;
});

describe("saveShot and readShot", () => {
  it("keeps a sealed file, mode 0600, with no JPEG bytes in the clear, and reads it back for its person", async () => {
    const id = await saveShot({ row: ROW, kind: "element", jpeg: JPEG, width: 600, height: 400 });
    expect(id).toMatch(/^sh[0-9a-f]{32}$/);
    const file = path.join(dir, `${id}.wks`);
    const raw = await fs.readFile(file);
    expect(raw.subarray(0, 4).toString("ascii")).toBe("wks1");
    expect(raw.includes(Buffer.from([0xff, 0xd8]))).toBe(false);
    expect(raw.includes(Buffer.from("482913"))).toBe(false);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await readShot(id!, { userId: "u-max", organizationId: "org1" })).toEqual(JPEG);
    expect(st.shots[0]).toMatchObject({ id, browserSessionId: "bs1", kind: "element", width: 600, height: 400, bytes: JPEG.length });
    const kept = st.shots[0] as { createdAt: Date; expiresAt: Date };
    expect(kept.expiresAt.getTime() - kept.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("reads as nothing for another person, another workspace, once expired, or for an id that is not one", async () => {
    const id = (await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 1280, height: 800 }))!;
    expect(await readShot(id, { userId: "u-olivia", organizationId: "org1" })).toBeNull();
    expect(await readShot(id, { userId: "u-max", organizationId: "org2" })).toBeNull();
    expect(await readShot("../../etc/passwd", { userId: "u-max", organizationId: "org1" })).toBeNull();
    (st.shots[0] as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1000);
    expect(await readShot(id, { userId: "u-max", organizationId: "org1" })).toBeNull();
  });

  it("keeps at most 20 a session, none too big or not a JPEG, and none without a folder", async () => {
    for (let i = 0; i < 20; i++) expect(await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 })).not.toBeNull();
    expect(await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 })).toBeNull();
    expect(await saveShot({ row: { ...ROW, id: "bs2" }, kind: "page", jpeg: Buffer.concat([JPEG, Buffer.alloc(600_001)]), width: 10, height: 10 })).toBeNull();
    expect(await saveShot({ row: { ...ROW, id: "bs2" }, kind: "page", jpeg: Buffer.from("not a jpeg"), width: 10, height: 10 })).toBeNull();
    delete process.env.BROWSER_SHOTS_DIR;
    expect(await saveShot({ row: { ...ROW, id: "bs2" }, kind: "page", jpeg: JPEG, width: 10, height: 10 })).toBeNull();
  });
});

describe("sweepShots and deleteShotsOfSessions", () => {
  it("deletes expired pictures with their files, and files no row names once an hour old", async () => {
    const keep = (await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 }))!;
    const old = (await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 }))!;
    (st.shots.find((s) => s.id === old) as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1);
    const orphan = path.join(dir, `sh${"a".repeat(32)}.wks`);
    const young = path.join(dir, `sh${"b".repeat(32)}.wks`);
    const stray = path.join(dir, "notes.txt");
    await fs.writeFile(orphan, "x");
    await fs.writeFile(young, "x");
    await fs.writeFile(stray, "x");
    const hourAgo = new Date(Date.now() - 61 * 60 * 1000);
    await fs.utimes(orphan, hourAgo, hourAgo);
    await fs.utimes(stray, hourAgo, hourAgo);
    await fs.utimes(path.join(dir, `${keep}.wks`), hourAgo, hourAgo);
    expect(await sweepShots(new Date())).toEqual({ expired: 1, orphans: 1 });
    const left = (await fs.readdir(dir)).sort();
    expect(left).toEqual([`${keep}.wks`, "notes.txt", `sh${"b".repeat(32)}.wks`].sort());
    expect(st.shots.map((s) => s.id)).toEqual([keep]);
  });

  it("deletes every picture of a person's sessions, files and rows", async () => {
    const a = (await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 }))!;
    await saveShot({ row: { ...ROW, id: "bs-other", userId: "u-olivia" }, kind: "page", jpeg: JPEG, width: 10, height: 10 });
    expect(await deleteShotsOfSessions(["bs1"])).toBe(1);
    expect(st.shots.map((s) => s.browserSessionId)).toEqual(["bs-other"]);
    await expect(fs.stat(path.join(dir, `${a}.wks`))).rejects.toThrow();
  });
});

// Review round 1 of Phase 4.
describe("the disk is the database's too (review round 1 of Phase 4)", () => {
  const logged = () => vi.mocked(console.error).mock.calls.map((c) => c.join(" "));

  it("writes nothing when the disk would be left under the larger of 10 GB and a tenth free, saying so by its code", async () => {
    // 12 GB free of 500: under a tenth (50 GB).
    disk(12 * GB);
    expect(await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 })).toBeNull();
    // 9 GB free of 50: under 10 GB.
    disk(9 * GB, 50 * GB);
    expect(await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 })).toBeNull();
    // A disk that cannot be read refuses too.
    vi.spyOn(fs, "statfs").mockRejectedValue(Object.assign(new Error("no"), { code: "ENOSYS" }));
    expect(await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 })).toBeNull();
    // Before: written whatever the disk held.
    expect(await fs.readdir(dir)).toEqual([]);
    expect(st.shots).toEqual([]);
    expect(logged()).toEqual(["[browser] picture not kept: disk_low", "[browser] picture not kept: disk_low", "[browser] picture not kept: disk_unknown"]);
    // 60 GB free of 500: kept.
    disk(60 * GB);
    expect(await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 })).not.toBeNull();
  });

  it("keeps the deployment's pictures not yet expired within BROWSER_SHOTS_MAX_BYTES", async () => {
    process.env.BROWSER_SHOTS_MAX_BYTES = String(Math.floor(JPEG.length * 2.5));
    expect(await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 })).not.toBeNull();
    expect(await saveShot({ row: { ...ROW, id: "bs2" }, kind: "page", jpeg: JPEG, width: 10, height: 10 })).not.toBeNull();
    // Before: written past any budget.
    expect(await saveShot({ row: { ...ROW, id: "bs3" }, kind: "page", jpeg: JPEG, width: 10, height: 10 })).toBeNull();
    expect(logged()).toContain("[browser] picture not kept: budget");
    // An expired one no longer counts.
    (st.shots[0] as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1);
    expect(await saveShot({ row: { ...ROW, id: "bs3" }, kind: "page", jpeg: JPEG, width: 10, height: 10 })).not.toBeNull();
  });
});

describe("a file never outlives its row's delete unseen (review round 1 of Phase 4)", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
  async function aged(file: string, h: number) {
    await fs.utimes(file, hoursAgo(h), hoursAgo(h));
  }

  it("keeps a row whose file could not be deleted, made expired, and deletes both on a later sweep", async () => {
    const id = (await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 }))!;
    const file = path.join(dir, `${id}.wks`);
    // A file that will not go: a folder where it was.
    await fs.rm(file);
    await fs.mkdir(file);
    (st.shots[0] as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1);
    expect(await sweepShots(new Date())).toMatchObject({ expired: 0 });
    // Before: the row was deleted, and nothing ever tried the file again.
    expect(st.shots.map((s) => s.id)).toEqual([id]);
    await fs.rmdir(file);
    expect(await sweepShots(new Date())).toMatchObject({ expired: 1 });
    expect(st.shots).toEqual([]);
  });

  it("keeps an erased person's picture rows, expired, while there is no folder to delete their files from", async () => {
    await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 });
    delete process.env.BROWSER_SHOTS_DIR;
    expect(await deleteShotsOfSessions(["bs1"])).toBe(0);
    expect(st.shots).toHaveLength(1);
    expect((st.shots[0] as { expiresAt: Date }).expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    // Not shown any more, whatever its 24 hours said.
    process.env.BROWSER_SHOTS_DIR = dir;
    expect(await readShot(String(st.shots[0].id), { userId: "u-max", organizationId: "org1" })).toBeNull();
  });

  it("deletes no expired row while there is no folder", async () => {
    await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 });
    (st.shots[0] as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1);
    delete process.env.BROWSER_SHOTS_DIR;
    // Before: every expired row deleted, its sealed file kept for good.
    expect(await sweepShots(new Date())).toEqual({ expired: 0, orphans: 0 });
    expect(st.shots).toHaveLength(1);
  });

  it("deletes a picture file past its 24 hours and one more, whatever the database says", async () => {
    const id = (await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 }))!;
    const young = (await saveShot({ row: ROW, kind: "page", jpeg: JPEG, width: 10, height: 10 }))!;
    await aged(path.join(dir, `${id}.wks`), 26);
    await aged(path.join(dir, `${young}.wks`), 23);
    // Its row still says it is kept (a clock moved, a row written late).
    expect(await sweepShots(new Date())).toEqual({ expired: 0, orphans: 1 });
    expect(await fs.readdir(dir)).toEqual([`${young}.wks`]);
  });

  it("looks at most scanMax files a tick, going on from where it stopped, so an orphan behind kept pictures is found", async () => {
    const kept: string[] = [];
    for (let i = 0; i < 4; i++) kept.push((await saveShot({ row: { ...ROW, id: `bs${i}` }, kind: "page", jpeg: JPEG, width: 10, height: 10 }))!);
    const orphan = `sh${"f".repeat(32)}.wks`;
    await fs.writeFile(path.join(dir, orphan), "x");
    for (const name of await fs.readdir(dir)) await aged(path.join(dir, name), 2);
    const stat = vi.spyOn(fs, "stat");
    const seen: number[] = [];
    let found = 0;
    for (let tick = 0; tick < 3 && found === 0; tick++) {
      stat.mockClear();
      found = (await sweepShots(new Date(), { scanMax: 2 })).orphans;
      seen.push(stat.mock.calls.length);
    }
    // Before: every file looked at in one tick, past any cap.
    expect(seen.every((n) => n <= 2)).toBe(true);
    expect(found).toBe(1);
    expect((await fs.readdir(dir)).sort()).toEqual(kept.map((k) => `${k}.wks`).sort());
  });
});
