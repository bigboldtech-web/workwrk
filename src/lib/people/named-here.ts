// The people a person record names (batch 6 of the docs-found fixes): a
// manager, dotted manager or report who holds no seat in the workspace being
// read is never named there. `here` is levelsHeldIn(workspace, those ids,
// kept seats).
//
// THE LINES ARE THIS WORKSPACE'S (docs/plans/workspace-status-2.md E1, E2,
// E6, step 3). The record's caller reads the line its seat here holds (the
// account's for someone anchored here, the membership's otherwise), this
// workspace's own dotted lines (UserDottedLine.organizationId) and the
// reports here (reportsHereOf). So no line of another workspace reaches this
// filter, and the batch 7 answers about one ("Reports to someone in another
// workspace", "N lines kept for another workspace") are gone with the
// cross-workspace line: only the seat filter is left.

type Named = { id: string };

export function namedHere<M extends Named, D extends Named & { deletedAt: Date | null }, R extends Named>(
  card: { manager: M | null; dottedManagers: readonly D[]; directReports: readonly R[] },
  here: ReadonlyMap<string, unknown>,
): { manager: M | null; dottedManagers: D[]; directReports: R[] } {
  return {
    manager: card.manager && here.has(card.manager.id) ? card.manager : null,
    dottedManagers: card.dottedManagers.filter((m) => !m.deletedAt && here.has(m.id)),
    directReports: card.directReports.filter((r) => here.has(r.id)),
  };
}

/**
 * The words for dotted lines kept for another workspace (pure; batch 7),
 * after the names shown (`more`) or alone: how many, never whose. Only the
 * dotted-lines PUT still answers such a count (`keptElsewhere`), until its
 * keep list retires in step 4 of workspace-status-2 with these words.
 */
export function dottedElsewhereWords(n: number, more: boolean): string | null {
  if (n <= 0) return null;
  return `${more ? "and " : ""}${n} ${n === 1 ? "line" : "lines"} kept for another workspace`;
}

/** The ids levelsHeldIn must be asked about for namedHere. */
export function namedIds(card: { manager: Named | null; dottedManagers: readonly Named[]; directReports: readonly Named[] }): string[] {
  return [...(card.manager ? [card.manager.id] : []), ...card.dottedManagers.map((d) => d.id), ...card.directReports.map((r) => r.id)];
}
