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
