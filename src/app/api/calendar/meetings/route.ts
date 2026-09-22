// /api/calendar/meetings: A THIN DELEGATE to GET /api/calendar/events.
//
// spec-planner.md section 0 row 13 folds three feeds into one, and keeps
// the three old routes for one release as delegates.
//
// This one had NO CALLER in the product even before the fold: grep for the
// literal "/api/calendar/meetings" and the only hit was the route file
// itself. It kept answering, with its own scoping rules
// (`isManager(session)` plus `getTeamUserIds`) that disagreed with every
// other meeting read, which is exactly the kind of second opinion this
// phase is here to remove.
//
// It answers the same `{ meetings: [...] }` shape from the one calendar
// read, so anything outside this repo that learned the URL still works.
// The scoping is now the calendar read's: `calendar=team` means the
// viewer's report tree, and without the relationship it falls back to the
// viewer's own meetings rather than to a 403.
//
// WHEN IT GOES. The next release. The removal note is in
// scripts/MIGRATIONS.md.

import { NextResponse } from "next/server";
import { GET as calendarEvents } from "../events/route";

type CalendarRow = {
  id: string;
  kind: string;
  title: string;
  start: string;
  end: string;
  personId: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const forward = new URL("/api/calendar/events", url.origin);
  for (const [k, v] of url.searchParams) forward.searchParams.set(k, v);
  // The old route's `view=team` is the new one's `calendar=team`.
  if (url.searchParams.get("view") === "team") forward.searchParams.set("calendar", "team");
  forward.searchParams.set("kinds", "meeting");

  const res = await calendarEvents(new Request(forward, { headers: req.headers }));
  if (!res.ok) return res;

  const body = (await res.json()) as { events?: CalendarRow[] };
  const meetings = (body.events ?? [])
    .filter((e) => e.kind === "meeting")
    .map((e) => ({
      id: e.id.replace(/^meeting:/, ""),
      title: e.title,
      scheduledAt: e.start,
      duration: Math.max(1, Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000)),
      attendees: e.personId ? [{ userId: e.personId }] : [],
    }));

  return NextResponse.json({ meetings });
}
