// The workspace switch for AI apps (MCP) and its optional allow list
// (docs/plans/mcp-server.md Decision 9, 3.8 step 5, 6.3).
//
// No row means off. The switch is off by default and only Owners and Admins
// turn it on (the policy route, step 2); turning it off revokes every
// connection. The allow list is optional: empty allows every app.
//
// WHAT AN APP IS, for the list: where it sends the person back, the grant's
// `redirectHost`, written by redirectHostOf (src/lib/oauth/redirect-uri.ts):
//   - an https redirect: its host ("claude.ai");
//   - a loopback redirect: "localhost" (an app on this computer);
//   - a private-use scheme: the scheme and a colon ("cursor:").
// A list entry is one of those, or "*.example.com" for a host and every host
// under it. A colon can never be part of a host, so a scheme entry never
// matches a host and the other way round.
//
// Server-only for readMcpPolicy (prisma); the parsers are pure.

import { prisma } from "@/lib/prisma";

export interface McpPolicyView {
  enabled: boolean;
  allowedApps: string[];
}

export const MCP_POLICY_OFF: McpPolicyView = Object.freeze({ enabled: false, allowedApps: [] }) as McpPolicyView;

/** At most this many entries (the SQL CHECK "McpPolicy_values_check"). */
export const ALLOWED_APPS_MAX = 50;

const SCHEME = /^[a-z][a-z0-9+.-]{1,63}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOOPBACK_WORDS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "loopback"]);

/** The workspace's policy, or off when it has no row. */
export async function readMcpPolicy(organizationId: string): Promise<McpPolicyView> {
  const row = await prisma.mcpPolicy.findUnique({ where: { organizationId }, select: { enabled: true, allowedApps: true } });
  if (!row) return MCP_POLICY_OFF;
  return { enabled: row.enabled === true, allowedApps: [...(row.allowedApps ?? [])] };
}

/** Several workspaces' policies at once, off for any with no row. */
export async function readMcpPolicies(organizationIds: readonly string[]): Promise<Map<string, McpPolicyView>> {
  const out = new Map<string, McpPolicyView>();
  if (organizationIds.length === 0) return out;
  const rows = await prisma.mcpPolicy.findMany({
    where: { organizationId: { in: [...organizationIds] } },
    select: { organizationId: true, enabled: true, allowedApps: true },
  });
  for (const id of organizationIds) out.set(id, MCP_POLICY_OFF);
  for (const r of rows) out.set(r.organizationId, { enabled: r.enabled === true, allowedApps: [...(r.allowedApps ?? [])] });
  return out;
}

/**
 * One allow-list entry as a person typed it, in the stored form, or null when
 * it names no app: "claude.ai", "https://claude.ai/x" (the host is kept),
 * "*.example.com", "localhost" (any app on this computer), "cursor:" or
 * "cursor://" (an app scheme).
 */
export function parseAllowedApp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s || s.length > 300) return null;
  if (LOOPBACK_WORDS.has(s)) return "localhost";
  const scheme = /^([a-z][a-z0-9+.-]*):(\/\/)?$/.exec(s);
  if (scheme) {
    const name = scheme[1];
    if (name === "http" || name === "https") return null;
    return SCHEME.test(name) ? `${name}:` : null;
  }
  let host = s;
  if (/^https?:\/\//.test(host)) {
    try {
      const u = new URL(host);
      if (u.username || u.password) return null;
      host = u.hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/\.$/, "");
  if (LOOPBACK_WORDS.has(host)) return "localhost";
  const wildcard = host.startsWith("*.");
  const bare = wildcard ? host.slice(2) : host;
  if (!HOST.test(bare)) return null;
  // "*." only before a name with a dot in it: "*.com" would be every site there.
  if (wildcard && !bare.includes(".")) return null;
  return wildcard ? `*.${bare}` : bare;
}

/** Whether an app (its redirectHost) is on the workspace's list. An empty list allows every app. */
export function appAllowed(allowedApps: readonly string[], redirectHost: string): boolean {
  if (allowedApps.length === 0) return true;
  const h = redirectHost.trim().toLowerCase();
  if (!h) return false;
  return allowedApps.some((raw) => {
    const e = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!e) return false;
    if (e === h) return true;
    if (e.startsWith("*.")) {
      const base = e.slice(2);
      return !h.endsWith(":") && (h === base || h.endsWith(`.${base}`));
    }
    return false;
  });
}

/** The switch and the list together (3.8 step 5): null when allowed, else the revoke reason. */
export function policyRefusal(policy: McpPolicyView, redirectHost: string): "admin_off" | "app_not_allowed" | null {
  if (!policy.enabled) return "admin_off";
  if (!appAllowed(policy.allowedApps, redirectHost)) return "app_not_allowed";
  return null;
}
