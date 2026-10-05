import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Local uploads live in storage/uploads, outside public/, where Next served
// them by itself (by decoded path, past every header rule and rewrite). Files
// written before the move are read from public/uploads until moved.
// The module reads process.cwd() when it loads, so it is imported only after
// the working directory points at a scratch folder.
const root = mkdtempSync(path.join(tmpdir(), "uploads-test-"));
const realCwd = process.cwd;
const REPO = path.resolve(__dirname, "../..");
let m: typeof import("./local-uploads");
beforeAll(async () => {
  process.cwd = () => root;
  m = await import("./local-uploads");
});

const put = (dir: string, name: string, body: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), body);
};

beforeEach(() => {
  rmSync(path.join(root, "storage"), { recursive: true, force: true });
  rmSync(path.join(root, "public"), { recursive: true, force: true });
});
afterAll(() => {
  process.cwd = realCwd;
  rmSync(root, { recursive: true, force: true });
});

describe("local uploads", () => {
  it("are written outside public/", async () => {
    expect(m.UPLOADS_DIR).toBe(path.join(root, "storage", "uploads"));
    expect(path.relative(path.join(root, "public"), await m.uploadsDirForWrite()).startsWith("..")).toBe(true);
    expect(existsSync(m.UPLOADS_DIR)).toBe(true);
  });

  it("are read from storage first, then from public/uploads for one not moved yet", async () => {
    put(m.LEGACY_UPLOADS_DIR, "logo-o-1.png", "old");
    expect((await m.readUpload("logo-o-1.png"))?.toString()).toBe("old");
    put(m.UPLOADS_DIR, "logo-o-1.png", "new");
    expect((await m.readUpload("logo-o-1.png"))?.toString()).toBe("new");
    expect(await m.readUpload("../secret")).toBeNull();
    expect(await m.readUpload(".env")).toBeNull();
  });

  it("are deleted from both places and listed once", async () => {
    put(m.LEGACY_UPLOADS_DIR, "a.png", "x");
    put(m.UPLOADS_DIR, "a.png", "x");
    put(m.UPLOADS_DIR, "b.png", "y");
    expect((await m.listUploads()).sort()).toEqual(["a.png", "b.png"]);
    expect(await m.deleteUpload("a.png")).toBe(true);
    expect(existsSync(path.join(m.LEGACY_UPLOADS_DIR, "a.png")) || existsSync(path.join(m.UPLOADS_DIR, "a.png"))).toBe(false);
    expect(await m.deleteUpload("missing.png")).toBe(false);
  });

  it("move across without overwriting anything, and leave what they cannot move", async () => {
    put(m.LEGACY_UPLOADS_DIR, "file-o-1.svg", "<svg/>");
    put(m.LEGACY_UPLOADS_DIR, "same.png", "same");
    put(m.UPLOADS_DIR, "same.png", "same");
    put(m.LEGACY_UPLOADS_DIR, "clash.png", "legacy bytes");
    put(m.UPLOADS_DIR, "clash.png", "newer bytes");
    put(m.LEGACY_UPLOADS_DIR, ".hidden", "h");
    mkdirSync(path.join(m.LEGACY_UPLOADS_DIR, "nested"));
    expect(await m.moveLegacyUploads()).toEqual({ moved: 2, left: 3 });
    expect(readFileSync(path.join(m.UPLOADS_DIR, "file-o-1.svg"), "utf8")).toBe("<svg/>");
    // A name held by different bytes keeps both copies as they were.
    expect(readFileSync(path.join(m.UPLOADS_DIR, "clash.png"), "utf8")).toBe("newer bytes");
    expect(readFileSync(path.join(m.LEGACY_UPLOADS_DIR, "clash.png"), "utf8")).toBe("legacy bytes");
    expect(readdirSync(m.LEGACY_UPLOADS_DIR).sort()).toEqual([".hidden", "clash.png", "nested"]);
    // Nothing to do the second time.
    expect(await m.moveLegacyUploads()).toEqual({ moved: 0, left: 3 });
  });
});

describe("nothing writes a person's file into public/ again", () => {
  it("has no route or library joining public and uploads but local-uploads itself", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "generated" && e.name !== "node_modules") walk(p); continue; }
        if (!/\.(ts|tsx|mjs)$/.test(e.name) || /\.test\./.test(e.name) || p.endsWith(path.join("lib", "local-uploads.ts"))) continue;
        const s = readFileSync(p, "utf8");
        if (/["']public["']\s*,\s*["']uploads["']|public\/uploads\//.test(s.replace(/\/\/.*$/gm, ""))) hits.push(path.relative(REPO, p));
      }
    };
    walk(path.join(REPO, "src"));
    walk(path.join(REPO, "scripts"));
    expect(hits).toEqual([]);
  });
});

