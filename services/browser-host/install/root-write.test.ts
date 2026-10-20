// Root's writes on the browser server (step 3 review, H1): only into
// folders root owns, never through a link, the mode set on the descriptor.
// Run in a scratch folder owned by this user, standing in for root.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONTAINER_FIREWALL_OK, CONTAINER_VERSIONS_FILE } from "../lib/config.mjs";
import { FIREWALL_FILE, FIREWALL_OK } from "../lib/firewall.mjs";
import { PATHS } from "./firewall-check.mjs";
import { MAINT_PATHS } from "./maint.mjs";
import { HOST_OWNED_DIRS, openExclusive, ROOT_DIRS, writeRootFile } from "./root-write.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const me = process.getuid?.() ?? 0;
let dir = "";
let outside = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wkb-rw-"));
  fs.chmodSync(dir, 0o755);
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "wkb-rw-target-"));
  fs.writeFileSync(path.join(outside, "sudoers"), "root ALL=(ALL) ALL\n", { mode: 0o440 });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
const target = () => path.join(outside, "sudoers");
const targetUntouched = () => {
  expect(fs.readFileSync(target(), "utf8")).toBe("root ALL=(ALL) ALL\n");
  expect(fs.statSync(target()).mode & 0o777).toBe(0o440);
};

describe("writeRootFile", () => {
  it("writes the whole file with its mode set", () => {
    const p = path.join(dir, "firewall.ok");
    writeRootFile(p, "2026-10-21T04:00:00.000Z\n", 0o644, { owner: me });
    expect(fs.readFileSync(p, "utf8")).toBe("2026-10-21T04:00:00.000Z\n");
    expect(fs.statSync(p).mode & 0o777).toBe(0o644);
    expect(fs.existsSync(`${p}.tmp`)).toBe(false);
  });

  it("never writes or chmods through a link planted as its temporary file", () => {
    const p = path.join(dir, "firewall.ok");
    fs.symlinkSync(target(), `${p}.tmp`);
    writeRootFile(p, "x\n", 0o644, { owner: me });
    targetUntouched();
    expect(fs.lstatSync(p).isFile()).toBe(true);
  });

  it("replaces a link planted as the file itself, never following it", () => {
    const p = path.join(dir, "versions.json");
    fs.symlinkSync(target(), p);
    writeRootFile(p, "{}\n", 0o644, { owner: me });
    targetUntouched();
    expect(fs.lstatSync(p).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(p, "utf8")).toBe("{}\n");
  });

  it("refuses a folder that is a link, owned by another user, or writable by others", () => {
    const linked = path.join(dir, "linked");
    fs.symlinkSync(outside, linked);
    expect(() => writeRootFile(path.join(linked, "sudoers"), "x", 0o644, { owner: me })).toThrow("root_write_not_a_dir");
    targetUntouched();
    expect(() => writeRootFile(path.join(dir, "a"), "x", 0o644, { owner: me + 1 })).toThrow("root_write_dir_owner");
    fs.chmodSync(dir, 0o777);
    expect(() => writeRootFile(path.join(dir, "a"), "x", 0o644, { owner: me })).toThrow("root_write_dir_writable");
  });

  it("refuses the host's own folders outright", () => {
    for (const h of HOST_OWNED_DIRS) expect(() => writeRootFile(`${h}/firewall.ok`, "x", 0o644)).toThrow("root_write_host_folder");
  });

  it("opens only a new file that is no link (O_CREAT, O_EXCL, O_NOFOLLOW)", () => {
    const p = path.join(dir, "race.tmp");
    fs.symlinkSync(target(), p);
    expect(() => openExclusive(p, 0o644)).toThrow();
    fs.rmSync(p);
    fs.writeFileSync(p, "already");
    expect(() => openExclusive(p, 0o644)).toThrow();
    targetUntouched();
  });
});

describe("no root writer targets a folder wkbhost owns", () => {
  const ownedByHost = (p: string) => HOST_OWNED_DIRS.some((h) => p === h || p.startsWith(`${h}/`));

  it("the firewall's files and the maintenance job's versions live in root's folders", () => {
    for (const p of [PATHS.file, PATHS.savedDir, PATHS.ok, MAINT_PATHS.versions, FIREWALL_FILE, FIREWALL_OK]) {
      expect({ p, host: ownedByHost(p) }).toEqual({ p, host: false });
      expect(Object.values(ROOT_DIRS).some((r) => p === r || p.startsWith(`${r}/`))).toBe(true);
    }
    // And the host reads them where they are written.
    expect(CONTAINER_FIREWALL_OK).toBe(PATHS.ok);
    expect(CONTAINER_VERSIONS_FILE).toBe(MAINT_PATHS.versions);
  });

  it("the root scripts write only through writeRootFile, and install.sh never writes into the host's folders", () => {
    for (const f of ["firewall-check.mjs", "maint.mjs"]) {
      const t = fs.readFileSync(path.join(HERE, f), "utf8");
      expect({ f, raw: /writeFileSync|chmodSync|renameSync/.test(t) }).toEqual({ f, raw: false });
      expect(t).toContain("writeRootFile(p, text,");
    }
    const install = fs.readFileSync(path.join(HERE, "install.sh"), "utf8");
    expect(install).not.toMatch(/>\s*"?\$STATE/);
    expect(install).not.toMatch(/>\s*"?\/var\/lib\/workwrk-browser-host/);
    expect(install).not.toMatch(/>\s*"?\/run\/workwrk-browser-host/);
  });
});
