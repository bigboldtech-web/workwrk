// /api/users/[id]/handover, the offboarding ledger. Before removing a
// person, the manager sees what they still hold (open tasks, live OKRs,
// KRA assignments, company assets, direct reports) so nothing falls on
// the floor. THE GATE (person-access.server.ts mayHandOverPerson,
// docs-found fixes batch 9): an Owner or Admin, or a manager-tier viewer
// over their own SOLID report tree, never on an Admin, never themselves.
// Both GET (the summary names their open tasks, Lists and Spaces) and POST
// (which lets the caller pick themselves to take it all, private Spaces
// too). The org-wide levels and the People team pass only inside their own
// solid tree, as any manager does; outside it they may still remove someone
// who holds nothing (DELETE's rule, mayRemovePerson), never hand over.
//
//   GET  → counts + capped lists (advisory summary for the confirm dialog)
//   GET ?to=<id> → only what the handover would do with their direct
//          reports if <id> takes the work (the dialog says it before it
//          runs): an Agent takes the work but never the reports, which go
//          up to the leaver's own manager instead
//   POST → { reassignToId } moves their OPEN items' ownerId and their
//          reports' managerId to the picked person. Done work keeps its
//          original owner: history is never rewritten. 503 roles_busy when
//          the role lock was busy (nothing moved); 503 handover_partial when
//          the reports moved and the work did not (running it again moves
//          the rest).
//   The picked person is anyone who works here: anchored here, or through a
//   membership here (docs-found fixes batch 5).
//   Every report HERE moves (docs/plans/workspace-status-2.md E1, E4, E6,
//   step 4): everyone whose line in this workspace names them, anchored here
//   or here through a membership, and nobody's line in another workspace.
//   The summary's reports, GET ?to='s preview and POST read the same lines
//   (reportsHereOf, the plan), so the dialog's count, its preview and the
//   run agree. Batches 7 to 9 left a report whose line another workspace
//   relied on for the step that ends the account, and named them; with one
//   line per workspace there is none (E6).
//   A manager-tier viewer is never let run it on an Admin, or over someone
//   they only read through a dotted line (batch 8), since the removal that
//   follows would be refused after the work had moved, and POST reads the
//   actor fresh, as DELETE does, so an Admin demoted a moment ago moves
//   nothing. Batch 8 read DELETE's own rule here, which admits the org-wide
//   levels and the People team for everyone who is not an Admin: a Director
//   could read a peer VP's work and hand it, with their reports, to
//   themselves (batch 9).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { mayHandOverPersonHere, mayRemovePerson, peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { staleTabRefusal } from "@/lib/access/tab-workspace-check";
import { freshActorRefusal, freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { isHandoverWorkFailed, isOpenStatus, previewReportHandover, runHandover } from "@/lib/people/handover.server";
import { rolesBusyResponse } from "@/lib/access/roles-busy";
import { liveHereAmong } from "@/lib/access/manager-lines";
import { personSeatIn, reportsHereOf } from "@/lib/access/acting-workspace";
import { leavesOnlyHere } from "@/lib/access/workspace-status";
import { liveKeysMadeHere } from "@/lib/access/seat-api-keys";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";

/** A deactivated person can't take over anyone's work: they can't sign in, and hold no reports (invariant 13). */
function inactiveRecipientWords(name: string): string {
  return `${name || "That person"} is deactivated, so they can't take over this work. Pick someone active.`;
}

const LIST_CAP = 5;

/** The log's words for the goal targets they counted from their Lists (recurring-goals.md C10). */
function goalSourcesSaid(g: { moved: number; paused: number } | undefined): string {
  if (!g || (g.moved === 0 && g.paused === 0)) return "";
  const moved = g.moved ? `. ${g.moved} goal ${g.moved === 1 ? "target" : "targets"} counted from their Lists moved with them` : "";
  const paused = g.paused ? `. ${g.paused} goal ${g.paused === 1 ? "target" : "targets"} the recipient can't count stayed paused, and their owners were told` : "";
  return `${moved}${paused}`;
}

/**
 * The person picked to take the work, when they are in this workspace:
 * anchored here or through a membership here, not removed (docs-found fixes
 * batch 5). An Owner who last switched to another workspace was refused as
 * "not found" here, though the handover itself takes them.
 */
async function recipientHere(orgId: string, id: string) {
  const row = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
  if (!row || !(await liveHereAmong(orgId, [id])).has(id)) return null;
  // Deactivated HERE (step 3): their own row's status where they are
  // anchored, their membership's status where they work through one, never
  // the account's status in another workspace.
  const seat = await personSeatIn(orgId, id);
  return { ...row, status: seat?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" };
}

/**
 * The person whose work is handed over: anyone who holds a seat here, removed
 * or not, anchored here or through a membership here (docs/plans/
 * workspace-status.md D11), with whether their account keeps working
 * somewhere else once this seat ends (workspace-status.ts leavesOnlyHere: a
 * membership here, D5, or a usable seat elsewhere, D3), for the D17 note
 * only: the handover moves this workspace's lines whatever it is.
 */
async function leaverHere(orgId: string, id: string) {
  const seat = await personSeatIn(orgId, id);
  if (!seat) return null;
  const row = await prisma.user.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true } });
  return row ? { ...row, seat, onlyHere: await leavesOnlyHere(orgId, id) } : null;
}

