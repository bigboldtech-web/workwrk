// Review cycles: the words, the transitions and the scoring rules every
// review surface shares (spec-teams-performance /reviews and /reviews/[id]).
// Pure: no prisma, no React, so each rule has a test.
//
// Transitions, each by its worst case:
//   Draft -> Active            Launch only (POST /launch creates the reviews)
//   Active -> In calibration   Start calibration (a confirm)
//   In calibration -> Completed  Finalize only: never set by hand, and only
//                              once every review is completed, so a cycle
//                              never reads "Completed" over people whose
//                              review was skipped
//   Draft / Active -> Cancelled  Cancel cycle (nothing is deleted)
//   anything else              refused (a Completed cycle never reopens and
//                              a Cancelled one stays cancelled)
//
// Who may write what, and when:
//   the subject      their own review while the cycle is Active and they
//                    have not submitted; after submit it is read only (the
//                    old route put a submitted review back to "not started"
//                    on the next autosave)
//   the reviewer     while the cycle is Active; once calibration starts a
//                    submitted manager review is frozen, and one never
//                    submitted can still be submitted (so a slow manager is
//                    never locked out of a review that has none)

export type CycleStatus = "DRAFT" | "ACTIVE" | "IN_CALIBRATION" | "COMPLETED" | "CANCELLED";
export type ReviewStatus = "PENDING" | "SELF_ASSESSMENT" | "MANAGER_REVIEW" | "CALIBRATION" | "COMPLETED";
export type Tone = "neutral" | "info" | "warning" | "success" | "danger";

export const CYCLE_STATUS: Record<CycleStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "info" },
  IN_CALIBRATION: { label: "In calibration", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function cycleStatusOf(s: string): { label: string; tone: Tone } {
  return CYCLE_STATUS[s as CycleStatus] ?? { label: s, tone: "neutral" };
}

/** One person's review, in the naming canon. */
export function reviewStatusOf(r: { status: string; calibratedScore?: number | null }): { label: string; tone: Tone } {
  switch (r.status) {
    case "COMPLETED":
      return { label: "Completed", tone: "success" };
    case "CALIBRATION":
      return { label: "Calibrated", tone: "warning" };
    case "MANAGER_REVIEW":
      return r.calibratedScore != null ? { label: "Calibrated", tone: "warning" } : { label: "Manager review done", tone: "info" };
    case "SELF_ASSESSMENT":
      return { label: "Self review done", tone: "info" };
    default:
      return { label: "Not started", tone: "neutral" };
  }
}

export const CYCLE_TYPES: Array<{ value: string; label: string }> = [
  { value: "MONTHLY_PULSE", label: "Monthly pulse" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "ANNUAL", label: "Annual appraisal" },
  { value: "PROBATION", label: "Probation" },
  { value: "PIP_REVIEW", label: "Performance plan" },
];
export function cycleTypeLabel(t: string): string {
  return CYCLE_TYPES.find((x) => x.value === t)?.label ?? t;
}

export const OUTCOMES: Array<{ value: string; label: string }> = [
  { value: "PROMOTION_ELIGIBLE", label: "Promotion eligible" },
  { value: "HIKE_ELIGIBLE", label: "Hike eligible" },
  { value: "STATUS_QUO", label: "Status quo" },
  { value: "PIP_REQUIRED", label: "Performance plan" },
  { value: "EXIT_RECOMMENDATION", label: "Exit recommendation" },
];
const OUTCOME_SET = new Set(OUTCOMES.map((o) => o.value));
export function isOutcome(v: unknown): v is string {
  return typeof v === "string" && OUTCOME_SET.has(v);
}
export function outcomeLabel(v: string | null | undefined): string {
  return OUTCOMES.find((o) => o.value === v)?.label ?? "";
}

export const POTENTIALS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Low" },
  { value: 2, label: "Medium" },
  { value: 3, label: "High" },
];

/** The four steps a cycle walks, for the step dots. */
export type CycleStep = "self" | "manager" | "calibrate" | "done";
export const CYCLE_STEPS: Array<{ key: CycleStep; label: string }> = [
  { key: "self", label: "Self" },
  { key: "manager", label: "Manager" },
  { key: "calibrate", label: "Calibrate" },
  { key: "done", label: "Done" },
];

/**
 * How many of the four steps a cycle has passed (0 to 4). Draft has passed
 * none; Active has passed Self once every self review is in; In
 * calibration has passed Self and Manager; Completed all four.
 */
export function stepsPassed(status: string, stats?: { total: number; selfDone: number; managerDone: number } | null): number {
  if (status === "COMPLETED") return 4;
  if (status === "IN_CALIBRATION") return 2;
  if (status === "ACTIVE") {
    if (!stats || stats.total === 0) return 0;
    if (stats.managerDone >= stats.total) return 2;
    return stats.selfDone >= stats.total ? 1 : 0;
  }
  return 0;
}

