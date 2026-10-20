// @ts-check
// The browser launcher service (docs/plans/browser-host.md 5.5 and 8.3,
// Decision 19): the only part of the host that touches Docker.
//
// It runs as wkblaunch, in the docker group, with no network at all
// (PrivateNetwork=yes, AF_UNIX only). It answers the ten fixed operations
// of ops.mjs, one JSON object a line, on /run/workwrk-browser-launcher/launcher.sock,
// mode 0660, owned by wkblaunch:wkbhost, so only the host's user (and root)
// can open it. systemd makes that socket (workwrk-browser-launcher.socket,
// SocketUser, SocketGroup and SocketMode) and hands it over, so the launcher
// never needs to be in the host's group to give it the socket.
//
// Its fixed settings: the seccomp profile from /etc/workwrk-browser-host
// (the install's copy of container/chrome-seccomp.json), the committed
// Dockerfile and the image's start (container/wkb-start) beside this folder, and BROWSER_HOST_SESSION_MEMORY_MB from
// host.env (1024 to 4096, 1280 by default), the same S the host's max uses.
// It logs codes, durations and counts only.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createLog } from "../lib/log.mjs";
import { createDockerApi } from "./docker-api.mjs";
import { createOps } from "./ops.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The installed seccomp profile (8.2 step 5). */
export const SECCOMP_PATH = "/etc/workwrk-browser-host/chrome-seccomp.json";
const LINE_MAX = 64 * 1024;

/**
 * The session memory the launcher gives each container, as the host reads it.
 * @param {string | undefined} raw
 * @returns {number | null}
 */
export function sessionMemoryMb(raw) {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return 1280;
  if (!/^\d{4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1024 && n <= 4096 ? n : null;
}

/**
 * The seccomp profile, checked as JSON and written compactly, as SecurityOpt carries it.
 * @param {string} text
 */
export function compactSeccomp(text) {
  const p = JSON.parse(text);
  if (!p || p.defaultAction !== "SCMP_ACT_ERRNO" || !Array.isArray(p.syscalls)) throw new Error("seccomp_profile");
  return JSON.stringify(p);
}

/**
 * Serve the operations on a listening server: one line in, one line out, in order of arrival.
 * @param {net.Server} server
 * @param {ReturnType<typeof createOps>} ops
 */
export function serve(server, ops) {
  server.on("connection", (conn) => {
    let buf = "";
    conn.setEncoding("utf8");
    conn.on("error", () => undefined);
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
        if (!line.trim()) continue;
        // Handed to the operations in the order the lines came; answers go back as each settles, matched by id.
        void ops.handle(line).then((reply) => {
          if (!conn.destroyed) conn.write(`${JSON.stringify(reply)}\n`);
        });
      }
    });
  });
}

/** Start the service. */
async function main() {
  const log = createLog({ tag: "launcher" });
  const memoryMb = sessionMemoryMb(process.env.BROWSER_HOST_SESSION_MEMORY_MB);
  if (memoryMb === null) {
    log.event("refused", "session_memory");
    process.exit(1);
  }
  let seccomp;
  try {
    seccomp = compactSeccomp(fs.readFileSync(SECCOMP_PATH, "utf8"));
  } catch {
    log.event("refused", "seccomp_profile");
    process.exit(1);
  }
  const dockerfile = fs.readFileSync(path.join(HERE, "..", "container", "Dockerfile"));
  const startScript = fs.readFileSync(path.join(HERE, "..", "container", "wkb-start"));
  const ops = createOps({ engine: createDockerApi(), seccomp, memoryMb, dockerfile, startScript, log });
  const server = net.createServer();
  serve(server, ops);
  // systemd's socket (LISTEN_FDS), never a path of our own choosing in production.
  if (process.env.LISTEN_FDS === "1" && Number(process.env.LISTEN_PID) === process.pid) {
    server.listen({ fd: 3 });
  } else {
    log.event("refused", "no_socket");
    process.exit(1);
  }
  log.event("start", { memory_mb: memoryMb });
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

/** Whether this file is the entry point. */
function isEntry() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(String(process.argv[1]))).href;
  } catch {
    return false;
  }
}
if (isEntry()) void main();
