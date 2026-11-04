// A person's dotted-line managers (spec-teams-people /people/[id] Edit
// details and the org chart's edit mode). PUT replaces the whole set in one
// transaction, so two quick edits never leave half of each. Writers: the
// reporting chain, the People team, the org-wide levels and Admins (the same
// people who write placement). Never self, never an Agent as the manager,
// never the solid-line manager twice, and never someone below the person.
//
// Why "never below": a dotted line puts the subject in the manager's report
// tree, and that tree is the chain-view read reach (person-access.server.ts),
// so a dotted line from a manager to their own report let the report read
// the manager's phone, skill ratings, KPI history and reviews. The solid
// line's manager_cycle check (PATCH /api/users/[id]) never saw dotted lines.
//
// EACH WORKSPACE'S OWN DOTTED LINES (docs/plans/workspace-status-2.md E2, E4,
// E5, E6). Every UserDottedLine names its workspace. GET answers this
// workspace's rows (step 3). PUT replaces this workspace's rows with the
// body, and only them (seat-writes.ts writeDottedHere, step 4): another
// workspace's rows of the same person are never read, checked or deleted,
// so a save in B never takes off A's line, and a B row can always be taken
// off in B. A new line here needs a manager who holds a live seat here, is
// no Agent here, and is not below the person over this workspace's lines
// (peopleBelow); a line already held here is kept as it is, its manager
// deactivated here or not, as a deactivation keeps dotted lines. Batches 6
// and 7 kept a line "another workspace relies on" whatever the body said
// and answered how many (`keptElsewhere`): since E2 there is none, so the
// keep list and its count retired (E6). Before, B's Admin took Rita
// (deactivated in B through her membership, live in another workspace the
// person works in) off the person's B lines, the PUT answered 200 and kept
// the row, and Rita was back on the next load.
//
// A SUBJECT OF EITHER KIND (workspace-status-2.md E7, step 5). PUT writes the
// dotted lines here of someone anchored here and of someone here through a
// membership alike, on the seat as read (personSeatIn, the account's
// workspace with it), through the same doors: relationTo over this
// workspace's tree, the placement write, the role lock. The solid line it
// leaves out of the set is the one the seat here holds (the membership's for
// a membership person), never the account's: before, it filtered the
// account's line, which is the anchored workspace's, so a B dotted manager
// who is Pat's A manager was dropped from her B set (the step 2 review,
// pairing 10). Before step 5 a membership subject was a 404.

import { NextResponse, type NextRequest } from "next/server";
import { accessV2Resolver } from "@/lib/access/flags";
import { prisma } from "@/lib/prisma";
import { agentIdsAmong, managerMapFor, peopleCtx, relationTo, type PeopleCtx } from "@/lib/people/person-access.server";
import { staleTabRefusal } from "@/lib/access/tab-workspace-check";
import { canWritePersonGroup } from "@/lib/people/person-fields";
import { agentIdsIn, managerCandidateIn } from "@/lib/access/manager-candidate";
import { lockOrgRoles } from "@/lib/access/membership";
import { levelsHeldIn, personSeatIn, workspaceDottedLines } from "@/lib/access/acting-workspace";
import { seatRefOf, writeDottedHere } from "@/lib/access/seat-writes";
import { liveHereAmong } from "@/lib/access/manager-lines";
import { rolesBusyOrThrow } from "@/lib/access/roles-busy";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * Everyone below `subjectId`, over solid lines AND dotted lines, any depth,
 * the subject excluded. None of them may become the subject's dotted-line
 * manager. A loop already in the data never hangs the walk: each person is
 * visited once.
 */
async function peopleBelow(organizationId: string, subjectId: string): Promise<Set<string>> {
  const [managers, dotted] = await Promise.all([
    managerMapFor(organizationId),
    // Everyone who works here (docs-found fixes batch 5), as managerMapFor:
    // two indexed halves, never a scan of every workspace's people (batch 6).
    workspaceDottedLines(organizationId),
  ]);
  const under = new Map<string, string[]>();
  const link = (managerId: string | null, userId: string) => {
    if (!managerId || managerId === userId) return;
    const list = under.get(managerId) ?? [];
    list.push(userId);
    under.set(managerId, list);
  };
  for (const [userId, managerId] of managers) link(managerId, userId);
  for (const d of dotted) if (managers.has(d.userId)) link(d.managerId, d.userId);
  const below = new Set<string>();
  const queue = [subjectId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of under.get(cur) ?? []) {
      if (next === subjectId || below.has(next)) continue;
      below.add(next);
      queue.push(next);
    }
  }
  return below;
}

