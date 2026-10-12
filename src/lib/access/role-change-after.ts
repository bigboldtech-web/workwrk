// What follows a role change once it has committed, the same on every path
// that changes roles: the Members drawer (PATCH /api/users/[id]) and the bulk
// role change (POST /api/settings/members/bulk). Docs-found fixes batch 5:
// the bulk change made people agent accounts and left their AI teammate
// connections running, which PATCH ended.
//
// An agent account holds no Google connection for AI teammates and no
// teammate browser (docs/plans/ai-teammates-phase3.md Decision 20,
// docs/plans/ai-teammates-phase4.md Decision 27), so a change TO the Agent
// tier ends both here. After the commit, never failing the change: the cron
// sweeps end anything this misses. A Guest written elsewhere (the Guest
// invitation's orgRole) is ended by the sweep (connections.ts
// sweepConnections, no_access); these paths make no Guest.
//
// Server-only.

import { endTeammateAccessFor } from "@/lib/agents/leaver-hooks";
import type { AppliedRoleChange } from "./membership";

/** The people among these changes who were just made agent accounts here. */
export function madeAgents(changes: ReadonlyArray<{ userId: string; change: Pick<AppliedRoleChange, "changed" | "after"> | null | undefined }>): string[] {
  return [...new Set(changes.filter((c) => c.change?.changed && c.change.after.level === "AGENT").map((c) => c.userId))];
}

/**
 * End the AI teammate connections and browsers of everyone these changes
 * made an agent account, in one call. Never throws: a failure is logged and
 * the sweep ends what it missed.
 */
export async function afterRoleChanges(
  organizationId: string,
  changes: ReadonlyArray<{ userId: string; change: Pick<AppliedRoleChange, "changed" | "after"> | null | undefined }>,
  actorId: string,
): Promise<void> {
  const ids = madeAgents(changes);
  if (ids.length === 0) return;
  await endTeammateAccessFor(organizationId, ids, "no_access", actorId).catch((e: unknown) => {
    console.error(`[connectors] role change hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
  });
}
