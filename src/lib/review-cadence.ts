// Review cadence — single source of truth for the four review rhythms
// (weekly check-in, monthly pulse, quarterly review, annual appraisal),
// their org-level configuration, and the period-key math that buckets a
// date into the right cadence window.
//
// This module is intentionally prisma-free so both the client Settings
// editor and the server-side cron / review pages can import it. The
// org config lives on `Organization.settings` JSON (see /api/settings):
//   settings.reviewCadences   → ReviewCadenceConfig
//   settings.scoreWeights      → Record<MetricKey, number> (sum 100)
//   settings.scoringBands      → ScoringBand[]
//   settings.behavioralAnchors → string[] (5-point Likert labels)

// NOTE: keep this module dependency-free (no prisma, no server-only
// imports) so the client Settings editor can import its types/defaults.
// The week math is duplicated from weekly-review.ts on purpose — that
// file imports prisma and must not leak into a client bundle.

/** Monday 00:00 UTC of the ISO week the date falls in (Sun = prev week). */
export function weekStartFor(date: Date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

export type CadenceKey = "weekly" | "monthly" | "quarterly" | "annual";

/** One cadence's org configuration. */
export interface CadenceSetting {
  enabled: boolean;
  /** Auto-open the cycle when its anchor lands (cron). */
  autoOpen: boolean;
  /**
   * When the cycle anchors within its period:
   *   weekly    → ISO weekday 1..7 (1=Mon) the check-in is "due"
   *   monthly   → day-of-month 1..28 the pulse opens
   *   quarterly → day-of-quarter offset (1 = first day of the quarter)
   *   annual    → month-of-year 1..12 the appraisal opens
   */
  anchor: number;
  /** Days before the period closes to start nudging people. */
  reminderLeadDays: number;
}

export type ReviewCadenceConfig = Record<CadenceKey, CadenceSetting>;

export const CADENCE_LABELS: Record<CadenceKey, string> = {
  weekly: "Weekly check-in",
  monthly: "Monthly pulse",
  quarterly: "Quarterly review",
  annual: "Annual appraisal",
};

/** Maps a cadence to the ReviewType enum value used for ReviewCycle rows. */
export const CADENCE_REVIEW_TYPE: Record<Exclude<CadenceKey, "weekly">, "MONTHLY_PULSE" | "QUARTERLY" | "ANNUAL"> = {
  monthly: "MONTHLY_PULSE",
  quarterly: "QUARTERLY",
  annual: "ANNUAL",
};

export const DEFAULT_CADENCES: ReviewCadenceConfig = {
  weekly: { enabled: true, autoOpen: true, anchor: 5, reminderLeadDays: 1 },
  monthly: { enabled: true, autoOpen: true, anchor: 1, reminderLeadDays: 3 },
  quarterly: { enabled: true, autoOpen: true, anchor: 1, reminderLeadDays: 7 },
  annual: { enabled: false, autoOpen: false, anchor: 1, reminderLeadDays: 14 },
};

/** Behavioral Likert anchors used in the manager review. Order = 1..5. */
export const DEFAULT_BEHAVIORAL_ANCHORS: string[] = [
  "Needs significant improvement",
  "Below expectations",
  "Meets expectations",
  "Exceeds expectations",
  "Role model",
];

export type MetricKey = "kpi" | "sopCompliance" | "behavioral" | "peer";

export const METRIC_LABELS: Record<MetricKey, string> = {
  kpi: "KPI attainment",
  sopCompliance: "SOP compliance",
  behavioral: "Behavioral rating",
  peer: "Peer feedback",
};

export const DEFAULT_SCORE_WEIGHTS: Record<MetricKey, number> = {
  kpi: 40,
  sopCompliance: 20,
  behavioral: 30,
  peer: 10,
};

export interface ScoringBand {
  label: string;
  min: number;
  max: number;
  color: string;
}

export const DEFAULT_SCORING_BANDS: ScoringBand[] = [
  { label: "Exceptional", min: 90, max: 100, color: "#22c55e" },
  { label: "Strong", min: 75, max: 89, color: "#14b8a6" },
  { label: "On track", min: 60, max: 74, color: "#f59e0b" },
  { label: "Needs focus", min: 40, max: 59, color: "#f97316" },
  { label: "At risk", min: 0, max: 39, color: "#ef4444" },
];

/* ───────────────────────── reading org config ───────────────────────── */

type OrgSettings = Record<string, unknown> | null | undefined;

/** Merge stored cadence config over the defaults so missing keys are filled. */
export function getReviewCadences(settings: OrgSettings): ReviewCadenceConfig {
  const stored = (settings?.["reviewCadences"] ?? {}) as Partial<Record<CadenceKey, Partial<CadenceSetting>>>;
  const out = {} as ReviewCadenceConfig;
  (Object.keys(DEFAULT_CADENCES) as CadenceKey[]).forEach((k) => {
    out[k] = { ...DEFAULT_CADENCES[k], ...(stored[k] ?? {}) };
  });
  return out;
}

export function getScoreWeights(settings: OrgSettings): Record<MetricKey, number> {
  const stored = (settings?.["scoreWeights"] ?? {}) as Partial<Record<MetricKey, number>>;
  return { ...DEFAULT_SCORE_WEIGHTS, ...stored };
}

export function getScoringBands(settings: OrgSettings): ScoringBand[] {
  const stored = settings?.["scoringBands"];
  return Array.isArray(stored) && stored.length ? (stored as ScoringBand[]) : DEFAULT_SCORING_BANDS;
}

export function getBehavioralAnchors(settings: OrgSettings): string[] {
  const stored = settings?.["behavioralAnchors"];
  return Array.isArray(stored) && stored.length === 5 ? (stored as string[]) : DEFAULT_BEHAVIORAL_ANCHORS;
}

/** Map a 0..100 score onto its configured band (or null if no band matches). */
export function bandFor(score: number, bands: ScoringBand[]): ScoringBand | null {
  return bands.find((b) => score >= b.min && score <= b.max) ?? null;
}

/* ───────────────────────── period keys ───────────────────────── */

/** "2026-W24" for the ISO week the date falls in. */
export function weekKeyFor(date: Date = new Date()): string {
  const start = weekStartFor(date);
  // ISO week number: Thursday of the week determines the year+week.
  const thursday = new Date(start);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstStart = weekStartFor(firstThursday);
  const week = 1 + Math.round((start.getTime() - firstStart.getTime()) / (7 * 24 * 3600 * 1000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** "2026-06" for the calendar month. */
export function monthKeyFor(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-Q2" for the calendar quarter. */
export function quarterKeyFor(date: Date = new Date()): string {
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${q}`;
}

/** "2026" for the calendar year. */
export function yearKeyFor(date: Date = new Date()): string {
  return String(date.getUTCFullYear());
}

/** The current period key for a cadence — what a record/cycle is bucketed under. */
export function currentPeriodKey(cadence: CadenceKey, date: Date = new Date()): string {
  switch (cadence) {
    case "weekly": return weekKeyFor(date);
    case "monthly": return monthKeyFor(date);
    case "quarterly": return quarterKeyFor(date);
    case "annual": return yearKeyFor(date);
  }
}

/* ───────────────────────── validation (settings API) ───────────────────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/** Weights must be non-negative and sum to 100 (±1 for rounding). */
export function validateScoreWeights(weights: unknown): ValidationResult {
  if (typeof weights !== "object" || weights === null) return { ok: false, error: "scoreWeights must be an object" };
  const vals = Object.values(weights as Record<string, unknown>);
  if (!vals.length) return { ok: false, error: "scoreWeights cannot be empty" };
  let sum = 0;
  for (const v of vals) {
    if (typeof v !== "number" || v < 0) return { ok: false, error: "weights must be non-negative numbers" };
    sum += v;
  }
  if (Math.abs(sum - 100) > 1) return { ok: false, error: `weights must sum to 100 (got ${sum})` };
  return { ok: true };
}

/** Bands must cover 0..100 without overlap; each min<=max. */
export function validateScoringBands(bands: unknown): ValidationResult {
  if (!Array.isArray(bands) || !bands.length) return { ok: false, error: "scoringBands must be a non-empty array" };
  const sorted = [...bands].sort((a, b) => (a as ScoringBand).min - (b as ScoringBand).min);
  for (const b of sorted as ScoringBand[]) {
    if (typeof b.min !== "number" || typeof b.max !== "number" || b.min > b.max) {
      return { ok: false, error: "each band needs min<=max numbers" };
    }
    if (b.min < 0 || b.max > 100) return { ok: false, error: "bands must stay within 0..100" };
  }
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] as ScoringBand).min <= (sorted[i - 1] as ScoringBand).max) {
      return { ok: false, error: "band ranges overlap" };
    }
  }
  return { ok: true };
}
