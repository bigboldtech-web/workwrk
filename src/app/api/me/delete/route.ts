import { NextRequest } from "next/server";
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
import { ERASURE_INLINE_BUDGET_MS, ERASURE_METHOD, continueErasure, recordErasure } from "@/lib/agents/erasure-sweep";
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
 * TWO PARTS (review round 5 of Phase 3). Blanking a heavy person's whole
 * history in the one 20 second transaction (30 hourly routines leave about
 * 260,000 runs and report rows a year) timed it out every time, so they could
 * never erase their account, and their teammates' answers in flight were lost
 * while it held their runs.
 *  (a) One short transaction, in this order: the workspace locks; the
 *      last-admin re-check under them; the person's open runs and running
 *      requests failed and their User row anonymised, back to back; the small
 *      deletes and writes (notifications, idea votes and comments, person
 *      memories, their routines, at most 30); the consent record, and beside
 *      it the person's AccountErasure row (review round 6 of Phase 3: the
 *      erasure's progress, started over if one is already there). Nothing in
 *      it reads their whole history.
 *  (b) After it commits, src/lib/agents/erasure-sweep.ts continueErasure
 *      blanks the words listed above, their AI questions' text and the
 *      network details of their activity rows, in batches of 500 rows, each
 *      its own short statement, for up to 20 seconds, from the start, and
 *      saves on the row where it stopped. The account is deleted once (a)
 *      commits, so the answer is a success whether or not (b) finished; the
 *      teammates cron (finishErasures) goes on from that place, within
 *      minutes, and runs one more whole pass once nothing can still arrive.
 * Their AI questions and activity rows grow by one a teammate turn or write,
 * so they left (a) as well.
 *
 * A TURN STILL GOING NEVER KEEPS WHAT IT WRITES (review rounds 4 and 5 of
 * Phase 3). A turn writes its answer, cards and chat lines only while its run
 * is open and its person still has an account, checked under the run's lock
 * and the person's (src/lib/agents/budget.ts runState). So once (a) commits,
 * every run of theirs reads closed or person_gone, and no turn of theirs
 * writes again. A turn that saved before then (the run statement or the User
 * update waited on its locks until it had) has its rows blanked by (b) or the
 * sweep. A request still RUNNING (approved, its tool going) is ended FAILED
 * in (a), so the result its swap from RUNNING would write never lands.
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
    // (a) The short transaction (see the header): nothing in it reads the
    // person's whole history.
    await prisma.$transaction(async (tx) => {
      // 1) Lock every workspace this person belongs to, in one sorted order
      //    (no deadlock between two deletes), then re-check under the lock.
      //    Another delete of an admin of the same workspace waits here until
      //    this one commits, so it counts this person as gone. First, so a
      //    run claimed while this waits is still failed below (review round
      //    5 of Phase 3: the runs were failed before this wait).
      for (const orgId of lockOrgs) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`me.delete:${orgId}`}))`;
      }
      const stillSole = await soleAdminWorkspaces(userId, tx);
      if (stillSole.length > 0) throw new LastAdminError(stillSole);

      // 2) Every run of theirs still open is failed, every request of theirs
      //    still running ends (so its result, written by a swap from RUNNING,
      //    never lands), and the User row is anonymised, back to back with
      //    nothing that waits between them. A turn takes the same two in the
      //    same order, run then person (budget.ts runState), and this takes no
      //    run after the person, so neither ever waits on the other in turn.
      const now = new Date();
      await tx.agentRun.updateMany({
        where: { OR: [{ actingForId: userId }, { triggeredBy: userId }], status: { in: [...OPEN_RUN_STATUSES] } },
        data: { status: "FAILED", endedAt: now, error: TURN_ERRORS.accountDeleted },
      });
      await tx.agentAction.updateMany({ where: { actingForId: userId, status: "RUNNING" }, data: { status: "FAILED", updatedAt: now } });
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
          deletedAt: now,
          tokenVersion: { increment: 1 },
        },
      });

      // 3) The small deletes and writes, each bounded by the person (their
      //    words are blanked after the commit, below).
      await Promise.all([
        tx.notification.deleteMany({ where: { userId } }),
        tx.ideaVote.deleteMany({ where: { userId } }),
        tx.ideaComment.deleteMany({ where: { userId } }),
        // What their teammates remember about them goes, and the routines that
        // work as them keep no words and never run again (the rows stay, as
        // chats and cards do, so nothing that points at one is left dangling;
        // lead, after review round 3 of Phase 3).
        tx.agentMemory.deleteMany({ where: { scope: "person", scopeId: userId } }),
        tx.agentRoutine.updateMany({ where: { actingForId: userId }, data: { name: "Erased", prompt: "Erased", status: "paused", pausedReason: "person_gone", nextRunAt: null } }),
      ]);

      // 4) Log the erasure request itself (required evidence), and beside it
      //    the erasure's progress row, which the sweep reads (review round 6
      //    of Phase 3: it found erasures by this record alone, which POST
      //    /api/consent could write for a living account).
      await tx.consentRecord.create({
        data: {
          userId,
          method: ERASURE_METHOD,
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
          withdrawnAt: now,
        },
      });
      await recordErasure(tx, userId, now);
    }, { timeout: 20_000, maxWait: 10_000 });
  } catch (err) {
    if (err instanceof LastAdminError) return lastAdmin();
    console.error("[delete] failed:", err);
    return jsonError("Failed to delete account", 500);
  }

  // (b) The account is deleted. Their words go now, in batches within a
  // budget, the place saved on the row; whatever this leaves, or a failure,
  // the sweep finishes from there (src/lib/agents/erasure-sweep.ts
  // finishErasures), so the answer is a success either way. A pass that
  // reaches the end here still waits for the sweep's last pass, once nothing
  // in flight can still write.
  try {
    const pass = await continueErasure(userId, Date.now() + ERASURE_INLINE_BUDGET_MS);
    if (!pass.found) console.error(`[delete] account ${userId}: no erasure row found after the commit`);
    else if (pass.end !== "settling") console.error(`[delete] account ${userId}: words left for the erasure sweep after ${pass.rows} rows`);
  } catch (err) {
    console.error(`[delete] account ${userId}: words left for the erasure sweep: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
  }

  return jsonSuccess({
    ok: true,
    message:
      "Account anonymized. Some organizational records are retained in anonymized form as permitted by GDPR Art. 17(3) and our retention policy.",
  });
}
