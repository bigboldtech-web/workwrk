import { prisma } from "@/lib/prisma";
import type { CalendarSubscription } from "@/generated/prisma";

/**
 * Google Calendar OAuth + REST client.
 *
 * We deliberately don't pull in `googleapis` (heavy, ships dozens of
 * unrelated service clients). Google's Calendar API v3 is a clean REST
 * surface — fetch + careful typing is enough.
 *
 * Scopes requested: `.../auth/calendar` — full read/write. Subscription
 * `direction` controls whether we *use* write access (OUT/BOTH) even
 * though the token can.
 *
 * Token refresh: `accessToken` is short-lived (~1h). The `expiresAt` on
 * CalendarSubscription tells us when to refresh. `ensureFreshToken`
 * handles refresh-as-needed before every API call.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/calendar/v3";
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export const GOOGLE_CAL_SOURCE = "GCAL";

export function isGoogleEnabled(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(): string {
  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${base}/api/integrations/google-calendar/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",      // get refresh_token
    prompt: "consent",           // force refresh_token on every connect
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  return res.json();
}

/** Reads the subscription's token; if expired (or expiring in <60s),
 *  refreshes and persists the new access token. Returns the fresh
 *  access token ready to use. */
export async function ensureFreshToken(sub: CalendarSubscription): Promise<string> {
  const buffer = 60 * 1000; // 1 min
  if (sub.accessToken && sub.expiresAt && sub.expiresAt.getTime() - Date.now() > buffer) {
    return sub.accessToken;
  }
  if (!sub.refreshToken) throw new Error("No refresh token stored; user must reconnect");
  const data = await refreshAccessToken(sub.refreshToken);
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await prisma.calendarSubscription.update({
    where: { id: sub.id },
    data: { accessToken: data.access_token, expiresAt },
  });
  return data.access_token;
}

async function authedFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

export interface GoogleCalendarMeta {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
}

export async function listCalendars(token: string): Promise<GoogleCalendarMeta[]> {
  const res = await authedFetch(token, "/users/me/calendarList");
  if (!res.ok) throw new Error(`List calendars failed: ${res.status}`);
  const data = await res.json();
  return data.items ?? [];
}

export interface GoogleEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  updated?: string;
  htmlLink?: string;
}

export interface EventsPage {
  items: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** Incremental list. Pass `syncToken` to fetch deltas since the last
 *  successful sync; on the first call, omit syncToken and use timeMin
 *  to bound the initial window. Google returns 410 when a syncToken
 *  expires — callers should detect it and do a full resync. */
export async function listEvents(
  token: string,
  calendarId: string,
  opts: { syncToken?: string; pageToken?: string; timeMin?: string; timeMax?: string },
): Promise<EventsPage> {
  const params = new URLSearchParams();
  if (opts.syncToken) params.set("syncToken", opts.syncToken);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  if (opts.timeMin && !opts.syncToken) params.set("timeMin", opts.timeMin);
  if (opts.timeMax && !opts.syncToken) params.set("timeMax", opts.timeMax);
  params.set("singleEvents", "true");
  params.set("maxResults", "250");
  params.set("showDeleted", "true");

  const res = await authedFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  if (res.status === 410) {
    // Sync token expired — caller must reset and do a full resync.
    const err: any = new Error("Sync token expired");
    err.code = 410;
    throw err;
  }
  if (!res.ok) throw new Error(`List events failed: ${res.status}`);
  const data = await res.json();
  return { items: data.items ?? [], nextPageToken: data.nextPageToken, nextSyncToken: data.nextSyncToken };
}

export async function insertEvent(
  token: string,
  calendarId: string,
  event: {
    summary: string;
    description?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
  },
): Promise<GoogleEvent> {
  const res = await authedFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`Insert event failed: ${res.status}`);
  return res.json();
}

export async function updateEvent(
  token: string,
  calendarId: string,
  eventId: string,
  patch: Partial<{
    summary: string;
    description: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    status: "confirmed" | "cancelled";
  }>,
): Promise<GoogleEvent> {
  const res = await authedFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Update event failed: ${res.status}`);
  return res.json();
}

export async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  const res = await authedFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
  // 404/410 are fine — event already gone.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Delete event failed: ${res.status}`);
  }
}

/** Revoke a Google OAuth token (calls Google's revoke endpoint so the
 *  user's Google account page reflects the disconnection immediately). */
export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => {});
}
