// @ts-check
// The server isolation proof (docs/plans/browser-host.md 12.3, Decision 4):
// the firewall proven at the network layer, where Chrome cannot hide a gap,
// and Chrome's own layer proven apart, labelled as Chrome's.
//
// IT RUNS ONLY as root on the browser server, against its host in container
// mode on http://127.0.0.1:8789, and refuses anywhere else with a message
// saying why (exit 2). Run by the lead, after the Founder actions, from a
// root shell (sudo -i), with the key in that shell for this run only:
//
//   mkdir -p /opt/workwrk-browser-host/current/proof
//   install -m 0644 <checkout>/services/browser-host/proof/isolation.mjs /opt/workwrk-browser-host/current/proof/
//   read -rs BROWSER_HOST_KEY && export BROWSER_HOST_KEY
//   node /opt/workwrk-browser-host/current/main.mjs isolation-proof
//     (add --stop-host to stop the host even with browsers open on it)
//   reboot
//   (a root shell again, the key read again)
//   node /opt/workwrk-browser-host/current/main.mjs isolation-proof --after-reboot
//   rm -r /opt/workwrk-browser-host/current/proof; unset BROWSER_HOST_KEY
//
// The first run stops the host once (the Caddy check below), which ends
// every session on the server. So it stops it only when /health says no
// browser is open, starting or held once its own two are released; else it
// fails that check and leaves the host running, unless run with
// --stop-host. Before the stop it arms a dead-man switch (systemd-run, 180
// seconds) that starts the host again whatever happens to this process, and
// cancels it once the host is started. Ctrl-C, SIGTERM and a dropped SSH
// session (SIGHUP) run the same cleanup as the end of a run, then exit.
// The key is sent only in a header from this process, never in a command's
// arguments, and no token is either. It prints "N of M checks passed" and
// exits 1 on any failure.
//
// THE LISTENERS (a revision of 12.3's setup, by what the kernel does): a
// /32 on an interface of the host's own namespace is a local address, so a
// session's packet to it is delivered locally (the input hook, counted
// to_host) and never meets the forward rules the private ranges live in.
// So the eight listeners live in a network namespace of their own,
// wkbproof, joined to the host by a veth pair (wkbproof0 on the host,
// wkbproof1 inside), with a route a /32: a session reaching one is
// forwarded, as it would be to any real private address, and is refused as
// private. Each answers the host itself first (its positive control). The
// expected counter of every target is the hook its packet truly meets: a
// local address of the host is to_host, anything routed is judged by the
// forward rules (private, host, port, other_dns). 172.17.0.1 is to_host
// when docker0 holds it here, else private. The pair's own /30 is scope
// link, and lib/firewall.mjs leaves wkbproof* out of the host's addresses,
// so a firewall check during the proof never writes it into the table.
//
// A RELOAD DURING A PROBE (the 5-minute check, or the host's start running
// it) zeroes the counters. It is seen by the rule handles changing (a reload
// re-creates every rule), and that probe is run again on the new table.
// Chosen over stopping the check's timer by worst case: stopping it changes
// the production server, and a proof killed hard would leave it stopped, so
// firewall.ok would go stale and the host refuse every create 10 minutes
// later until a person noticed.
//
// THE NETWORK LAYER: every check runs from A's own network namespace
// (nsenter -t <A's pid> -n), with its positive control from the host's own.
// A refused target must fail within a second, by a reset or an ICMP
// refusal (never a hang), and raise the counter named for it (lib/firewall.mjs
// COUNTERS, read from nft -j list table inet workwrk_browsers), and no other
// counter the proof reads: session traffic is rejected, never dropped. Other
// sessions' traffic may move only the counters the proof does not read.
//
// CHROME'S OWN LAYER is a set of its own, from http://example.com/ on A (an
// http page, so mixed content is not what refuses), through the proof's
// own CDP client on A's connect address. Its loopback checks are labelled
// as what they are: the container's own loopback, not the host's.
//
// THEN the container (the launcher's probe, docker inspect, the memory
// cap), nothing kept (no container or network left; the host's own folders
// searched for the key, every token, every session id and the page's
// words while they still exist, its state folder, its runtime folders and
// the PrivateTmp of the host, the launcher and Caddy, which a stop wipes;
// then a Caddy proxy error forced while the host is stopped, then journald
// searched), and the firewall's listing saved for --after-reboot once the
// proof's own links are gone. --after-reboot checks the boot order, the
// listing against it, every rule once, and the network layer again. The
// listeners, their namespace, the pair and its routes are removed at the
// end, whatever happened, and their removal is checked.

import { spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import path from "node:path";

import WebSocket from "ws";

import { COUNTERS, listingMeaning, publicAddresses, TABLE } from "../lib/firewall.mjs";
import { parseSandbox } from "../lib/launcher-client.mjs";
import { DEVTOOLS_PORT } from "../lib/ranges.mjs";

/** The host's API, on the server itself (12.3). */
export const API = "http://127.0.0.1:8789";
export const HOST_ENV = "/etc/workwrk-browser-host/host.env";
export const FIREWALL_ENV = "/etc/workwrk-browser-host/firewall.env";
export const LAUNCHER_SOCKET = "/run/workwrk-browser-launcher/launcher.sock";
export const LOADED_LISTING = "/run/workwrk-browser-firewall/firewall.loaded.json";
/** The listing this proof saves before the reboot, root's alone. */
export const SAVED_LISTING = "/root/workwrk-isolation-proof.listing.json";
/** The host's state folder, searched for anything kept (12.3), with its runtime folders and PrivateTmp (searchRoots). */
export const SEARCHED = Object.freeze(["/var/lib/workwrk-browser-host"]);
/** The host's unit, which the proof stops once (the Caddy check). */
export const HOST_UNIT = "workwrk-browser-host.service";
/** The dead-man switch's transient unit, and how long it waits to start the host. */
export const DEADMAN_UNIT = "wkbproof-host-start";
export const DEADMAN_SECONDS = 180;
/** The counters the proof reads: a refusal may raise its own alone (other sessions may move the rest). */
export const USED_COUNTERS = Object.freeze(["private", "to_host", "host", "port", "other_dns", "devtools_other_user"]);

/** The listeners' namespace and the veth pair that joins it to the host. */
export const PROOF_NS = "wkbproof";
export const LINK_HOST = "wkbproof0";
export const LINK_PEER = "wkbproof1";
export const LISTENER_DEV = "wkbproofd";
/** The pair's own /30: the host's end, and the listeners' end. */
export const LINK = Object.freeze({ host: "169.254.255.1", peer: "169.254.255.2", prefix: 30 });
/** One listener in each blocked range of 12.3, each a /32. */
export const LISTENERS = Object.freeze(["10.77.0.1", "172.16.77.1", "192.168.77.1", "100.64.77.1", "169.254.77.1", "198.18.77.1", "192.0.2.77", "203.0.113.77"]);
export const METADATA = "169.254.169.254";
export const DOCKER0 = "172.17.0.1";
export const PUBLIC_V6 = "2606:4700:4700::1111";
/** Docker's embedded resolver, in every container's own namespace (5.4). */
export const DOCKER_DNS = "127.0.0.11";
/** A refusal is a reset or an ICMP refusal within this (12.3). */
export const REFUSE_MS = 1000;
/** Chrome's own DevTools listener on the container's loopback, behind the relay on 9222 (5.3). */
export const CHROME_PORT = 9223;
/** What a page on A allocates, to prove the memory cap (12.3). */
export const ALLOCATE_MB = 3072;

// ── Pure: reading what the tools print ──────────────────────────────

/**
 * A KEY=value line of an env file, or null.
 * @param {string | null} text
 * @param {string} key
 * @returns {string | null}
 */
export function envValue(text, key) {
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
    if (m && m[1] === key) return m[2].trim();
  }
  return null;
}

/**
 * Why the proof refuses to run here, or null when this is the browser
 * server in container mode with the key given.
 * @param {{ platform: string, uid: number | null, hostEnv: string | null, key: string, health: { status: number, mode: unknown } | null }} f
 * @returns {string | null}
 */
export function refusal(f) {
  if (f.platform !== "linux") return "this is not Linux, so it is not the browser server";
  if (f.uid !== 0) return "run it as root (sudo -i), on the browser server";
  if (f.hostEnv === null) return `there is no ${HOST_ENV}, so this is not the browser server`;
  if (envValue(f.hostEnv, "BROWSER_HOST_MODE") !== "container") return `${HOST_ENV} does not say BROWSER_HOST_MODE=container`;
  if (!f.key) return "BROWSER_HOST_KEY is not set: read it into this shell for this run only (read -rs BROWSER_HOST_KEY && export BROWSER_HOST_KEY)";
  if (!f.health) return `the host does not answer at ${API}/health`;
  if (f.health.status === 401) return "the host refused BROWSER_HOST_KEY (401)";
  if (f.health.status !== 200) return `the host's /health answered ${f.health.status}`;
  if (f.health.mode !== "container") return "the host here runs in process mode, not container mode";
  return null;
}

/** The message a refusal prints. @param {string} why */
export const refusalMessage = (why) => `The isolation proof runs only as root on the browser server, against its host in container mode (docs/plans/browser-host.md 12.3). Refused: ${why}.`;

/**
 * @typedef {{ code: number | null, stdout: string, stderr: string, ms: number }} Ran
 * @typedef {"answered" | "connected" | "refused" | "unreachable" | "timeout" | "no_name" | "failed"} Outcome
 */

/**
 * What a curl run says: answered (an HTTP answer), connected (TCP opened,
 * then TLS or HTTP failed), refused (a reset), unreachable (an ICMP
 * refusal, or no route), timeout (a hang), no_name, or failed.
 * @param {Ran} r
 * @returns {{ outcome: Outcome, http: number | null }}
 */
