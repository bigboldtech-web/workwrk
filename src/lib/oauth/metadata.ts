// The discovery documents (docs/plans/mcp-server.md 3.2): RFC 9728 protected
// resource metadata and RFC 8414 authorization server metadata, exactly as
// the spec lists them. `resource_documentation` and `service_documentation`
// are left out while MCP_DOCS_URL is unset, never pointed at a guess.
//
// GET answers JSON with `Cache-Control: public, max-age=300` and
// `Access-Control-Allow-Origin: *`; OPTIONS allows GET and OPTIONS and the
// headers a 2025-06-18 browser client sends on discovery.
//
// Pure (reads only the configuration).

import { ISSUER, MCP_DOCS_URL, MCP_RESOURCE } from "@/lib/mcp/config";

export const SCOPES = ["mcp:read", "mcp:write"] as const;
export type McpScope = (typeof SCOPES)[number];

export function protectedResourceMetadata(): Record<string, unknown> {
  const docs = MCP_DOCS_URL();
  return {
    resource: MCP_RESOURCE(),
    authorization_servers: [ISSUER()],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "WorkwrK",
    ...(docs ? { resource_documentation: docs } : {}),
  };
}

export function authorizationServerMetadata(): Record<string, unknown> {
  const iss = ISSUER();
  const docs = MCP_DOCS_URL();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/api/oauth/token`,
    registration_endpoint: `${iss}/api/oauth/register`,
    revocation_endpoint: `${iss}/api/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    ...(docs ? { service_documentation: docs } : {}),
  };
}

const METADATA_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300",
  "Access-Control-Allow-Origin": "*",
} as const;

/** The GET answer for a discovery document. */
export function metadataResponse(doc: Record<string, unknown>): Response {
  return new Response(JSON.stringify(doc), { status: 200, headers: METADATA_HEADERS });
}

/** The OPTIONS answer for a discovery document. */
export function metadataPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "MCP-Protocol-Version, Content-Type, Authorization",
      "Access-Control-Max-Age": "600",
    },
  });
}

/** Scopes from a space-separated list: unknown ones dropped, write implies read, none left means both (3.4 step 4). */
export function requestedScopes(raw: string | null | undefined): McpScope[] {
  const asked = new Set((raw ?? "").split(/\s+/).filter(Boolean));
  const write = asked.has("mcp:write");
  const read = asked.has("mcp:read") || write;
  if (!read) return ["mcp:read", "mcp:write"];
  return write ? ["mcp:read", "mcp:write"] : ["mcp:read"];
}
