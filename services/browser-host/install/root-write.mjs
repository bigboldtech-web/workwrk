// @ts-check
// Every file root writes on the browser server, written safely
// (docs/plans/browser-host.md 5.4 and 8.4; step 3 review, H1).
//
// ROOT WRITES ONLY INTO FOLDERS ROOT OWNS: /run/workwrk-browser-firewall
// (the firewall's file, its saved listing and firewall.ok) and
// /var/lib/workwrk-browser-maint (versions.json). Never into the host's own
// folders (/var/lib/workwrk-browser-host, /run/workwrk-browser-host), which
// wkbhost owns: a compromised host could plant a link there, and root would
// write or chmod whatever it points to. The host only reads these files.
//
// EACH WRITE, whatever the folder:
//   - the folder must be a real directory (not a link), owned by root, and
//     writable by nobody else; one made here is made 0755;
//   - the temporary file is unlinked, then opened O_CREAT | O_EXCL |
//     O_NOFOLLOW (a link put there in between makes the open fail);
//   - its mode is set on the open descriptor (fchmod), never by path;
//   - it is synced, then renamed over the file, which replaces a link there
//     rather than following it.

import fs from "node:fs";
import path from "node:path";

/** The root-owned folders root writes into. */
export const ROOT_DIRS = Object.freeze({ firewall: "/run/workwrk-browser-firewall", maint: "/var/lib/workwrk-browser-maint" });
/** The folders wkbhost owns, which root never writes into. */
export const HOST_OWNED_DIRS = Object.freeze(["/var/lib/workwrk-browser-host", "/run/workwrk-browser-host"]);

/**
 * A folder root may write into: made 0755 when missing, then checked to be a
 * real directory owned by `owner` (root) that nobody else can write.
 * @param {string} dir
 * @param {number} owner
 */
export function checkedDir(dir, owner) {
  try {
    fs.mkdirSync(dir, { mode: 0o755 });
  } catch (err) {
    if (!(err && /** @type {NodeJS.ErrnoException} */ (err).code === "EEXIST")) throw new Error("root_write_no_dir");
  }
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("root_write_not_a_dir");
  if (st.uid !== owner) throw new Error("root_write_dir_owner");
  if ((st.mode & 0o022) !== 0) throw new Error("root_write_dir_writable");
}

/**
 * Open a new file that must not exist and must not be a link.
 * @param {string} p
 * @param {number} mode
 * @returns {number} the descriptor
 */
export function openExclusive(p, mode) {
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
  return fs.openSync(p, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode);
}

/**
 * Write a whole file as root, safely (see the header).
 * @param {string} p
 * @param {string} text
 * @param {number} mode
 * @param {{ owner?: number }} [o] the folder's owner; root, but for the tests
 */
export function writeRootFile(p, text, mode, o = {}) {
  const dir = path.dirname(p);
  if (HOST_OWNED_DIRS.some((h) => dir === h || dir.startsWith(`${h}/`))) throw new Error("root_write_host_folder");
  checkedDir(dir, o.owner ?? 0);
  const tmp = `${p}.tmp`;
  try {
    fs.unlinkSync(tmp);
  } catch {
    // None there.
  }
  const fd = openExclusive(tmp, mode);
  try {
    fs.writeSync(fd, text);
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
}
