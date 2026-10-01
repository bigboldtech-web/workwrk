// RETIRED (spec-account-auth `/onboard` Data, A3). The eight-step checklist
// API had no consumer left: its two readers (the deleted
// components/onboarding-checklist.tsx and /welcome's POST, which this
// GET-only route answered with a 405) are gone. First-run progress is the
// setup console now: Organization.settings.console, read through
// src/lib/setup/console-state.ts and written by
// PATCH /api/settings { section: "console" }; the Workspace settings
// Overview card ticks its four steps from data.
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "This endpoint is retired.", code: "retired" }, { status: 410 });
}
