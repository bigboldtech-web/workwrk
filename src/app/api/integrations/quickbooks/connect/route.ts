import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionOrFail, getOrgId, isManager, jsonError } from "@/lib/api-helpers";
import { buildAuthUrl, isConfigured } from "@/lib/integrations/quickbooks";

/**
 * Kicks off the QuickBooks OAuth dance.
 *
 * `state` is a random hex token bound to the current org via a
 * signed JSON cookie. The /callback route verifies both sides
 * before exchanging the code for tokens, preventing CSRF / cross-
 * tenant code injection.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  if (!isConfigured()) {
    return jsonError("QuickBooks OAuth credentials are not configured", 503);
  }

  const orgId = getOrgId(session);
  const state = randomBytes(24).toString("hex");
  const payload = JSON.stringify({ orgId, state });
  const url = buildAuthUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set("qb_oauth_state", payload, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min — plenty for a single consent flow
  });
  return res;
}
