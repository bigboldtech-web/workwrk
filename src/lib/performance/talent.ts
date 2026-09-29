// The talent grid's words and periods (spec-teams-performance /talent).
// Pure, so the rules are tested without a database.
//
// Boxes are "{performance}-{potential}", each 1 to 3 (Low, Medium, High),
// the key every existing row already carries, so nothing is migrated. The
// nine labels are FIXED (DECIDED) and the long description is always shown
// beside them, so nobody has to learn the words.

export const BOX_KEYS = ["1-1", "1-2", "1-3", "2-1", "2-2", "2-3", "3-1", "3-2", "3-3"] as const;
export type BoxKey = (typeof BOX_KEYS)[number];

export const BOX_LABELS: Record<BoxKey, string> = {
  "3-3": "Stars",
  "3-2": "High performers",
  "3-1": "Trusted professionals",
  "2-3": "Future leaders",
  "2-2": "Core players",
  "2-1": "Steady contributors",
  "1-3": "Untapped potential",
  "1-2": "Inconsistent",
  "1-1": "At risk",
};

const LEVEL = ["", "Low", "Medium", "High"] as const;

/** "High performance, high potential". */
export function boxDescription(key: string): string {
  const [perf, pot] = key.split("-").map(Number);
  if (!LEVEL[perf] || !LEVEL[pot]) return "";
  return `${LEVEL[perf]} performance, ${LEVEL[pot].toLowerCase()} potential`;
}

export function boxLabel(key: string): string {
  return BOX_LABELS[key as BoxKey] ?? key;
}

export function levelLabel(n: number | null | undefined): string {
  return n && LEVEL[n] ? LEVEL[n] : "";
}

/** Top talent (a green dot) and needs attention (a red dot): colour never travels alone, the legend names both. */
export const TOP_BOXES: readonly BoxKey[] = ["3-3", "3-2", "2-3"];
export const ATTENTION_BOXES: readonly BoxKey[] = ["1-1"];

/** The grid's rows top to bottom (potential High to Low), cells left to right (performance Low to High). */
export const GRID_ROWS: ReadonlyArray<readonly BoxKey[]> = [
  ["1-3", "2-3", "3-3"],
  ["1-2", "2-2", "3-2"],
  ["1-1", "2-1", "3-1"],
];

/** The Action picker. "PIP" is the stored word for a performance plan (existing rows carry it). */
export const TALENT_ACTIONS: Array<{ value: string; label: string }> = [
  { value: "Promote", label: "Promote" },
  { value: "Develop", label: "Develop" },
  { value: "Retain", label: "Retain" },
  { value: "Coach", label: "Coach" },
  { value: "PIP", label: "Performance plan" },
  { value: "Exit", label: "Exit" },
];
export function actionLabel(v: string | null | undefined): string {
  return TALENT_ACTIONS.find((a) => a.value === v)?.label ?? v ?? "";
}

/**
 * The bounded period list (never free text): the current fiscal year's four
 * quarters, every period a placement exists for, and the name of every
 * completed review cycle. Newest first: the current quarter, the earlier
 * quarters of this year, then everything else by when it was last used,
 * and the rest of this year's quarters last. The default is the current
 * quarter.
 */
export function talentPeriodList(input: {
  currentQuarter: string;
  yearQuarters: readonly string[];
  used: ReadonlyArray<{ period: string; lastUsed: number; count: number }>;
  cycleNames: ReadonlyArray<{ name: string; endedAt: number }>;
}): Array<{ key: string; count: number }> {
  const counts = new Map(input.used.map((u) => [u.period, u.count] as const));
  const out: string[] = [];
  const add = (k: string) => { if (k && !out.includes(k)) out.push(k); };
  const idx = input.yearQuarters.indexOf(input.currentQuarter);
  add(input.currentQuarter);
  for (let i = idx - 1; i >= 0; i -= 1) add(input.yearQuarters[i]);
  const others = [
    ...input.used.map((u) => ({ key: u.period, at: u.lastUsed })),
    ...input.cycleNames.map((c) => ({ key: c.name, at: c.endedAt })),
  ].sort((a, b) => b.at - a.at);
  for (const o of others) add(o.key);
  for (let i = idx + 1; i < input.yearQuarters.length; i += 1) add(input.yearQuarters[i]);
  return out.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}
