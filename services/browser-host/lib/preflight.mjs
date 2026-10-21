// @ts-check
// Container mode's preflight (docs/plans/browser-host.md Decision 2, 5.2,
// 5.4 and 8.5): what must hold on the server before any browser starts,
// checked at start and every minute. Each failure is a refusal code; the
// host refuses creates while any holds, and /healthz answers 503, since each
// needs a person:
//
//   postgres_listener   something listens on 5432 or 5433 (/proc/net/tcp, tcp6)
//   app_listener        something listens on 3000
//   postgres_process    a process named postgres
//   app_process         a process named next-server
//   apparmor_profile    the workwrk-browser profile is not loaded
//   daemon_config       /etc/docker/daemon.json is missing or unreadable
//   daemon_ipv6         IPv6 is on in the daemon
//   firewall_stale      firewall.ok is missing or over 10 minutes old    (problem firewall_unchecked)
//   launcher_socket     the launcher does not answer                     (problem launcher_unreachable)
//   runc_below_floor    runc is older than RUNC_FLOOR                    (problem preflight)
//   swap_on             /proc/swaps lists a swap area                    (problem preflight)
//   swap_unreadable     /proc/swaps cannot be read                       (problem preflight)
//
// SWAP (final privacy review, M3): a browser's memory holds the pages a
// person sees and what they type, and swap would write it to the disk, where
// it outlives the session. The install turns swap off for good; the host
// refuses to start a browser while any swap area is on, or while it cannot
// tell.
//
// The browser server never shares a machine with the database or the app
// (Decision 2); the install refuses the same at step 1.
//
// The files are read through the passed-in deps, so the tests read none.

/** The ports of a Postgres (5432, and the deploy notes' tunnel 5433) and of the app. */
export const FORBIDDEN_PORTS = Object.freeze({ 5432: "postgres_listener", 5433: "postgres_listener", 3000: "app_listener" });
/** How old firewall.ok may be (5.4: the check runs every 5 minutes). */
export const FIREWALL_OK_MAX_MS = 10 * 60_000;
/**
 * The oldest runc a session may run on (8.5): 1.3.3 fixes CVE-2025-31133,
 * CVE-2025-52565 and CVE-2025-52881. The lead raises it when a newer escape
 * is fixed (scripts/browser-provider-smoke.ts holds the same floor).
 */
export const RUNC_FLOOR = "1.3.3";

/** Where each check reads. */
export const PREFLIGHT_PATHS = Object.freeze({
  tcp: Object.freeze(["/proc/net/tcp", "/proc/net/tcp6"]),
  proc: "/proc",
  apparmor: "/sys/kernel/security/apparmor/policy/profiles",
  daemon: "/etc/docker/daemon.json",
  swaps: "/proc/swaps",
});

/**
 * The swap areas /proc/swaps lists (its first line is the header), or null when it cannot be read.
 * @param {string | null} text
 * @returns {number | null}
 */
export function swapAreas(text) {
  if (text === null) return null;
  return String(text)
    .split("\n")
    .slice(1)
    .filter((l) => l.trim()).length;
}

/**
 * @typedef {{
 *   readFile: (p: string) => string | null,
 *   listDir: (p: string) => string[] | null,
 *   now: () => number,
 *   firewallOk: string,
 *   versions: () => Promise<{ runc?: string | null } | null>,
 * }} PreflightDeps
 */

/**
 * The ports something listens on, from /proc/net/tcp or tcp6.
 * @param {string | null} text
 * @returns {Set<number>}
 */
export function listeningPorts(text) {
  const out = new Set();
  for (const line of String(text ?? "").split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || parts[3] !== "0A") continue;
    const port = parseInt(parts[1].split(":").at(-1) ?? "", 16);
    if (Number.isInteger(port)) out.add(port);
  }
  return out;
}

/**
 * Whether a version is at least the floor ("v1.3.4", "1.3.3-0ubuntu1" and "1.3.3" read alike).
 * @param {unknown} v
 * @param {string} floor
 */
export function versionAtLeast(v, floor) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(typeof v === "string" ? v : "");
  if (!m) return false;
  const a = m.slice(1).map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/**
 * The time firewall.ok holds, or null.
 * @param {string | null} text
 */
export function firewallOkAt(text) {
  const t = Date.parse(String(text ?? "").trim());
  return Number.isFinite(t) ? t : null;
}

/**
 * Every refusal that holds now (see the header), sorted.
 * @param {PreflightDeps} deps
 * @returns {Promise<string[]>}
 */
export async function preflight(deps) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const p of PREFLIGHT_PATHS.tcp) {
    for (const port of listeningPorts(deps.readFile(p))) {
      const code = FORBIDDEN_PORTS[/** @type {keyof typeof FORBIDDEN_PORTS} */ (port)];
      if (code) out.add(code);
    }
  }
  for (const pid of deps.listDir(PREFLIGHT_PATHS.proc) ?? []) {
    if (!/^\d+$/.test(pid)) continue;
    const comm = (deps.readFile(`${PREFLIGHT_PATHS.proc}/${pid}/comm`) ?? "").trim();
    const argv0 = (deps.readFile(`${PREFLIGHT_PATHS.proc}/${pid}/cmdline`) ?? "").split("\0")[0] ?? "";
    if (comm === "postgres" || /(^|\/)postgres$/.test(argv0)) out.add("postgres_process");
    if (comm.startsWith("next-server") || argv0.startsWith("next-server")) out.add("app_process");
  }
  const profiles = deps.listDir(PREFLIGHT_PATHS.apparmor);
  if (!profiles || !profiles.some((p) => /^workwrk-browser\.\d+$/.test(p))) out.add("apparmor_profile");
  const daemon = deps.readFile(PREFLIGHT_PATHS.daemon);
  /** @type {any} */
  let conf = null;
  try {
    conf = daemon === null ? null : JSON.parse(daemon);
  } catch {
    conf = null;
  }
  if (!conf || typeof conf !== "object") out.add("daemon_config");
  else if (conf.ipv6 !== false) out.add("daemon_ipv6");
  const ok = firewallOkAt(deps.readFile(deps.firewallOk));
  if (ok === null || deps.now() - ok > FIREWALL_OK_MAX_MS) out.add("firewall_stale");
  let versions = null;
  try {
    versions = await deps.versions();
  } catch {
    versions = null;
  }
  if (!versions) out.add("launcher_socket");
  else if (!versionAtLeast(versions.runc, RUNC_FLOOR)) out.add("runc_below_floor");
  const swaps = swapAreas(deps.readFile(PREFLIGHT_PATHS.swaps));
  if (swaps === null) out.add("swap_unreadable");
  else if (swaps > 0) out.add("swap_on");
  return [...out].sort();
}

/**
 * The /health problems the refusals raise (3.2): the firewall and the launcher by their own codes, the rest as preflight.
 * @param {readonly string[]} refusals
 */
export function problemsOf(refusals) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const r of refusals) out.add(r === "firewall_stale" ? "firewall_unchecked" : r === "launcher_socket" ? "launcher_unreachable" : "preflight");
  return [...out];
}
