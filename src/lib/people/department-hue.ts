// Department.color, from three incompatible encodings to the eight-hue index
// (design-system 1.7; spec-teams-people section 4 "Data migrations").
//
// What is stored today, found by the Phase 6 reconnaissance:
//   - legacy hex from the seed and the setup wizard (#6C5CE7 purple,
//     #00D68F, #FF9F43, #FF6B6B, #A29BFE, #54A0FF, #0073EA, #E056A0 pink,
//     #00BCD4, #8BC34A, #795548, #607D8B)
//   - CSS-var strings from the current Department dialog
//     ("var(--os-c-blue)", "var(--os-brand)", ...)
//   - null (SCIM groups, register, organization create)
//
// The picker is to store the INDEX (1 to 8), never a hex. This file is the
// one mapping, pure and tested; scripts/report-department-colors.ts prints
// what it WOULD write (report only in Phase 6), and every reader can accept
// all three encodings during the rollout through `departmentHue`.
//
// Pure: no imports.

export interface UserHue {
  index: number;
  name: "Sky" | "Teal" | "Moss" | "Sand" | "Clay" | "Rose" | "Slate" | "Stone";
  /** Light hue (text and dot). */
  hex: string;
}

export const USER_HUES: readonly UserHue[] = [
  { index: 1, name: "Sky", hex: "#0B5FC2" },
  { index: 2, name: "Teal", hex: "#0F766E" },
  { index: 3, name: "Moss", hex: "#3F6212" },
  { index: 4, name: "Sand", hex: "#854D0E" },
  { index: 5, name: "Clay", hex: "#9A3412" },
  { index: 6, name: "Rose", hex: "#9F1239" },
  { index: 7, name: "Slate", hex: "#475569" },
  { index: 8, name: "Stone", hex: "#57534E" },
];

/** The `--os-c-*` / brand names the dialog wrote, and their hue (1.7 migration row). */
const VAR_TO_INDEX: Record<string, number> = {
  "os-brand": 1,
  "os-c-blue": 1,
  "os-c-indigo": 1,
  "os-c-purple": 1,
  "os-c-teal": 2,
  "os-c-green": 3,
  "os-c-lime": 3,
  "os-c-yellow": 4,
  "os-c-brown": 4,
  "os-c-orange": 5,
  "os-c-red": 6,
  "os-c-pink": 6,
  "os-c-gray": 7,
  "os-c-grey": 7,
};

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let v = m[1];
  if (v.length === 3) v = v.split("").map((c) => c + c).join("");
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

/**
 * The nearest of the eight by hue. Low-saturation colours are greys: Slate
 * when cool, Stone when warm. Purple and pink, which the eight exclude on
 * purpose, land on Sky and Rose exactly as the 1.7 migration row says.
 */
export function nearestUserHue(hex: string): number | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  const { h, s } = hsl;
  if (s < 0.25) return h >= 20 && h <= 70 ? 8 : 7;
  if (h >= 315 || h < 10) return 6; // pink and red: Rose
  if (h < 22) return 5; // red-orange and brick: Clay
  if (h < 75) return 4; // orange, amber, ochre: Sand
  if (h < 165) return 3; // yellow-green and green: Moss
  if (h < 200) return 2; // cyan and teal: Teal
  if (h < 315) return 1; // blue, indigo and purple: Sky
  return 7;
}

export type StoredColorKind = "empty" | "index" | "css-var" | "hex" | "unknown";

/** Classify a stored Department.color and give the index it maps to. */
export function departmentHue(value: string | null | undefined): { kind: StoredColorKind; index: number | null } {
  if (value === null || value === undefined || value.trim() === "") return { kind: "empty", index: null };
  const v = value.trim();
  if (/^[1-8]$/.test(v)) return { kind: "index", index: Number(v) };
  const cssVar = /^var\(--([a-z0-9-]+)\)$/i.exec(v);
  if (cssVar) {
    const idx = VAR_TO_INDEX[cssVar[1].toLowerCase()];
    return { kind: "css-var", index: idx ?? null };
  }
  const idx = nearestUserHue(v);
  return idx ? { kind: "hex", index: idx } : { kind: "unknown", index: null };
}
