// complianceTone (spec-goals section 3): the ONE colour rule for a
// compliance or read-rate percentage on the manager surfaces (Alignment,
// Sub-teams, KPI reviews, the Teams overview). It replaces three copies
// that disagreed: complianceTone on the Alignment board (80 / 50), tone on
// the rollup page and pctColor in components/team/ui.tsx (90 / 70 / 50).
//
//   80 and up   success   "On track"
//   50 to 79    warning   "Needs attention"
//   below 50    danger    "Off track"
//   null        neutral   "Not measured"
//
// The word always travels with the colour (never colour alone). Pure.

export type ComplianceTone = "success" | "warning" | "danger" | "neutral";

export function complianceTone(pct: number | null | undefined): ComplianceTone {
  if (pct == null || !Number.isFinite(pct)) return "neutral";
  if (pct >= 80) return "success";
  if (pct >= 50) return "warning";
  return "danger";
}

export function complianceWord(pct: number | null | undefined): string {
  const t = complianceTone(pct);
  return t === "success" ? "On track" : t === "warning" ? "Needs attention" : t === "danger" ? "Off track" : "Not measured";
}

/** The Tailwind text class for a tone (semantic tokens only). */
export function complianceTextClass(pct: number | null | undefined): string {
  const t = complianceTone(pct);
  return t === "success" ? "text-success-text" : t === "warning" ? "text-warning-text" : t === "danger" ? "text-danger-text" : "text-ink-2";
}

/** Filter bands used by the Alignment and Sub-teams panels. */
export type ComplianceBand = "low" | "mid" | "high" | "none";
export function complianceBand(pct: number | null | undefined): ComplianceBand {
  const t = complianceTone(pct);
  return t === "danger" ? "low" : t === "warning" ? "mid" : t === "success" ? "high" : "none";
}
