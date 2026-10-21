// The WorkwrK MCP server's configuration (docs/plans/mcp-server.md 3.1).
//
// ONE SWITCH. Nothing of the MCP server or its OAuth authorization server
// answers until MCP_OFFERED=1: every route is a 404 and the consent page
// renders nothing, so production is unchanged until the founder sets it
// (Decision 1; worst case without it: open registration before counsel has
// read the privacy text).
//
// ONE ORIGIN. MCP_ORIGIN is the origin of NEXTAUTH_URL. In production it must
// be https and equal "https://" + APP_HOST, or nothing is offered: the issuer,
// every endpoint in the metadata and the resource all name it, and a second
// URL for one resource is a worst case of its own. ISSUER is MCP_ORIGIN and
// MCP_RESOURCE is MCP_ORIGIN + "/api/mcp".
//
// Read at call time, so a test (or a reload with --update-env) changes it.

const TRUE = new Set(["1", "true"]);

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function hostOnly(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/** The origin of NEXTAUTH_URL, or null when it is unset or not a URL. */
export function mcpOrigin(): string | null {
  const raw = process.env.NEXTAUTH_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** True only when MCP_OFFERED is set and the origin is one the server may name. */
export function mcpOffered(): boolean {
  if (!TRUE.has((process.env.MCP_OFFERED ?? "").trim().toLowerCase())) return false;
  const origin = mcpOrigin();
  if (!origin) return false;
  if (isProduction()) {
    const appHost = process.env.APP_HOST?.trim();
    if (!appHost) return false;
    if (origin !== `https://${hostOnly(appHost)}`) return false;
  }
  return true;
}

/** MCP_ORIGIN, for code that already checked mcpOffered(). Throws when it is unset, never a guess. */
export function MCP_ORIGIN(): string {
  const o = mcpOrigin();
  if (!o) throw new Error("mcp_origin_unset");
  return o;
}

/** The issuer (RFC 8414): MCP_ORIGIN. */
export function ISSUER(): string {
  return MCP_ORIGIN();
}

/** The one protected resource (RFC 8707, RFC 9728). */
export function MCP_RESOURCE(): string {
  return `${MCP_ORIGIN()}/api/mcp`;
}

/** The public docs page for connecting an app, or null while it is unset. */
export function MCP_DOCS_URL(): string | null {
  const raw = process.env.MCP_DOCS_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || (!isProduction() && u.protocol === "http:") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** MCP_PROOF_LIMITS=1: the live proof's short registration window. Never in production. */
export function proofLimits(): boolean {
  return !isProduction() && TRUE.has((process.env.MCP_PROOF_LIMITS ?? "").trim().toLowerCase());
}

/**
 * In production a request is served only on the app host (2.1 step 1): the
 * Host header, port stripped, equals APP_HOST. Anywhere else every host is
 * served (local servers run on their own ports).
 */
export function onMcpHost(hostHeader: string | null | undefined): boolean {
  if (!isProduction()) return true;
  const appHost = process.env.APP_HOST?.trim();
  if (!appHost || !hostHeader) return false;
  return hostOnly(hostHeader.replace(/:\d+$/, "")) === hostOnly(appHost.replace(/:\d+$/, ""));
}

/** Both gates at once: offered, and on the right host. */
export function mcpServes(hostHeader: string | null | undefined): boolean {
  return mcpOffered() && onMcpHost(hostHeader);
}

/**
 * A `resource` value as RFC 8707 compares it: an absolute URI, no fragment and
 * no query, scheme and host lower case, the default port dropped, one trailing
 * slash ignored. Null when it is not such a URI.
 */
export function normalResource(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.hash || u.search || u.username || u.password) return null;
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : "";
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}

/** True when `raw` names MCP_RESOURCE. */
export function isOurResource(raw: string): boolean {
  return normalResource(raw) === MCP_RESOURCE();
}

/** Hosts that are ours (3 Refinements): never a redirect target. Lower case, no port. */
export function ownHosts(): { exact: string[]; suffixes: string[] } {
  const exact = new Set<string>();
  const suffixes = new Set<string>(["workwrk.com"]);
  const origin = mcpOrigin();
  if (origin) exact.add(hostOnly(new URL(origin).hostname));
  for (const key of ["APP_HOST", "MARKETING_HOST", "ADMIN_HOST"] as const) {
    const v = process.env[key]?.trim();
    if (v) exact.add(hostOnly(v.replace(/:\d+$/, "")));
  }
  const cookieDomain = process.env.COOKIE_DOMAIN?.trim();
  if (cookieDomain) {
    const d = hostOnly(cookieDomain.replace(/^\./, ""));
    if (d) suffixes.add(d);
  }
  return { exact: [...exact].filter(Boolean), suffixes: [...suffixes].filter(Boolean) };
}
