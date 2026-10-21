// @ts-check
// The egress firewall's file (docs/plans/browser-host.md Decision 4 and
// 5.4): our own nftables table, inet workwrk_browsers, never Docker's
// DOCKER-USER chain. Pure: the addresses and the host user's uid are passed
// in; install/firewall-check.mjs writes, checks and loads the file as root.
//
// THE FIRST THREE LINES declare, delete and define the table. `nft -f`
// applies a file as one transaction, so a reload replaces the table whole:
// it never appends a second copy of its rules, and is never without them.
//
// FOUR HOOKS:
//   forward   a session reaching anything, judged before anything else, so
//             one session reaching another is refused as private; only
//             replies come back in
//   input     a session reaching the host itself, which DOCKER-USER never sees
//   output    only the host's own user reaches a session at all: its DevTools
//             port, counted devtools_other_user, and any other port of the
//             session range, counted session_other_user (final security
//             review, L4); a reply the kernel sends for no socket (a reset,
//             an ICMP refusal) has no user and is never matched
//   input     the host's public inbound: SSH, HTTP and HTTPS, ICMP, DHCP replies
//
// Session traffic that is not allowed is REJECTED (a TCP reset, or ICMP
// administratively prohibited), never silently dropped, so a refused request
// fails at once instead of hanging for two minutes. Every refusal rule has
// its own counter, named by its comment; the isolation proof reads them.
// The rate rule drops: it is a policer, not a refusal. Its meter keeps one
// element a session bridge, which times out a minute after the bridge's
// last packet (final privacy review), so no bridge's name outlives its
// session in the kernel's tables.
//
// Beside 5.4's text, input_public accepts DHCP replies (UDP 67 to 68, and
// 547 to 546 for DHCPv6): conntrack does not match a broadcast reply to a
// rebinding client, and a lease that cannot renew takes the server off the
// network (worst case of leaving them out; they reach only the DHCP client).

import { BLOCKED_V4, cidrSpan, DEVTOOLS_PORT, isV4, RESOLVERS_V4, SESSION_POOL } from "./ranges.mjs";

/** The table's family and name, as every nft command names it. */
export const TABLE = "inet workwrk_browsers";

/** The counters every refusal carries, by comment (12.3 reads them). */
export const COUNTERS = Object.freeze(["ipv6", "other_dns", "private", "host", "rate", "port", "into_session", "to_host", "devtools_other_user", "session_other_user"]);
/** How long the rate meter keeps a bridge it has not seen a packet from. */
export const RATE_METER_TIMEOUT = "60s";

/**
 * Where the file and the check's mark live on the server: a folder root owns,
 * which the host only reads (install/root-write.mjs; step 3 review, H1).
 */
export const FIREWALL_FILE = "/run/workwrk-browser-firewall/firewall.nft";
export const FIREWALL_OK = "/run/workwrk-browser-firewall/firewall.ok";

/**
 * An IPv4 address or IPv4 CIDR, as nft writes it, or null.
 * @param {string} raw
 */
function v4Element(raw) {
  const t = String(raw).trim();
  if (isV4(t)) return t;
  if (/^[\d.]+\/\d{1,2}$/.test(t) && cidrSpan(t) && isV4(t.split("/")[0])) return t;
  return null;
}

/**
 * The host's own addresses and the app server's, checked, deduplicated and
 * sorted, so the file (and its hash) is the same whatever order `ip` lists them in.
 * @param {readonly string[]} list
 */
export function hostElements(list) {
  /** @type {string[]} */
  const out = [];
  for (const raw of list) {
    const e = v4Element(raw);
    if (e === null) throw new Error("firewall_bad_address");
    if (!out.includes(e)) out.push(e);
  }
  const first = (/** @type {string} */ e) => cidrSpan(e.includes("/") ? e : `${e}/32`)?.first ?? 0;
  return out.sort((a, b) => first(a) - first(b) || a.localeCompare(b));
}

/**
 * The file of 5.4.
 * @param {{ hostV4: readonly string[], blockV4: readonly string[], hostUid: number }} o
 *   hostV4: the host's public IPv4 addresses (`ip -j -4 addr show scope global`)
 *   blockV4: BROWSER_HOST_BLOCK, the app server's addresses
 *   hostUid: wkbhost's uid, the only user that reaches a session's 9222
 * @returns {string}
 */