export function curlOutcome(r) {
  const err = r.stderr;
  if (r.code === 0) {
    const m = /(\d{3})\s*$/.exec(r.stdout.trim());
    return { outcome: "answered", http: m ? Number(m[1]) : null };
  }
  if (r.code === 28 || /timed out/i.test(err)) return { outcome: "timeout", http: null };
  if (r.code === 6) return { outcome: "no_name", http: null };
  if (/Connection refused/i.test(err)) return { outcome: "refused", http: null };
  if (/No route to host|Network is unreachable|Host is unreachable|Permission denied|Operation not permitted/i.test(err)) return { outcome: "unreachable", http: null };
  // TCP opened, then TLS or the HTTP answer failed: the listener was reached
  // (sshd's banner is "HTTP/0.9" to curl, exit 1; a weird reply is 8).
  if (r.code === 1 && /HTTP\/0\.9/.test(err)) return { outcome: "connected", http: null };
  if (r.code === 8 || r.code === 35 || r.code === 51 || r.code === 52 || r.code === 56 || r.code === 60) return { outcome: "connected", http: null };
  return { outcome: "failed", http: null };
}

/**
 * What a dig run says: answered (a reply with its status), refused (an
 * ICMP refusal or a reset), timeout (no reply), or failed.
 * @param {Ran} r
 * @returns {{ outcome: Outcome, status: string | null, answers: number }}
 */
export function digOutcome(r) {
  const text = `${r.stdout}\n${r.stderr}`;
  const status = /status:\s*([A-Z]+)/.exec(text)?.[1] ?? null;
  const answers = Number(/ANSWER:\s*(\d+)/.exec(text)?.[1] ?? 0);
  if (status) return { outcome: "answered", status, answers };
  if (/host unreachable|network unreachable|connection refused|unreachable/i.test(text)) return { outcome: "unreachable", status: null, answers: 0 };
  if (/timed out|no servers could be reached/i.test(text)) return { outcome: "timeout", status: null, answers: 0 };
  return { outcome: "failed", status: null, answers: 0 };
}

/** Whether an outcome is a refusal (12.3: a reset, or an ICMP refusal). @param {Outcome} o */
export const isRefusal = (o) => o === "refused" || o === "unreachable";
/** Whether an outcome reached the listener. @param {Outcome} o */
export const reached = (o) => o === "answered" || o === "connected";

/**
 * Every refusal counter of the table's listing, by its comment, with the
 * comments found more than once (a stacked rule) or not at all.
 * @param {unknown} listing nft -j list table inet workwrk_browsers
 * `generation` is the table's rule handles in order: a reload re-creates
 * every rule, so it changes, and the counters it zeroed are not compared.
 * @returns {{ values: Record<string, number>, twice: string[], missing: string[], rules: number, generation: string }}
 */
export function counterValues(listing) {
  const items = listing && typeof listing === "object" && Array.isArray(/** @type {any} */ (listing).nftables) ? /** @type {any[]} */ (/** @type {any} */ (listing).nftables) : null;
  if (!items) throw new Error("bad_listing");
  /** @type {Record<string, number>} */
  const values = {};
  /** @type {Record<string, number>} */
  const seen = {};
  let rules = 0;
  /** @type {string[]} */
  const handles = [];
  for (const item of items) {
    const rule = item && typeof item === "object" ? item.rule : null;
    if (!rule || typeof rule !== "object") continue;
    rules += 1;
    handles.push(`${String(rule.chain)}:${String(rule.handle)}`);
    const comment = typeof rule.comment === "string" ? rule.comment : null;
    if (!comment) continue;
    const counter = Array.isArray(rule.expr) ? rule.expr.find((/** @type {any} */ e) => e && typeof e === "object" && e.counter) : null;
    seen[comment] = (seen[comment] ?? 0) + 1;
    values[comment] = (values[comment] ?? 0) + (counter && Number.isFinite(counter.counter.packets) ? Number(counter.counter.packets) : 0);
  }
  return { values, twice: Object.keys(seen).filter((k) => seen[k] > 1), missing: COUNTERS.filter((c) => !(c in seen)), rules, generation: handles.join(",") };
}

/**
 * What a probe did to the counters: how much its own rose, and which other
 * counter the proof reads moved too (a refusal must raise its own alone).
 * @param {Record<string, number>} before
 * @param {Record<string, number>} after
 * @param {string} own
 * @returns {{ rose: number, others: string[] }}
 */
export function counterMoves(before, after, own) {
  const rose = (after[own] ?? 0) - (before[own] ?? 0);
  const others = USED_COUNTERS.filter((c) => c !== own && (after[c] ?? 0) !== (before[c] ?? 0));
  return { rose, others };
}

/**
 * The destinations of `ip -j route show`.
 * @param {unknown} ipJson
 * @returns {string[]}
 */
export function routeDestinations(ipJson) {
  return (Array.isArray(ipJson) ? ipJson : []).map((r) => (r && typeof r.dst === "string" ? r.dst.replace(/\/32$/, "") : "")).filter(Boolean);
}

/**
 * The host's own folders, searched for anything kept (12.3): its state
 * folder, every /run/workwrk-browser-* (the RuntimeDirectories), and the
 * PrivateTmp of the host, the launcher and Caddy (systemd's
 * /tmp/systemd-private-<boot>-<unit>-<random>). Never the rest of /tmp.
 * @param {readonly string[]} tmpEntries the names in /tmp
 * @param {readonly string[]} runEntries the names in /run
 * @returns {string[]}
 */
export function searchRoots(tmpEntries, runEntries) {
  const privateTmp = /^systemd-private-[0-9a-f]{32}-(workwrk-browser-host|workwrk-browser-launcher|caddy)\.service-[A-Za-z0-9]+$/;
  return [...SEARCHED, ...runEntries.filter((n) => n.startsWith("workwrk-browser-")).map((n) => `/run/${n}`), ...tmpEntries.filter((n) => privateTmp.test(n)).map((n) => `/tmp/${n}`)];
}

/**
 * The dead-man switch around the host's stop: a transient timer that
 * starts the host after DEADMAN_SECONDS whatever happens to the proof, and
 * its cancellation once the host is started again.
 */
export function deadmanCommands() {
  return {
    arm: ["systemd-run", `--unit=${DEADMAN_UNIT}`, `--on-active=${DEADMAN_SECONDS}`, "--timer-property=AccuracySec=1s", "/usr/bin/systemctl", "start", HOST_UNIT],
    cancel: ["systemctl", "stop", `${DEADMAN_UNIT}.timer`],
  };
}

/**
 * Why the host must not be stopped now: the browsers open on it, or null.
 * @param {any} health /health's answer
 * @param {boolean} forced --stop-host
 * @returns {string | null}
 */
export function stopRefusal(health, forced) {
  if (forced) return null;
  const running = Number(health?.running ?? NaN);
  const starting = Number(health?.starting ?? NaN);
  const held = Number(health?.held ?? NaN);
  if (![running, starting, held].every(Number.isFinite)) return "the host's /health did not say how many browsers are open, so it was not stopped; run again with --stop-host to stop it anyway";
  const open = running + starting + held;
  if (open === 0) return null;
  return `the host was not stopped: ${open} browser${open === 1 ? " is" : "s are"} open on it (running ${running}, starting ${starting}, held ${held}), and a stop would end ${open === 1 ? "it" : "them"}; run again when none is, or with --stop-host to end them`;
}

/**
 * What refused a page's websocket to DevTools, from what Chrome said about it.
 * @param {{ statuses: readonly number[], texts: readonly string[] }} seen the handshake answers and the console's lines
 * @returns {string}
 */
export function wsRefusedBy(seen) {
  const text = seen.texts.join("\n");
  if (seen.statuses.includes(403) || /\b403\b/.test(text)) return "Chrome's Origin check (its DevTools server answered 403)";
  if (/local network|private network|ERR_BLOCKED_BY_LOCAL_NETWORK|ERR_BLOCKED_BY_PRIVATE_NETWORK|address space/i.test(text)) return "Local Network Access (the request never reached the socket)";
  return `neither was seen${seen.texts[0] ? `: ${seen.texts[0].slice(0, 120)}` : ""}`;
}

/**
 * The rules that appear more than once in one chain, by meaning (no handle, counters at 0).
 * @param {unknown} listing
 * @returns {string[]}
 */
export function duplicateRules(listing) {
  const items = /** @type {any[]} */ (/** @type {any} */ (listing)?.nftables ?? []);
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const item of items) {
    if (!item?.rule) continue;
    const meaning = listingMeaning({ nftables: [{ rule: item.rule }] });
    seen.set(meaning, (seen.get(meaning) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([m]) => m.slice(0, 200));
}

/**
 * Every IPv4 address local to a namespace, from `ip -j -4 addr show`.
 * @param {unknown} ipJson
 * @returns {Set<string>}
 */
export function localAddresses(ipJson) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const link of Array.isArray(ipJson) ? ipJson : []) {
    for (const a of Array.isArray(link?.addr_info) ? link.addr_info : []) if (a && a.family === "inet" && typeof a.local === "string") out.add(a.local);
  }
  return out;
}

/**
 * The global IPv6 addresses `ip -6 addr` shows (12.3: there must be none).
 * @param {string} text
 * @returns {string[]}
 */
export function globalV6(text) {
  return [...String(text).matchAll(/inet6\s+([0-9a-f:]+)\/\d+\s+scope\s+global/gi)].map((m) => m[1]);
}

/**
 * A browser's id from /json/version's webSocketDebuggerUrl, or null.
 * @param {unknown} json
 */
