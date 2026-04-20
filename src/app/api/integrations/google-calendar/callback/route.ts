import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeCode } from "@/services/googleCalendar";

/**
 * Google OAuth redirect target. Validates the state cookie round-trip,
 * exchanges the authorization code for access + refresh tokens, and
 * stores them on a placeholder CalendarSubscription row keyed by
 * (userId, "GOOGLE", null). The user still has to pick *which* Google
 * calendars to sync from on the settings page — that's what the
 * `externalCalendarId` field gets set to on the subscribe call.
 *
 * On success, redirects back to /settings/calendar?connected=1 so the
 * UI can fetch the calendar list and present the picker.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const appBase = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const returnTo = (ok: boolean, msg?: string) => {
    const target = new URL(`${appBase}/settings/calendar`);
    target.searchParams.set(ok ? "connected" : "error", ok ? "1" : (msg ?? "unknown"));
    return NextResponse.redirect(target);
  };

  if (errorParam) return returnTo(false, errorParam);
  if (!code || !state) return returnTo(false, "missing_code_or_state");

  // State format: "<nonce>:<userId>"
  const cookie = req.cookies.get("gcal_state")?.value;
  if (!cookie || cookie !== state) return returnTo(false, "state_mismatch");

  const [, userId] = state.split(":");
  if (!userId) return returnTo(false, "bad_state");

  try {
    const tokens = await exchangeCode(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Create (or refresh) the "master" subscription row that holds the
    // tokens. Per-calendar subscriptions created on subscribe inherit
    // these tokens via the userId lookup.
    await prisma.calendarSubscription.upsert({
      where: {
        userId_provider_externalCalendarId: {
          userId,
          provider: "GOOGLE",
          externalCalendarId: null as unknown as string, // unique index allows null distinctness per Postgres
        },
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? undefined,
        expiresAt,
        enabled: true,
      },
      create: {
        userId,
        provider: "GOOGLE",
        externalCalendarId: null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        direction: "BOTH",
        enabled: true,
      },
    });

    const res = returnTo(true);
    res.cookies.delete("gcal_state");
    return res;
  } catch (err: any) {
    console.error("[GCal callback] exchange failed:", err?.message ?? err);
    return returnTo(false, "exchange_failed");
  }
}
