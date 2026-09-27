// Server helpers for /api/tools/*: the app-key gate plus the viewer facts the
// pure rules in tool-access.ts read.

import type { NextResponse } from "next/server";
import { requireApp } from "@/lib/app-gate";
import { legacySessionTiers } from "@/lib/access/legacy-session";
import type { ToolViewer } from "./tool-access";

export async function requireTools(): Promise<{ error: NextResponse } | ToolViewer & { orgId: string; name: string | null; isAgent: boolean; actingAs: boolean }> {
  // Every Member (APP_RULES.tools); Guests 404, a hidden app 403 app_off.
  const gate = await requireApp("tools");
  if ("error" in gate) return { error: gate.error };
  const tiers = await legacySessionTiers();
  return {
    userId: gate.viewer.userId,
    orgId: gate.viewer.organizationId,
    toolAdmin: tiers.toolAdmin,
    isManager: tiers.manager,
    name: tiers.name,
    // The export rule (access section 9): never an Agent, never acting as.
    isAgent: gate.viewer.isAgent,
    actingAs: Boolean(gate.viewer.actingAs),
  };
}