export function firewallText(o) {
  if (!Number.isInteger(o.hostUid) || o.hostUid < 1 || o.hostUid > 0xfffffffe) throw new Error("firewall_bad_uid");
  const host = hostElements([...o.hostV4, ...o.blockV4]);
  const hostSet = host.length > 0 ? `set host_v4 { type ipv4_addr; flags interval; elements = { ${host.join(", ")} } }` : "set host_v4 { type ipv4_addr; flags interval; }";
  const blocked = BLOCKED_V4;
  return [
    "table inet workwrk_browsers",
    "delete table inet workwrk_browsers",
    "table inet workwrk_browsers {",
    "  set blocked_v4 { type ipv4_addr; flags interval; elements = {",
    `    ${blocked.slice(0, 6).join(", ")},`,
    `    ${blocked.slice(6, 12).join(", ")},`,
    `    ${blocked.slice(12).join(", ")} } }`,
    `  ${hostSet}`,
    `  set resolvers_v4 { type ipv4_addr; elements = { ${RESOLVERS_V4.join(", ")} } }`,
    "",
    "  chain refuse {",
    "    meta l4proto tcp reject with tcp reset",
    "    reject with icmpx type admin-prohibited",
    "  }",
    "  chain from_session {",
    '    meta nfproto ipv6 counter comment "ipv6" jump refuse',
    "    ip daddr @resolvers_v4 udp dport 53 accept",
    "    ip daddr @resolvers_v4 tcp dport 53 accept",
    '    meta l4proto { tcp, udp } th dport 53 counter comment "other_dns" jump refuse',
    '    ip daddr @blocked_v4 counter comment "private" jump refuse',
    '    ip daddr @host_v4 counter comment "host" jump refuse',
    `    meter wkb_rate { iifname timeout ${RATE_METER_TIMEOUT} limit rate over 6 mbytes/second burst 12 mbytes } counter comment "rate" drop`,
    "    tcp dport { 80, 443 } accept",
    "    udp dport 443 accept",
    '    counter comment "port" jump refuse',
    "  }",
    "  chain forward {",
    "    type filter hook forward priority filter - 10; policy accept;",
    // What a session sends is judged first, so one session reaching another is rejected and counted as private (L1).
    '    iifname "wkb-*" jump from_session',
    '    oifname "wkb-*" ct state established,related accept',
    '    oifname "wkb-*" counter comment "into_session" drop',
    "  }",
    "  chain input_sessions {",
    "    type filter hook input priority filter - 10; policy accept;",
    '    iifname "wkb-*" ct state established,related accept',
    '    iifname "wkb-*" counter comment "to_host" jump refuse',
    "  }",
    "  chain output_devtools {",
    "    type filter hook output priority filter - 10; policy accept;",
    `    ip daddr ${SESSION_POOL} tcp dport ${DEVTOOLS_PORT} meta skuid != ${o.hostUid} counter comment "devtools_other_user" reject with tcp reset`,
    `    ip daddr ${SESSION_POOL} meta skuid != ${o.hostUid} counter comment "session_other_user" jump refuse`,
    "  }",
    "  chain input_public {",
    "    type filter hook input priority filter; policy drop;",
    "    iif lo accept",
    "    ct state established,related accept",
    '    iifname "wkb-*" drop',
    "    tcp dport { 22, 80, 443 } accept",
    "    meta nfproto ipv4 udp sport 67 udp dport 68 accept",
    "    meta nfproto ipv6 udp sport 547 udp dport 546 accept",
    "    icmp type { echo-request, destination-unreachable, time-exceeded } limit rate 10/second accept",
    "    icmpv6 type { echo-request, destination-unreachable, packet-too-big, time-exceeded, nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert } accept",
    "  }",
    "}",
    "",
  ].join("\n");
}

/**
 * A listing of the table (`nft -j list table inet workwrk_browsers`) reduced
 * to its meaning: every counter at 0, no rule handles, and no element a
 * dynamic set (the rate meter) learnt from traffic. Two listings with equal
 * meanings are the same table, whatever their counters say.
 * @param {unknown} listing
 * @returns {string} a canonical text of the meaning
 */
export function listingMeaning(listing) {
  const items = listing && typeof listing === "object" && Array.isArray(/** @type {{ nftables?: unknown }} */ (listing).nftables) ? /** @type {{ nftables: unknown[] }} */ (listing).nftables : null;
  if (!items) throw new Error("firewall_bad_listing");
  /** @param {unknown} v @param {string | null} key @returns {unknown} */
  const clean = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => clean(x, null));
    if (!v || typeof v !== "object") return v;
    /** @type {Record<string, unknown>} */
    const src = /** @type {Record<string, unknown>} */ (v);
    /** @type {Record<string, unknown>} */
    const out = {};
    const dynamicSet = key === "set" && Array.isArray(src.flags) && src.flags.includes("dynamic");
    for (const k of Object.keys(src).sort()) {
      if (k === "handle") continue;
      if (dynamicSet && k === "elem") continue;
      if (key === "counter" && (k === "packets" || k === "bytes")) {
        out[k] = 0;
        continue;
      }
      out[k] = clean(src[k], k);
    }
    return out;
  };
  // The listing's own header (nft's version) is not the table.
  const body = items.filter((x) => !(x && typeof x === "object" && "metainfo" in x));
  return JSON.stringify(clean(body, null));
}

/**
 * The host's own public addresses from `ip -j -4 addr show scope global`,
 * leaving out every bridge Docker or a session made (their gateways change
 * with each session and are reached through input_sessions anyway), and the
 * isolation proof's own pair (wkbproof*), whatever scope its address says.
 * @param {unknown} ipJson
 * @returns {string[]}
 */
export function publicAddresses(ipJson) {
  if (!Array.isArray(ipJson)) throw new Error("firewall_bad_ip_listing");
  /** @type {string[]} */
  const out = [];
  for (const link of ipJson) {
    const name = link && typeof link.ifname === "string" ? link.ifname : "";
    // wkbproof*: the isolation proof's own pair (proof/isolation.mjs), never a host address.
    if (!name || /^(wkb-|wkbproof|docker|br-|veth|lo$)/.test(name)) continue;
    for (const a of Array.isArray(link.addr_info) ? link.addr_info : []) {
      if (a && a.family === "inet" && a.scope === "global" && isV4(a.local) && !out.includes(a.local)) out.push(a.local);
    }
  }
  return out;
}
