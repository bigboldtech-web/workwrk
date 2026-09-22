// /api/planner/events: A THIN DELEGATE to GET /api/calendar/events.
//
// spec-planner.md section 0 row 13 folds three feeds into one:
//
//   "GET /api/planner/events, GET /api/calendar, GET /api/calendar/meetings
//    folded into one GET /api/calendar/events; the three routes stay one
//    release as thin delegates, then go"
//
// This is that release. Nothing in the product calls this any more: the
// Calendar reads `/api/calendar/events` directly. It stays for one release
// so a browser tab that was open across the deploy, and anything outside
// this repo that learned the URL, keeps getting an answer instead of a 404.
//
// WHAT IT ANSWERS. The same `{ events: [...] }` shape it always did, with
// `source` and `external` derived from the new endpoint's `kind`. It served
// tasks only, so nothing that used to appear here has gone: meetings,
// events and reminders are filtered OUT of the delegate's answer, because
// adding them would change what an old caller renders, and a delegate's
// job is to keep a promise rather than to improve on it.
//
// WHEN IT GOES. The next release. The removal note is in
// scripts/MIGRATIONS.md.

import { NextResponse } from "next/server";
import { GET as calendarEvents } from "../../calendar/events/route";

interface PlannerEvent {
  id: string;
  source: "task" | "item";
  /** Synced from Google. */
  external: boolean;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string | null;
  url: string | null;
}

type CalendarRow = {
  id: string;
  kind: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string | null;
  url: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  // The one calendar read, asked for exactly what this endpoint used to
  // serve. The session, the scope and the range validation are all its.
  const forward = new URL("/api/calendar/events", url.origin);
  for (const [k, v] of url.searchParams) forward.searchParams.set(k, v);
  forward.searchParams.set("kinds", "task,external");

  const res = await calendarEvents(new Request(forward, { headers: req.headers }));
  if (!res.ok) return res;

  const body = (await res.json()) as { events?: CalendarRow[] };
  const events: PlannerEvent[] = (body.events ?? [])
    .filter((e) => e.kind === "task" || e.kind === "external")
    .map((e) => ({
      // The old ids were bare, the new ones are namespaced. Unwrap, so a
      // caller that stored one still matches.
      id: e.id.replace(/^item:/, ""),
      source: "item",
      external: e.kind === "external",
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      status: e.status,
      url: e.url,
    }));

  return NextResponse.json({ events });
}
