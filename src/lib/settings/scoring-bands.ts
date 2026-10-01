// The Performance bands row check (settings spec `/settings/scoring`): an
// error on the offending row, never a toast. Pure; tested.
import { validateScoringBands, type ScoringBand } from "@/lib/review-cadence";

export function bandError(bands: ScoringBand[]): { row: number; message: string } | null {
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (!b.label.trim()) return { row: i, message: "Give the band a name" };
    if (!(b.min >= 0 && b.max <= 100 && b.min <= b.max)) return { row: i, message: "Use 0 to 100, low to high" };
    for (let j = 0; j < i; j++) {
      const o = bands[j];
      if (b.min <= o.max && o.min <= b.max) return { row: i, message: `Overlaps ${o.label || "another band"}` };
    }
  }
  return validateScoringBands(bands).ok ? null : { row: 0, message: "Bands must not overlap" };
}