/**
 * Whether their account keeps working in another workspace once this seat
 * ends, so the Deactivate and Remove dialogs may say their other workspaces
 * are not affected (D17). The same pick as the end itself (the step 3 review
 * L2): someone anchored here moves only to a usable seat elsewhere that no
 * same-address account blocks (leavesOnlyHere, withUsableSeatElsewhere), so
 * one whose only seat elsewhere is blocked is ended everywhere (D4) and the
 * line is not shown; someone who works here through a membership keeps the
 * workspace their account is anchored to while that is live and open.
 */
async function belongsElsewhere(orgId: string, leaver: { id: string; seat: { kind: "anchor" | "membership" }; onlyHere: boolean }): Promise<boolean> {
  if (leaver.seat.kind === "anchor") return leaver.onlyHere;
  const open = { status: { in: ["ACTIVE" as const, "TRIAL" as const] } };
  const anchored = await prisma.user.findFirst({ where: { id: leaver.id, organizationId: { not: orgId }, deletedAt: null, status: { not: "INACTIVE" }, organization: open }, select: { id: true } });
  return !!anchored;
}

/**
 * GET ?notes=1 (docs/plans/workspace-status.md, the final review, product
 * L6): only the two notes the Remove and Deactivate dialogs show under the
 * summary (leaving-notes.ts), for a viewer who may remove this person
 * (mayRemovePerson, DELETE's own rule) whether or not they may hand the work
 * over: whether their other workspaces are not affected, and how many API
 * keys they made here stop working. A boolean and a count: it names no
 * workspace, no key and nothing of their work. Before, a viewer who may
 * remove but not hand over (the People team or an org-wide level outside
 * their own tree) read no summary, so the dialog said neither.
 */
async function leavingNotesOnly(id: string): Promise<Response> {
  const ctx = await peopleCtx();
  if (!ctx) return jsonError("Unauthorized", 401);
  const staleTab = await staleTabRefusal(ctx.organizationId);
  if (staleTab) return staleTab;
  const target = await leaverHere(ctx.organizationId, id);
  if (!target) return jsonError("User not found", 404);
  // DELETE's own rule over the level held HERE (the seat's), as the record
  // asks it (users/[id] route accessFor); nothing here decides the viewer's
  // own access.
  // eslint-disable-next-line no-restricted-syntax
  if (!mayRemovePerson(ctx, relationTo(ctx, id), { accessLevel: target.seat.level })) {
    return jsonError("You can only remove people in your reporting line.", 403);
  }
  const [alsoElsewhere, apiKeys] = await Promise.all([belongsElsewhere(ctx.organizationId, target), liveKeysMadeHere(prisma, ctx.organizationId, id)]);
  return jsonSuccess({ alsoElsewhere, apiKeys });
}

