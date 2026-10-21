// POST /oauth/decision (docs/plans/mcp-server.md 3.4), the consent form's
// Allow or Deny, as one function the route answers with.
//
//   1. THE ORIGIN: `new URL(Origin).origin === MCP_ORIGIN`, or with no Origin
//      `new URL(Referer).origin === MCP_ORIGIN`, compared as origins, never
//      as prefixes ("https://app.workwrk.com.evil.example" is another
//      origin). SameSite is not counted: under COOKIE_DOMAIN every WorkwrK
//      subdomain is the same site. Else 403;
//   2. THE SESSION: present, and freshWorkspaceActor ok, else 403 stale;
//   3. THE REQUEST: found and not expired, bound to this viewer, with the csrf
//      of the form last shown to them (constant time), else 403;
//   4. TAKEN ONCE: a guarded delete, so of two submits one finds it (for
//      Allow, inside grantConsent's transaction, under the client's lock);
//   5. Deny: 303 to the app with access_denied;
//   6. Allow: a hold on the session's own workspace sends the person to its
//      hold page (the request left for after it); the workspace must still
//      be eligible, write only if the app asked; then grants.ts
//      grantConsent under the person's lock, the policy's and the client's;
//   7. 303 to the app with code, state and iss (RFC 9207).
// 20 a minute per person. A refusal is a 403 page that sends the browser on
// to the consent page's own sentence for it, never to the app.
//
// Server-only.

import { MFA_HOLD_PAGE, PASSWORD_HOLD_PAGE } from "@/lib/auth/mfa-hold";
import { ISSUER, MCP_ORIGIN } from "@/lib/mcp/config";
import { MCP_CONSENT_COPY, MCP_OAUTH_COPY } from "@/lib/mcp/mcp-copy";
import { appLabel } from "./app-label";
import { findClient } from "./clients";
import { mcpWorkspacesFor } from "./eligibility";
import { readForm } from "./form";
import { grantConsent } from "./grants";
import { decisionLimit } from "./limits";
import type { McpScope } from "./metadata";
import { redirectHostOf, withParams } from "./redirect-uri";
import { formMatches, readRequest, takeRequest } from "./requests";
import { consentSession } from "./session";
import { isWellFormed } from "./tokens";

const DECISION_FORM_MAX = 8 * 1024;

export type DecisionOutcome =
  | { kind: "redirect"; to: string }
  | { kind: "refuse"; status: 400 | 403 | 413 | 415 | 429 | 500; view: "refused" | "stale" | "expired" | "tooMany"; request: string | null };

/** Is the form posted from our own origin (Origin, else Referer, compared as origins)? */
export function sameOriginPost(headers: Headers): boolean {
  const expected = MCP_ORIGIN();
  const origin = headers.get("origin");
  if (origin !== null) {
    try {
      return new URL(origin).origin === expected;
    } catch {
      return false;
    }
  }
  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

const FIELDS = ["request", "csrf", "action", "workspace", "access"] as const;

export async function decide(req: Request, now: Date = new Date()): Promise<DecisionOutcome> {
  const refuse = (status: 400 | 403 | 413 | 415 | 429, view: "refused" | "stale" | "expired" | "tooMany", request: string | null = null): DecisionOutcome => ({ kind: "refuse", status, view, request });

  // 1.
  if (!sameOriginPost(req.headers)) return refuse(403, "refused");
  const read = await readForm(req, DECISION_FORM_MAX);
  if (!read.ok) return refuse(read.status, "refused");
  const form = read.form;
  if (FIELDS.some((f) => form.getAll(f).length > 1)) return refuse(400, "refused");
  const token = form.get("request");
  const requestToken = isWellFormed("request", token) ? token : null;

  // 2.
  const session = await consentSession();
  if (session.kind !== "ok") return refuse(403, "stale", requestToken);
  if (!decisionLimit(session.userId).ok) return refuse(429, "tooMany");

  // 3.
  const request = await readRequest(requestToken, now);
  if (!request) return refuse(403, "expired");
  if (!formMatches(request, session.userId, form.get("csrf"))) return refuse(403, "refused");
  const client = await findClient(request.clientId);
  if (!client || client.disabledAt) return refuse(403, "refused");

  const back = (params: Record<string, string | null>) => withParams(request.redirectUri, { ...params, state: request.state, iss: ISSUER() });
  const denied = (description: string) => ({ kind: "redirect" as const, to: back({ error: "access_denied", error_description: description }) });
  const take = () => takeRequest(request, session.userId, now);

  // 4 and 5. Deny: taken once, then back to the app.
  if (form.get("action") !== "allow") {
    if (!(await take())) return refuse(403, "refused");
    return denied(MCP_OAUTH_COPY.denied);
  }

  // 6. Allow. The workspaces are read before the request is taken, so a hold
  // on the session's own workspace sends the person to its hold page, as the
  // consent page does, with the request still there for after it.
  const redirectHost = redirectHostOf(request.redirectUri);
  const elig = await mcpWorkspacesFor({ userId: session.userId, sessionOrgId: session.organizationId, authAt: session.authAt, redirectHost });
  if (elig.ownEnded) return refuse(403, "stale");
  if (elig.held === "mfa") return { kind: "redirect", to: MFA_HOLD_PAGE };
  if (elig.held === "password") return { kind: "redirect", to: PASSWORD_HOLD_PAGE };
  const workspace = elig.workspaces.find((w) => w.id === form.get("workspace"));
  if (!workspace) {
    if (!(await take())) return refuse(403, "refused");
    return denied(MCP_OAUTH_COPY.unavailable);
  }
  const write = form.get("access") === "write" && request.scopes.includes("mcp:write");
  const scopes: McpScope[] = write ? ["mcp:read", "mcp:write"] : ["mcp:read"];
  // The request is taken inside the consent's own transaction, under the client's lock (grants.ts).
  const granted = await grantConsent({
    userId: session.userId,
    organizationId: workspace.id,
    clientId: client.id,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    resource: request.resource,
    scopes,
    appName: appLabel(client.name, request.redirectUri),
    redirectHost,
    sessionTokenVersion: session.tokenVersion,
    sessionMaxDays: workspace.sessionMaxDays,
    take: { requestId: request.id, viewerId: session.userId, csrfHash: request.csrfHash },
    now,
  });
  if (!granted.ok) {
    if (granted.reason === "taken") return refuse(403, "refused");
    if (granted.reason === "stale") return refuse(403, "stale", requestToken);
    // Unavailable (refused before the take) or too many (after it): the request ends here either way.
    if (granted.reason === "unavailable") await take();
    return denied(MCP_OAUTH_COPY.unavailable);
  }

  // 7.
  return { kind: "redirect", to: back({ code: granted.code }) };
}

/** A refusal's answer: its status, and a page that moves on to the consent page's sentence (never to the app). */
export function refusalResponse(o: Extract<DecisionOutcome, { kind: "refuse" }>): Response {
  const q = new URLSearchParams({ view: o.view });
  if (o.request) q.set("request", o.request);
  // Our own path with a fixed word and a base64url token: nothing to escape but the ampersand.
  const href = `/oauth/consent?${q.toString()}`.replace(/&/g, "&amp;");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${href}"><title>WorkwrK</title></head><body><p><a href="${href}">${MCP_CONSENT_COPY.continue}</a></p></body></html>`;
  return new Response(html, {
    status: o.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(o.status === 429 ? { "Retry-After": "60" } : {}) },
  });
}

/** The 303 to the app. */
export function redirectResponse(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}
