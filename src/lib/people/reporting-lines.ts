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

/** One person on a reporting line, as the walks up it read them. */
export interface LineFacts {
  managerId: string | null;
  /** Holds the Agent tier: never anyone's manager (access 2.4, AGENT_TIER_BLURB). */
  agent: boolean;
  /** Deactivated. */
  inactive: boolean;
}

/** The people of one workspace who are not removed, by id. Anyone absent is removed or elsewhere. */
export type LineMap = ReadonlyMap<string, LineFacts>;

/** How far a walk up a line goes before it gives up (a line longer than this is a data fault). */
const WALK_CAP = 64;

/**
 * The manager a person reports to for every read that grants reach (the
 * report trees' direct level, a review's manager reviewer, an approver):
 * the stored manager, unless they hold the Agent tier, then the next person
 * up the solid line who does not. An Agent is never anyone's manager
 * (AGENT_TIER_BLURB), and the people listed under one before rule 6 existed
 * report, in effect, to the manager above them.
 *
 * Nobody when, past an Agent, the line ends, loops, or reaches someone
 * absent from `people` (removed, or another workspace): a removed person
 * ends the report-tree walks too (team.ts, reporting-line.ts), so this never
 * names someone the trees do not already give reach over. A stored manager
 * who is no Agent is answered as stored, whatever their state, as before.
 *
 * Never the person themselves (`subjectId`): a stored loop through an Agent
 * (P to Agent A to P) or a stored self-line names nobody, so nobody becomes
 * their own reviewer, approver or weekly-review manager.
 */
export function effectiveManagerFrom(stored: string | null, people: LineMap, subjectId?: string): string | null {
  const answer = walkPastAgents(stored, people);
  return subjectId && answer === subjectId ? null : answer;
}

function walkPastAgents(stored: string | null, people: LineMap): string | null {
  let cursor = stored;
  let skipped = false;
  const seen = new Set<string>();
  while (cursor && seen.size < WALK_CAP) {
    const p = people.get(cursor);
    if (!p) return skipped ? null : cursor;
    if (!p.agent) return cursor;
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    skipped = true;
    cursor = p.managerId;
  }
  return null;
}

/**
 * Where reports go when they must move up a line (the handover, and moving
 * an Agent's reports off them): `start` itself, or the first person above
 * who can manage them now. That is someone live (a deactivated person holds
 * no reports, invariant 13) who is no Agent. Nobody when the line ends,
 * loops, or reaches a removed person or another workspace first.
 */
export function liveManagerFrom(start: string | null, people: LineMap): string | null {
  let cursor = start;
  const seen = new Set<string>();
  while (cursor && seen.size < WALK_CAP) {
    const p = people.get(cursor);
    if (!p) return null;
    if (!p.agent && !p.inactive) return cursor;
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    cursor = p.managerId;
  }
  return null;
}

/**
 * Where a leaver's direct reports go in a handover (handover.server.ts
 * runHandover, and the transfer dialog's preview of it, so the dialog says
 * exactly what the run does).
 *
 *   to the recipient   unless that would close a loop, or the recipient is an
 *                      Agent (access 2.4: an Agent is never anyone's manager;
 *                      the work still goes to them as asked) or deactivated
 *                      (invariant 13: a deactivated person holds no reports)
 *   otherwise          up the leaver's own line to the first person who can
 *                      manage them now (liveManagerFrom: live, no Agent),
 *                      when no loop follows; else to no manager
 *
 * `people` carries who is an Agent, deactivated or removed for that walk.
 * Without it only `agentIds` is known, and the leaver's own manager is the
 * one person asked (the batch 2 rule).
 *
 * `stays` are reports this step leaves where they are, answered apart, in
 * none of the other lists: those whose line to the leaver another workspace
 * relies on (acting-workspace.ts linesElsewhere, docs-found fixes batch 6),
 * while the leaver stays a live manager there (the Agent move, SCIM ending a
 * membership here, and, batch 8, a handover before the step that ends the
 * account, which moves them then). The step that ends the account passes the
 * other reports instead, which are the handover's to move.
 */
