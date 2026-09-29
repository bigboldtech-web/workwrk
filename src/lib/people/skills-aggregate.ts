// The Skills page's numbers (spec-teams-people /people/skills), computed so
// that ratings are people data: holder COUNTS are over everyone, but every
// average, the Gap and Expert chips and the holder ratings are computed only
// over the people the viewer may read (self, chain, People team, Admin).
// The old route divided the manager sum by ALL holders, so the average read
// low; here each average divides by the rows that carry that rating.
//
// Ratings are 1 to 5. A legacy row rated on a 10 scale (the profile once
// printed "/10") is shown on its own scale, never rewritten.
//
// Pure: no imports. Client safe.

export interface SkillRow {
  id: string;
  name: string;
  userId: string;
  selfRating: number;
  managerRating: number | null;
}

export interface SkillHolder {
  userId: string;
  skillId: string;
  /** null when the viewer may not read this person's ratings. */
  selfRating: number | null;
  managerRating: number | null;
}

export interface SkillSummary {
  name: string;
  /** Everyone who holds it. */
  holders: number;
  /** Holders whose ratings the viewer may read. */
  visibleRated: number;
  avgSelf: number | null;
  avgManager: number | null;
  gap: boolean;
  expert: boolean;
  /** Every holder; ratings blank where not visible. Rated first. */
  people: SkillHolder[];
}

export const EXPERT_AT = 4;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Group by name, case-insensitively, keeping the most common spelling. */
function canonicalKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function summariseSkills(rows: readonly SkillRow[], canRead: (userId: string) => boolean): SkillSummary[] {
  const groups = new Map<string, { spellings: Map<string, number>; rows: SkillRow[] }>();
  const fresh = (): { spellings: Map<string, number>; rows: SkillRow[] } => ({ spellings: new Map(), rows: [] });
  for (const r of rows) {
    const key = canonicalKey(r.name);
    if (!key) continue;
    const g = groups.get(key) ?? fresh();
    g.spellings.set(r.name.trim(), (g.spellings.get(r.name.trim()) ?? 0) + 1);
    g.rows.push(r);
    groups.set(key, g);
  }
  const out: SkillSummary[] = [];
  for (const g of groups.values()) {
    const name = [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const holderIds = new Set(g.rows.map((r) => r.userId));
    const visible = g.rows.filter((r) => canRead(r.userId));
    const selfRated = visible.filter((r) => r.selfRating > 0);
    const mgrRated = visible.filter((r) => r.managerRating != null && r.managerRating > 0);
    const avgSelf = selfRated.length ? round1(selfRated.reduce((s, r) => s + r.selfRating, 0) / selfRated.length) : null;
    const avgManager = mgrRated.length ? round1(mgrRated.reduce((s, r) => s + (r.managerRating ?? 0), 0) / mgrRated.length) : null;
    const best = (r: SkillRow) => r.managerRating ?? r.selfRating;
    const expert = visible.some((r) => best(r) >= EXPERT_AT);
    // A gap is a skill the visible people rate low: the manager average under
    // 3, or nobody visible at 4 or more. Expert wins a tie, so a skill never
    // carries both chips (with nobody at 4 or more, the second half holds).
    const gap = !expert && visible.length > 0;
    const people: SkillHolder[] = g.rows
      .map((r) => {
        const seen = canRead(r.userId);
        return {
          userId: r.userId,
          skillId: r.id,
          selfRating: seen && r.selfRating > 0 ? r.selfRating : null,
          managerRating: seen ? r.managerRating : null,
        };
      })
      .sort((a, b) => (b.managerRating ?? b.selfRating ?? -1) - (a.managerRating ?? a.selfRating ?? -1));
    out.push({ name, holders: holderIds.size, visibleRated: visible.length, avgSelf, avgManager, gap, expert, people });
  }
  return out.sort((a, b) => b.holders - a.holders || a.name.localeCompare(b.name));
}

/** "4/5", or "7/10" for a legacy row stored on the old scale. */
export function ratingLabel(value: number | null | undefined): string | null {
  if (value == null || value <= 0) return null;
  return value > 5 ? `${value}/10` : `${value}/5`;
}

/** A skill name as stored: trimmed, single-spaced, 1 to 60 characters. */
export function cleanSkillName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, " ");
  if (!v || v.length > 60) return null;
  return v;
}

export function isRating(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}
