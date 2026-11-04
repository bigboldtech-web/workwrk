// SCIM's one way to bring back a person's DEACTIVATED seat in a workspace
// (docs/plans/workspace-status.md D14; the step 4 review M1, L1, L2, L3):
// PUT and PATCH active:true on src/app/api/scim/v2/Users/[id], for someone
// anchored here or here through a membership, and POST
// /api/scim/v2/Users for an address whose seat here was deactivated. One
// path, so the doors cannot drift.
//
// In ONE transaction, under the workspace's role lock and seat lock (each a
// bounded wait: a busy one answers 503, which identity providers retry):
//   1. the workspace must be open: a reactivation never lands in a
//      SUSPENDED or CANCELLED workspace, and D6 never moves an account into
//      one (L3)
//   2. the seat check (src/lib/seats.ts): a seat back is a seat used
//   3. the push's own fields for someone anchored here (names, address),
//      written as before; nothing of a membership person's, whose account is
//      their anchored workspace's. Under the person's row lock (after the
//      workspace's locks): only while they are still anchored here (the
//      final review, integrity L2), and never the address, its verification
//      or the names while the account holds a membership in another
//      workspace (security H1, src/lib/access/shared-identity.ts)
//   4. restoreSeat for this workspace only (workspace-status.ts), at the
//      level the seat held: a seat this workspace REMOVED is refused (a
//      removal is a decision the identity provider's periodic push, or a
//      POST, must not undo: M1), as are an erased account and a second live
//      account of the address. Someone reactivated a moment ago (not_ended)
//      is left exactly as they are (L2).
//   5. only once the seat is back: the reporting lines HERE that no longer
//      hold cleared (manager-candidate.ts staleLinesOf; the line the seat
//      here holds, through seat-writes.ts writeLineHere on the row that
//      holds it now, and this workspace's dotted rows, through
//      removeDottedHere: never another workspace's line, workspace-status-2.md
//      E4, step 4; before, it cleared the account's line, which for someone
//      here through a membership is their own company's), each with its
//      reporting_line_changed row, and the open reviews moved with a cleared
//      manager line (review-cycle.server.ts followReportingLine, to the
//      first Owner when no person acted), all in the same transaction (L1:
//      POST cleared lines silently; L2: a not_ended reactivation kept them
//      cleared, unlogged).
// After the commit: the reactivation's own audit row (scimReactivated) and
// the skills with AI teammates here, and in each workspace whose seat came
// back with the anchored one (D16), stop their 30 days.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { liveOwnerIds, lockOrgRoles } from "@/lib/access/membership";
import { LOCKED_TX, rolesBusyAnswer } from "@/lib/access/org-roles-busy";
import { clearedLineSentence, staleLinesOf, type StaleLine } from "@/lib/access/manager-candidate";
import { personSeatIn, type PersonSeat } from "@/lib/access/acting-workspace";
import { restoreSeat, workspaceIsOpen, type RestoreSeatResult } from "@/lib/access/workspace-status";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";
import { followReportingLine } from "@/lib/performance/review-cycle.server";
import { scimReactivated } from "@/lib/scim-deprovision";
import { SCIM_WORKSPACE_INACTIVE } from "@/lib/scim-auth";
import { skillsBackFor } from "@/lib/skills/store";
import { lockPerson } from "@/lib/access/workspace-anchor";
import { removeDottedHere, seatRefOf, writeLineHere } from "@/lib/access/seat-writes";
import { identityShared, touchesIdentity, withoutIdentity } from "@/lib/access/shared-identity";

/** The fields SCIM answers a resource with. */
export const SCIM_USER_SELECT = { id: true, email: true, firstName: true, lastName: true, status: true, createdAt: true, updatedAt: true } as const;
export type ScimUserRow = Prisma.UserGetPayload<{ select: typeof SCIM_USER_SELECT }>;

/** Why a seat this workspace removed does not come back through SCIM (M1). */
export const SCIM_REMOVED_REFUSAL =
  "This person was removed from this workspace in WorkwrK, so the identity provider can't bring them back. An Owner or Admin can restore them from the Directory's Removed view.";


export type ScimReactivation =
  | { ok: true; row: ScimUserRow; seat: PersonSeat | null; restored: boolean }
  | { ok: false; status: 403 | 404 | 409 | 503; error: string };

/** restoreSeat's refusal as SCIM answers it, or null when there is nothing to refuse. */
function refusalOf(r: RestoreSeatResult): { status: 404 | 409; error: string } | null {
  switch (r.outcome) {
    case "restored":
    case "not_ended":
      return null;
    case "removed":
      return { status: 409, error: SCIM_REMOVED_REFUSAL };
    case "duplicate":
      return { status: 409, error: "Another account with this address is already active in this workspace. The two accounts need to be merged first." };
    case "erased":
    case "not_here":
      return { status: 404, error: "User not found" };
  }
}

