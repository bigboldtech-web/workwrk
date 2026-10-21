// Redirect URIs: what may be registered, how a request matches one, and what
// a person is told about where they go (docs/plans/mcp-server.md Decision 3,
// 3.3, 3.4).
//
// REGISTERED, each at most 2,000 characters, with no fragment, no user
// information, no spaces or control characters, and one of:
//   - https on a host that is not ours (MCP_ORIGIN's, APP_HOST, MARKETING_HOST,
//     ADMIN_HOST, and any host equal to or under workwrk.com or COOKIE_DOMAIN);
//   - loopback http (127.0.0.1, [::1], localhost) on any port (RFC 8252 7.3),
//     never the port our own server answers on when it is itself on loopback
//     (local development);
//   - a private-use scheme (RFC 8252 7.1) that is not on the refused list.
// Also refused: a URI whose path or query holds an absolute URL (http:,
// https:, "//" or %2F%2F after the host, as written or decoded), the shape of
// a trusted page that forwards wherever its query says (Google's url?q=).
// Worst cases answered: a code delivered to a page on our own origin, and a
// trusted-looking host that hands the code on.
//
// MATCHED exactly, string for string, except that a loopback URI matches on
// any port. A request with no redirect_uri uses the only one registered.
//
// Pure (reads only the configuration).

import { mcpOrigin, ownHosts } from "@/lib/mcp/config";
import { MCP_LABEL_COPY } from "@/lib/mcp/mcp-copy";

export const REDIRECT_URI_MAX = 2000;
export const REDIRECT_URIS_MAX = 5;

const SCHEME = /^[a-z][a-z0-9+.-]{1,63}$/;
/** Schemes a browser or the OS treats as something other than "open this app" (3.3). */
export const REFUSED_SCHEMES: ReadonlySet<string> = new Set([
  "http", "https", "javascript", "data", "file", "blob", "about", "vbscript", "filesystem", "ws", "wss", "ftp",
  "mailto", "tel", "sms", "intent", "chrome", "chrome-extension", "moz-extension", "ms-browser-extension",
  "view-source", "jar",
]);
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]", "localhost"]);

export type RedirectKind = "https" | "loopback" | "app";

export type RedirectCheck = { ok: true; kind: RedirectKind; uri: string } | { ok: false; why: string };

function normalHost(h: string): string {
  return h.trim().toLowerCase().replace(/\.$/, "");
}

/** Is this host one of ours? */
export function isOwnHost(host: string): boolean {
  const h = normalHost(host);
  if (!h) return false;
  const own = ownHosts();
  if (own.exact.includes(h)) return true;
  return own.suffixes.some((s) => h === s || h.endsWith(`.${s}`));
}

/** Our own server's loopback port, when it runs on loopback (local development), else null. */
function ownLoopbackPort(): string | null {
  const origin = mcpOrigin();
  if (!origin) return null;
  const u = new URL(origin);
  if (!LOOPBACK_HOSTS.has(normalHost(u.hostname))) return null;
  return u.port || (u.protocol === "https:" ? "443" : "80");
}

/** Does the part after the host carry an absolute URL, written or encoded? */
function embedsAbsoluteUrl(u: URL): boolean {
  const tail = `${u.pathname}${u.search}`;
  if (/https?:/i.test(tail) || /%2f%2f/i.test(tail) || tail.includes("//")) return true;
  let decoded: string;
  try {
    decoded = decodeURIComponent(tail.replace(/\+/g, " "));
  } catch {
    return true;
  }
  return /https?:/i.test(decoded) || decoded.includes("//") || /%2f%2f/i.test(decoded);
}

