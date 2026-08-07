// GET /api/automation/actions
//
// The action catalog for the workflow builder: key/name/category,
// per-action param schemas, retry safety, availability, and any
// integration connection the action depends on. The execute()
// implementations stay server-side.

import { NextResponse } from "next/server";
import { LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";
import { resolveAutomationContext } from "@/lib/automation/hub-access";
import { AUTOMATION_ACTIONS } from "@/lib/automation/registry-actions";

export async function GET() {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;

  return NextResponse.json(
    {
      actions: AUTOMATION_ACTIONS.map((a) => ({
        key: a.key,
        name: a.name,
        category: a.category,
        description: a.description,
        safeToRetry: a.safeToRetry,
        available: a.available,
        requiresConnection: a.requiresConnection ?? null,
        params: a.params,
      })),
    },
    { headers: LOOKUP_CACHE_HEADERS },
  );
}