export function planReportHandover(input: {
  leaverId: string;
  recipientId: string;
  recipientIsAgent: boolean;
  /** The recipient is deactivated: they take the work as asked, never the reports. */
  recipientInactive?: boolean;
  managers: ManagerMap;
  /** Agents among the people who could take the reports (the leaver's manager). */
  agentIds: ReadonlySet<string>;
  people?: LineMap;
  /** Reports whose line another workspace relies on: they stay where they are. */
  stays?: ReadonlySet<string>;
}): { reportIds: string[]; toRecipient: string[]; rehome: Map<string | null, string[]>; leaverManager: string | null; stays: string[] } {
  const { leaverId, recipientId, managers } = input;
  const listed = [...managers.entries()].filter(([, m]) => m === leaverId).map(([uid]) => uid);
  const stays = listed.filter((uid) => input.stays?.has(uid));
  const reportIds = listed.filter((uid) => !input.stays?.has(uid));
  const recipientManagesNobody = input.recipientIsAgent || input.recipientInactive === true;
  const toRecipient = recipientManagesNobody ? [] : reportIds.filter((r) => r !== recipientId && !wouldCreateCycle(r, recipientId, managers));
  const leaverManager = managers.get(leaverId) ?? null;
  const target = input.people
    ? liveManagerFrom(leaverManager, input.people)
    : leaverManager && !input.agentIds.has(leaverManager) ? leaverManager : null;
  const rehome = new Map<string | null, string[]>();
  for (const r of reportIds) {
    if (toRecipient.includes(r)) continue;
    const up = target && target !== r && target !== leaverId && !wouldCreateCycle(r, target, managers) ? target : null;
    rehome.set(up, [...(rehome.get(up) ?? []), r]);
  }
  return { reportIds, toRecipient, rehome, leaverManager, stays };
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

/** "Ida Ray", "Ida Ray and Max Chen", "Ida Ray, Max Chen and 2 others" (pure). */
function namesSaid(names: readonly (string | null)[]): string {
  const said = names.map((n) => n || "Someone");
  if (said.length <= 1) return said[0] ?? "";
  if (said.length === 2) return `${said[0]} and ${said[1]}`;
  if (said.length === 3) return `${said[0]}, ${said[1]} and ${said[2]}`;
  return `${said[0]}, ${said[1]} and ${said.length - 2} others`;
}

/**
 * What moving an Agent's reports leaves where it is, and why (pure; tested;
 * docs-found fixes batch 6): the people whose line to `name` another
 * workspace relies on. They also work with `name` in that workspace, where
 * `name` is still their manager, so the line is that workspace's too and
 * this one leaves it as it is. Never names the other workspace: who else a
 * person works for is not this workspace's to know. Null when nobody stays.
 * A handover never says this (batch 7): its leaver's account ends next, in
 * every workspace, and that step moves those lines (linesAlsoElsewhereNote,
 * batch 8).
 */
export function linesStayNote(stays: readonly { name: string | null; kind?: "solid" | "dotted" }[], name: string): string | null {
  if (stays.length === 0) return null;
  const solid = stays.filter((s) => s.kind !== "dotted").map((s) => s.name);
  const dotted = stays.filter((s) => s.kind === "dotted").map((s) => s.name);
  const parts = [
    solid.length ? `${namesSaid(solid)} ${solid.length === 1 ? "stays" : "stay"} listed under ${name}` : null,
    dotted.length ? `${namesSaid(dotted)} ${dotted.length === 1 ? "keeps a dotted line" : "keep dotted lines"} to ${name}` : null,
  ].filter(Boolean).join(", and ");
  const lines = stays.length === 1 ? "that line still counts" : "those lines still count";
  return `${parts}. They also work with ${name} in another workspace, where ${lines}, so ${stays.length === 1 ? "it's" : "they're"} left as ${stays.length === 1 ? "it is" : "they are"}.`;
}

/**
 * What the transfer and Remove dialogs say about the reports who also report
 * to the leaver in another workspace they both work in (pure; tested; batch
 * 7). Deactivating or removing someone ends their account in every
 * workspace, so those lines move too, and the other workspace's Audit log
 * records the move. They move WITH the deactivation or the removal, never
 * with the handover before it (batch 8: that step can still be refused), so
 * before it lands the words say when: `ends` is "deactivated" or "removed"
 * (said before the dialog runs, or when the step was refused after the
 * handover), and "done" once it landed. Never names the other workspace.
 * Null when nobody does.
 */
export function linesAlsoElsewhereNote(people: readonly { name: string | null }[], leaverName: string, ends: "deactivated" | "removed" | "done"): string | null {
  if (people.length === 0) return null;
  const one = people.length === 1;
  const who = namesSaid(people.map((p) => p.name));
  if (ends === "done") {
    return `${who} also reported to ${leaverName} in another workspace. ${one ? "That line" : "Those lines"} moved too, and that workspace's Audit log records it.`;
  }
  return `${who} also ${one ? "reports" : "report"} to ${leaverName} in another workspace. ${one ? "That line moves" : "Those lines move"} only once ${leaverName} is ${ends}, since that ends their account there too, and that workspace's Audit log records it.`;
}

/**
 * The Members drawer's line about an Agent who still has people listed under
 * them (pure; tested). Null when nobody is. The lines give the Agent nothing
 * (src/lib/access/manager-lines.ts), so it says so, and what "Move their
 * reports" does: the direct reports go up the Agent's line (the handover's
 * routing), and a dotted line to an Agent is taken off.
 */
export function agentReportsNote(
  plan: { solid: number; dotted: number; rehomed: { to: string | null; count: number }[] },
  agentName: string,
): string | null {
  if (plan.solid + plan.dotted === 0) return null;
  const listed = [
    plan.solid ? `${plan.solid} ${plan.solid === 1 ? "direct report" : "direct reports"}` : null,
    plan.dotted ? `${plan.dotted} ${plan.dotted === 1 ? "dotted-line report" : "dotted-line reports"}` : null,
  ].filter(Boolean).join(" and ");
  const where = (to: string | null) => (to ? `to ${to}` : "to no manager for now");
  const groups = plan.rehomed.filter((g) => g.count > 0);
  const moves = [
    groups.length === 1
      ? `${plan.solid === 1 ? "the direct report goes" : `the ${plan.solid} direct reports go`} ${where(groups[0].to)}`
      : groups.length > 1
        ? `of the direct reports, ${groups.map((g) => `${g.count} ${g.count === 1 ? "goes" : "go"} ${where(g.to)}`).join(" and ")}`
        : null,
    plan.dotted ? `${plan.dotted === 1 ? "the dotted line is" : "the dotted lines are"} taken off` : null,
  ].filter(Boolean).join(", and ");
  return `${agentName} is on the Agent tier, and an Agent can't be anyone's manager, so ${agentName} doesn't manage the ${listed} still listed under them. Move them so the record matches: ${moves}.`;
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
