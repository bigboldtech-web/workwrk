// AppSumo codes in the Staff console (spec-admin-backoffice 2.6): the views,
// the Filter panel's fields, the sort, the three tier presets and the import
// parser. Pure (Prisma types only), so GET /api/admin/appsumo, its CSV and the
// page read one definition and vitest proves it.

import type { Prisma } from "@/generated/prisma";
import { boundedInt, codeSearchWhere } from "@/lib/admin/search";
import { parseDay, parseList, seatsAreUnlimited } from "@/lib/admin/companies-list";
import { VALID_PLANS, type CompanyPlan } from "@/lib/admin/company-patch-rules";
import { planLabel } from "@/lib/staff-audit-helpers";

export const CODE_VIEWS = ["all", "unused", "redeemed", "refunded"] as const;
export type CodeView = (typeof CODE_VIEWS)[number];
export const CODE_VIEW_LABEL: Record<CodeView, string> = {
  all: "All",
  unused: "Unused",
  redeemed: "Redeemed",
  refunded: "Refunded",
};

/** One status per code, a refund winning over a redemption (search.ts codeStatus). */
export function codeViewWhere(view: CodeView): Prisma.AppsumoCodeWhereInput {
  switch (view) {
    case "unused":
      return { redeemedAt: null, refundedAt: null };
    case "redeemed":
      return { redeemedAt: { not: null }, refundedAt: null };
    case "refunded":
      return { refundedAt: { not: null } };
    default:
      return {};
  }
}

export const CODE_SORTS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "code", label: "Code A to Z" },
] as const;
export type CodeSort = (typeof CODE_SORTS)[number]["key"];

export const CODE_TIERS = ["1", "2", "3", "4", "5"] as const;

export interface CodeListParams {
  view: CodeView;
  code: string;
  tiers: number[];
  plans: CompanyPlan[];
  importedFrom: string | null;
  importedTo: string | null;
  redeemedFrom: string | null;
  redeemedTo: string | null;
  redeemedBy: string | null;
  sort: CodeSort;
  page: number;
  limit: number;
}

const COMPANY_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export function parseCodeListParams(sp: URLSearchParams): CodeListParams {
  // `filter` is the old name of `view` (bookmarks from before the rebuild).
  const rawView = sp.get("view") ?? sp.get("filter");
  const sort = sp.get("sort");
  const by = (sp.get("redeemed_by") ?? "").trim();
  return {
    view: (CODE_VIEWS as readonly string[]).includes(rawView ?? "") ? (rawView as CodeView) : "all",
    code: (sp.get("code") ?? "").trim().slice(0, 100),
    tiers: parseList(sp.get("tier"), CODE_TIERS).map(Number),
    plans: parseList(sp.get("plan"), VALID_PLANS),
    importedFrom: parseDay(sp.get("imported_from")),
    importedTo: parseDay(sp.get("imported_to")),
    redeemedFrom: parseDay(sp.get("redeemed_from")),
    redeemedTo: parseDay(sp.get("redeemed_to")),
    redeemedBy: COMPANY_ID_RE.test(by) ? by : null,
    sort: CODE_SORTS.some((s) => s.key === sort) ? (sort as CodeSort) : "newest",
    page: boundedInt(sp.get("page"), 1, 1, 100_000),
    limit: boundedInt(sp.get("limit"), 100, 1, 500),
  };
}

export function activeCodeFilterCount(p: CodeListParams): number {
  return [
    p.code.length > 0,
    p.tiers.length > 0,
    p.plans.length > 0,
    p.importedFrom !== null || p.importedTo !== null,
    p.redeemedFrom !== null || p.redeemedTo !== null,
    p.redeemedBy !== null,
  ].filter(Boolean).length;
}

function range(from: string | null, to: string | null): Prisma.DateTimeFilter | null {
  if (!from && !to) return null;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
  };
}

/** Every filter except the view. */
export function codeFilterWhere(p: CodeListParams): Prisma.AppsumoCodeWhereInput {
  const and: Prisma.AppsumoCodeWhereInput[] = [];
  if (p.code) and.push(codeSearchWhere(p.code));
  if (p.tiers.length) and.push({ tier: { in: p.tiers } });
  if (p.plans.length) and.push({ plan: { in: p.plans } });
  const imported = range(p.importedFrom, p.importedTo);
  if (imported) and.push({ createdAt: imported });
  const redeemed = range(p.redeemedFrom, p.redeemedTo);
  if (redeemed) and.push({ redeemedAt: redeemed });
  if (p.redeemedBy) and.push({ redeemedByOrg: p.redeemedBy });
  return and.length ? { AND: and } : {};
}

