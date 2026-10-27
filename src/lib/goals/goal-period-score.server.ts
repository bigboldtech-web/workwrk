// The score patch of a closed period (docs/plans/recurring-goals.md B3 step
// 3, G2). The closer calls it exactly once per closed period, inside the
// transaction that holds the period row FOR UPDATE and stamps
// scorePatchedAt, and retries a period whose patch has not run on its next
// run (patchScoreOnce in goal-periods.server.ts).
//
// STEP 2 LEAVES IT EMPTY on purpose: the performance score's okrParts, the
// period-to-month mapping and the patch rules are step 6 (G1, G2). The hook
// exists now so the close, its lock and its once-only stamp are proved
// before anything writes a score through them.

import type { Prisma } from "@/generated/prisma";

/** Patch the owner's score row for the month the period belongs to (G2). Step 6. */
export async function patchPeriodScore(tx: Prisma.TransactionClient, periodId: string): Promise<void> {
  void tx;
  void periodId;
}
