// Search (Cmd+K) in the Staff console (spec-admin-backoffice section 2.8):
// the query rules shared by GET /api/admin/search and the list endpoints, so
// a result can never show something a list would not.
//
// Three things are searchable and nothing else: a company's name, slug or
// sign-in domain; a staff member's name or email; an AppSumo code (exact or
// prefix). No customer content (tasks, documents, messages, files) is
// searchable here, and nothing in this module can ask for it.

import type { Prisma } from "@/generated/prisma";
import { planLabel, statusLabel } from "@/lib/staff-audit-helpers";

export const SEARCH_TYPES = ["companies", "staff", "codes"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** The overlay searches from the second character. */
export const SEARCH_MIN_CHARS = 2;
/** Longer than any name, slug, domain, email or code we store. */
export const SEARCH_MAX_CHARS = 100;
export const SEARCH_DEFAULT_LIMIT = 8;
const SEARCH_MAX_LIMIT = 20;

/** Trimmed, whitespace collapsed, capped; null when too short to search. */
export function normalizeSearchQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_CHARS);
  return q.length >= SEARCH_MIN_CHARS ? q : null;
}

/** `types=companies,codes`; absent or empty = all three; unknown words dropped. */
export function parseSearchTypes(raw: string | null | undefined): SearchType[] {
  if (!raw) return [...SEARCH_TYPES];
  const want = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  const out = SEARCH_TYPES.filter((t) => want.has(t));
  return out.length > 0 ? out : [...SEARCH_TYPES];
}

export function parseSearchLimit(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return SEARCH_DEFAULT_LIMIT;
  return Math.min(SEARCH_MAX_LIMIT, Math.max(1, n));
}

/**
 * A query param as a whole number clamped to [min, max]; the fallback when
 * absent or not a number. `page=abc` used to make a Prisma skip NaN (a 500)
 * and `limit=-5` was echoed back as-is.
 */
export function boundedInt(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Prisma's `contains` and `startsWith` become SQL LIKE without escaping, so
 * `%` and `_` in what a staff member typed were wildcards: "%%" matched
 * every company and "_" in a code matched any character, breaking the
 * exact-or-prefix promise. Backslash is Postgres's default LIKE escape.
 */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Companies by name, slug or sign-in domain, case-insensitive substring.
 * The one definition: GET /api/admin/companies?search= uses it too.
 */
export function companySearchWhere(raw: string): Prisma.OrganizationWhereInput {
  const q = escapeLike(raw);
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
      { domain: { contains: q, mode: "insensitive" } },
    ],
  };
}

/** Staff by name or email, case-insensitive substring. */
export function staffSearchWhere(raw: string): Prisma.PlatformAdminWhereInput {
  const q = escapeLike(raw);
  return {
    OR: [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ],
  };
}

/** Codes by exact or prefix match, case-insensitive (a prefix includes the exact code). */
export function codeSearchWhere(q: string): Prisma.AppsumoCodeWhereInput {
  return { code: { startsWith: escapeLike(q.replace(/\s+/g, "")), mode: "insensitive" } };
}

export type CodeStatus = "unused" | "redeemed" | "refunded";

/** One status per code: a refund wins over a redemption. */
export function codeStatus(row: { redeemedAt: Date | string | null; refundedAt: Date | string | null }): CodeStatus {
  if (row.refundedAt) return "refunded";
  if (row.redeemedAt) return "redeemed";
  return "unused";
}

/**
 * The right-hand text of a CODES row. A code redeemed by a company that no
 * longer exists says "Redeemed" alone rather than showing a dangling id.
 */
export function codeSecondary(status: CodeStatus, companyName: string | null): string {
  if (status === "refunded") return "Refunded";
  if (status === "redeemed") return companyName ? `Redeemed by ${companyName}` : "Redeemed";
  return "Unused";
}

/** The right-hand text of a COMPANIES or RECENT row: "Scale · Active". */
export function companySecondary(plan: string, status: string): string {
  return `${planLabel(plan)} · ${statusLabel(status)}`;
}
