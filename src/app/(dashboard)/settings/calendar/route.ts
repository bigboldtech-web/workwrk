// /settings/calendar: 308 to /account/connections.
//
// Phase 4 (docs/plans/ui-refresh/spec-planner.md section 0 row 4,
// settings-architecture section 7.1 row 1.16).
//
// WHAT WAS HERE. A 73-line "Coming soon" stub that contradicted itself: its
// own header comment said "this app has no calendar-OAuth backend" while the
// OAuth pair, the CalendarSubscription model, the sync cron and the personal
// ICS feed all existed and had no UI at all. Every row that flow writes
// belongs to ONE PERSON, so the page belongs on the My settings door rather
// than on workspace settings.
//
// NOTHING IS LOST. Everything the stub showed was a ComingSoonRow behind the
// "Show upcoming features" preference (Outlook, iCloud, Fastmail, ICS
// providers), which is to say nothing anyone could act on, plus two links to
// /settings and /integrations that the settings shell already carries. What
// replaces it at /account/connections does more than the stub ever did,
// because the Google card and the calendar feed card are both live.
//
// A route handler and not a page, and a twin of the next.config.ts row, for
// the reasons written out in full in
// src/app/(dashboard)/tasks/backlog/route.ts: the config table is read once
// at server start, this file is in the module graph and so takes effect under
// hot reload, and a route handler emits a real 308 with a Location header
// before anything paints.

import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET() {
  permanentRedirect("/account/connections");
}
