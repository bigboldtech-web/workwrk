// The people a person record names (batch 6 of the docs-found fixes): a
// manager, dotted manager or report who holds no level in the workspace being
// read belongs to the person's other workspace, so this workspace is never
// told who they are. `here` is levelsHeldIn(workspace, those ids).

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

/** The ids levelsHeldIn must be asked about for namedHere. */
export function namedIds(card: { manager: Named | null; dottedManagers: readonly Named[]; directReports: readonly Named[] }): string[] {
  return [...(card.manager ? [card.manager.id] : []), ...card.dottedManagers.map((d) => d.id), ...card.directReports.map((r) => r.id)];
}