export function browserIdOf(json) {
  const url = json && typeof json === "object" ? /** @type {any} */ (json).webSocketDebuggerUrl : null;
  const m = /\/devtools\/browser\/([0-9a-f-]{36})$/i.exec(typeof url === "string" ? url : "");
  return m ? m[1] : null;
}

/**
 * Bytes from docker stats' MemUsage ("1.21GiB / 1.25GiB"): the used part.
 * @param {string} text
 * @returns {number | null}
 */
export function statsBytes(text) {
  const m = /^\s*([\d.]+)\s*([KMGT]?i?B)\b/i.exec(String(text));
  if (!m) return null;
  const units = /** @type {Record<string, number>} */ ({ b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 });
  const k = units[m[2].toLowerCase()];
  return k ? Math.round(Number(m[1]) * k) : null;
}

/**
 * `systemctl show` output (Key=Value lines of one or more units, separated by blank lines), by Id.
 * @param {string} text
 * @returns {Record<string, Record<string, string>>}
 */
export function systemctlShow(text) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  for (const block of String(text).split(/\n\s*\n/)) {
    /** @type {Record<string, string>} */
    const kv = {};
    for (const line of block.split("\n")) {
      const at = line.indexOf("=");
      if (at > 0) kv[line.slice(0, at)] = line.slice(at + 1);
    }
    if (kv.Id) out[kv.Id] = kv;
  }
  return out;
}

/**
 * Whether the firewall unit became active before Docker began to start.
 * @param {Record<string, Record<string, string>>} units
 * @returns {{ ok: boolean, firewall: number, docker: number }}
 */
export function firewallBeforeDocker(units) {
  const fw = Number(units["workwrk-browser-firewall.service"]?.ActiveEnterTimestampMonotonic ?? 0);
  const dk = Number(units["docker.service"]?.InactiveExitTimestampMonotonic ?? 0);
  return { ok: fw > 0 && dk > 0 && fw <= dk, firewall: fw, docker: dk };
}

/**
 * The container checks of 12.3 on one docker inspect.
 * @param {any} ins docker inspect's object for A
 * @param {{ memoryMb: number, seccomp: string | null }} want the session memory and the installed profile's text
 * @returns {Array<{ name: string, ok: boolean, detail?: unknown }>}
 */
export function inspectChecks(ins, want) {
  const hc = ins?.HostConfig ?? {};
  const cfg = ins?.Config ?? {};
  const nets = ins?.NetworkSettings?.Networks ?? {};
  const netNames = Object.keys(nets);
  /** @type {string[]} */
  const sec = Array.isArray(hc.SecurityOpt) ? hc.SecurityOpt.map(String) : [];
  const seccompOpt = sec.find((s) => s.startsWith("seccomp="));
  /** @param {string} t */
  const json = (t) => {
    try {
      return JSON.stringify(JSON.parse(t));
    } catch {
      return null;
    }
  };
  const seccompSame = Boolean(seccompOpt && want.seccomp && json(seccompOpt.slice("seccomp=".length)) === json(want.seccomp));
  const cap = want.memoryMb * 1024 * 1024;
  const empty = (/** @type {unknown} */ v) => v === null || v === undefined || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && Object.keys(/** @type {object} */ (v)).length === 0);
  const sysctls = hc.Sysctls ?? {};
  return [
    { name: "ReadonlyRootfs true", ok: hc.ReadonlyRootfs === true },
    { name: "CapDrop [ALL] and CapAdd null", ok: JSON.stringify(hc.CapDrop) === '["ALL"]' && (hc.CapAdd === null || hc.CapAdd === undefined), detail: { CapDrop: hc.CapDrop, CapAdd: hc.CapAdd } },
    { name: "Privileged false", ok: hc.Privileged === false },
    { name: "SecurityOpt holds no-new-privileges", ok: sec.some((s) => /^no-new-privileges(:true)?$/.test(s)), detail: sec.filter((s) => !s.startsWith("seccomp=")) },
    { name: "SecurityOpt holds the installed seccomp profile", ok: seccompSame },
    { name: "SecurityOpt holds apparmor=workwrk-browser, and AppArmorProfile is workwrk-browser", ok: sec.includes("apparmor=workwrk-browser") && ins?.AppArmorProfile === "workwrk-browser", detail: ins?.AppArmorProfile },
    { name: `Memory and MemorySwap at the cap (${want.memoryMb} MiB)`, ok: hc.Memory === cap && hc.MemorySwap === cap, detail: { Memory: hc.Memory, MemorySwap: hc.MemorySwap } },
    { name: "OomScoreAdj 500", ok: hc.OomScoreAdj === 500 },
    { name: "NanoCpus 1e9, PidsLimit 1024, User 10001:10001", ok: hc.NanoCpus === 1e9 && hc.PidsLimit === 1024 && cfg.User === "10001:10001", detail: { NanoCpus: hc.NanoCpus, PidsLimit: hc.PidsLimit, User: cfg.User } },
    {
      name: "no port, bind or mount",
      ok: empty(hc.PortBindings) && hc.PublishAllPorts !== true && empty(hc.Binds) && empty(hc.Mounts) && empty(ins?.Mounts) && empty(ins?.NetworkSettings?.Ports) && empty(hc.Devices),
      detail: { PortBindings: hc.PortBindings, Binds: hc.Binds, Mounts: ins?.Mounts, Ports: ins?.NetworkSettings?.Ports },
    },
    { name: "one network, wkb-*, its own", ok: netNames.length === 1 && /^wkb-[0-9a-f]{8}$/.test(netNames[0]) && hc.NetworkMode === netNames[0], detail: { NetworkMode: hc.NetworkMode, netNames } },
    { name: "LogConfig none", ok: hc.LogConfig?.Type === "none", detail: hc.LogConfig },
    {
      name: "IPv6 off",
      ok: netNames.every((n) => !nets[n]?.GlobalIPv6Address) && sysctls["net.ipv6.conf.all.disable_ipv6"] === "1" && sysctls["net.ipv6.conf.default.disable_ipv6"] === "1",
      detail: { sysctls },
    },
  ];
}

/**
 * Which needles appear in a text (each named by its label, never shown).
 * @param {string | Buffer} hay
 * @param {ReadonlyArray<{ label: string, value: string }>} needles
 * @returns {string[]} the labels found
 */
export function needlesIn(hay, needles) {
  const buf = typeof hay === "string" ? Buffer.from(hay, "utf8") : hay;
  return needles.filter((n) => n.value.length >= 6 && buf.includes(Buffer.from(n.value, "utf8"))).map((n) => n.label);
}

/**
 * A connect address from the API, pointed at the host on this server
 * (12.3: the proof talks to 127.0.0.1:8789, past Caddy, whose /connect is
 * the app's addresses only): the same path and token, our own origin.
 * @param {string} connectUrl
 * @param {string} api
 */
export function localConnect(connectUrl, api = API) {
  const u = new URL(connectUrl);
  const base = new URL(api);
  return `ws://${base.host}${u.pathname}${u.search}`;
}

// ── Pure: the plan ──────────────────────────────────────────────────

/**
 * @typedef {{ tool: "curl" | "dig", argv: string[], user?: string }} Probe
 * @typedef {{ label: string, probe: Probe, counter: string, control: Probe | null }} Refusal
 * @typedef {{
 *   bIp: string,
 *   aGateway: string,
 *   publicV4: readonly string[],
 *   publicHost: string,
 *   appV4: string,
 *   appHost: string,
 *   hostLocal: ReadonlySet<string>,
 *   resolved: { "example.com": string, "portquiz.net": string },
 * }} PlanContext
 */

/**
 * A curl that fails within 5 seconds at most, prints only the HTTP status,
 * and never follows a redirect.
 * @param {string} url
 * @param {string[]} [extra]
 * @returns {Probe}
 */
export function curl(url, extra = []) {
  return { tool: "curl", argv: ["curl", "-sS", "--max-time", "5", "-o", "/dev/null", "-w", "%{http_code}", ...extra, url] };
}

/**
 * @param {string} server
 * @param {string} name
 * @param {string[]} [extra]
 * @returns {Probe}
 */
export function dig(server, name, extra = ["+time=2", "+tries=1"]) {
  return { tool: "dig", argv: ["dig", `@${server}`, name, "A", ...extra] };
}

/**
 * The hook a session's packet to `ip` meets: local delivery (to_host) for an
 * address of the host itself, else the forward rules, with `forward` the
 * counter they answer.
 * @param {ReadonlySet<string>} hostLocal
 * @param {string} ip
 * @param {string} forward
 */
export const counterFor = (hostLocal, ip, forward) => (hostLocal.has(ip) ? "to_host" : forward);

/**
 * The network layer's table (12.3), each target with the counter its
 * refusal must raise and its positive control from the host's namespace.
 * @param {PlanContext} c
 * @returns {Refusal[]}
 */
