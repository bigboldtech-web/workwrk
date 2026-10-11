// Whether the address a page was served from is a private one
// (docs/plans/ai-teammates-phase4.md Decision 10): a main-frame response from
// such an address closes the page before anything is read. The guard checks
// hosts before a request leaves (sites.ts neverReason); this catches a public
// name that resolves to a private address (DNS rebinding, a metadata name).
//
// Private here is every range no public site is served from: loopback,
// RFC 1918, link-local (the cloud metadata services), carrier-grade NAT,
// "this network", the documentation, benchmarking and reserved ranges,
// multicast and broadcast; for IPv6 the loopback, unspecified, unique local,
// link-local, site-local and multicast ranges, and IPv4 written inside IPv6
// (mapped, compatible, 6to4 and NAT64), read as the IPv4 address it holds.
// An address that is not one (empty, malformed) reads as private: the check
// fails closed.
//
// Pure.

/** The four bytes of a dotted IPv4 address, or null. */
function v4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b.every((x) => x >= 0 && x <= 255) ? b : null;
}

function privateV4(b: number[]): boolean {
  const [a, c] = b;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && c >= 64 && c <= 127) return true;
  if (a === 169 && c === 254) return true;
  if (a === 172 && c >= 16 && c <= 31) return true;
  if (a === 192 && c === 168) return true;
  if (a === 192 && c === 0 && (b[2] === 0 || b[2] === 2)) return true;
  if (a === 198 && (c === 18 || c === 19)) return true;
  if (a === 198 && c === 51 && b[2] === 100) return true;
  if (a === 203 && c === 0 && b[2] === 113) return true;
  return a >= 224;
}

/** The eight 16 bit groups of an IPv6 address (an IPv4 tail read too), or null. */
function v6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":")) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const b = v4(last);
    if (!b) return null;
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const read = (part: string) => (part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN)));
  const head = read(halves[0]);
  const rest = halves.length === 2 ? read(halves[1]) : [];
  if ([...head, ...rest].some((g) => Number.isNaN(g))) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }
  if (tail.length === 2) groups = [...groups.slice(0, 6), tail[0], tail[1]];
  return groups;
}

function privateV6(g: number[]): boolean {
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  // :: and ::1
  if (zeroUpTo(7) && (g[7] === 0 || g[7] === 1)) return true;
  const embedded = (hi: number, lo: number) => privateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible)
  if (zeroUpTo(5) && (g[5] === 0xffff || g[5] === 0)) return embedded(g[6], g[7]);
  // 64:ff9b::/96 (NAT64)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]);
  // 2002::/16 (6to4): the IPv4 address in groups 1 and 2
  if (g[0] === 0x2002) return embedded(g[1], g[2]);
  // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;
  if ((g[0] & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 documentation, 100::/64 discard
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true;
  return false;
}

/** Whether a page served from this address must be closed (see the header). */
export function isPrivateAddress(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return true;
  const ip = raw.trim().replace(/^\[|\]$/g, "");
  if (!ip) return true;
  const b4 = v4(ip);
  if (b4) return privateV4(b4);
  const g6 = v6(ip);
  if (g6) return privateV6(g6);
  return true;
}
