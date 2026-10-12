// The people a person record names (batch 6 of the docs-found fixes): a
// manager, dotted manager or report who holds no level in the workspace being
// read belongs to the person's other workspace, so this workspace is never
// told who they are. `here` is levelsHeldIn(workspace, those ids).
//
// Never told who, but told THAT (batch 7). A record that showed "Reports to:
// Nobody" for a manager in the person's other workspace let an Admin here
// pick someone, believing the line empty, and overwrite the line that
// workspace still counts (User.managerId is one column). So the record says
// `managerElsewhere` when another workspace relies on the stored manager's
// line (manager-lines.ts recordLinesOfOthers), and leaves out the dotted
// lines kept for another workspace, as the dotted-lines GET does, counting
// them (`dottedElsewhere`) instead. Before, a dotted manager who is an Agent
// here and a manager there was listed, and the Edit details dialog let it be
// taken off, but the PUT kept it: the save tick was untrue.

type Named = { id: string };

export function namedHere<M extends Named, D extends Named & { deletedAt: Date | null }, R extends Named>(
  card: { manager: M | null; dottedManagers: readonly D[]; directReports: readonly R[] },
  here: ReadonlyMap<string, unknown>,
  others: { managerElsewhere?: boolean; dottedKept?: ReadonlySet<string> } = {},
): { manager: M | null; managerElsewhere: boolean; dottedManagers: D[]; dottedElsewhere: number; directReports: R[] } {
  const kept = others.dottedKept ?? new Set<string>();
  const manager = card.manager && here.has(card.manager.id) ? card.manager : null;
  return {
    manager,
    // Only for a manager it does not name: someone who holds a level here is named.
    managerElsewhere: !manager && !!card.manager && others.managerElsewhere === true,
    dottedManagers: card.dottedManagers.filter((m) => !m.deletedAt && here.has(m.id) && !kept.has(m.id)),
    dottedElsewhere: card.dottedManagers.filter((m) => kept.has(m.id)).length,
    directReports: card.directReports.filter((r) => here.has(r.id)),
  };
}

/**
 * The words for dotted lines kept for another workspace (pure; batch 7),
 * after the names shown (`more`) or alone: how many, never whose.
 */
export function dottedElsewhereWords(n: number, more: boolean): string | null {
  if (n <= 0) return null;
  return `${more ? "and " : ""}${n} ${n === 1 ? "line" : "lines"} kept for another workspace`;
}

/** The ids levelsHeldIn must be asked about for namedHere. */
export function namedIds(card: { manager: Named | null; dottedManagers: readonly Named[]; directReports: readonly Named[] }): string[] {
  return [...(card.manager ? [card.manager.id] : []), ...card.dottedManagers.map((d) => d.id), ...card.directReports.map((r) => r.id)];
}
