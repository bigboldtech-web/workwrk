// Reporting lines, as pure set logic: the server's cycle check for
// PATCH /api/users/[id] { managerId } and the org chart's edit mode, and the
// tree the org chart renders (every root, the unlinked group, focus paths).
//
// Pure: no imports. Client safe.

export type ManagerMap = ReadonlyMap<string, string | null>;

/**
 * Would making `managerId` the manager of `subjectId` close a loop? True when
 * the proposed manager is the subject or reports (at any depth) to them.
 * A pre-existing loop elsewhere in the org never blocks an unrelated write:
 * the walk stops on the first repeat.
 */
export function wouldCreateCycle(subjectId: string, managerId: string | null, managers: ManagerMap): boolean {
  if (!managerId) return false;
  if (managerId === subjectId) return true;
  const seen = new Set<string>();
  let cursor: string | null = managerId;
  while (cursor) {
    if (cursor === subjectId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = managers.get(cursor) ?? null;
  }
  return false;
}

/**
 * Where a leaver's direct reports go in a handover (handover.server.ts
 * runHandover, and the transfer dialog's preview of it, so the dialog says
 * exactly what the run does).
 *
 *   to the recipient   unless that would close a loop, or the recipient is an
 *                      Agent (access 2.4: an Agent is never anyone's manager;
 *                      the work still goes to them as asked)
 *   otherwise          up to the leaver's own manager, when that manager is
 *                      no Agent and no loop follows; else to no manager
 */
export function planReportHandover(input: {
  leaverId: string;
  recipientId: string;
  recipientIsAgent: boolean;
  managers: ManagerMap;
  /** Agents among the people who could take the reports (the leaver's manager). */
  agentIds: ReadonlySet<string>;
}): { reportIds: string[]; toRecipient: string[]; rehome: Map<string | null, string[]>; leaverManager: string | null } {
  const { leaverId, recipientId, managers } = input;
  const reportIds = [...managers.entries()].filter(([, m]) => m === leaverId).map(([uid]) => uid);
  const toRecipient = input.recipientIsAgent ? [] : reportIds.filter((r) => r !== recipientId && !wouldCreateCycle(r, recipientId, managers));
  const leaverManager = managers.get(leaverId) ?? null;
  const rehome = new Map<string | null, string[]>();
  for (const r of reportIds) {
    if (toRecipient.includes(r)) continue;
    const up = leaverManager && leaverManager !== r && !input.agentIds.has(leaverManager) && !wouldCreateCycle(r, leaverManager, managers) ? leaverManager : null;
    rehome.set(up, [...(rehome.get(up) ?? []), r]);
  }
  return { reportIds, toRecipient, rehome, leaverManager };
}

/**
 * The transfer dialog's line about the reports when they cannot all go to
 * the person picked (pure; tested). Null when every report goes to them.
 */
export function reportHandoverNote(
  plan: { recipientIsAgent: boolean; rehomed: { to: string | null; count: number }[] },
  recipientName: string,
): string | null {
  const groups = plan.rehomed.filter((g) => g.count > 0);
  const rest = groups.reduce((n, g) => n + g.count, 0);
  if (rest === 0) return null;
  const where = (to: string | null) => (to ? `to ${to}` : "to no manager for now");
  const moves =
    groups.length === 1
      ? `${rest === 1 ? "Their direct report goes" : `Their ${rest} direct reports go`} ${where(groups[0].to)}`
      : `Of their direct reports, ${groups.map((g) => `${g.count} ${g.count === 1 ? "goes" : "go"} ${where(g.to)}`).join(" and ")}`;
  if (plan.recipientIsAgent) {
    return `${recipientName} is on the Agent tier, and an Agent can't be anyone's manager. ${moves} instead. The rest still goes to ${recipientName}.`;
  }
  return `${moves}, because moving ${rest === 1 ? "it" : "them"} to ${recipientName} would make a reporting loop.`;
}

export interface OrgPerson {
  id: string;
  managerId: string | null;
  name: string;
}

export interface OrgNode<P extends OrgPerson = OrgPerson> {
  person: P;
  children: OrgNode<P>[];
  /** Everyone below this node. */
  total: number;
  depth: number;
}

function byTeamSizeThenName<P extends OrgPerson>(a: OrgNode<P>, b: OrgNode<P>): number {
  return b.total - a.total || a.person.name.localeCompare(b.person.name);
}

function byName<P extends OrgPerson>(a: OrgNode<P>, b: OrgNode<P>): number {
  return a.person.name.localeCompare(b.person.name);
}

/**
 * The org as a forest. A root is a person with no manager, or whose manager
 * is not in the set (removed, or outside it). Anyone not reachable from a
 * root sits in a reporting loop and is returned in `unlinked`, never dropped,
 * so the chart always accounts for every person. EVERY root is returned (the
 * old "+N more" cap is gone).
 */
export function buildOrgForest<P extends OrgPerson>(
  people: readonly P[],
  opts: { sort?: "size" | "name" } = {},
): { roots: OrgNode<P>[]; unlinked: P[] } {
  const byId = new Map(people.map((p) => [p.id, p]));
  const kids = new Map<string, P[]>();
  const rootPeople: P[] = [];
  for (const p of people) {
    if (p.managerId && p.managerId !== p.id && byId.has(p.managerId)) {
      const list = kids.get(p.managerId) ?? [];
      list.push(p);
      kids.set(p.managerId, list);
    } else {
      rootPeople.push(p);
    }
  }
  const placed = new Set<string>();
  const cmp = opts.sort === "name" ? byName : byTeamSizeThenName;
  const build = (p: P, depth: number): OrgNode<P> => {
    placed.add(p.id);
    const children: OrgNode<P>[] = [];
    for (const c of kids.get(p.id) ?? []) {
      if (placed.has(c.id)) continue;
      children.push(build(c, depth + 1));
    }
    children.sort(cmp);
    const total = children.reduce((n, c) => n + 1 + c.total, 0);
    return { person: p, children, total, depth };
  };
  const roots = rootPeople.map((p) => build(p, 0)).sort(cmp);
  const unlinked = people.filter((p) => !placed.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  return { roots, unlinked };
}

/** The ids from a root down to `id` (inclusive), for ?focus= expansion. */
export function pathTo<P extends OrgPerson>(roots: readonly OrgNode<P>[], id: string): string[] {
  const walk = (node: OrgNode<P>, trail: string[]): string[] | null => {
    const next = [...trail, node.person.id];
    if (node.person.id === id) return next;
    for (const c of node.children) {
      const hit = walk(c, next);
      if (hit) return hit;
    }
    return null;
  };
  for (const r of roots) {
    const hit = walk(r, []);
    if (hit) return hit;
  }
  return [];
}

/**
 * Keep the nodes that match (and their ancestors, so the match stays in
 * context). Returns a new forest; the input is not changed.
 */
export function filterForest<P extends OrgPerson>(
  roots: readonly OrgNode<P>[],
  matches: (p: P) => boolean,
): OrgNode<P>[] {
  const keep = (node: OrgNode<P>): OrgNode<P> | null => {
    const children = node.children.map(keep).filter((n): n is OrgNode<P> => n !== null);
    if (matches(node.person) || children.length > 0) return { ...node, children };
    return null;
  };
  return roots.map(keep).filter((n): n is OrgNode<P> => n !== null);
}

/** Every id in the forest, depth first. */
export function forestIds<P extends OrgPerson>(roots: readonly OrgNode<P>[]): string[] {
  const out: string[] = [];
  const walk = (n: OrgNode<P>) => { out.push(n.person.id); n.children.forEach(walk); };
  roots.forEach(walk);
  return out;
}
