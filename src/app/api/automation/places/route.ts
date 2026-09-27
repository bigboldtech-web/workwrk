// GET /api/automation/places
//
// The builder's "Where it runs" picker source and the set-field action's
// field list: the Spaces, Folders and Lists the viewer can read, each List
// with the fields an automation may test or set. Nothing the viewer cannot
// open is ever offered.

import { NextResponse } from "next/server";
import { requireAutomation } from "@/lib/automation/gate";
import { loadPlaces } from "@/lib/automation/places-server";

export async function GET() {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const places = await loadPlaces(ctx.viewer, ctx.orgId, { withFields: true });
  return NextResponse.json(places, { headers: { "Cache-Control": "private, no-store" } });
}
