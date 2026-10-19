// @ts-check
// The address ranges the firewall and the launcher share
// (docs/plans/browser-host.md 5.2 and 5.4). Pure.
//
// BLOCKED_V4 is exactly src/lib/browser/addresses.ts privateV4: "this
// network", RFC 1918, loopback, carrier-grade NAT, link-local (the cloud
// metadata services), the IETF, documentation and benchmarking ranges, and
// 224 and above (multicast, reserved and broadcast) as one /3. ranges.test.ts
// holds blockedV4 equal to the app's isPrivateAddress, range by range and
// over 200,000 seeded addresses, so the two never drift apart.
//
// SESSION_POOL is where every session's own /28 bridge lives: the lowest free
// one of its 4,096, its gateway at +1 and its one container at +2.

/** The ranges no session may reach (5.4 blocked_v4). */
export const BLOCKED_V4 = Object.freeze([
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/3",
]);

/** The only resolvers a session may ask (5.4 resolvers_v4): Cloudflare and Quad9. */
export const RESOLVERS_V4 = Object.freeze(["1.1.1.1", "1.0.0.1", "9.9.9.9", "149.112.112.112"]);

/** What each container's own Docker resolver forwards to (5.2 Dns). */
export const CONTAINER_DNS = Object.freeze(["1.1.1.1", "9.9.9.9"]);

/** Every session network's /28 comes from here (5.2). */
export const SESSION_POOL = "10.250.0.0/16";
/** The size of one session's network. */
export const SESSION_PREFIX = 28;
/** The DevTools port inside every session container (5.3). */
export const DEVTOOLS_PORT = 9222;

/**
 * An IPv4 address as an unsigned 32 bit number, or null when it is not one
 * (four decimal parts of at most three digits, each 0 to 255).
 * @param {string} ip
 * @returns {number | null}
 */
export function v4ToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(typeof ip === "string" ? ip : "");
  if (!m) return null;
  const b = m.slice(1).map(Number);
  if (!b.every((x) => x >= 0 && x <= 255)) return null;
  return ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
}

/**
 * A number back to its dotted form.
 * @param {number} n
 */
export function intToV4(n) {
  const u = n >>> 0;
  return [u >>> 24, (u >>> 16) & 255, (u >>> 8) & 255, u & 255].join(".");
}

/**
 * A CIDR's first address and prefix, or null.
 * @param {string} cidr
 * @returns {{ base: number, prefix: number } | null}
 */
export function parseCidr(cidr) {
  const m = /^([^/]+)\/(\d{1,2})$/.exec(typeof cidr === "string" ? cidr : "");
  if (!m) return null;
  const ip = v4ToInt(m[1]);
  const prefix = Number(m[2]);
  if (ip === null || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (ip & mask) >>> 0, prefix };
}

/**
 * The first and last address of a CIDR.
 * @param {string} cidr
 * @returns {{ first: number, last: number } | null}
 */
export function cidrSpan(cidr) {
  const c = parseCidr(cidr);
  if (!c) return null;
  const size = 2 ** (32 - c.prefix);
  return { first: c.base, last: c.base + size - 1 };
}

const BLOCKED_SPANS = BLOCKED_V4.map((c) => /** @type {{ first: number, last: number }} */ (cidrSpan(c)));

/**
 * Whether no session may reach this IPv4 address. Anything that is not an
 * IPv4 address reads as blocked: the check fails closed, as the app's does.
 * @param {string} ip
 */
export function blockedV4(ip) {
  const n = v4ToInt(ip);
  if (n === null) return true;
  return BLOCKED_SPANS.some((s) => n >= s.first && n <= s.last);
}

/**
 * Whether a string is a plain IPv4 address.
 * @param {unknown} ip
 */
export function isV4(ip) {
  return typeof ip === "string" && v4ToInt(ip) !== null;
}

/**
 * The /28 numbered `index` (0 to 4,095) of the session pool: its subnet, gateway and container address.
 * @param {number} index
 * @returns {{ subnet: string, gateway: string, ip: string }}
 */
export function sessionSubnet(index) {
  const pool = /** @type {{ base: number, prefix: number }} */ (parseCidr(SESSION_POOL));
  const base = pool.base + index * 16;
  return { subnet: `${intToV4(base)}/${SESSION_PREFIX}`, gateway: intToV4(base + 1), ip: intToV4(base + 2) };
}

/** How many /28s the pool holds. */
export const SESSION_SUBNETS = 2 ** (SESSION_PREFIX - 16);

/**
 * Whether two CIDRs share any address.
 * @param {string} a
 * @param {string} b
 */
export function overlaps(a, b) {
  const x = cidrSpan(a);
  const y = cidrSpan(b);
  if (!x || !y) return false;
  return x.first <= y.last && y.first <= x.last;
}

/**
 * The lowest /28 of the pool that overlaps none of `taken` (every subnet any
 * Docker network uses), or null when all 4,096 are in use.
 * @param {readonly string[]} taken
 * @returns {{ index: number, subnet: string, gateway: string, ip: string } | null}
 */
export function lowestFreeSubnet(taken) {
  const spans = taken.map(cidrSpan).filter((s) => s !== null);
  for (let i = 0; i < SESSION_SUBNETS; i += 1) {
    const s = sessionSubnet(i);
    const span = /** @type {{ first: number, last: number }} */ (cidrSpan(s.subnet));
    if (!spans.some((t) => t.first <= span.last && span.first <= t.last)) return { index: i, ...s };
  }
  return null;
}

/**
 * Whether an address is a session container's (+2 of a pool /28).
 * @param {unknown} ip
 */
export function isSessionIp(ip) {
  const n = typeof ip === "string" ? v4ToInt(ip) : null;
  const pool = /** @type {{ first: number, last: number }} */ (cidrSpan(SESSION_POOL));
  return n !== null && n >= pool.first && n <= pool.last && (n - pool.first) % 16 === 2;
}
