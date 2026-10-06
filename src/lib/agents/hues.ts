// The colour an AI teammate wears (docs/plans/ai-teammates.md 3.1): one of
// the eight user hues of design-system 1.7, emitted in this order as
// --os-status-user-1..8 by src/app/(dashboard)/tokens.css. Stored by name
// (Agent.hue, the CHECK in prisma/sql/2026-10-06-ai-teammates.sql) and drawn
// through the token, never a hex, so a theme change repaints every tile.
//
// Catalog agents predate the column and carry ten hue names of their own
// (CatalogAgent["hue"], two of them purple-family, which the design system
// removed). LEGACY_CATALOG_HUE maps each onto the nearest user hue, so an
// agent added from the catalog wears a colour without a migration.
//
// Pure: the catalog is a constant with no imports.

import { AGENTS_BY_SLUG, type CatalogAgent } from "./catalog";

export const TEAMMATE_HUES = ["sky", "teal", "moss", "sand", "clay", "rose", "slate", "stone"] as const;

export type TeammateHue = (typeof TEAMMATE_HUES)[number];

export type HueIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const HUE_SET: ReadonlySet<string> = new Set(TEAMMATE_HUES);

export function isTeammateHue(v: unknown): v is TeammateHue {
  return typeof v === "string" && HUE_SET.has(v);
}

/** The hue's place in the token ramp: sky is --os-status-user-1, stone is 8. */
export function hueIndex(hue: TeammateHue): HueIndex {
  return (TEAMMATE_HUES.indexOf(hue) + 1) as HueIndex;
}

/** The tile fill, for EntityTile's `color`. */
export function hueColor(hue: TeammateHue): string {
  return `var(--os-status-user-${hueIndex(hue)})`;
}

export const LEGACY_CATALOG_HUE: Record<CatalogAgent["hue"], TeammateHue> = {
  blue: "sky",
  green: "moss",
  amber: "sand",
  violet: "sky",
  pink: "rose",
  teal: "teal",
  sky: "sky",
  rose: "rose",
  lime: "moss",
  slate: "slate",
};

/**
 * The hue an agent shows: its own, else its catalog entry's (an agent added
 * from the catalog keeps the catalog slug), else null for the neutral tile.
 */
export function hueForAgent(a: { hue: string | null | undefined; slug: string }): TeammateHue | null {
  if (isTeammateHue(a.hue)) return a.hue;
  // An own-property read: a custom agent named "Constructor" has the slug
  // "constructor", which a plain index would find on Object.prototype.
  const catalog = Object.prototype.hasOwnProperty.call(AGENTS_BY_SLUG, a.slug) ? AGENTS_BY_SLUG[a.slug] : undefined;
  return catalog ? (LEGACY_CATALOG_HUE[catalog.hue] ?? null) : null;
}
