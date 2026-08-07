// Per-doc sharing + roles — migration-free.
//
// All sharing state lives in Organization.settings (Json) under
// `settings.docSharing[docId]`, mirroring the settings.permissions
// precedent (src/app/api/permissions/route.ts). Doc.content is
// deliberately NOT used: it is client-owned (the editor PUTs the whole
// object on every autosave) and snapshotted into DocVersion, so any
// server-injected key there would be clobbered by the next keystroke
// and duplicated into version history.
//
// Role semantics (resolveDocRole) — default behavior provably unchanged:
//   - creator / admin (COMPANY_ADMIN, SUPER_ADMIN): always "edit"
//   - no entry, or entry with neither `restricted` nor listed members:
//     "edit" (every pre-feature doc keeps org-wide access)
//   - listed in members: that member's role
//   - restricted + unlisted: null (callers respond 404, matching the
//     404-not-403 convention in src/lib/doc-access.ts)
//   - unrestricted + unlisted: "edit" (org default preserved)
//
// ENFORCEMENT NOTE: every /api/docs/[id]/* subroute must call
// requireDocRole() after its docAccessible() check — a restricted doc
// must be invisible through every side door (versions, comments,
// duplicate, export, summarize, ask, extract-table, restore). Any
// FUTURE doc subroute must do the same.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export type DocRole = "edit" | "view";

export interface DocSharingEntry {
  restricted?: boolean;
  members?: Record<string, DocRole>;
  publicSecret?: string;
  publicCreatedAt?: string;
}

const ADMIN_LEVELS = ["COMPANY_ADMIN", "SUPER_ADMIN"];

/** Read settings.docSharing with a typeof-object guard (mirrors the
 *  settings.permissions read in src/lib/api-helpers.ts). */
export function getDocSharingMap(settings: unknown): Record<string, DocSharingEntry> {
  const s = settings && typeof settings === "object" ? (settings as { docSharing?: unknown }) : null;
  const map = s?.docSharing;
  if (map && typeof map === "object" && !Array.isArray(map)) {
    return map as Record<string, DocSharingEntry>;
  }
  return {};
}

export function resolveDocRole(
  entry: DocSharingEntry | undefined,
  viewer: { userId: string; accessLevel: string | null | undefined; createdById: string | null },
): DocRole | null {
  // Creator + org admins always keep full edit — the owner can never
  // lock themselves (or the admins) out.
  if (viewer.createdById && viewer.userId === viewer.createdById) return "edit";
  if (ADMIN_LEVELS.includes(viewer.accessLevel ?? "")) return "edit";
  if (!entry) return "edit";

  const listed = entry.members?.[viewer.userId];
  if (listed === "edit" || listed === "view") return listed;
  if (entry.restricted) return null;
  return "edit";
}

/** Bundled org-settings fetch + role resolution, so every doc subroute
 *  gates with one mechanical call after its docAccessible() check. */
export async function requireDocRole(
  viewer: { orgId: string; userId: string; accessLevel: string | null | undefined },
  doc: { id: string; createdById: string | null },
): Promise<DocRole | null> {
  const org = await prisma.organization.findUnique({
    where: { id: viewer.orgId },
    select: { settings: true },
  });
  const entry = getDocSharingMap(org?.settings)[doc.id];
  return resolveDocRole(entry, {
    userId: viewer.userId,
    accessLevel: viewer.accessLevel,
    createdById: doc.createdById,
  });
}

/** Timing-safe secret comparison (sha256 both sides first so lengths
 *  always match — precedent: src/lib/api-auth.ts hashKey). */
export function publicSecretMatches(stored: string | undefined, supplied: string): boolean {
  if (!stored || !supplied) return false;
  const a = createHash("sha256").update(stored).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

/** Public-link secret — entropy precedent: src/lib/api-auth.ts:33. */
export function newPublicSecret(): string {
  return randomBytes(24).toString("base64url");
}
