// The one place the app decides which address a request came from.
//
// Every per-address rate limit, the sign-in throttle, the security activity
// log, API key "last used from" and the evidence on acknowledgements read the
// address here. An earlier version of each took the FIRST x-forwarded-for
// hop. Behind nginx that hop is whatever the client claimed
// ($proxy_add_x_forwarded_for appends the real address after it), so anyone
// could pick a fresh address per request, walk around every per-address limit
// and leave a made-up address in the log.
//
// The order a client cannot forge: x-real-ip first (nginx sets it to the
// address it accepted the connection from, replacing anything the client
// sent; scripts/DEPLOY-NOTES.md), then the LAST x-forwarded-for hop (the one
// nginx added). Next.js only fills x-forwarded-for with the socket address
// when the header is absent and never appends to it, so locally, with no
// proxy, the last hop is the socket address. A value that is not shaped like
// an address counts as absent, so junk is never keyed on or stored. Null when
// nothing is known; never a guess.

type ReadHeader = (name: string) => string | null | undefined;

/** IPv4, IPv6 and IPv4-mapped IPv6 only: hex digits, dots and colons. */
const ADDRESS = /^[0-9A-Fa-f:.]{2,45}$/;

function asAddress(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && ADDRESS.test(v) ? v : null;
}

/** The trusted client address, given a way to read one request header. */
export function clientIpFrom(read: ReadHeader): string | null {
  const real = asAddress(read("x-real-ip"));
  if (real) return real;
  const raw = read("x-forwarded-for");
  if (!raw) return null;
  const hops = raw.split(",");
  // The last hop only: an empty last hop means nothing trustworthy was added,
  // and the hops before it are the client's own claim.
  return asAddress(hops[hops.length - 1]);
}

/** The trusted client address from a fetch Headers (or anything with `get`). */
export function clientIpFromHeaders(
  headers: { get(name: string): string | null } | null | undefined,
): string | null {
  if (!headers || typeof headers.get !== "function") return null;
  return clientIpFrom((name) => headers.get(name));
}

/**
 * The trusted client address from a plain header record, the shape NextAuth
 * hands `authorize` (lower-case keys). Node joins a repeated header with ", ",
 * so an array only comes from a hand-built object; it is joined the same way.
 */
export function clientIpFromRecord(
  headers: Record<string, string | string[] | undefined> | null | undefined,
): string | null {
  if (!headers) return null;
  return clientIpFrom((name) => {
    const v = headers[name];
    return Array.isArray(v) ? v.join(", ") : v;
  });
}