/** May this URI be registered (and, with a matching registration, be sent a code)? */
export function checkRedirectUri(raw: unknown): RedirectCheck {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, why: "it is empty" };
  if (raw.length > REDIRECT_URI_MAX) return { ok: false, why: "it is longer than 2000 characters" };
  if (/[\u0000- \u007f-\u009f]/.test(raw)) return { ok: false, why: "it holds spaces or control characters" };
  if (raw.includes("#")) return { ok: false, why: "it has a fragment" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, why: "it is not an absolute URI" };
  }
  if (u.username || u.password || /^[a-z][a-z0-9+.-]*:\/\/[^/?]*@/i.test(raw)) return { ok: false, why: "it holds user information" };
  const scheme = u.protocol.replace(/:$/, "").toLowerCase();
  if (scheme === "https") {
    const host = normalHost(u.hostname);
    if (!host) return { ok: false, why: "it has no host" };
    if (isOwnHost(host)) return { ok: false, why: "it is one of WorkwrK's own addresses" };
    if (embedsAbsoluteUrl(u)) return { ok: false, why: "it carries another address in its path or query" };
    return { ok: true, kind: "https", uri: raw };
  }
  if (scheme === "http") {
    const host = normalHost(u.hostname);
    if (!LOOPBACK_HOSTS.has(host)) return { ok: false, why: "http is allowed only on this computer (loopback)" };
    const own = ownLoopbackPort();
    if (own && (u.port || "80") === own) return { ok: false, why: "it is one of WorkwrK's own addresses" };
    if (embedsAbsoluteUrl(u)) return { ok: false, why: "it carries another address in its path or query" };
    return { ok: true, kind: "loopback", uri: raw };
  }
  if (!SCHEME.test(scheme) || REFUSED_SCHEMES.has(scheme)) return { ok: false, why: "its scheme is not allowed" };
  if (embedsAbsoluteUrl(u)) return { ok: false, why: "it carries another address in its path or query" };
  return { ok: true, kind: "app", uri: raw };
}

/** Is this a loopback http URI? */
export function isLoopbackUri(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" && LOOPBACK_HOSTS.has(normalHost(u.hostname));
  } catch {
    return false;
  }
}

/**
 * The redirect a request may use: the given one when it equals a registered
 * one exactly (a loopback one on any port), the only registered one when none
 * is given, else null. The given one must itself pass checkRedirectUri.
 */
export function matchRedirect(registered: readonly string[], given: string | null | undefined): string | null {
  if (given === null || given === undefined || given === "") return registered.length === 1 ? registered[0] : null;
  if (!checkRedirectUri(given).ok) return null;
  if (registered.includes(given)) return given;
  if (!isLoopbackUri(given)) return null;
  const g = new URL(given);
  for (const r of registered) {
    if (!isLoopbackUri(r)) continue;
    const ru = new URL(r);
    if (ru.protocol === g.protocol && normalHost(ru.hostname) === normalHost(g.hostname) && ru.pathname === g.pathname && ru.search === g.search) return given;
  }
  return null;
}

/** The scheme of a private-use redirect, lower case. */
function schemeOf(raw: string): string {
  return new URL(raw).protocol.replace(/:$/, "").toLowerCase();
}

/**
 * What an app IS for the allow list and the grant (src/lib/mcp/policy.ts):
 * an https redirect's host, "localhost" for loopback, "<scheme>:" for an app
 * scheme. At most 255 characters (the SQL CHECK).
 */
export function redirectHostOf(raw: string): string {
  const u = new URL(raw);
  if (u.protocol === "https:") return normalHost(u.hostname).slice(0, 255);
  if (isLoopbackUri(raw)) return "localhost";
  return `${schemeOf(raw)}:`.slice(0, 255);
}

/** The words for where a redirect goes: its https host, "an app on this computer", "the cursor app". At most 60 characters. */
export function redirectLabelOf(raw: string): string {
  const u = new URL(raw);
  if (u.protocol === "https:") {
    const host = normalHost(u.hostname);
    // The right end of a host is the part that names its owner.
    return host.length > 60 ? `…${host.slice(host.length - 59)}` : host;
  }
  if (isLoopbackUri(raw)) return MCP_LABEL_COPY.loopback;
  return MCP_LABEL_COPY.scheme(schemeOf(raw).slice(0, 48));
}

/** The redirect with these parameters set (existing ones kept). Null values are left out. */
export function withParams(raw: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(raw);
  for (const [k, v] of Object.entries(params)) if (typeof v === "string") u.searchParams.set(k, v);
  return u.toString();
}
