// How a KPI reading from an integration lands (POST /api/v1/kpi-records and
// the kpi.record action of /api/integrations/ingest), as one rule. Docs-found
// fixes batch 3.
//
// THE PERIOD IS A MONTH, "YYYY-MM". Goals read only month keys
// (src/lib/alignment.ts latestKpiValues: the latest month wins, and a key
// with a W or a Q is skipped), and the in-app recorders write only month
// keys. The OpenAPI example used to be "2026-Q1": an integration that
// followed it got 201 and a kpi.recorded webhook, and its readings never
// moved a goal, never counted as this month (so the monthly "record your
// KPIs" email kept coming), and nothing said why. Worse, any other key
// ("October", "2026-10-12") is compared as a string with the month keys and
// can sort after every real month, so it would pin a goal's live value for
// good. So a period that is not a month key is refused with a 400 that says
// what to send. A month that has not started anywhere yet is refused too: a
// forecast posted as next month would become the goal's live value.
// Any earlier month is taken, so an integration can backfill history.
//
// A SECOND READING FOR THE SAME KPI, PERSON AND MONTH (the row is unique on
// the three) used to throw inside the create and answer a bare 500, so an
// integration re-posting a corrected number lost the correction:
//   - the same number again changes nothing (200, the reading as it is), so
//     a retried call is safe;
//   - a different number replaces it (200) while the month is still open,
//     the same two months the in-app recorders write (this month and last
//     month, in any timezone: src/lib/kpi-period.ts). It goes back to
//     PENDING, as a new reading from an integration starts, and the
//     reviewer is cleared: a manager's approval was of the old number, and
//     keeping it would show "Approved" on a number nobody approved;
//   - a different number for a closed month is refused (409, with the
//     reading's id): the in-app recorders never rescore a closed month
//     either, and a review may already rest on it.
//
// Pure: no Prisma.

import { currentKpiPeriod, isKpiPeriodWritableAnyZone } from "@/lib/kpi-period";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const ZONE_AHEAD_MS = 14 * 60 * 60 * 1000;

export const KPI_PERIOD_RULE =
  "period must be a month written YYYY-MM, such as 2026-10, and not a month that has not started yet. Goals read only month keys.";

/** Why this period can't take a reading, or null when it can. */
export function integrationPeriodProblem(period: unknown, now: Date = new Date()): string | null {
  if (typeof period !== "string" || !MONTH_KEY.test(period)) return KPI_PERIOD_RULE;
  // The month that is current somewhere on Earth: fourteen hours ahead of UTC.
  // Keys are fixed width, so string order is month order.
  if (period > currentKpiPeriod(new Date(now.getTime() + ZONE_AHEAD_MS))) return KPI_PERIOD_RULE;
  return null;
}

export type IntegrationKpiWrite = "create" | "unchanged" | "update" | "closed";

function same(a: number | null | undefined, b: number): boolean {
  return a != null && Math.abs(a - b) < 1e-9;
}

/** What a reading does to the row already there for its KPI, person and month. */
export function integrationKpiWrite(args: {
  existing: { actualValue: number | null; targetValue: number } | null;
  actual: number;
  target: number;
  period: string;
  now?: Date;
}): IntegrationKpiWrite {
  const ex = args.existing;
  if (!ex) return "create";
  if (same(ex.actualValue, args.actual) && same(ex.targetValue, args.target)) return "unchanged";
  return isKpiPeriodWritableAnyZone(args.period, args.now ?? new Date()) ? "update" : "closed";
}

export const KPI_CLOSED_MONTH =
  "That month is closed, so its reading stays as it is. A reading can change only in this month or last month.";
