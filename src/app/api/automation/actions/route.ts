// GET /api/automation/actions
//
// The action catalog for the workflow builder: key/name/category,
// per-action param schemas, retry safety, availability, and any
// integration connection the action depends on. The execute()
// implementations stay server-side.

import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";
import { requireAutomation } from "@/lib/automation/gate";
import { AUTOMATION_ACTIONS } from "@/lib/automation/registry-actions";

export async function GET() {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  // An AI teammate step only for someone with AI teammates (private cache: per viewer).
  const aiOn = (await can(ctx.viewer, "view", { type: "app", key: "ai" })).allowed;

  return NextResponse.json(
    {
      actions: AUTOMATION_ACTIONS.map((a) => ({
        key: a.key,
        name: a.name,
        category: a.category,
        description: a.description,
        safeToRetry: a.safeToRetry,
        available: a.available && (a.key !== "ask_teammate" || aiOn),
        // The step exists: the builder says why it can't be used, never "Coming soon" (review round 4).
        unavailableReason: a.available && a.key === "ask_teammate" && !aiOn ? "ai_off" : null,
        requiresConnection: a.requiresConnection ?? null,
        params: a.params,
      })),
    },
    { headers: LOOKUP_CACHE_HEADERS },
  );
}
