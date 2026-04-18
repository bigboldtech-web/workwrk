import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { getClientIp, getVisitorGeo, POLICY_VERSION } from "@/lib/compliance/server";

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
 *  - notifications, AI queries, idea votes/comments, activity log rows
 *    attributable to the user (these are freely deletable)
 *
 * Things we RETAIN:
 *  - Aggregated org records (reviews, KPI records, kudos, action items) with
 *    the anonymized user reference — deletion would break historical integrity
 *  - Consent records — required to prove lawful processing
 *
 * Request body requires `confirm: "<email>"` to prevent accidental deletion.
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
  if (!body.confirm || body.confirm.trim().toLowerCase() !== me.email.toLowerCase()) {
    return jsonError("Confirmation email does not match", 400);
  }

  const geo = await getVisitorGeo();
  const ipAddress = await getClientIp();
  const userAgent = req.headers.get("user-agent") ?? null;
  const anonymizedEmail = `deleted-${userId}@workwrk.anon`;
  const randomPassword = crypto.randomUUID() + crypto.randomUUID();

  try {
    await prisma.$transaction(async (tx) => {
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
        },
      });

      // 2) Hard-delete data that is safe to remove
      await Promise.all([
        tx.notification.deleteMany({ where: { userId } }),
        tx.aIQuery.deleteMany({ where: { userId } }),
        tx.ideaVote.deleteMany({ where: { userId } }),
        tx.ideaComment.deleteMany({ where: { userId } }),
        tx.activityLog.deleteMany({ where: { actorId: userId } }),
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
    });

    return jsonSuccess({
      ok: true,
      message:
        "Account anonymized. Some organizational records are retained in anonymized form as permitted by GDPR Art. 17(3) and our retention policy.",
    });
  } catch (err) {
    console.error("[delete] failed:", err);
    return jsonError("Failed to delete account", 500);
  }
}
