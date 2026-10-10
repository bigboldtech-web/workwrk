import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { getClientIp, getVisitorGeo, POLICY_VERSION } from "@/lib/compliance/server";
import { soleAdminWorkspaces } from "@/lib/access/self-facts";
import { endAllConnectionsOf } from "@/lib/connectors/connections";
import { OPEN_RUN_STATUSES } from "@/lib/agents/budget";
import { TURN_ERRORS } from "@/lib/agents/teammate-copy";

/** Thrown inside the transaction when the re-check under the lock refuses. */
class LastAdminError extends Error {
  constructor(public readonly orgIds: string[]) { super("last_admin"); }
}

/**
 * GDPR Article 17 / CCPA Right to Delete.
 *
 * Approach: we anonymize the User row and preserve organizational records
 * (reviews, kudos, activity) that reference them. Anonymization is widely
 * accepted by EU DPAs as satisfying the erasure obligation while meeting our
 * legitimate-interest obligations (data integrity, legal defense, tax audit).
 *
 * Things we DO erase:
 *  - email, names, avatar, phone, date of birth, passwordHash
 *  - notifications, idea votes/comments (freely deletable)
 *  - the text of their AI questions and answers: each AIQuery row stays,
 *    worded "Erased", because the row IS the plan's count of AI questions
 *    used (src/lib/ai-allowance.ts); deleting it handed questions back, so
 *    invite, ask, delete could run the AI on any plan without end
 *  - the IP address and user agent on the activity rows they authored
 *  - their AI chats' and AI teammates' records, in every workspace (review
 *    round 3 of Phase 3): the text of every chat they own, with Ask AI or a
 *    teammate (each message's words, its call record and its meta, worded
 *    "Erased"; the chat's title), what each
 *    request a teammate asked them to approve would send or change (input,
 *    edited input, preview and result: an email's recipients and body, an
 *    event's guests), and their runs' output (an answer's text and calls);
 *    the input of Ask AI's tool runs too. The rows stay, as the AIQuery rows
 *    do: their ids, status, times and token counts are the plan's and the
 *    audit's. Their Google connections end first (endAllConnectionsOf), so
 *    no teammate reads their Gmail or Google Calendar after the words go.
 *    Each request's error goes too, and an Ask AI tool run's (review round 4
 *    of Phase 3): a Google card's can name the person's two Google addresses
 *    (CONNECTOR_COPY.accountChanged), a tool's can quote its input.
 *
 * A TURN STILL GOING NEVER WRITES AFTER THE BLANKING (review round 4 of Phase
 * 3). The transaction's FIRST statement fails every open run of theirs
 * (FAILED, "the account it worked for was deleted", endedAt), and a turn
 * writes its answer, cards and chat lines only while its run is open and
 * its person still has an account, checked under the run's lock
 * (src/lib/agents/budget.ts runStillOpen). Erasure first: the turn waits on
 * the lock, reads FAILED and writes nothing, and its last run write, asked
 * only of an open run, leaves the FAILED. The turn first: this statement
 * waits on the lock until its rows are committed, and the blanking below
 * reads them. A run claimed after that first statement is not failed by it,
 * so a turn also checks that its person still has an account (the User row,
 * FOR SHARE), which this transaction anonymises after it is done with runs:
 * that turn writes nothing either, and its run ends FAILED keeping none of
 * its words. Before, an answer, its run's output and its cards written a
 * moment after the blanking were kept for good. A request still RUNNING
 * (approved, its tool going) is ended FAILED before the blanking, so the
 * result it would write after it, by a swap from RUNNING, is never written.
 *
 * Things we RETAIN:
 *  - Aggregated org records (reviews, KPI records, kudos, action items) with
 *    the anonymized user reference — deletion would break historical integrity
 *  - Consent records, required to prove lawful processing
 *  - The activity and audit rows they authored, under the anonymised actor
 *    ("Deleted User"): the workspace's audit log and its retention setting
 *    decide how long those live, never the person the log is about, so an
 *    admin cannot erase their own trail by deleting their account
 *
 * Request body requires `confirm: "DELETE"` (the My settings dialog) or the
 * person's own email (the older privacy-controls shape) to prevent an
 * accidental deletion.
 *
 * Refused (409 `last_admin`) when the person is the only active Owner or
 * Admin of ANY workspace they belong to (the anchored one and every
 * membership): a workspace with nobody who can reach Members is one nobody
 * can repair (spec-account-auth "Delete my account", the last Owner case).
 * The check runs twice: once up front for a fast answer, and again inside
 * the transaction under a per-workspace advisory lock, so two sole admins
 * deleting at the same moment cannot both pass (the second waits for the
 * first, then sees it gone and is refused). The anonymised row also takes a tokenVersion bump, so every other
 * device's session ends on its next check instead of lingering.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, deletedAt: true, organizationId: true },
  });
  if (!me) return jsonError("Not found", 404);
  if (me.deletedAt) return jsonError("Account already deleted", 400);
  const confirm = typeof body.confirm === "string" ? body.confirm.trim() : "";
  if (confirm !== "DELETE" && confirm.toLowerCase() !== me.email.toLowerCase()) {
    return jsonError("Type DELETE to confirm", 400);
  }
  const lastAdmin = () =>
    jsonSuccess({ error: "You are the only admin of a workspace you belong to. Make someone else an admin there first.", code: "last_admin" }, 409);
  const sole = await soleAdminWorkspaces(userId);
  if (sole.length > 0) return lastAdmin();
  // Every workspace this person belongs to: the lock set for the re-check.
  const memberOf = await prisma.organizationMembership.findMany({ where: { userId }, select: { organizationId: true } });
  const lockOrgs = [...new Set([me.organizationId, ...memberOf.map((m) => m.organizationId)])].sort();

  const geo = await getVisitorGeo();
  const ipAddress = await getClientIp();
  const userAgent = req.headers.get("user-agent") ?? null;
  const anonymizedEmail = `deleted-${userId}@workwrk.anon`;
  const randomPassword = crypto.randomUUID() + crypto.randomUUID();

  // Their Google connections for AI teammates go in every workspace, and
  // Google is told (docs/plans/ai-teammates-phase3.md Decision 20). Before
  // the erasure (review round 3 of Phase 3: it ran after the commit, so a
  // teammate could still read their mail into a chat the erasure had just
  // blanked), never failing it: the cron sweep ends any missed. A refusal
  // under the lock below, a race no up-front check can rule out, leaves them
  // disconnected, which connecting again undoes.
  await endAllConnectionsOf(userId, "left", userId).catch((e) => {
    console.error(`[connectors] account deletion hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
  });

  try {
    await prisma.$transaction(async (tx) => {
      // First, before anything else (see the header): every run of theirs
      // still open is failed, and from here no turn of theirs writes.
      const now = new Date();
      const theirRuns = { OR: [{ actingForId: userId }, { triggeredBy: userId }] };
      await tx.agentRun.updateMany({
        where: { ...theirRuns, status: { in: [...OPEN_RUN_STATUSES] } },
        data: { status: "FAILED", endedAt: now, error: TURN_ERRORS.accountDeleted },
      });
      // Their runs' words next, before the User row: this transaction takes
      // no run after it anonymises that row below, the order a turn's writes
      // take the two in (budget.ts runState), so neither ever waits on the
      // other in turn. A teammate run's error is one of the engine's own
      // sentences (TURN_ERRORS), the one above among them, so it stays.
      await tx.agentRun.updateMany({ where: theirRuns, data: { output: Prisma.DbNull } });
      // Ask AI's tool runs keep the tool's input there (no actingForId), and
      // its error, which can quote that input (review round 4 of Phase 3).
      await tx.agentRun.updateMany({ where: { triggeredBy: userId, actingForId: null }, data: { input: {}, error: null } });
      // And every request of theirs still running ends, so its result, written by a swap from RUNNING, never lands after the blanking.
      await tx.agentAction.updateMany({ where: { actingForId: userId, status: "RUNNING" }, data: { status: "FAILED", updatedAt: now } });

      // 0) Lock every workspace this person belongs to, in one sorted order
      //    (no deadlock between two deletes), then re-check under the lock.
      //    Another delete of an admin of the same workspace waits here until
      //    this one commits, so it counts this person as gone.
      for (const orgId of lockOrgs) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`me.delete:${orgId}`}))`;
      }
      const stillSole = await soleAdminWorkspaces(userId, tx);
      if (stillSole.length > 0) throw new LastAdminError(stillSole);

      // 1) Anonymize the user row
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymizedEmail,
          firstName: "Deleted",
          lastName: "User",
          avatar: null,
          phone: null,
          dateOfBirth: null,
          passwordHash: randomPassword,
          status: "INACTIVE",
          deletedAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      });

      // 2) Hard-delete data that is safe to remove
      await Promise.all([
        tx.notification.deleteMany({ where: { userId } }),
        tx.aIQuery.updateMany({ where: { userId }, data: { query: "Erased", response: null } }),
        tx.ideaVote.deleteMany({ where: { userId } }),
        tx.ideaComment.deleteMany({ where: { userId } }),
        // Kept, with the network details cleared (see the header).
        tx.activityLog.updateMany({ where: { actorId: userId }, data: { ipAddress: null, userAgent: null } }),
        // Their AI chats' and AI teammates' records, in every workspace (see
        // the header); their runs were blanked first of all, above.
        tx.chatMessage.updateMany({ where: { session: { userId } }, data: { content: "Erased", toolCalls: Prisma.DbNull, meta: Prisma.DbNull } }),
        tx.chatSession.updateMany({ where: { userId }, data: { title: null } }),
        // The error too (review round 4 of Phase 3): a Google card's names both of the person's Google addresses.
        tx.agentAction.updateMany({ where: { actingForId: userId }, data: { input: {}, editedInput: Prisma.DbNull, preview: {}, result: Prisma.DbNull, error: null } }),
        // What their teammates remember about them goes, and the routines that
        // work as them keep no words and never run again (the rows stay, as
        // chats and cards do, so nothing that points at one is left dangling;
        // lead, after review round 3 of Phase 3).
        tx.agentMemory.deleteMany({ where: { scope: "person", scopeId: userId } }),
        tx.agentRoutine.updateMany({ where: { actingForId: userId }, data: { name: "Erased", prompt: "Erased", status: "paused", pausedReason: "person_gone", nextRunAt: null } }),
      ]);

      // 3) Log the erasure request itself (required evidence)
      await tx.consentRecord.create({
        data: {
          userId,
          method: "erasure",
          necessary: true,
          preferences: false,
          analytics: false,
          marketing: false,
          doNotSell: true,
          region: geo.label,
          country: geo.country,
          policyVersion: POLICY_VERSION,
          ipAddress,
          userAgent,
          withdrawnAt: new Date(),
        },
      });
    }, { timeout: 20_000, maxWait: 10_000 });

    return jsonSuccess({
      ok: true,
      message:
        "Account anonymized. Some organizational records are retained in anonymized form as permitted by GDPR Art. 17(3) and our retention policy.",
    });
  } catch (err) {
    if (err instanceof LastAdminError) return lastAdmin();
    console.error("[delete] failed:", err);
    return jsonError("Failed to delete account", 500);
  }
}