export function networkPlan(c) {
  /** @type {Refusal[]} */
  const rows = [];
  for (const ip of LISTENERS) rows.push({ label: `the listener on ${ip}`, probe: curl(`http://${ip}/`), counter: counterFor(c.hostLocal, ip, "private"), control: curl(`http://${ip}/`) });
  rows.push({ label: "the metadata service", probe: curl(`http://${METADATA}/latest/meta-data/`), counter: counterFor(c.hostLocal, METADATA, "private"), control: curl(`http://${METADATA}/`) });
  rows.push({
    label: "B's DevTools",
    probe: curl(`http://${c.bIp}:${DEVTOOLS_PORT}/json/version`),
    counter: counterFor(c.hostLocal, c.bIp, "private"),
    control: { ...curl(`http://${c.bIp}:${DEVTOOLS_PORT}/json/version`), user: "wkbhost" },
  });
  rows.push({ label: `${DOCKER0} on 22`, probe: curl(`http://${DOCKER0}:22/`), counter: counterFor(c.hostLocal, DOCKER0, "private"), control: c.hostLocal.has(DOCKER0) ? curl(`http://${DOCKER0}:22/`) : null });
  for (const ip of c.publicV4) {
    rows.push({ label: `the public IPv4 ${ip} on 22`, probe: curl(`http://${ip}:22/`), counter: counterFor(c.hostLocal, ip, "host"), control: curl(`http://${ip}:22/`) });
    rows.push({ label: `the public IPv4 ${ip} on 443`, probe: curl(`https://${c.publicHost}/`, ["-k", "--resolve", `${c.publicHost}:443:${ip}`]), counter: counterFor(c.hostLocal, ip, "host"), control: curl(`https://${c.publicHost}/`, ["-k", "--resolve", `${c.publicHost}:443:${ip}`]) });
  }
  rows.push({ label: `A's gateway ${c.aGateway} on 22`, probe: curl(`http://${c.aGateway}:22/`), counter: counterFor(c.hostLocal, c.aGateway, "private"), control: curl(`http://${c.aGateway}:22/`) });
  rows.push({ label: `A's gateway ${c.aGateway} on 443`, probe: curl(`https://${c.publicHost}/`, ["-k", "--resolve", `${c.publicHost}:443:${c.aGateway}`]), counter: counterFor(c.hostLocal, c.aGateway, "private"), control: curl(`https://${c.publicHost}/`, ["-k", "--resolve", `${c.publicHost}:443:${c.aGateway}`]) });
  rows.push({ label: `the app server (${c.appHost})`, probe: curl(`https://${c.appHost}/`, ["-k", "--resolve", `${c.appHost}:443:${c.appV4}`]), counter: counterFor(c.hostLocal, c.appV4, "host"), control: curl(`https://${c.appHost}/`, ["-k", "--resolve", `${c.appHost}:443:${c.appV4}`]) });
  rows.push({ label: "portquiz.net on 8080", probe: curl("http://portquiz.net:8080/", ["--resolve", `portquiz.net:8080:${c.resolved["portquiz.net"]}`]), counter: "port", control: curl("http://portquiz.net:8080/", ["--resolve", `portquiz.net:8080:${c.resolved["portquiz.net"]}`]) });
  rows.push({ label: "a resolver that is not one of the four (8.8.8.8)", probe: dig("8.8.8.8", "example.com"), counter: "other_dns", control: dig("8.8.8.8", "example.com") });
  rows.push({ label: "a name that resolves to a private address (rebind.test to 10.77.0.1)", probe: curl("http://rebind.test/", ["--resolve", "rebind.test:80:10.77.0.1"]), counter: counterFor(c.hostLocal, "10.77.0.1", "private"), control: curl("http://rebind.test/", ["--resolve", "rebind.test:80:10.77.0.1"]) });
  return rows;
}

/**
 * What must work from A's namespace (12.3).
 * @param {PlanContext} c
 * @returns {Array<{ label: string, probe: Probe }>}
 */
export function mustWork(c) {
  return [
    { label: "https://example.com/", probe: curl("https://example.com/", ["--resolve", `example.com:443:${c.resolved["example.com"]}`]) },
    { label: "http://portquiz.net/", probe: curl("http://portquiz.net/", ["--resolve", `portquiz.net:80:${c.resolved["portquiz.net"]}`]) },
    { label: "dig @1.1.1.1 example.com", probe: dig("1.1.1.1", "example.com", ["+time=3", "+tries=2"]) },
    { label: `Docker's own resolver (${DOCKER_DNS}), which forwards from the container's namespace to the four`, probe: dig(DOCKER_DNS, "example.com", ["+time=3", "+tries=2"]) },
  ];
}

/**
 * The listeners' namespace and pair (see the header), in order.
 * @returns {string[][]}
 */
export function setupCommands() {
  return [
    ["ip", "netns", "add", PROOF_NS],
    ["ip", "link", "add", LINK_HOST, "type", "veth", "peer", "name", LINK_PEER],
    ["ip", "link", "set", LINK_PEER, "netns", PROOF_NS],
    ["ip", "addr", "add", `${LINK.host}/${LINK.prefix}`, "scope", "link", "dev", LINK_HOST],
    ["ip", "link", "set", LINK_HOST, "up"],
    ["ip", "-n", PROOF_NS, "link", "set", "lo", "up"],
    ["ip", "-n", PROOF_NS, "addr", "add", `${LINK.peer}/${LINK.prefix}`, "scope", "link", "dev", LINK_PEER],
    ["ip", "-n", PROOF_NS, "link", "set", LINK_PEER, "up"],
    ["ip", "-n", PROOF_NS, "link", "add", LISTENER_DEV, "type", "dummy"],
    ["ip", "-n", PROOF_NS, "link", "set", LISTENER_DEV, "up"],
    ...LISTENERS.map((a) => ["ip", "-n", PROOF_NS, "addr", "add", `${a}/32`, "dev", LISTENER_DEV]),
    ["ip", "-n", PROOF_NS, "route", "add", "default", "via", LINK.host],
    ...LISTENERS.map((a) => ["ip", "route", "add", `${a}/32`, "via", LINK.peer, "dev", LINK_HOST]),
  ];
}

/** The listeners' namespace and pair removed (each may already be gone). */
export function cleanupCommands() {
  return [
    ...LISTENERS.map((a) => ["ip", "route", "del", `${a}/32`]),
    ["ip", "netns", "del", PROOF_NS],
    ["ip", "link", "del", LINK_HOST],
  ];
}

/**
 * One listener: python3's http.server on port 80 of one address, inside the namespace.
 * @param {string} ip
 * @param {string} dir an empty folder it serves
 */
export function listenerCommand(ip, dir) {
  return ["ip", "netns", "exec", PROOF_NS, "python3", "-m", "http.server", "80", "--bind", ip, "--directory", dir];
}

// ── The run ─────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>,
 *   on: (event: string, fn: (params: any, sessionId?: string) => void) => void,
 *   close: () => void,
 *   closed: () => boolean,
 * }} Cdp
 * @typedef {(cmd: string, args: readonly string[], o?: { timeoutMs?: number }) => Promise<Ran>} Exec
 * @typedef {{
 *   exec: Exec,
 *   spawnDetached: (argv: readonly string[]) => { stop: () => void, exited: () => boolean },
 *   api: (method: string, p: string, body?: unknown) => Promise<{ status: number, json: any }>,
 *   cdp: (wsUrl: string) => Promise<Cdp>,
 *   httpsGet: (url: string) => Promise<number | null>,
 *   launcher: (op: string, args: Record<string, unknown>) => Promise<any>,
 *   resolve4: (name: string) => Promise<string | null>,
 *   readFile: (p: string) => string | null,
 *   writeFile: (p: string, text: string) => void,
 *   searchFiles: (roots: readonly string[], needles: ReadonlyArray<{ label: string, value: string }>) => Array<{ file: string, labels: string[] }>,
 *   listDir: (p: string) => string[],
 *   emptyDir: () => { path: string, remove: () => void },
 *   onSignal: (fn: (signal: string) => void) => void,
 *   exit: (code: number) => void,
 *   platform: string,
 *   uid: number | null,
 *   key: string,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<void>,
 *   print: (line: string) => void,
 * }} Deps
 */

/** A stop of the whole proof, with its reason (a failed setup step, or a signal). */
class ProofStop extends Error {}

/** The signals that end a run early: Ctrl-C, a stop, and a dropped SSH session. */
export const SIGNALS = Object.freeze(["SIGINT", "SIGTERM", "SIGHUP"]);
/** After a signal's cleanup, how long the run's own flow has to report before the process is ended for it. */
export const SIGNAL_GRACE_MS = 2000;

