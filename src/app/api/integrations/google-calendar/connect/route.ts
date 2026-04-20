import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionOrFail, getUserId } from "@/lib/api-helpers";
import { buildAuthUrl, isGoogleEnabled } from "@/services/googleCalendar";

/**
 * Kick off the Google Calendar OAuth dance.
 *
 * Sets a signed HttpOnly `gcal_state` cookie so the callback can verify
 * the round trip wasn't forged. The cookie carries: the CSRF nonce and
 * the userId of the caller (callbacks don't have a session guarantee,
 * especially from cross-site redirects).
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isGoogleEnabled()) {
    return NextResponse.json(
      { error: "Google Calendar sync is not configured on this deployment" },
      { status: 501 },
    );
  }

  const userId = getUserId(session);
  const nonce = randomBytes(16).toString("hex");
  const state = `${nonce}:${userId}`;
  const url = buildAuthUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set("gcal_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60, // 10 minutes
    path: "/",
  });
  return res;
}