/** Null when the cycle may move from `from` to `to` by a status write; else why not. */
export function cycleTransitionBlocked(from: string, to: string): string | null {
  if (from === to) return null;
  if (to === "COMPLETED") return "A cycle is completed by finalizing its outcomes";
  if (to === "ACTIVE") return from === "DRAFT" ? "Launch the cycle to open it" : "A cycle cannot go back to active";
  if (to === "DRAFT") return "A cycle cannot go back to draft";
  if (to === "IN_CALIBRATION") return from === "ACTIVE" ? null : "Only an active cycle can start calibration";
  if (to === "CANCELLED") return from === "DRAFT" || from === "ACTIVE" ? null : "Only a draft or active cycle can be cancelled";
  return "Unknown status";
}

export function subjectMayWrite(cycleStatus: string, reviewStatus: string): boolean {
  return cycleStatus === "ACTIVE" && reviewStatus === "PENDING";
}

export function managerMayWrite(cycleStatus: string, reviewStatus: string): boolean {
  if (reviewStatus === "COMPLETED" || reviewStatus === "CALIBRATION") return false;
  if (cycleStatus === "ACTIVE") return true;
  // Calibration started: a review never submitted can still be submitted.
  return cycleStatus === "IN_CALIBRATION" && (reviewStatus === "PENDING" || reviewStatus === "SELF_ASSESSMENT");
}

// ── Scale words ─────────────────────────────────────────────────────

/** The five words under a 1 to 5 scale when Settings has none (the spec's fallback). */
export const BUILT_IN_SCALE_WORDS = ["Below", "Developing", "Meets", "Exceeds", "Outstanding"] as const;

/**
 * The words a rating scale shows: Settings > Scoring and reviews >
 * Behavioural anchors when the org has set exactly five non-empty words,
 * otherwise the five built-in words.
 */
export function scaleWords(stored: unknown): { words: string[]; fromSettings: boolean } {
  if (Array.isArray(stored) && stored.length === 5 && stored.every((w) => typeof w === "string" && w.trim())) {
    return { words: (stored as string[]).map((w) => w.trim()), fromSettings: true };
  }
  return { words: [...BUILT_IN_SCALE_WORDS], fromSettings: false };
}

/** The five behaviours the manager rates; their keys are what the API averages. */
export const BEHAVIOURS: Array<{ key: "quality" | "reliability" | "collaboration" | "initiative" | "growth"; label: string }> = [
  { key: "quality", label: "Quality" },
  { key: "reliability", label: "Reliability" },
  { key: "collaboration", label: "Collaboration" },
  { key: "initiative", label: "Initiative" },
  { key: "growth", label: "Growth" },
];

// ── Validation of what a form sends ─────────────────────────────────

function rating(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
}
function text(v: unknown, max = 10_000): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** A self review body, cleaned: ratings 1 to 5 or dropped, text capped. */
export function cleanSelfRatings(input: unknown): { kraRatings: Array<{ kraId: string; kraName: string; rating: number | null; achievements: string }>; reflection: { wentWell: string; couldImprove: string; goals: string } } {
  const b = (input && typeof input === "object" ? input : {}) as { kraRatings?: unknown; reflection?: unknown };
  const rows = Array.isArray(b.kraRatings) ? b.kraRatings : [];
  const r = (b.reflection && typeof b.reflection === "object" ? b.reflection : {}) as Record<string, unknown>;
  return {
    kraRatings: rows
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as { kraId?: unknown }).kraId === "string")
      .slice(0, 100)
      .map((x) => ({ kraId: String(x.kraId), kraName: text(x.kraName, 300), rating: rating(x.rating), achievements: text(x.achievements) })),
    reflection: { wentWell: text(r.wentWell), couldImprove: text(r.couldImprove), goals: text(r.goals) },
  };
}

/** What a submitted self review is missing (every KRA rated), or null. */
export function selfReviewGap(clean: ReturnType<typeof cleanSelfRatings>, kraIds: readonly string[]): string | null {
  const rated = new Set(clean.kraRatings.filter((k) => k.rating != null).map((k) => k.kraId));
  const missing = kraIds.filter((id) => !rated.has(id));
  return missing.length ? `Rate every KRA first (${missing.length} left)` : null;
}

/** A manager assessment, cleaned the same way. */
export function cleanManagerAssessment(input: unknown): {
  kraRatings: Array<{ kraId: string; kraName: string; rating: number | null; comments: string }>;
  behavioral: Record<string, number>;
  overallComments: string;
  recommendation: string;
} {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rows = Array.isArray(b.kraRatings) ? b.kraRatings : [];
  const beh = (b.behavioral && typeof b.behavioral === "object" ? b.behavioral : {}) as Record<string, unknown>;
  const behavioral: Record<string, number> = {};
  for (const { key } of BEHAVIOURS) {
    const v = rating(beh[key]);
    if (v != null) behavioral[key] = v;
  }
  return {
    kraRatings: rows
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as { kraId?: unknown }).kraId === "string")
      .slice(0, 100)
      .map((x) => ({ kraId: String(x.kraId), kraName: text(x.kraName, 300), rating: rating(x.rating), comments: text(x.comments) })),
    behavioral,
    overallComments: text(b.overallComments),
    recommendation: isOutcome(b.recommendation) ? (b.recommendation as string) : "",
  };
}