/**
 * The proof. Answers its exit code: 0 all passed, 1 a check failed, 2 refused here.
 * A signal runs the same cleanup, then exits 1 through `d.exit`.
 * @param {Deps} d
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export async function runProof(d, argv) {
  const afterReboot = argv.includes("--after-reboot");
  const stopForced = argv.includes("--stop-host");
  const hostEnv = d.readFile(HOST_ENV);
  /** @type {{ status: number, mode: unknown } | null} */
  let health = null;
  const preliminary = refusal({ platform: d.platform, uid: d.uid, hostEnv, key: d.key, health: { status: 200, mode: "container" } });
  if (!preliminary) {
    const h = await d.api("GET", "/health").catch(() => null);
    health = h ? { status: h.status, mode: h.json?.mode } : null;
  }
  const why = preliminary ?? refusal({ platform: d.platform, uid: d.uid, hostEnv, key: d.key, health });
  if (why) {
    d.print(refusalMessage(why));
    return 2;
  }

  /** @type {Array<{ section: string, name: string, ok: boolean }>} */
  const results = [];
  let section = "setup";
  /** @param {string} name @param {boolean} ok @param {unknown} [detail] */
  const check = (name, ok, detail) => {
    results.push({ section, name, ok });
    const dd = ok || detail === undefined ? "" : `\n         ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 600)}`;
    d.print(`${ok ? "  ok  " : "  FAIL"} ${name}${dd}`);
    return ok;
  };
  /** A recorded result that is neither a pass nor a failure (12.3's verify lines). @param {string} text */
  const note = (text) => d.print(`  note ${text}`);
  /** @param {string} s */
  const begin = (s) => {
    section = s;
    d.print(`\n${s}`);
  };
  let reported = false;
  /** The last line, once, whichever ends first (the run's own flow, or a signal's handler): its exit code, or null when already reported. */
  const report = () => {
    if (reported) return null;
    reported = true;
    if (interrupted) check("the proof ran to the end", false, `interrupted by ${interrupted}`);
    const failed = results.filter((r) => !r.ok);
    d.print(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; ${failed.length} failed` : ""}.`);
    return failed.length > 0 ? 1 : 0;
  };

  const region = envValue(hostEnv, "BROWSER_HOST_REGION") ?? "";
  const memoryMb = Number(envValue(hostEnv, "BROWSER_HOST_SESSION_MEMORY_MB") || 1280);
  const publicHost = (() => {
    try {
      return new URL(String(envValue(hostEnv, "BROWSER_HOST_PUBLIC_URL"))).hostname;
    } catch {
      return "";
    }
  })();
  const appHost = (() => {
    try {
      return new URL(String(envValue(hostEnv, "BROWSER_HOST_APP_ORIGIN") || "https://app.workwrk.com")).hostname;
    } catch {
      return "app.workwrk.com";
    }
  })();
  const block = String(envValue(d.readFile(FIREWALL_ENV), "BROWSER_HOST_BLOCK") ?? "")
    .split(/[\s,]+/)
    .filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
  const startedIso = new Date(d.now()).toISOString();

  /** Every value that must never be kept or logged, by label. */
  /** @type {Array<{ label: string, value: string }>} */
  const secrets = [{ label: "the key", value: d.key }];
  /** @type {Array<{ id: string, cdp: Cdp | null }>} */
  const made = [];
  /** @type {Array<{ stop: () => void, exited: () => boolean }>} */
  const listeners = [];
  /** @type {{ path: string, remove: () => void } | null} */
  let served = null;
  let hostStopped = false;
  let deadmanArmed = false;
  /** Set by a signal: every command from the run's own flow then stops it. */
  let interrupted = "";
  let reachedEnd = false;

  /** A command of the run's own flow: refused once a signal came, so nothing new starts while the cleanup runs. @param {readonly string[]} cmd @param {number} [timeoutMs] */
  const sh = (cmd, timeoutMs = 15_000) => {
    if (interrupted) return Promise.reject(new ProofStop(`interrupted by ${interrupted}`));
    return d.exec(cmd[0], cmd.slice(1), { timeoutMs });
  };
  /** A command of the cleanup's, which always runs. @param {readonly string[]} cmd @param {number} [timeoutMs] */
  const shc = (cmd, timeoutMs = 15_000) => d.exec(cmd[0], cmd.slice(1), { timeoutMs }).catch(() => ({ code: 1, stdout: "", stderr: "", ms: 0 }));
  /** @param {Probe} p @param {number | null} pid A's pid for its namespace, or null for the host's */
  const probeRun = (p, pid) => {
    const argv = p.user ? ["runuser", "-u", p.user, "--", ...p.argv] : p.argv;
    return pid === null ? sh(argv, 10_000) : sh(["nsenter", "-t", String(pid), "-n", ...argv], 10_000);
  };
  /** @param {Probe} p @param {Ran} r */
  const outcomeOf = (p, r) => (p.tool === "dig" ? digOutcome(r).outcome : curlOutcome(r).outcome);
  const listTable = async () => {
    const r = await sh(["nft", "-j", "list", "table", ...TABLE.split(" ")]);
    if (r.code !== 0) throw new ProofStop("nft could not list the table");
    return JSON.parse(r.stdout);
  };
  const counters = async () => counterValues(await listTable());
  /**
   * Something run between two readings of the counters, on one table: when a
   * reload re-created the rules meanwhile (their handles changed), it is run
   * again on the new table, up to three times.
   * @template T
   * @param {() => Promise<T>} run
   */
  const measured = async (run) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await counters();
      const r = await run();
      const after = await counters();
      if (before.generation === after.generation) return { r, before: before.values, after: after.values };
      note("the firewall table was reloaded during that probe (its rule handles changed), so it runs again on the new table");
    }
    throw new ProofStop("the firewall table kept reloading");
  };

  /**
   * A session through the API: its connect client (its one client, held to the end), its container and its tab.
   * @param {string} label
   */
  const openSession = async (label) => {
    const r = await d.api("POST", "/v1/sessions", {
      projectId: "workwrk",
      region,
      timeout: 1800,
      keepAlive: false,
      browserSettings: { viewport: { width: 1280, height: 800 }, recordSession: false, logSession: false },
      userMetadata: { wk: "isolation-proof" },
    });
    if (r.status !== 201 || typeof r.json?.id !== "string" || typeof r.json?.connectUrl !== "string") throw new ProofStop(`session ${label} was not made (${r.status} ${r.json?.why ?? r.json?.error ?? ""})`);
    const id = String(r.json.id);
    const box = { id, cdp: /** @type {Cdp | null} */ (null) };
    made.push(box);
    secrets.push({ label: `session ${label}'s id`, value: id });
    secrets.push({ label: `session ${label}'s connect token`, value: new URL(r.json.connectUrl).searchParams.get("t") ?? "" });
    // Connected at once: a session nobody connects to ends within a minute.
    const cdp = await d.cdp(localConnect(r.json.connectUrl));
    box.cdp = cdp;
    const ps = await sh(["docker", "ps", "--filter", `label=workwrk.session=${id}`, "--format", "{{.Names}}"]);
    const name = ps.stdout.trim().split("\n")[0] ?? "";
    if (!/^wkb-[0-9a-f]{8}$/.test(name)) throw new ProofStop(`session ${label}'s container was not found`);
    const insRun = await sh(["docker", "inspect", name]);
    const ins = JSON.parse(insRun.stdout || "[]")[0];
    const pid = Number(ins?.State?.Pid);
    const netName = String(ins?.HostConfig?.NetworkMode ?? "");
    const n = ins?.NetworkSettings?.Networks?.[netName] ?? {};
    if (!Number.isInteger(pid) || pid <= 1 || !n.IPAddress || !n.Gateway) throw new ProofStop(`session ${label}'s pid or address was not read`);
    const targets = await cdp.send("Target.getTargets");
    const page = (targets?.targetInfos ?? []).find((/** @type {any} */ t) => t.type === "page");
    if (!page) throw new ProofStop(`session ${label} has no tab`);
    const attached = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    return { id, label, cdp, name, pid, ip: String(n.IPAddress), gateway: String(n.Gateway), network: netName, ins, tab: String(attached.sessionId) };
  };

  /**
   * @param {{ cdp: Cdp, tab: string }} s
   * @param {string} expression
   * @param {number} [timeoutMs]
   */
  const evaluate = async (s, expression, timeoutMs = 15_000) => {
    const r = await Promise.race([
      s.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s.tab),
      d.sleep(timeoutMs).then(() => ({ timedOut: true })),
    ]);
    return r?.timedOut ? { timedOut: true } : r?.result?.value;
  };
  /** @param {{ cdp: Cdp, tab: string }} s @param {string} url @param {(text: string) => boolean} ready */
  const open = async (s, url, ready) => {
    await s.cdp.send("Page.navigate", { url }, s.tab);
    for (let i = 0; i < 50; i += 1) {
      const text = await evaluate(s, "document.readyState === 'complete' && document.body ? document.body.innerText : ''", 3000).catch(() => "");
      if (typeof text === "string" && ready(text)) return text;
      await d.sleep(200);
    }
    return "";
  };

  /** The network layer of 12.3 from A's own namespace. @param {any} A @param {any} B */
  const networkLayer = async (A, B) => {
    const hostLocal = localAddresses(JSON.parse((await sh(["ip", "-j", "-4", "addr", "show"])).stdout || "[]"));
    const publicV4 = publicAddresses(JSON.parse((await sh(["ip", "-j", "-4", "addr", "show", "scope", "global"])).stdout || "[]"));
    const resolved = { "example.com": (await d.resolve4("example.com")) ?? "", "portquiz.net": (await d.resolve4("portquiz.net")) ?? "" };
    if (!resolved["example.com"] || !resolved["portquiz.net"]) throw new ProofStop("example.com or portquiz.net did not resolve on the host");
    if (!publicHost) throw new ProofStop(`${HOST_ENV} has no BROWSER_HOST_PUBLIC_URL`);
    if (block.length === 0) throw new ProofStop(`${FIREWALL_ENV} names no app server address`);
    /** @type {PlanContext} */
    const ctx = { bIp: B.ip, aGateway: A.gateway, publicV4, publicHost, appV4: block[0], appHost, hostLocal, resolved };

    begin("positive controls, from the host's own namespace");
    const plan = networkPlan(ctx);
    for (const row of plan) {
      if (!row.control) continue;
      const r = await probeRun(row.control, null);
      const o = outcomeOf(row.control, r);
      check(`${row.label} answers${row.control.user ? ` (as ${row.control.user})` : ""} (${o})`, reached(o), r.stderr.slice(0, 200));
    }
    for (const ip of [...publicV4, A.gateway]) {
      const r = await sh(["ssh-keyscan", "-T", "5", ip], 10_000);
      check(`ssh-keyscan of ${ip} answers`, /\bssh-|ecdsa-|ed25519/.test(r.stdout), r.stderr.slice(0, 200));
    }

    begin("the network layer, from A's own namespace (nsenter -n): each refused within a second, its own counter raised and no other");
    for (const row of plan) {
      const m = await measured(() => probeRun(row.probe, A.pid));
      const o = outcomeOf(row.probe, m.r);
      const moves = counterMoves(m.before, m.after, row.counter);
      check(
        `${row.label}: refused (${o}, ${Math.round(m.r.ms)} ms), ${row.counter} rose by ${moves.rose}${moves.others.length ? `, and ${moves.others.join(", ")} moved too` : ", and no other counter moved"}`,
        isRefusal(o) && m.r.ms < REFUSE_MS && moves.rose > 0 && moves.others.length === 0,
        { outcome: o, ms: Math.round(m.r.ms), others: moves.others, stderr: m.r.stderr.slice(0, 200) },
      );
    }

    begin("IPv6, from A's own namespace");
    const v6 = await sh(["nsenter", "-t", String(A.pid), "-n", "ip", "-6", "addr"]);
    check("ip -6 addr shows no global address", v6.code === 0 && globalV6(v6.stdout).length === 0, globalV6(v6.stdout));
    const six = await sh(["nsenter", "-t", String(A.pid), "-n", "curl", "-6", "-sS", "--max-time", "5", "-o", "/dev/null", `https://[${PUBLIC_V6}]/`], 10_000);
    const sixOut = curlOutcome(six).outcome;
    check(`curl -6 https://[${PUBLIC_V6}]/ fails at once, without an answer (${sixOut}, ${Math.round(six.ms)} ms)`, six.code !== 0 && !reached(sixOut) && six.ms < REFUSE_MS, six.stderr.slice(0, 200));
    note(`its message: ${six.stderr.trim().slice(0, 160)} (12.3 expects "Network is unreachable"; the ipv6 rule is the backstop)`);

    begin("the output rule, from the host's own namespace");
    const m = await measured(() => probeRun(curl(`http://${B.ip}:${DEVTOOLS_PORT}/json/version`), null));
    const rootOut = curlOutcome(m.r).outcome;
    const moves = counterMoves(m.before, m.after, "devtools_other_user");
    check(`root's curl of B's DevTools is refused (${rootOut}), devtools_other_user rose by ${moves.rose}, and no other counter moved`, isRefusal(rootOut) && moves.rose > 0 && moves.others.length === 0, { stderr: m.r.stderr.slice(0, 200), others: moves.others });
    const asHost = await probeRun({ ...curl(`http://${B.ip}:${DEVTOOLS_PORT}/json/version`), user: "wkbhost" }, null);
    check(`wkbhost's is answered (${curlOutcome(asHost).outcome})`, curlOutcome(asHost).outcome === "answered", asHost.stderr.slice(0, 200));

    begin("must work, from A's own namespace");
    for (const w of mustWork(ctx)) {
      const r = await probeRun(w.probe, A.pid);
      if (w.probe.tool === "dig") {
        const o = digOutcome(r);
        check(`${w.label} answers (${o.status ?? o.outcome}, ${o.answers} answers)`, o.status === "NOERROR" && o.answers > 0, r.stdout.slice(0, 200));
      } else {
        const o = curlOutcome(r);
        check(`${w.label} answers (${o.outcome} ${o.http ?? ""})`, o.outcome === "answered" && o.http !== null && o.http > 0, r.stderr.slice(0, 200));
      }
    }
  };

  /**
   * The cleanup, once, from the end of the run or from a signal: the host
   * started again if the proof stopped it (then the dead-man switch
   * cancelled), the sessions released, the listeners stopped, the namespace,
   * the pair and its routes removed and each removal checked, and, after the
   * first run, the table's listing saved once the proof's own links are gone.
   * @type {Promise<void> | null}
   */
  let cleaning = null;
  const cleanup = () =>
    (cleaning ??= (async () => {
      section = "cleanup";
      if (hostStopped) {
        const r = await shc(["systemctl", "start", HOST_UNIT], 40_000);
        hostStopped = r.code !== 0;
        check("the host is started again", !hostStopped, r.stderr.slice(0, 200));
      }
      if (deadmanArmed && !hostStopped) {
        const r = await shc(deadmanCommands().cancel);
        deadmanArmed = r.code !== 0;
        check("and the dead-man switch is cancelled", !deadmanArmed, r.stderr.slice(0, 200));
      }
      for (const s of made) {
        if (s.cdp && !s.cdp.closed()) {
          try {
            s.cdp.close();
          } catch {
            /* gone */
          }
        }
        await d.api("POST", `/v1/sessions/${s.id}`, { status: "REQUEST_RELEASE" }).catch(() => null);
      }
      for (const l of listeners) l.stop();
      for (const cmd of cleanupCommands()) await shc(cmd);
      for (let i = 0; i < 30 && listeners.some((l) => !l.exited()); i += 1) await d.sleep(100);
      served?.remove();
      const netns = await shc(["ip", "netns", "list"]);
      const link = await shc(["ip", "link", "show", LINK_HOST]);
      const routes = routeDestinations(JSON.parse((await shc(["ip", "-j", "route", "show"])).stdout || "[]"));
      const leftRoutes = LISTENERS.filter((ip) => routes.includes(ip));
      const running = listeners.filter((l) => !l.exited()).length;
      check(
        `the namespace ${PROOF_NS}, the pair ${LINK_HOST} and ${LINK_PEER}, its ${LISTENERS.length} routes and every listener are gone`,
        !new RegExp(`^${PROOF_NS}\\b`, "m").test(netns.stdout) && link.code !== 0 && leftRoutes.length === 0 && running === 0,
        { netns: netns.stdout.trim(), link: link.code, routes: leftRoutes, listenersRunning: running },
      );
      if (!afterReboot && reachedEnd && link.code !== 0) {
        // Saved only now, with the proof's own links gone, for the run after the reboot.
        const r = await shc(["nft", "-j", "list", "table", ...TABLE.split(" ")]);
        let saved = false;
        try {
          d.writeFile(SAVED_LISTING, listingMeaning(JSON.parse(r.stdout)));
          saved = d.readFile(SAVED_LISTING) !== null;
        } catch {
          saved = false;
        }
        check(`the table's listing is saved for the run after the reboot (${SAVED_LISTING})`, saved);
      }
    })());

  // Ctrl-C, a stop, or a dropped SSH session: the same cleanup, then out.
  // The run's own flow stops at its next command; whatever it still waits
  // on (a page, a sleep), the process ends once the cleanup is done.
  d.onSignal((signal) => {
    if (interrupted) {
      // A second signal while the cleanup runs (one that hangs): out at once; the dead-man switch starts the host if the proof stopped it.
      d.print(`${signal} again: exiting now${deadmanArmed ? `; ${DEADMAN_UNIT} starts the host within ${DEADMAN_SECONDS} seconds` : ""}`);
      d.exit(1);
      return;
    }
    interrupted = signal;
    d.print(`\n${signal}: stopping the proof, and cleaning up first`);
    void cleanup()
      .catch(() => undefined)
      .then(() => d.sleep(SIGNAL_GRACE_MS))
      .then(() => {
        if (report() !== null) d.exit(1);
      });
  });

  try {
    // ── Setup ───────────────────────────────────────────────────────
    begin("setup: the listeners in their own namespace, joined to the host");
    // Whatever a run that died left.
    for (const cmd of cleanupCommands()) await sh(cmd);
    for (const cmd of setupCommands()) {
      const r = await sh(cmd);
      if (r.code !== 0) throw new ProofStop(`${cmd.join(" ")} failed: ${r.stderr.trim().slice(0, 200)}`);
    }
    served = d.emptyDir();
    for (const ip of LISTENERS) listeners.push(d.spawnDetached(listenerCommand(ip, served.path)));
    // Each listener must answer the host through the pair, by its own /32 route.
    /** @type {Record<string, string>} */
    const up = {};
    for (let i = 0; i < 20; i += 1) {
      for (const ip of LISTENERS) {
        if (up[ip] === "answered") continue;
        up[ip] = curlOutcome(await sh(curl(`http://${ip}/`).argv, 10_000)).outcome;
      }
      if (LISTENERS.every((ip) => up[ip] === "answered")) break;
      await d.sleep(300);
    }
    const routes = routeDestinations(JSON.parse((await sh(["ip", "-j", "route", "show", "dev", LINK_HOST])).stdout || "[]"));
    check(
      `the namespace ${PROOF_NS}, the pair ${LINK_HOST} and ${LINK_PEER}, a /32 route via the pair for each of the ${LISTENERS.length} listeners, and each listener answering the host`,
      LISTENERS.every((ip) => up[ip] === "answered" && routes.includes(ip)) && listeners.every((l) => !l.exited()),
      { up, routes },
    );
    const hostAddrs = publicAddresses(JSON.parse((await sh(["ip", "-j", "-4", "addr", "show", "scope", "global"])).stdout || "[]"));
    check(`the pair's own address (${LINK.host}) is never read as one of the host's (a firewall check meanwhile leaves it out of the table)`, !hostAddrs.includes(LINK.host), hostAddrs);

    if (afterReboot) {
      begin("after the reboot");
      const units = systemctlShow((await sh(["systemctl", "show", "-p", "Id", "-p", "ActiveEnterTimestampMonotonic", "-p", "InactiveExitTimestampMonotonic", "workwrk-browser-firewall.service", "docker.service"])).stdout);
      const order = firewallBeforeDocker(units);
      check("the firewall service was active before Docker began to start", order.ok, order);
      const listing = await listTable();
      const meaning = listingMeaning(listing);
      const saved = d.readFile(SAVED_LISTING);
      check("the table equals the listing saved before the reboot, its counters aside", saved !== null && saved.trim() === meaning, saved === null ? `no ${SAVED_LISTING}: run the proof once before the reboot` : "the listings differ");
      const loaded = d.readFile(LOADED_LISTING);
      check("and equals what the firewall service saved at this boot", loaded !== null && loaded.trim() === meaning);
      const cv = counterValues(listing);
      check("every refusal counter is there exactly once", cv.twice.length === 0 && cv.missing.length === 0, cv);
      check("no rule is there twice", duplicateRules(listing).length === 0, duplicateRules(listing));
    }

    const A = await openSession("A");
    const B = await openSession("B");
    check("sessions A and B are made through the API, connected, and their containers found", true);
    // Their live tokens, watch and control, minted now: the searches at the end look for every one.
    for (const s of [A, B]) {
      for (const mode of ["watch", "control"]) {
        const live = await d.api("GET", `/v1/sessions/${s.id}/debug?mode=${mode}`);
        const t = String(live.json?.debuggerFullscreenUrl ?? "").split("#t=")[1];
        if (t) secrets.push({ label: `session ${s.label}'s ${mode} token`, value: t });
      }
    }

    await networkLayer(A, B);

    if (!afterReboot) {
      // ── Chrome's own layer ───────────────────────────────────────
      begin("Chrome's own layer (Chrome's, not the firewall's), from http://example.com/ on A");
      // What Chrome says of each request it refuses: the handshake's answers and the console's lines.
      /** @type {number[]} */
      const statuses = [];
      /** @type {string[]} */
      const texts = [];
      A.cdp.on("Network.webSocketHandshakeResponseReceived", (p, sid) => void (sid === A.tab && statuses.push(Number(p?.response?.status))));
      A.cdp.on("Log.entryAdded", (p, sid) => void (sid === A.tab && texts.push(String(p?.entry?.text ?? ""))));
      await A.cdp.send("Network.enable", {}, A.tab).catch(() => undefined);
      await A.cdp.send("Log.enable", {}, A.tab).catch(() => undefined);
      const page = await open(A, "http://example.com/", (t) => t.includes("Example Domain"));
      check("A shows http://example.com/", page.includes("Example Domain"));
      const fetchExpr = (/** @type {string} */ url) => `fetch(${JSON.stringify(url)}, { mode: "no-cors" }).then(() => "resolved", () => "rejected")`;
      const lan = await measured(() => evaluate(A, fetchExpr("http://10.77.0.1/")));
      const left = (lan.after.private ?? 0) - (lan.before.private ?? 0) > 0;
      check(`fetch("http://10.77.0.1/") from the page rejects (${lan.r})`, lan.r === "rejected");
      note(left ? "its packet left Chrome: the firewall refused it (private rose)" : "its packet never left Chrome: Local Network Access refused it (private did not rise)");
      const loop = await evaluate(A, fetchExpr("http://127.0.0.1:8789/"));
      check(`the container's own loopback, not the host's: fetch("http://127.0.0.1:8789/") rejects, nothing listens there (${loop})`, loop === "rejected");
      const raw = await sh(["runuser", "-u", "wkbhost", "--", "curl", "-sS", "--max-time", "5", `http://${A.ip}:${DEVTOOLS_PORT}/json/version`]);
      /** @type {string | null} */
      let browserId = null;
      try {
        browserId = browserIdOf(JSON.parse(raw.stdout));
      } catch {
        browserId = null;
      }
      check("A's real browser id is read from its /json/version, as wkbhost", browserId !== null, raw.stderr.slice(0, 200));
      if (browserId) secrets.push({ label: "A's browser id", value: browserId });
      const wsExpr = (/** @type {string} */ url) =>
        `new Promise((done) => { let ws; try { ws = new WebSocket(${JSON.stringify(url)}); } catch (e) { done("threw"); return; } const t = setTimeout(() => { try { ws.close(); } catch (e) {} done("timeout"); }, 5000); ws.onopen = () => { clearTimeout(t); ws.close(); done("opened"); }; ws.onerror = () => { clearTimeout(t); done("refused"); }; })`;
      for (const port of [DEVTOOLS_PORT, CHROME_PORT]) {
        statuses.length = 0;
        texts.length = 0;
        const r = await evaluate(A, wsExpr(`ws://127.0.0.1:${port}/devtools/browser/${browserId ?? "unknown"}`));
        await d.sleep(300);
        const by = wsRefusedBy({ statuses, texts });
        check(`the container's own loopback: a page websocket to ws://127.0.0.1:${port}/devtools/browser/<A's real id> is refused (${r}), by ${by}`, browserId !== null && r !== "opened" && r !== "timeout");
      }
      for (const port of [DEVTOOLS_PORT, CHROME_PORT]) {
        const r = await evaluate(A, fetchExpr(`http://127.0.0.1:${port}/json/version`));
        note(`verify: fetch("http://127.0.0.1:${port}/json/version") on the container's own loopback ${r === "rejected" ? "rejects (Local Network Access)" : `is ${r}`}`);
      }
      const sandbox = await open(A, "chrome://sandbox", (t) => /sandboxed/i.test(t));
      check('chrome://sandbox reads "Seccomp-BPF sandbox Yes", the namespace sandbox in use, and "You are adequately sandboxed."', parseSandbox(sandbox).ok, sandbox.slice(0, 300));

      // ── The container ────────────────────────────────────────────
      begin("the container");
      const probes = await d.launcher("probe", { image: "current" }).catch(() => null);
      check("the launcher's probe against current: the netfilter socket refused, and its high bit form", probes?.netlink === 0 && probes?.netlinkHigh === 0, probes);
      check("and net_admin in a new namespace refused", probes?.netAdmin === 0, probes);
      const seccompText = d.readFile("/etc/workwrk-browser-host/chrome-seccomp.json");
      for (const c of inspectChecks(A.ins, { memoryMb, seccomp: seccompText })) check(`docker inspect of A: ${c.name}`, c.ok, c.detail);

      begin("memory: a page on A allocates until 3 GB");
      const cap = memoryMb * 1024 * 1024;
      // The cgroup's own high mark too, read while it exists (the container may be removed when it dies).
      const peakFile = `/sys/fs/cgroup/system.slice/docker-${String(A.ins?.Id ?? "none")}.scope/memory.peak`;
      let highest = 0;
      let peak = 0;
      let sampling = true;
      const sampler = (async () => {
        while (sampling && !interrupted) {
          const s = await sh(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", A.name], 5000).catch(() => ({ stdout: "" }));
          const used = statsBytes(s.stdout);
          if (used !== null) highest = Math.max(highest, used);
          const p = Number(d.readFile(peakFile) ?? NaN);
          if (Number.isFinite(p)) peak = Math.max(peak, p);
          await d.sleep(300);
        }
      })();
      const alloc = await evaluate(
        A,
        `(async () => { const keep = []; for (let i = 0; i < ${ALLOCATE_MB}; i += 1) { keep.push(new Uint8Array(1024 * 1024).fill(i & 255)); if (i % 32 === 0) await new Promise((r) => setTimeout(r, 0)); } return keep.length; })()`,
        90_000,
      ).catch(() => "crashed");
      await d.sleep(2000);
      sampling = false;
      await sampler;
      const insAfter = JSON.parse((await sh(["docker", "inspect", A.name])).stdout || "[]")[0];
      const crashed = alloc !== ALLOCATE_MB;
      check(`the allocation never finishes: its tab or its container is gone (${typeof alloc === "object" ? "timed out" : String(alloc)})`, crashed);
      note(insAfter ? `A's container is still running: ${insAfter?.State?.Running === true}, OOMKilled: ${insAfter?.State?.OOMKilled === true}` : "A's container is gone");
      check(`docker stats never shows A over its cap (highest ${Math.round(highest / 1048576)} MiB of ${memoryMb})`, highest > 0 && highest <= cap);
      if (peak > 0) check(`and its cgroup's memory.peak is within the cap (${Math.round(peak / 1048576)} MiB)`, peak <= cap);
      else note("its cgroup's memory.peak could not be read");
      for (const unit of ["workwrk-browser-host", "workwrk-browser-launcher", "caddy"]) {
        const r = await sh(["systemctl", "is-active", unit]);
        check(`${unit} keeps running`, r.stdout.trim() === "active");
      }
      const bPage = await open(B, "http://example.com/", (t) => t.includes("Example Domain"));
      check("B still reads example.com", bPage.includes("Example Domain"));

      // ── Nothing kept ─────────────────────────────────────────────
      begin("nothing kept");
      const liveA = secrets.find((x) => x.label === "session A's control token")?.value ?? "";
      const connectA = secrets.find((x) => x.label === "session A's connect token")?.value ?? "";
      // The page's words, once seen on B.
      const words = [{ label: "the page's words", value: "Example Domain" }];
      for (const s of [A, B]) {
        const r = await d.api("POST", `/v1/sessions/${s.id}`, { status: "REQUEST_RELEASE" });
        check(`session ${s.label} is released (${r.status})`, r.status === 200 || r.status === 409);
        try {
          s.cdp.close();
        } catch {
          /* gone */
        }
      }
      await d.sleep(8000);
      for (const s of [A, B]) {
        const c = await sh(["docker", "ps", "-a", "--filter", `label=workwrk.session=${s.id}`, "--format", "{{.Names}}"]);
        const n = await sh(["docker", "network", "ls", "--filter", `label=workwrk.session=${s.id}`, "--format", "{{.Name}}"]);
        check(`no container and no network of ${s.label} is left (docker ps -a, docker network ls)`, c.stdout.trim() === "" && n.stdout.trim() === "", { containers: c.stdout.trim(), networks: n.stdout.trim() });
      }
      const others = (await sh(["docker", "ps", "-a", "--filter", "name=wkb-", "--format", "{{.Names}}"])).stdout.trim();
      note(others ? `other wkb-* containers are on the server: ${others.split("\n").length} (not this proof's)` : "no wkb-* container is on the server");
      // The host's own folders first, while they exist: a stop wipes its PrivateTmp and its RuntimeDirectory.
      const roots = searchRoots(d.listDir("/tmp"), d.listDir("/run"));
      const found = d.searchFiles(roots, [...secrets, ...words]);
      check(`the host's own folders hold none of the key, the tokens, the session ids or the page's words (${roots.join(", ")})`, found.length === 0, found);
      // A proxy error forced, with tokens in its request line: the error loggers are excluded, so journald must hold none.
      const now = await d.api("GET", "/health");
      const refused = now.status === 200 ? stopRefusal(now.json, stopForced) : "the host's /health did not answer, so it was not stopped";
      if (refused) {
        check("the host is stopped for the Caddy check, with nothing open on it", false, refused);
      } else {
        const arm = await sh(deadmanCommands().arm);
        deadmanArmed = arm.code === 0;
        check(`a dead-man switch is armed first: ${DEADMAN_UNIT} starts the host in ${DEADMAN_SECONDS} seconds, whatever happens to this proof`, deadmanArmed, arm.stderr.slice(0, 200));
      }
      if (!refused && deadmanArmed) {
        d.print(`  Stopping the host now: every browser open on it ends (running ${now.json?.running}, starting ${now.json?.starting}, held ${now.json?.held}).`);
        hostStopped = true;
        await sh(["systemctl", "stop", HOST_UNIT], 40_000);
        const live502 = await d.httpsGet(`https://${publicHost}/live/${A.id}?t=${encodeURIComponent(liveA)}`);
        check(`a request through Caddy while the host is stopped answers 502 (${live502})`, live502 === 502);
        const connect = await d.httpsGet(`https://${publicHost}/connect/${A.id}?t=${encodeURIComponent(connectA)}`);
        note(`a connect through Caddy from this server answers ${connect} (404 is the app addresses' rule; 502 the stopped host)`);
        const started = await sh(["systemctl", "start", HOST_UNIT], 40_000);
        hostStopped = started.code !== 0;
        check("the host is started again", !hostStopped, started.stderr.slice(0, 200));
        if (!hostStopped) {
          const cancelled = await sh(deadmanCommands().cancel);
          deadmanArmed = cancelled.code !== 0;
          check("and the dead-man switch is cancelled", !deadmanArmed, cancelled.stderr.slice(0, 200));
        }
      }
      const journal = await sh(["journalctl", "-u", "workwrk-browser-host", "-u", "workwrk-browser-launcher", "-u", "caddy", "--since", startedIso, "-o", "cat", "--no-pager"], 60_000);
      const inJournal = needlesIn(journal.stdout, [...secrets, ...words]);
      check(`journald since the start holds none of them either (${journal.stdout.split("\n").length} lines)`, journal.code === 0 && inJournal.length === 0, inJournal);
      let upz = 0;
      for (let i = 0; i < 60 && upz !== 200; i += 1) {
        upz = (await d.api("GET", "/healthz").catch(() => ({ status: 0 }))).status;
        if (upz !== 200) await d.sleep(3000);
      }
      check(`the host is back, /healthz ${upz}`, upz === 200);
    }
    reachedEnd = true;
  } catch (err) {
    if (!interrupted) check("the proof ran to the end", false, err instanceof Error ? err.message : String(err));
  }
  await cleanup().catch(() => undefined);
  return report() ?? 1;
}

