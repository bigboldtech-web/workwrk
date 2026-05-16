import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionOrFail, getOrgId, isManager, jsonError } from "@/lib/api-helpers";
import { buildAuthUrl, isConfigured } from "@/lib/integrations/xero";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  if (!isConfigured()) {
    return jsonError("Xero OAuth credentials are not configured", 503);
  }

  const orgId = getOrgId(session);
  const state = randomBytes(24).toString("hex");
  const payload = JSON.stringify({ orgId, state });
  const url = buildAuthUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set("xero_oauth_state", payload, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