/** The manager rating on 0 to 100: the behaviour ratings' mean, times 20. */
export function managerRatingFrom(behavioral: Record<string, number>): number | null {
  const vals = BEHAVIOURS.map((b) => behavioral[b.key]).filter((v): v is number => typeof v === "number");
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 20);
}

// ── Composite, bands and the performance axis ───────────────────────

export interface CompositeParts {
  /** 0 to 100, or null when there is no data. */
  kpi: number | null;
  sopCompliance: number | null;
  /** The manager's behaviour rating, 0 to 100. */
  behavioral: number | null;
  peer: number | null;
}

/**
 * The composite score from Settings > Scoring and reviews > Score weights.
 * A part with no data is left out and the remaining weights are scaled up,
 * so a person with no peer feedback is never marked down for it. Null when
 * no part has data.
 */
export function compositeScore(parts: CompositeParts, weights: Partial<Record<keyof CompositeParts, number>>): number | null {
  let sum = 0;
  let wsum = 0;
  for (const k of ["kpi", "sopCompliance", "behavioral", "peer"] as const) {
    const v = parts[k];
    const w = weights[k];
    if (v == null || !Number.isFinite(v) || typeof w !== "number" || !(w > 0)) continue;
    sum += Math.max(0, Math.min(120, v)) * w;
    wsum += w;
  }
  return wsum > 0 ? Math.round(sum / wsum) : null;
}

export interface Band {
  label: string;
  min: number;
  max: number;
}

/** The band a score falls in (bands may leave gaps; the nearest lower band wins). */
export function bandOf(score: number | null | undefined, bands: readonly Band[]): Band | null {
  if (score == null || !Number.isFinite(score) || !bands.length) return null;
  const s = Math.max(0, Math.min(100, score));
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => s >= b.min) ?? sorted[sorted.length - 1];
}

/**
 * Low (1), Medium (2) or High (3) on the 9-box performance axis, from the
 * org's bands: the top bands are High, the bottom bands Low, the middle
 * Medium (five bands split 2 / 1 / 2; three split 1 / 1 / 1).
 */
export function performanceLevel(score: number | null | undefined, bands: readonly Band[]): 1 | 2 | 3 | null {
  const band = bandOf(score, bands);
  if (!band) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const n = sorted.length;
  if (n === 1) return 2;
  const i = sorted.findIndex((b) => b.label === band.label && b.min === band.min);
  if (n === 2) return i === 0 ? 3 : 1;
  const edge = Math.max(1, Math.floor((n - 1) / 2));
  if (i < edge) return 3;
  if (i >= n - edge) return 1;
  return 2;
}

/** Mean of 1 to 5 ratings as 0 to 100 (null when none). */
export function ratingsTo100(ratings: ReadonlyArray<number | null | undefined>): number | null {
  const v = ratings.filter((r): r is number => typeof r === "number" && r >= 1 && r <= 5);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 20) : null;
}

// ── The New cycle modal's defaults ──────────────────────────────────

function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** The period a cycle type implies, anchored on `now` (dates stay editable). */
export function defaultCyclePeriod(type: string, now: Date): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (type === "MONTHLY_PULSE") return { start: isoDay(new Date(Date.UTC(y, m, 1))), end: isoDay(new Date(Date.UTC(y, m + 1, 0))) };
  if (type === "QUARTERLY") {
    const q0 = Math.floor(m / 3) * 3;
    return { start: isoDay(new Date(Date.UTC(y, q0, 1))), end: isoDay(new Date(Date.UTC(y, q0 + 3, 0))) };
  }
  if (type === "ANNUAL") return { start: isoDay(new Date(Date.UTC(y, 0, 1))), end: isoDay(new Date(Date.UTC(y, 11, 31))) };
  return { start: isoDay(now), end: isoDay(new Date(now.getTime() + 30 * 86_400_000)) };
}

/** A default name for a cycle type in the period that holds `now`. */
export function defaultCycleName(type: string, now: Date): string {
  const y = now.getUTCFullYear();
  if (type === "MONTHLY_PULSE") return `${now.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${y} pulse`;
  if (type === "QUARTERLY") return `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${y} review`;
  if (type === "ANNUAL") return `${y} annual appraisal`;
  if (type === "PROBATION") return "Probation review";
  return "Performance plan review";
}
