// GET /oauth/authorize (docs/plans/mcp-server.md 3.4), as one function the
// page renders, so the order of its checks is testable on its own.
//
//   1. an unknown, malformed or disabled client: the page `unknownApp`, with
//      no link (nothing it names can be trusted);
//   2. a redirect the client did not register (matched exactly, a loopback
//      one on any port): the page `badRedirect`, with no link;
//   3. every other error renders `appError` with a "Back to <label>" link to
//      the redirect carrying error, error_description, state and iss.
//      NOTHING REDIRECTS BY ITSELF (review M1): WorkwrK is never a hop that
//      bounces a browser to wherever a stranger's registration says.
//        unsupported_response_type: response_type other than code;
//        invalid_request: a parameter sent twice, a bad challenge, a method
//          other than S256, a state over 4,096 characters;
//        invalid_target: a resource other than MCP_RESOURCE (absent means it);
//   4. scopes: unknown ones dropped, write implies read, none means both;
//   5. the pending request stored for 10 minutes; 300 an address per 10
//      minutes, counted first, which also caps its live pending requests;
//   6. on to the consent page, through /login when signed out.
//
// Server-only.

import { ISSUER, MCP_RESOURCE, isOurResource } from "@/lib/mcp/config";
import { MCP_OAUTH_COPY } from "@/lib/mcp/mcp-copy";
import { appLabel } from "./app-label";
import { findClient } from "./clients";
import { authorizeLimit } from "./limits";
import { requestedScopes } from "./metadata";
import { validChallenge } from "./pkce";
import { matchRedirect, withParams } from "./redirect-uri";
import { createRequest } from "./requests";

export const STATE_MAX = 4096;

export type AuthorizeView =
  | { kind: "redirect"; to: string }
  | { kind: "error"; error: "unknownApp" | "badRedirect" | "tooMany" }
  | { kind: "appError"; label: string; backHref: string };

/** The consent page's address for a request token. */
export function consentPath(requestToken: string): string {
  return `/oauth/consent?request=${encodeURIComponent(requestToken)}`;
}

/** The sign-in page with the consent page as its callback. */
export function loginPathFor(requestToken: string | null): string {
  return requestToken ? `/login?callbackUrl=${encodeURIComponent(consentPath(requestToken))}` : "/login";
}

const SINGLE = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method"] as const;

export async function authorizeStep(query: URLSearchParams, ctx: { ip: string; signedIn: boolean; now?: Date }): Promise<AuthorizeView> {
  if (!authorizeLimit(ctx.ip).ok) return { kind: "error", error: "tooMany" };

  // 1. The client.
  if (query.getAll("client_id").length !== 1) return { kind: "error", error: "unknownApp" };
  const client = await findClient(query.get("client_id"));
  if (!client || client.disabledAt) return { kind: "error", error: "unknownApp" };

  // 2. The redirect.
  if (query.getAll("redirect_uri").length > 1) return { kind: "error", error: "badRedirect" };
  const redirect = matchRedirect(client.redirectUris, query.get("redirect_uri"));
  if (!redirect) return { kind: "error", error: "badRedirect" };

  // 3. Everything else goes back to the app, by the person's own click.
  const label = appLabel(client.name, redirect);
  const stateRaw = query.get("state");
  const state = stateRaw !== null && stateRaw.length <= STATE_MAX ? stateRaw : null;
  const back = (error: string, description: string): AuthorizeView => ({
    kind: "appError",
    label,
    backHref: withParams(redirect, { error, error_description: description, state, iss: ISSUER() }),
  });
  if (SINGLE.some((n) => query.getAll(n).length > 1)) return back("invalid_request", MCP_OAUTH_COPY.repeated);
  if (query.get("response_type") !== "code") return back("unsupported_response_type", MCP_OAUTH_COPY.responseType);
  const challenge = query.get("code_challenge");
  if (!validChallenge(challenge, query.get("code_challenge_method"))) return back("invalid_request", MCP_OAUTH_COPY.pkce);
  if (stateRaw !== null && stateRaw.length > STATE_MAX) return back("invalid_request", MCP_OAUTH_COPY.stateTooLong);
  const resources = query.getAll("resource");
  if (resources.some((r) => !isOurResource(r))) return back("invalid_target", MCP_OAUTH_COPY.target);

  // 4 and 5.
  const token = await createRequest({
    clientId: client.id,
    redirectUri: redirect,
    scopes: requestedScopes(query.get("scope")),
    state: stateRaw,
    codeChallenge: challenge as string,
    resource: MCP_RESOURCE(),
    now: ctx.now,
  });

  // 6.
  return { kind: "redirect", to: ctx.signedIn ? consentPath(token) : loginPathFor(token) };
}
