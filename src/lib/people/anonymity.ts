// The anonymity rules shared by candor results, anonymous survey results and
// peer feedback (DECIDED: four answers is the anonymity floor). Pure.

/** Fewer answers than this and only the count is ever shown. */
export const ANONYMITY_FLOOR = 4;

export function meetsAnonymityFloor(count: number): boolean {
  return count >= ANONYMITY_FLOOR;
}

/** A copy in random order (Fisher-Yates), so an answer's position says nothing. */
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The aggregate a review subject sees of their peer feedback: the mean of
 * the submitted ratings once the floor is met, and only the count before.
 */
export function peerAggregate(rows: ReadonlyArray<{ status: string; rating: number | null; collaborationRating: number | null }>): {
  submitted: number;
  requested: number;
  averageRating: number | null;
  averageCollaboration: number | null;
  belowFloor: boolean;
} {
  const done = rows.filter((r) => r.status === "SUBMITTED");
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const belowFloor = !meetsAnonymityFloor(done.length);
  return {
    submitted: done.length,
    requested: rows.length,
    averageRating: belowFloor ? null : mean(done.map((r) => r.rating).filter((n): n is number => typeof n === "number")),
    averageCollaboration: belowFloor ? null : mean(done.map((r) => r.collaborationRating).filter((n): n is number => typeof n === "number")),
    belowFloor,
  };
}
