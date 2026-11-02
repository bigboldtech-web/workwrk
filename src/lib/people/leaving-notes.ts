// What the Deactivate and Remove dialogs say about the rest of a person's
// access (docs/plans/workspace-status.md D15, D17), from the handover
// summary (GET /api/users/[id]/handover: `alsoElsewhere`, `apiKeys`).
//
// Each workspace holds its own status now, so ending someone here ends this
// workspace only: when they belong to another one the dialogs say it is not
// affected (before: "ends their access there too, for now"). And the API keys
// they made here stop working with the seat (endSeat revokes them), so the
// dialogs say how many first.
//
// Pure: no imports. Client safe.

/** The dialogs' lines, in order: their other workspaces, then their API keys. Empty when there is nothing to say. */
export function leavingNotes(summary: { alsoElsewhere?: boolean; apiKeys?: number } | null | undefined): { elsewhere: string | null; keys: string | null } {
  const n = summary?.apiKeys ?? 0;
  return {
    elsewhere: summary?.alsoElsewhere ? "Their other workspaces are not affected." : null,
    keys: n > 0 ? (n === 1 ? "1 API key they made will stop working." : `${n} API keys they made will stop working.`) : null,
  };
}