/** The same writers as PUT: the pickers only ask for `below` when they can write. */
function writesDottedLines(ctx: PeopleCtx, id: string): boolean {
  const relation = relationTo(ctx, id);
  return canWritePersonGroup("placement", relation, { managerTierSelf: false, chainWritesMembership: !accessV2Resolver() }) && relation !== "self";
}

/**
 * GET answers THIS workspace's dotted lines of the person (workspace-status-2.md
 * E2, step 3): the rows whose organizationId is this workspace, for a
 * subject of either kind (anchored here, or here through a membership,
 * acting-workspace.ts personSeatIn). Before, it read the person's rows of
 * every workspace, so after the one-time SQL a line held in two workspaces
 * listed its manager twice, and a line held only in another workspace whose
 * manager has a seat here was listed here, copied here by the next save and
 * never removable here. No count of another workspace's lines is answered
 * (E6): none is read.
 */
/** A stamp as an Audit row's JSON carries it. */
const isoOrNull = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (ctx.orgRole === "GUEST") return err(404, "Not found");
  const { id } = await params;
  if (!(await personSeatIn(ctx.organizationId, id))) return err(404, "Not found");
  const stored = await prisma.userDottedLine.findMany({
    where: { userId: id, organizationId: ctx.organizationId },
    select: { managerId: true, role: true, manager: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
  });
  // A line to someone with no seat here is never named. A line to someone
  // deactivated here is listed, by their membership as when anchored here
  // (kept seats, step 1 review M2): PUT replaces every line of this
  // workspace not in its body, so one the list left out would be deleted by
  // the next save.
  const held = await levelsHeldIn(ctx.organizationId, stored.map((r) => r.managerId), prisma, { keptSeats: true });
  const rows = stored.filter((r) => held.has(r.managerId));
  // `below` is the person's report tree (solid and dotted), so the Edit
  // details picker can leave every one of them out. Only a writer gets it:
  // a reader has no picker, and the list is placement data.
  const below = writesDottedLines(ctx, id) ? [...(await peopleBelow(ctx.organizationId, id))] : undefined;
  return NextResponse.json({ managers: rows.map((r) => ({ ...r.manager, note: r.role })), ...(below ? { below } : {}) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  // A tab still showing another workspace than the session's: refused, never written here (src/lib/access/tab-workspace-check.ts).
  const staleTab = await staleTabRefusal(ctx.organizationId);
  if (staleTab) return staleTab;
  const { id } = await params;
  // The seat they hold HERE, not removed: anchored here, or a membership here
  // (E7, step 5). The account row says where it was anchored when read, so
  // the write below lands on that seat's row or nowhere (seatRefOf).
  const [subject, seat] = await Promise.all([
    prisma.user.findUnique({ where: { id }, select: { id: true, organizationId: true, firstName: true, lastName: true } }),
    personSeatIn(ctx.organizationId, id),
  ]);
  if (!subject || !seat || seat.removedAt) return err(404, "Not found");
  if (!writesDottedLines(ctx, id)) {
    return err(403, "You can't change this person's dotted lines.", { code: "field_forbidden", fields: ["dottedLines"] });
  }
  const body = (await req.json().catch(() => null)) as { managerIds?: unknown } | null;
  if (!body || !Array.isArray(body.managerIds) || !body.managerIds.every((x) => typeof x === "string")) {
    return err(400, "Send { managerIds: string[] }");
  }
  // Self is refused out loud. It used to be dropped in silence, and because
  // PUT replaces the whole set, that request also wiped every other entry.
  if ((body.managerIds as string[]).includes(id)) {
    return err(400, "Someone can't be their own dotted-line manager.", { code: "self_dotted_line", field: "dottedLines" });
  }
  // The solid line here is never a dotted line too: the one this seat holds.
  const ids = [...new Set(body.managerIds as string[])].filter((m) => m !== seat.managerId);
  if (ids.length > 20) return err(400, "Up to 20 dotted-line managers");
  // Every line the body names is this workspace's (E2): checked here, never
  // kept for another workspace.
  if (ids.length) {
    const { found, agents } = await agentIdsAmong(ctx.organizationId, ids);
    if (found !== ids.length) return err(400, "Someone in that list isn't in this workspace");
    if (agents.length) return err(400, "An Agent can't be anyone's manager", { code: "agent_cannot_manage" });
    const below = await peopleBelow(ctx.organizationId, id);
    // `managerIds` names the refused people, so a line saved before this
    // check existed can be found and taken off (removing it always passes).
    const looped = ids.filter((m) => below.has(m));
    if (looped.length) {
      return err(409, "That would make a reporting loop: this person already manages them, directly or further down.", { code: "dotted_line_cycle", field: "dottedLines", managerIds: looped });
    }
  }
  // The set is written under the workspace's role lock, and its managers
  // ids again there (rule 6's race, docs-found fixes batch 3): a role
  // change making one of them an Agent counts their dotted reports under the
  // same lock, so it waits for this write and sees the line, or lands first
  // and this sees an Agent. A NEW line also needs its manager's seat here
  // live (E4): a line to someone deactivated here is kept when it is held
  // already, never made.
  const written = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, ctx.organizationId);
    if (ids.length && (await agentIdsIn(ctx.organizationId, ids, tx)).size > 0) return { refused: "agent" as const };
    // Every named manager still holds a seat here (kept seats, as the GET
    // lists them), read again under the lock (the step 4 review L4): one
    // removed here between the first check and this lock is refused, never
    // kept on a row nobody here walks.
    const seated = await liveHereAmong(ctx.organizationId, ids, tx);
    if (ids.some((m) => !seated.has(m))) return { refused: "not_found" as const };
    const held = new Set((await tx.userDottedLine.findMany({ where: { userId: id, organizationId: ctx.organizationId }, select: { managerId: true } })).map((r) => r.managerId));
    for (const managerId of ids.filter((m) => !held.has(m))) {
      const c = await managerCandidateIn(ctx.organizationId, managerId, { db: tx, live: true });
      if (c === "inactive") return { refused: "inactive" as const };
      if (c !== "ok") return { refused: "not_found" as const };
    }
    // This workspace's rows only, replaced with the body (E2, step 4): on
    // the seat as read (anchored here or a membership here, step 5); null
    // when that seat no longer stands.
    const done = await writeDottedHere(tx, seatRefOf(ctx.organizationId, { id, organizationId: subject.organizationId }), ids.map((managerId) => ({ managerId })));
    if (!done) return { refused: "seat_changed" as const };
    // The save's Audit row in this transaction, carrying the lines it took
    // off as they stood (their notes, weights and dates) as well as the set
    // it left (the final review, integrity L2): before, only the new set was
    // logged, after the commit, so a line taken off left no record of what
    // it was.
    await tx.activityLog.create({
      data: {
        type: "reporting_line_changed",
        actorId: ctx.userId,
        organizationId: ctx.organizationId,
        description: `Changed ${subject.firstName} ${subject.lastName}'s dotted-line managers`,
        targetId: id,
        targetType: "user",
        severity: "info",
        metadata: { dottedManagerIds: ids, added: done.added, removed: done.removedLines.map((l) => ({ managerId: l.managerId, note: l.role, weight: l.weight, startDate: isoOrNull(l.startDate), endDate: isoOrNull(l.endDate), createdAt: isoOrNull(l.createdAt) })) },
      },
    });
    return { refused: null };
  }).catch(rolesBusyOrThrow);
  if (written instanceof NextResponse) return written;
  if (written.refused === "agent") return err(400, "An Agent can't be anyone's manager", { code: "agent_cannot_manage" });
  if (written.refused === "inactive") {
    return err(400, "That person is deactivated, and a deactivated person can't have reports. Reactivate them first, or pick someone else.", { code: "manager_inactive", field: "dottedLines" });
  }
  if (written.refused === "not_found") return err(400, "Someone in that list isn't in this workspace");
  if (written.refused === "seat_changed") return err(409, "Their status here changed a moment ago, so nothing was saved. Reload and try again.", { code: "seat_changed", field: "dottedLines" });
  // The lines this workspace holds now, every one of them.
  return NextResponse.json({ managerIds: ids });
}
