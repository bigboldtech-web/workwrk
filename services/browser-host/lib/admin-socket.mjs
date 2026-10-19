// @ts-check
// The admin socket (docs/plans/browser-host.md 6.4 and 8.4): drain, undrain
// and status, for root's maintenance job.
//
// /run/workwrk-browser-host/admin.sock in container mode (<state dir>/admin.sock
// in process mode), mode 0600, owned by the host's own user. One JSON object
// a line, { op }, answered by { ok, result | error }.
//
//   drain     creates refused (503 draining); running sessions go on
//   undrain   creates again
//   status    { running, starting, held }
//
// Anything else is refused and counted. It answers codes and counts only.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const LINE_MAX = 4096;

/**
 * @param {{
 *   path: string,
 *   sessions: Pick<import("./sessions.mjs").Sessions, "drain" | "undrain" | "status">,
 *   log: import("./log.mjs").Log,
 * }} o
 */
export function createAdminSocket(o) {
  const tally = { refused: 0 };

  /** @param {unknown} line */
  function answer(line) {
    let msg;
    try {
      msg = JSON.parse(String(line));
    } catch {
      tally.refused += 1;
      return { ok: false, error: "bad_request" };
    }
    const op = msg && typeof msg === "object" && !Array.isArray(msg) ? msg.op : null;
    const extra = msg && typeof msg === "object" ? Object.keys(msg).filter((k) => k !== "op" && k !== "id") : [];
    const id = msg && typeof msg === "object" && (typeof msg.id === "number" || typeof msg.id === "string") ? msg.id : undefined;
    const reply = (/** @type {Record<string, unknown>} */ r) => (id === undefined ? r : { id, ...r });
    if (extra.length > 0) {
      tally.refused += 1;
      return reply({ ok: false, error: "unknown_field" });
    }
    if (op === "drain") {
      o.sessions.drain();
      o.log.event("admin", "drain");
      return reply({ ok: true });
    }
    if (op === "undrain") {
      o.sessions.undrain();
      o.log.event("admin", "undrain");
      return reply({ ok: true });
    }
    if (op === "status") {
      const s = o.sessions.status();
      return reply({ ok: true, result: { running: s.running, starting: s.starting, held: s.held } });
    }
    tally.refused += 1;
    return reply({ ok: false, error: "unknown_op" });
  }

  const server = net.createServer((conn) => {
    let buf = "";
    conn.setEncoding("utf8");
    conn.on("data", (d) => {
      buf += d;
      if (buf.length > LINE_MAX) {
        conn.destroy();
        return;
      }
      let at;
      while ((at = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        if (line.trim()) conn.write(`${JSON.stringify(answer(line))}\n`);
      }
    });
    conn.on("error", () => undefined);
  });

  return {
    answer,
    tally: () => ({ ...tally }),
    /** Listen, the socket's mode 0600 before it is announced. */
    listen() {
      return /** @type {Promise<void>} */ (
        new Promise((resolve, reject) => {
          fs.mkdirSync(path.dirname(o.path), { recursive: true, mode: 0o700 });
          try {
            // A socket the last run left: nobody listens on it.
            fs.rmSync(o.path, { force: true });
          } catch {
            /* none */
          }
          server.once("error", reject);
          server.listen(o.path, () => {
            try {
              fs.chmodSync(o.path, 0o600);
            } catch (err) {
              reject(err);
              return;
            }
            resolve();
          });
        })
      );
    },
    close() {
      return /** @type {Promise<void>} */ (
        new Promise((resolve) => {
          server.close(() => {
            try {
              fs.rmSync(o.path, { force: true });
            } catch {
              /* gone */
            }
            resolve();
          });
        })
      );
    },
  };
}
