// Organization.settings, written one top-level key at a time.
//
// Organization.settings is ONE JSON column that eleven writers share (the
// settings page, process defaults, permissions, contract folders, policy
// categories, branding, setup, delete and restore, the admin console, the
// enterprise features and doc sharing). Each of them used to read the whole
// blob, change its own key and write the whole blob back, so two writers
// saving at the same moment silently erased each other: a branding save could
// drop a doc's sharing entry that had been written a millisecond before it.
//
// writeOrgSettingsKeys runs ONE UPDATE that replaces exactly the named
// top-level keys and removes the keys given as null, leaving every other key
// as the database holds it at that instant. A writer still merges INSIDE its
// own key (it reads that key, changes it and hands it back), which is safe
// because no two writers own the same key; doc sharing, the one key many
// requests write at once, goes further and locks the row and writes a single
// entry (src/lib/access/access-grant-store.ts).
//
// Server-only: prisma.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Set the named top-level keys of Organization.settings to these values (a
 * null value removes the key). One statement; nothing else in the column is
 * read or written. Returns false when no organization has this id.
 */
export async function writeOrgSettingsKeys(organizationId: string, patch: Record<string, unknown>, db: Db = prisma): Promise<boolean> {
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) remove.push(key);
    else set[key] = value;
  }
  if (remove.length === 0 && Object.keys(set).length === 0) return true;
  const json = JSON.stringify(set);
  // A bound Date, never NOW(), for the zone reason doc-lock.ts records.
  const now = new Date();
  const count = await db.$executeRaw`
    UPDATE "Organization"
    SET "settings" = ((CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END) - ${remove}::text[]) || ${json}::jsonb,
        "updatedAt" = ${now}
    WHERE "id" = ${organizationId}`;
  return count > 0;
}

/**
 * Merge `patch` INTO one top-level section of Organization.settings (for
 * example `data`), in one statement, so two saves of different keys of the
 * same section at the same moment (two switches on Settings > Data) can
 * never lose each other's change. A section that is absent or not an object
 * starts as {}. Every other key of the settings, and every other key of the
 * section, is kept.
 */
export async function mergeOrgSettingsSection(
  organizationId: string,
  section: string,
  patch: Record<string, unknown>,
  db: Db = prisma,
): Promise<boolean> {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) set[key] = value;
  if (Object.keys(set).length === 0) return true;
  const json = JSON.stringify(set);
  // A bound Date, never NOW(), for the zone reason doc-lock.ts records.
  const now = new Date();
  const count = await db.$executeRaw`
    UPDATE "Organization"
    SET "settings" = jsonb_set(
          CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END,
          ARRAY[${section}]::text[],
          (CASE WHEN jsonb_typeof("settings" -> ${section}) = 'object' THEN "settings" -> ${section} ELSE '{}'::jsonb END) || ${json}::jsonb,
          true
        ),
        "updatedAt" = ${now}
    WHERE "id" = ${organizationId}`;
  return count > 0;
}

/** One key of Organization.settings as an object ({} when absent or not an object). */
export function settingsKey(settings: unknown, key: string): Record<string, unknown> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  const v = (settings as Record<string, unknown>)[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