/** The query string for a codes list state; defaults are left out, so the URL stays short. */
export function codesQuery(p: Partial<CodeListParams>): string {
  const q = new URLSearchParams();
  if (p.view && p.view !== "all") q.set("view", p.view);
  if (p.code) q.set("code", p.code);
  if (p.tiers?.length) q.set("tier", p.tiers.join(","));
  if (p.plans?.length) q.set("plan", p.plans.join(","));
  if (p.importedFrom) q.set("imported_from", p.importedFrom);
  if (p.importedTo) q.set("imported_to", p.importedTo);
  if (p.redeemedFrom) q.set("redeemed_from", p.redeemedFrom);
  if (p.redeemedTo) q.set("redeemed_to", p.redeemedTo);
  if (p.redeemedBy) q.set("redeemed_by", p.redeemedBy);
  if (p.sort && p.sort !== "newest") q.set("sort", p.sort);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  if (p.limit && p.limit !== 100) q.set("limit", String(p.limit));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function codeOrderBy(sort: CodeSort): Prisma.AppsumoCodeOrderByWithRelationInput[] {
  if (sort === "oldest") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "code") return [{ code: "asc" }];
  return [{ createdAt: "desc" }, { id: "desc" }];
}

/* ───────────────────────── what a code gives ───────────────────────── */

/** "Tier 2 · Scale · 25 seats", or "Unlimited" in place of the seat number. Never the infinity glyph. */
export function codeGives(row: { tier: number; plan: string; seats: number }): string {
  const seats = seatsAreUnlimited(row.seats) ? "Unlimited" : `${row.seats} ${row.seats === 1 ? "seat" : "seats"}`;
  return `Tier ${row.tier} · ${planLabel(row.plan)} · ${seats}`;
}

/** The three presets (decided: they stay as code; the per-line override handles exceptions). */
export const TIER_PRESETS = [
  { tier: 1, plan: "GROWTH", seats: 5 },
  { tier: 2, plan: "SCALE", seats: 25 },
  { tier: 3, plan: "ENTERPRISE", seats: 999_999 },
] as const satisfies readonly { tier: number; plan: CompanyPlan; seats: number }[];

export type ImportRow = { code: string; tier: number; plan: CompanyPlan; seats: number };
export type ImportParse = { ok: true; rows: ImportRow[]; duplicatesInPaste: number } | { ok: false; error: string };

/**
 * The import textarea: one code per line; a line starting with "#" is a comment; a line may
 * override the default preset as `code, tier, plan, seats` (any trailing
 * parts may be left off, and keep the preset's values). Every line is
 * checked before anything is sent, and the first bad line is named by its
 * number ("Line 14: plan PRO is not a plan."). A code pasted twice is sent
 * once; "abc" and "ABC" are two codes.
 */
export function parseImport(text: string, preset: { tier: number; plan: string; seats: number }): ImportParse {
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  let dupes = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // A line that STARTS with "#" is a comment (the old importer's rule); a
    // "#" later in a line is part of it, never cut off.
    const raw = lines[i].trim();
    if (!raw || raw.startsWith("#")) continue;
    const n = i + 1;
    const parts = raw.split(",").map((s) => s.trim());
    const code = parts[0];
    if (!code || /\s/.test(code)) return { ok: false, error: `Line ${n}: a code has no spaces in it.` };
    if (code.length > 100) return { ok: false, error: `Line ${n}: that code is longer than 100 characters.` };
    let tier = preset.tier;
    let plan = preset.plan.toUpperCase();
    let seats = preset.seats;
    // An override may name only its first parts ("code, 2" changes the tier
    // and keeps the preset's plan and seats), the same as the old importer.
    if (parts.length > 4) return { ok: false, error: `Line ${n}: a line has at most four parts: code, tier, plan, seats.` };
    if (parts[1]) tier = Number(parts[1]);
    if (parts[2]) plan = parts[2].toUpperCase();
    if (parts[3]) seats = Number(parts[3]);
    if (![1, 2, 3, 4, 5].includes(tier)) return { ok: false, error: `Line ${n}: tier ${parts[1] ?? tier} is not a tier from 1 to 5.` };
    if (!(VALID_PLANS as readonly string[]).includes(plan)) return { ok: false, error: `Line ${n}: plan ${parts[2] ?? plan} is not a plan.` };
    if (!Number.isInteger(seats) || seats < 1) return { ok: false, error: `Line ${n}: seats ${parts[3] ?? seats} is not a whole number of 1 or more.` };
    // Codes are case-sensitive (the redeem route matches them exactly), so
    // only an identical line is a repeat.
    const key = code;
    if (seen.has(key)) {
      dupes++;
      continue;
    }
    seen.add(key);
    rows.push({ code, tier, plan: plan as CompanyPlan, seats });
  }
  if (rows.length === 0) return { ok: false, error: "Paste at least one code." };
  if (rows.length > 5000) return { ok: false, error: "Import at most 5,000 codes at a time." };
  return { ok: true, rows, duplicatesInPaste: dupes };
}
