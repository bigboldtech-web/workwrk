// GET /api/automation/triggers
//
// The trigger catalog for the workflow builder, straight from the code
// registry. `isEmitting` tells the UI which triggers fire for real today
// versus catalog-only seeds that light up when their domain ships.

import { NextResponse } from "next/server";
import { LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";
import { resolveAutomationContext } from "@/lib/automation/hub-access";
import { AUTOMATION_TRIGGERS } from "@/lib/automation/registry-triggers";

export async function GET() {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;

  return NextResponse.json(
    { triggers: AUTOMATION_TRIGGERS },
    { headers: LOOKUP_CACHE_HEADERS },
  );
}
