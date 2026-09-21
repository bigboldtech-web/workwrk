// The contract columns prisma/sql/2026-09-21-contract-send-decline.sql adds
// (Agreement.signingOrder / sendMessage / sentAt / voidedAt, AgreementParty
// declinedAt / declineReason / viewedAt / userAgent), and the one-release
// tolerance the project rule asks of every reader.
//
// The file is in the deploy manifest (scripts/deploy-migrations.mjs), so a
// deploy applies it before the build and a database that refuses it keeps
// the previous release. The two READ routes still tolerate the columns being
// absent (a hand deploy, a restored backup): on Prisma's "column does not
// exist" they re-run with an explicit select of the columns every release
// has had, and the new fields answer null. The write paths that need the
// columns (Send, Decline, Void) answer a named 503 instead of a bare 500.
//
// Pure apart from the Prisma error shape, so vitest proves the detection.

export const CONTRACT_MIGRATION = "prisma/sql/2026-09-21-contract-send-decline.sql";

const NEW_COLUMNS = ["signingOrder", "sendMessage", "sentAt", "voidedAt", "declinedAt", "declineReason", "viewedAt", "userAgent"];

/** True for Prisma P2022 / Postgres 42703 naming one of the new contract columns. */
export function isMissingContractColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; meta?: { column?: unknown } };
  const text = `${typeof e.message === "string" ? e.message : ""} ${String(e.meta?.column ?? "")}`;
  if (!NEW_COLUMNS.some((c) => text.includes(c))) return false;
  return e.code === "P2022" || e.code === "42703" || text.includes("does not exist");
}

export const CONTRACT_MIGRATION_MESSAGE = `Contracts need a database update (${CONTRACT_MIGRATION}). Ask an admin to apply it.`;

/** The Agreement columns every release has had. */
export const LEGACY_AGREEMENT_SELECT = {
  id: true, organizationId: true, title: true, content: true, sourceType: true, pdfUrl: true, fields: true, status: true, category: true,
  isTemplate: true, templateId: true, createdById: true, archivedAt: true, createdAt: true, updatedAt: true,
} as const;

/** The AgreementParty columns every release has had. */
export const LEGACY_PARTY_SELECT = {
  id: true, agreementId: true, role: true, name: true, email: true, userId: true, order: true, token: true, status: true, values: true, signedAt: true, ipAddress: true, createdAt: true,
} as const;

/** The new fields, as the legacy shape answers them. */
export const LEGACY_AGREEMENT_FILL = { signingOrder: false, sendMessage: null, sentAt: null, voidedAt: null } as const;
export const LEGACY_PARTY_FILL = { declinedAt: null, declineReason: null, viewedAt: null, userAgent: null } as const;
