// SCIM 2.0 discovery endpoint (RFC 7644 §4). IdPs hit this once to
// learn what we support so they can adjust their request shape.
// Bearer-authed like the rest, but most IdPs allow public discovery
// — we keep auth on for least surprise.

import { NextRequest, NextResponse } from "next/server";
import { authenticateScim, scimResponse } from "@/lib/scim-auth";

export async function GET(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;

  return scimResponse({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://workwrk.com/docs/scim",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Bearer token minted in WorkWrk Settings → Identity",
        primary: true,
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: new URL(req.url).toString(),
    },
  });
}

// SCIM also needs this exact path to allow CORS preflight from some
// IdP test consoles. Empty 200 is enough.
export function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
