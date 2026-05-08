// Overtime engine.
//
// Given a set of TimeEntry rows and an OvertimePolicy, produce
// regular / overtime / double-time hour buckets. The engine is
// pure — no DB calls — so payroll runs can call it in tight loops
// across thousands of employees.
//
// The rules we model today:
//   - Daily OT after `dailyOtAfter` hours.
//   - Daily DT after `dailyDtAfter` hours (CA: 12h).
//   - Weekly OT after `weeklyOtAfter` weekly total (FLSA: 40h).
//   - 7th-consecutive-day rule (CA): first 8h OT, beyond 8h DT.
//
// Worked hours that satisfy multiple thresholds count once at the
// highest severity (DT > OT > REG).

export type OtEntry = {
  // YYYY-MM-DD or any date that toISOString().slice(0,10)s into one.
  day: Date;
  hours: number;
};

export type OtPolicy = {
  dailyOtAfter: number | null;
  dailyDtAfter: number | null;
  weeklyOtAfter: number | null;
  seventhDayOt: boolean;
};

export type OtResult = {
  regular: number;
  overtime: number;
  doubletime: number;
  byDay: Array<{ day: string; regular: number; overtime: number; doubletime: number }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

/**
 * Compute OT for the given week's entries. The caller is responsible
 * for grouping by employee + week before calling — every entry here
 * is treated as belonging to the same person + week.
 */
export function computeWeeklyOvertime(entries: OtEntry[], policy: OtPolicy): OtResult {
  // Bucket entries by day.
  const byDay = new Map<string, number>();
  for (const e of entries) {
    const k = dayKey(e.day);
    byDay.set(k, (byDay.get(k) ?? 0) + e.hours);
  }

  // Sort days ascending so the 7th-consecutive-day rule lands on
  // the right day.
  const sortedDays = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));

  // Track consecutive days for the 7th-day rule.
  let consec = 0;
  let prevTs: number | null = null;

  const dayResults: OtResult["byDay"] = [];
  let totalRegular = 0;
  let totalOt = 0;
  let totalDt = 0;

  for (const [k, hours] of sortedDays) {
    const ts = new Date(k + "T00:00:00Z").getTime();
    if (prevTs !== null && ts - prevTs === DAY_MS) consec += 1;
    else consec = 1;
    prevTs = ts;

    let dailyReg = hours;
    let dailyOt = 0;
    let dailyDt = 0;

    // Daily double-time threshold first (always above OT).
    if (policy.dailyDtAfter !== null && dailyReg > policy.dailyDtAfter) {
      dailyDt = dailyReg - policy.dailyDtAfter;
      dailyReg = policy.dailyDtAfter;
    }
    // Daily OT threshold.
    if (policy.dailyOtAfter !== null && dailyReg > policy.dailyOtAfter) {
      dailyOt = dailyReg - policy.dailyOtAfter;
      dailyReg = policy.dailyOtAfter;
    }
    // 7th consecutive day: first 8h OT, beyond 8h DT (override the
    // regular calculation since this rule trumps daily).
    if (policy.seventhDayOt && consec >= 7) {
      dailyDt = Math.max(0, hours - 8);
      dailyOt = Math.min(hours, 8);
      dailyReg = 0;
    }

    dayResults.push({ day: k, regular: dailyReg, overtime: dailyOt, doubletime: dailyDt });
    totalRegular += dailyReg;
    totalOt += dailyOt;
    totalDt += dailyDt;
  }

  // Apply weekly OT threshold to the regular bucket only — daily OT
  // doesn't get re-promoted to DT by the weekly rule.
  if (policy.weeklyOtAfter !== null && totalRegular > policy.weeklyOtAfter) {
    const overflow = totalRegular - policy.weeklyOtAfter;
    totalOt += overflow;
    totalRegular = policy.weeklyOtAfter;
    // Reflect the reclassification in byDay so reports reconcile.
    let remaining = overflow;
    // Walk days latest → earliest; reclassify regular hours to OT.
    for (let i = dayResults.length - 1; i >= 0 && remaining > 0; i--) {
      const d = dayResults[i];
      const moveable = Math.min(d.regular, remaining);
      d.regular -= moveable;
      d.overtime += moveable;
      remaining -= moveable;
    }
  }

  return {
    regular: totalRegular,
    overtime: totalOt,
    doubletime: totalDt,
    byDay: dayResults,
  };
}

/** Convenience: fetch the org's active OT policy or return a sane default. */
export function defaultUsFlsaPolicy(): OtPolicy {
  return {
    dailyOtAfter: null,
    dailyDtAfter: null,
    weeklyOtAfter: 40,
    seventhDayOt: false,
  };
}

export function defaultCaliforniaPolicy(): OtPolicy {
  return {
    dailyOtAfter: 8,
    dailyDtAfter: 12,
    weeklyOtAfter: 40,
    seventhDayOt: true,
  };
}
