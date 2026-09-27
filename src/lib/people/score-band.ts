// The Score card's band chip (spec-teams-people /people/[id] Overview): the
// org's configured bands (Settings > Scoring & reviews) mapped onto the four
// chip tones by rank, never by the hex a band was saved with, so the chip
// stays inside the one palette: the top band is success, the bottom band
// danger, the one above it warning, everything between neutral.
//
// Pure: no imports. Client safe.

export type BandTone = "success" | "warning" | "danger" | "neutral";

export interface BandLike { label: string; min: number; max: number }

export function scoreBand(score: number, bands: readonly BandLike[]): { label: string; tone: BandTone } | null {
  if (!Number.isFinite(score) || bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const i = sorted.findIndex((b) => score >= b.min && score <= b.max);
  if (i === -1) return null;
  const n = sorted.length;
  const tone: BandTone = i === 0 ? "success" : i === n - 1 ? "danger" : i === n - 2 && n > 2 ? "warning" : "neutral";
  return { label: sorted[i].label, tone };
}
