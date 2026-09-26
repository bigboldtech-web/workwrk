// GET /api/report-schedules/recipient-options?q=&ids=&limit=
//
// The Schedule report dialog's recipient picker, and nothing else. It answers
// { people: Array<{ id, firstName, lastName, avatar, email, eligible }> },
// ordered by name.
//
// It applies the server's OWN recipient rule, so the picker can never offer a
// person the write would refuse: eligible = a member of this org, not
// deleted, status not INACTIVE (ON_LEAVE, PROBATION, PIP and NOTICE_PERIOD
// still receive) and not a Guest. The search part (q on first name, last name
// or email; limit default 20, max 50) returns eligible people only. `ids`
// (up to 100) names the chips already on a schedule, so a colleague who went
// inactive shows as a greyed chip and one back from leave can be found and
// added again. An ineligible person is named only when they are on a
// schedule the caller may manage, and never with an email, so the door is
// not a directory of deleted accounts. An id from another org answers nothing.
//
// Not /api/users or /api/people/pick: those answer "who can I see", and a
// report is a copy mailed to someone, which is a different question.
//
// A Guest is answered 404 by requireWorkApp, like a missing object.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { recipientOptions } from "@/lib/list-links-server";
import { requireWorkApp } from "@/lib/dashboards/dashboard-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const app = await requireWorkApp();
  if ("error" in app) return app.error;
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  const ids = (sp.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
  const rawLimit = Number(sp.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(50, Math.floor(rawLimit)) : 20;
  const people = await recipientOptions({ organizationId: c.organizationId, q, ids, limit, viewer: c });
  return NextResponse.json({ people }, { headers: { "Cache-Control": "private, no-store" } });
}