// ── The system's own deps ───────────────────────────────────────────

/** @type {Exec} */
export function systemExec(cmd, args, o = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const cap = 8 * 1024 * 1024;
    child.stdout.on("data", (b) => void (stdout.length < cap && (stdout += String(b))));
    child.stderr.on("data", (b) => void (stderr.length < cap && (stderr += String(b))));
    const timer = setTimeout(() => child.kill("SIGKILL"), o.timeoutMs ?? 15_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${e.message}`, ms: performance.now() - t0 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, ms: performance.now() - t0 });
    });
  });
}

/**
 * A flat CDP client over one websocket (the proof's own, as the app's).
 * @param {string} wsUrl
 * @returns {Promise<Cdp>}
 */
export function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, followRedirects: false, maxPayload: 64 * 1024 * 1024, handshakeTimeout: 10_000 });
    let next = 0;
    let closed = false;
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
    const waiting = new Map();
    /** @type {Map<string, Array<(p: any, s?: string) => void>>} */
    const events = new Map();
    ws.on("message", (data) => {
      /** @type {any} */
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (typeof msg.id === "number") {
        const w = waiting.get(msg.id);
        if (!w) return;
        waiting.delete(msg.id);
        if (msg.error) w.reject(new Error(`cdp ${msg.error.message ?? "error"}`));
        else w.resolve(msg.result);
      } else if (typeof msg.method === "string") for (const fn of events.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
    });
    ws.on("close", () => {
      closed = true;
      for (const w of waiting.values()) w.reject(new Error("cdp closed"));
      waiting.clear();
    });
    ws.on("error", () => reject(new Error("cdp unreachable")));
    ws.on("open", () =>
      resolve({
        send: (method, params = {}, sessionId) =>
          new Promise((res, rej) => {
            if (closed) return rej(new Error("cdp closed"));
            next += 1;
            waiting.set(next, { resolve: res, reject: rej });
            ws.send(JSON.stringify(sessionId ? { id: next, method, params, sessionId } : { id: next, method, params }));
          }),
        on: (event, fn) => void events.set(event, [...(events.get(event) ?? []), fn]),
        close: () => ws.close(),
        closed: () => closed,
      }),
    );
  });
}

/**
 * One request to the launcher's socket (root may open it), its result or null.
 * @param {string} op
 * @param {Record<string, unknown>} args
 */
function launcherCall(op, args) {
  return new Promise((resolve) => {
    const c = net.connect(LAUNCHER_SOCKET);
    let buf = "";
    const timer = setTimeout(() => {
      c.destroy();
      resolve(null);
    }, 150_000);
    c.on("connect", () => c.write(`${JSON.stringify({ id: 1, op, args })}\n`));
    c.on("data", (b) => {
      buf += String(b);
      const at = buf.indexOf("\n");
      if (at < 0) return;
      clearTimeout(timer);
      c.destroy();
      try {
        const reply = JSON.parse(buf.slice(0, at));
        resolve(reply.ok ? reply.result : null);
      } catch {
        resolve(null);
      }
    });
    c.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/**
 * Every regular file under `roots`, searched for the needles; a file over 64 MB is skipped.
 * @param {readonly string[]} roots
 * @param {ReadonlyArray<{ label: string, value: string }>} needles
 */
function searchFiles(roots, needles) {
  /** @type {Array<{ file: string, labels: string[] }>} */
  const found = [];
  /** @param {string} p @param {number} depth */
  const walk = (p, depth) => {
    let st;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      if (depth > 12) return;
      let names = [];
      try {
        names = fs.readdirSync(p);
      } catch {
        return;
      }
      for (const n of names) walk(path.join(p, n), depth + 1);
      return;
    }
    if (!st.isFile() || st.size > 64 * 1024 * 1024) return;
    try {
      const labels = needlesIn(fs.readFileSync(p), needles);
      if (labels.length > 0) found.push({ file: p, labels });
    } catch {
      /* unreadable */
    }
  };
  for (const r of roots) walk(r, 0);
  return found;
}

/** The system's deps, for the server. @param {Record<string, string | undefined>} env @returns {Deps} */
export function systemDeps(env) {
  const key = String(env.BROWSER_HOST_KEY ?? "").trim();
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "9.9.9.9"]);
  return {
    exec: systemExec,
    spawnDetached: (argv) => {
      const child = spawn(argv[0], argv.slice(1), { stdio: "ignore", detached: false });
      let gone = false;
      child.on("error", () => void (gone = true));
      child.on("exit", () => void (gone = true));
      return { stop: () => void (gone || child.kill("SIGTERM")), exited: () => gone };
    },
    api: async (method, p, body) => {
      /** @type {Record<string, string>} */
      const headers = { "x-bb-api-key": key };
      if (body !== undefined) headers["content-type"] = "application/json";
      const r = await fetch(`${API}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20_000) });
      /** @type {any} */
      let json = null;
      try {
        json = await r.json();
      } catch {
        json = null;
      }
      return { status: r.status, json };
    },
    cdp: connectCdp,
    httpsGet: (url) =>
      new Promise((resolve) => {
        const req = https.get(url, { timeout: 15_000 }, (res) => {
          res.resume();
          resolve(res.statusCode ?? null);
        });
        req.on("timeout", () => req.destroy());
        req.on("error", () => resolve(null));
      }),
    launcher: launcherCall,
    resolve4: async (name) => (await resolver.resolve4(name).catch(() => []))[0] ?? null,
    readFile: (p) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    writeFile: (p, text) => {
      fs.rmSync(p, { force: true });
      fs.writeFileSync(p, text, { mode: 0o600, flag: "wx" });
    },
    searchFiles,
    listDir: (p) => {
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    },
    onSignal: (fn) => {
      for (const sig of SIGNALS) process.on(sig, () => fn(sig));
    },
    exit: (code) => process.exit(code),
    emptyDir: () => {
      const p = fs.mkdtempSync(path.join("/run", "wkbproof-"));
      return { path: p, remove: () => fs.rmSync(p, { recursive: true, force: true }) };
    },
    platform: process.platform,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    key,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    print: (line) => {
      // A dropped SSH session leaves no terminal: a write that fails never stops the cleanup.
      try {
        process.stdout.write(`${line}\n`);
      } catch {
        /* no terminal */
      }
    },
  };
}

/**
 * `node main.mjs isolation-proof [--after-reboot] [--stop-host]`.
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} argv
 */
export async function main(env, argv) {
  // A dropped SSH session closes the terminal: its write errors are not the proof's.
  process.stdout.on("error", () => undefined);
  process.stderr.on("error", () => undefined);
  const deps = systemDeps(env);
  // The key lives in this process only for the run.
  delete env.BROWSER_HOST_KEY;
  return runProof(deps, argv);
}
