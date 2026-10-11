// Pictures of pages (src/lib/browser/shots.ts, Decision 23): sealed files
// outside the database, read back only by their person in their workspace
// before they expire, at most 20 a session, and swept with their files, and
// files no row names, by the cron.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({ shots: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/prisma", () => {
  const where = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, c]) => {
      if (c && typeof c === "object" && !(c instanceof Date)) {
        const cond = c as { in?: unknown[]; gt?: Date; lte?: Date };
        if (cond.in) return cond.in.includes(r[k]);
        if (cond.gt) return (r[k] as Date).getTime() > cond.gt.getTime();
        if (cond.lte) return (r[k] as Date).getTime() <= cond.lte.getTime();
      }
      return r[k] === c;
    });
  return {
    prisma: {
      teammateBrowserShot: {
        count: async (a: { where: Row }) => st.shots.filter((r) => where(r, a.where)).length,
        create: async (a: { data: Row }) => {
          st.shots.push({ ...a.data });
          return a.data;
        },
        findFirst: async (a: { where: Row }) => st.shots.find((r) => where(r, a.where)) ?? null,
        findMany: async (a: { where: Row; take?: number }) => st.shots.filter((r) => where(r, a.where)).slice(0, a.take ?? Infinity),
        deleteMany: async (a: { where: Row }) => {
          const before = st.shots.length;
          st.shots = st.shots.filter((r) => !where(r, a.where));
          return { count: before - st.shots.length };
        },
      },
    },
  };
});

import { deleteShotsOfSessions, readShot, saveShot, sweepShots } from "./shots";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("a picture of a page with a code 482913")]);
const ROW = { id: "bs1", organizationId: "org1", userId: "u-max" };
let dir = "";

beforeEach(async () => {
  st.shots = [];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wk-shots-test-"));
  process.env.BROWSER_SHOTS_DIR = dir;
  process.env.SECRETS_ENCRYPTION_KEY = "7".repeat(64);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.BROWSER_SHOTS_DIR;
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