async function gateHandover(session: unknown, id: string, opts: { moves?: boolean } = {}) {
  // Admins, and the manager tier over their own solid chain, never on an
  // Admin, never themselves (person-access.server.ts mayHandOverPerson,
  // batch 9). Decided on the chain itself: the relation's label says
  // "org-wide" or "people-team" before it says "chain", so batch 8's rule
  // let those viewers read and take anyone's work who was not an Admin.
  const ctx = await peopleCtx();
  if (!ctx) return jsonError("Unauthorized", 401);
  // A tab still showing another workspace than the session's: refused, never written here (src/lib/access/tab-workspace-check.ts).
  const staleTab = await staleTabRefusal(ctx.organizationId);
  if (staleTab) return staleTab;
  if (!(await mayHandOverPersonHere(ctx, id))) {
    return jsonError("You can only run handover for people in your reporting line.", 403);
  }
  if (opts.moves) {
    // As DELETE reads its actor: an Admin demoted a moment ago still carries
    // an Admin token, and would move the work before the removal refused them.
    const fresh = await freshWorkspaceActor(session);
    if (!fresh.ok) return freshActorRefusal(fresh);
  }
  return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { id } = await params;
  // The dialogs' two notes alone, under DELETE's own rule (see leavingNotesOnly).
  if (new URL(req.url).searchParams.get("notes") === "1") return leavingNotesOnly(id);
  const gateError = await gateHandover(session, id);
  if (gateError) return gateError;

  const target = await leaverHere(orgId, id);
  if (!target) return jsonError("User not found", 404);

  const to = new URL(req.url).searchParams.get("to");
  if (to) {
    const recipient = await recipientHere(orgId, to);
    if (!recipient || to === id) return jsonError("Reassignment target not found or inactive", 404);
    if (recipient.status === "INACTIVE") return jsonError(inactiveRecipientWords(`${recipient.firstName} ${recipient.lastName}`.trim()), 409);
    return jsonSuccess({ reports: await previewReportHandover(orgId, id, to) });
  }

  const [items, okrs, kraAssignments, assets, directReports, spaces, folders, lists] = await Promise.all([
    // A meeting's hidden Item is no task: never counted, never handed over.
    prisma.item.findMany({
      where: { organizationId: orgId, ownerId: id, archivedAt: null, ...NOT_SYSTEM_ITEMS },
      select: { id: true, title: true, status: true, board: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    }),
    prisma.oKR.findMany({
      where: { organizationId: orgId, ownerId: id, status: { not: "COMPLETED" } },
      select: { id: true, title: true, quarter: true, status: true },
      orderBy: { updatedAt: "desc" },
    }),
    // This workspace's KRAs only (the step 3 review H1): someone who works
    // here through a membership holds their own company's too.
    prisma.kRAAssignment.findMany({
      where: { userId: id, status: "ACTIVE", kra: { organizationId: orgId } },
      select: { id: true, kra: { select: { name: true } } },
    }),
    prisma.asset.findMany({
      where: { organizationId: orgId, assignedToId: id },
      select: { id: true, name: true, type: true },
      orderBy: { assignedAt: "desc" },
    }),
    // Everyone whose line HERE names them (E1, step 4), the set the handover
    // moves and its gate counts: anchored here, or through a membership here
    // (reportsHereOf, kept seats). Before, the account lines naming them, in
    // any workspace, then filtered to seats here: the one surface still
    // naming another workspace's reports (the step 3 review item 1).
    reportsHereOf(orgId, [id]).then(async (lines) => {
      const ids = lines.map((r) => r.id).filter((rid) => rid !== id);
      return ids.length
        ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }] })
        : [];
    }),
    prisma.space.findMany({ where: { organizationId: orgId, ownerId: id }, select: { id: true, name: true } }),
    prisma.folder.findMany({ where: { organizationId: orgId, ownerId: id }, select: { id: true, name: true } }),
    prisma.board.findMany({ where: { organizationId: orgId, ownerId: id }, select: { id: true, name: true } }),
  ]);

  const openTasks = items.filter((it) => isOpenStatus(it.status));
  // The goal targets they count from their Lists (recurring-goals.md C10):
  // the handover moves them to the person picked, where that person may.
  const goalSources = await connectedGoalSources(orgId, id);
  // Each workspace holds its own status now (docs/plans/workspace-status.md
  // D17): the dialogs say their other workspaces are not affected, and only
  // when they belong to one. And how many API keys they made here, which
  // stop working with the seat (D15).
  const [alsoElsewhere, apiKeys] = await Promise.all([belongsElsewhere(orgId, target), liveKeysMadeHere(prisma, orgId, id)]);

  return jsonSuccess({
    alsoElsewhere,
    apiKeys,
    openTasks: {
      count: openTasks.length,
      items: openTasks.slice(0, LIST_CAP).map((t) => ({
        id: t.id,
        title: t.title,
        board: t.board?.name ?? null,
      })),
    },
    okrs: { count: okrs.length, items: okrs.slice(0, LIST_CAP) },
    kras: {
      count: kraAssignments.length,
      items: kraAssignments.slice(0, LIST_CAP).map((a) => ({ id: a.id, name: a.kra.name })),
    },
    assets: { count: assets.length, items: assets.slice(0, LIST_CAP) },
    directReports: { count: directReports.length, items: directReports.slice(0, LIST_CAP) },
    containers: {
      count: spaces.length + folders.length + lists.length,
      spaces: spaces.length,
      folders: folders.length,
      lists: lists.length,
      items: [...spaces, ...folders, ...lists].slice(0, LIST_CAP),
    },
    ...(goalSources > 0 ? { goalSources: { count: goalSources } } : {}),
  });
}