/** Thrown inside the transaction so nothing of it lands. */
class Refused extends Error {
  constructor(readonly status: 403 | 404 | 409, message: string) {
    super(message);
    this.name = "ScimReactivationRefused";
  }
}

/**
 * Brings back this person's deactivated seat here (see the header). `fields`:
 * what the push also writes on the account of someone anchored here (never
 * pass any for a membership person).
 */
export async function scimReactivateSeat(organizationId: string, userId: string, fields: Record<string, unknown> = {}): Promise<ScimReactivation> {
  let placed: { row: ScimUserRow | null; seat: PersonSeat | null; restored: Extract<RestoreSeatResult, { outcome: "restored" }> | null };
  try {
    placed = await prisma.$transaction(async (tx) => {
      await lockOrgRoles(tx, organizationId);
      await lockWorkspaceSeats(tx, organizationId, { bounded: true });
      const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
      if (!org) throw new Refused(404, "User not found");
      // A closed workspace takes no one back (L3), in the words scim-auth.ts answers any write there with.
      if (!workspaceIsOpen(org.status)) throw new Refused(403, SCIM_WORKSPACE_INACTIVE);
      const seats = await seatsFor(organizationId, 1, tx);
      if (!seats.ok) throw new Refused(403, seats.message);
      if (Object.keys(fields).length > 0) {
        // See the header, step 3: a person moved away a moment ago, or an
        // identity shared with another workspace, takes none of them.
        await lockPerson(tx, userId);
        const write = touchesIdentity(fields) && (await identityShared(tx, userId, organizationId)) ? withoutIdentity(fields) : fields;
        if (Object.keys(write).length > 0) await tx.user.updateMany({ where: { id: userId, organizationId }, data: write });
      }

      const r = await restoreSeat(tx, { userId, organizationId, kind: "reactivated" });
      const no = refusalOf(r);
      if (no) throw new Refused(no.status, no.error);
      const restored = r.outcome === "restored" ? r : null;

      if (restored) {
        // The lines here, only now the seat is back, in this transaction (L1,
        // L2), on the row that holds the seat now (a D6 restore may have
        // moved the account here, E3 carrying the line with it).
        const stale = await staleLinesOf(organizationId, userId, tx);
        await removeDottedHere(tx, organizationId, stale.dotted.map((d) => ({ userId, managerId: d.managerId })));
        if (stale.manager) {
          const now = await tx.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true } });
          if (!now || !(await writeLineHere(tx, seatRefOf(organizationId, now), null))) throw new Refused(409, "Their status here changed a moment ago. Try again.");
        }
        const cleared: StaleLine[] = [...(stale.manager ? [stale.manager] : []), ...stale.dotted];
        if (cleared.length > 0) {
          const who = await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
          const name = `${who?.firstName ?? ""} ${who?.lastName ?? ""}`.trim();
          for (const line of cleared) {
            const solid = line === stale.manager;
            await tx.activityLog.create({
              data: {
                type: "reporting_line_changed",
                actorId: null,
                actorType: "scim",
                actorLabel: "Identity provider",
                organizationId,
                description: clearedLineSentence("Reactivated", name, line, solid),
                targetType: "user",
                targetId: userId,
                severity: "info",
                oldValue: solid ? { managerId: line.managerId } : { dottedManagerId: line.managerId },
                newValue: solid ? { managerId: null } : { dottedManagerId: null },
                metadata: { onReactivate: true, reason: line.why },
              },
            });
          }
        }
        // Open reviews follow the cleared line. No person acted, so a review
        // with no manager to go to goes to the first Owner, as SCIM's
        // unattended handover does (membership.ts unattendedRecipient).
        if (stale.manager) {
          const owner = (await liveOwnerIds(organizationId, tx))[0];
          if (owner) await followReportingLine(organizationId, [userId], owner, tx);
        }
      }
      const row = await tx.user.findUnique({ where: { id: userId }, select: SCIM_USER_SELECT });
      const seat = row ? await personSeatIn(organizationId, userId, tx) : null;
      return { row, seat, restored };
    }, LOCKED_TX);
  } catch (e) {
    if (e instanceof Refused) return { ok: false, status: e.status, error: e.message };
    const busy = rolesBusyAnswer(e);
    if (busy) return { ok: false, status: 503, error: busy.error };
    throw e;
  }
  if (!placed.row) return { ok: false, status: 404, error: "User not found" };
  if (placed.restored) {
    await scimReactivated(organizationId, userId).catch((e: unknown) => console.error("scim reactivation audit failed", e));
    // Their skills with AI teammates here stop their 30 days (docs/plans/ai-teammates-phase5.md Decision 14); never fails the write.
    for (const org of [organizationId, ...placed.restored.alsoRestoredIn]) await skillsBackFor(org, [userId]);
  }
  return { ok: true, row: placed.row, seat: placed.seat, restored: !!placed.restored };
}