/** How many goal targets this person counts from their Lists (0 when it cannot be read). */
async function connectedGoalSources(orgId: string, userId: string): Promise<number> {
  try {
    return await prisma.keyResult.count({ where: { sourceById: userId, okr: { organizationId: orgId } } });
  } catch {
    return 0;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { id } = await params;
  const gateError = await gateHandover(session, id, { moves: true });
  if (gateError) return gateError;

  const target = await leaverHere(orgId, id);
  if (!target) return jsonError("User not found", 404);

  const body = await req.json().catch(() => ({}));
  const reassignToId = typeof body?.reassignToId === "string" ? body.reassignToId : "";
  if (!reassignToId) return jsonError("reassignToId is required");
  if (reassignToId === id) return jsonError("Cannot reassign work to the person being removed");

  const recipient = await recipientHere(orgId, reassignToId);
  if (!recipient) return jsonError("Reassignment target not found or inactive", 404);
  if (recipient.status === "INACTIVE") return jsonError(inactiveRecipientWords(`${recipient.firstName} ${recipient.lastName}`.trim()), 409);

  // The one handover (src/lib/people/handover.server.ts): direct reports
  // (never into a loop) under the role lock, then the Spaces, Folders and
  // Lists they own and their open tasks. History is never rewritten. A busy
  // role lock answers 503 with nothing moved. When the reports moved and the
  // work did not (batch 5), the answer says exactly that, as a 503 the
  // dialog shows: running it again moves the rest, and the reports' moves
  // are already in the Audit log (one reporting_line_changed row each).
  let result: Awaited<ReturnType<typeof runHandover>>;
  try {
    // This workspace's lines only (E6): the same run whether or not their
    // account keeps working elsewhere.
    result = await runHandover({ organizationId: orgId, fromId: id, toId: reassignToId, actorId: getUserId(session) });
  } catch (e) {
    const busy = rolesBusyResponse(e);
    if (busy) return busy;
    if (isHandoverWorkFailed(e)) {
      return NextResponse.json(
        {
          error: e.message,
          code: e.code,
          partial: { ...e.lines, tasksReassigned: 0, containersReassigned: 0 },
        },
        { status: 503, headers: { "Retry-After": "2" } },
      );
    }
    throw e;
  }

  logActivity({
    type: "user_handover",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Handed over ${result.tasksReassigned} open tasks, ${result.reportsReassigned} direct reports and ${result.containersReassigned} Spaces, Folders and Lists from ${target.firstName} ${target.lastName} to ${recipient.firstName} ${recipient.lastName}${goalSourcesSaid(result.goalSources)}`,
    targetId: id,
    targetType: "user",
    metadata: {
      recipientId: reassignToId,
      ...result,
      reportsRehomed: result.reportsRehomed.length,
    },
  });

  return jsonSuccess(result);
}
