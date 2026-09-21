import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isMissingContractColumnError, LEGACY_AGREEMENT_FILL, LEGACY_AGREEMENT_SELECT, LEGACY_PARTY_FILL, LEGACY_PARTY_SELECT } from "@/lib/contract-columns";

/**
 * The contract with its parties. One-release tolerance for the 2026-09-21
 * contract columns: when the database does not have them yet, the read is
 * re-run over the columns every release has had and the new fields answer
 * their empty values, so an open never 500s on a database that is behind.
 */
async function loadAgreement(id: string, orgId: string) {
  try {
    return await prisma.agreement.findFirst({ where: { id, organizationId: orgId }, include: { parties: { orderBy: { order: "asc" } } } });
  } catch (e) {
    if (!isMissingContractColumnError(e)) throw e;
    const legacy = await prisma.agreement.findFirst({ where: { id, organizationId: orgId }, select: { ...LEGACY_AGREEMENT_SELECT, parties: { select: LEGACY_PARTY_SELECT, orderBy: { order: "asc" } } } });
    if (!legacy) return null;
    return { ...LEGACY_AGREEMENT_FILL, ...legacy, parties: legacy.parties.map((p) => ({ ...LEGACY_PARTY_FILL, ...p })) };
  }
}

/**
 * GET /api/agreements/[id] (spec-process section 2 `/agreements/[id]`): the
 * contract with its parties, `access.role` and `myParty`. Owner, Admin and
 * the People team (today's manager tier) hold FULL; a Member who is a PARTY
 * (by user id or by the email on their account) holds VIEW and gets the
 * document plus their own signing token only; everyone else gets the same
 * 404 a missing id gets.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const full = isManager(session);
  const agreement = await loadAgreement(id, orgId);
  if (!agreement) return jsonError("Not found", 404);

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const myParty = agreement.parties.find((p) => p.userId === userId || (!!me?.email && p.email.trim().toLowerCase() === me.email.toLowerCase())) ?? null;
  if (!full && !myParty) return jsonError("Not found", 404);

  const creator = agreement.createdById ? await prisma.user.findUnique({ where: { id: agreement.createdById }, select: { id: true, firstName: true, lastName: true, email: true, avatar: true } }) : null;

  if (!full) {
    // A party sees the document, their status and their own link; never the
    // other parties' emails or tokens.
    return jsonSuccess({
      id: agreement.id, title: agreement.title, content: agreement.content, sourceType: agreement.sourceType, pdfUrl: agreement.pdfUrl,
      status: agreement.status, category: agreement.category, isTemplate: agreement.isTemplate, fields: agreement.fields, sentAt: agreement.sentAt, voidedAt: agreement.voidedAt,
      createdAt: agreement.createdAt, updatedAt: agreement.updatedAt, createdBy: creator,
      parties: agreement.parties.map((p) => ({ id: p.id, name: p.name, role: p.role, status: p.status, order: p.order, signedAt: p.signedAt })),
      access: { role: "VIEW" },
      myParty: { id: myParty!.id, name: myParty!.name, role: myParty!.role, status: myParty!.status, token: myParty!.token, signedAt: myParty!.signedAt },
    });
  }

  return jsonSuccess({ ...agreement, createdBy: creator, access: { role: "FULL" }, myParty: myParty ? { id: myParty.id, name: myParty.name, role: myParty.role, status: myParty.status, token: myParty.token, signedAt: myParty.signedAt } : null });
}

const LOCKED = "This contract has been sent for signature. Its document, fields and status are locked; void it to withdraw it.";

/**
 * PATCH /api/agreements/[id] { title, content, fields, category, archived,
 * action: "void" }. FULL only.
 *
 * THE DOCUMENT IS THE RECORD. Title, content and fields are writable while the
 * contract is a DRAFT or a template and at no other time: a signature was
 * given against exact content, so once the contract is out for signature
 * the only status change is Void (`{ action: "void" }`, or the older
 * `{ status: "VOIDED" }` spelling), and the free status list is gone.
 * Folder and Trash (category, archived) stay writable at every status.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const existing = await prisma.agreement.findFirst({ where: { id, organizationId: getOrgId(session) }, select: { id: true, status: true, isTemplate: true } });
  if (!existing) return jsonError("Not found", 404);

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  const editable = existing.isTemplate || existing.status === "DRAFT";
  const wantsVoid = body.action === "void" || body.status === "VOIDED";
  if (wantsVoid) {
    if (existing.status !== "SENT" && existing.status !== "PARTIALLY_SIGNED") return jsonError("Only a contract that is out for signature can be voided.", 409);
    data.status = "VOIDED";
    data.voidedAt = new Date();
  } else if (body.status !== undefined) {
    return jsonError("A contract's status moves through Send for signature, signing and Void only.", 409);
  }
  if (body.title !== undefined || body.content !== undefined || body.fields !== undefined) {
    if (!editable) return jsonError(LOCKED, 409);
    if (body.title !== undefined) data.title = String(body.title).trim() || "Untitled contract";
    if (body.content !== undefined) data.content = String(body.content ?? "");
    if (body.fields !== undefined) data.fields = Array.isArray(body.fields) ? body.fields : [];
  }
  if (body.category !== undefined) data.category = body.category ? String(body.category).trim() || null : null;
  if (body.archived !== undefined) {
    data.archivedAt = body.archived ? new Date() : null;
    // Record WHO archived it so /trash's "Archived by" names a person instead
    // of a blank cell. Cleared on un-archive, so a restored row carries no
    // stale archiver. The column is additive and nullable
    // (prisma/sql/2026-09-21-agreement-archived-by.sql); a database that has
    // not had it applied yet rejects this key, so the write is attempted and
    // the archive itself never depends on it.
    data.archivedById = body.archived ? getUserId(session) : null;
  }
  if (Object.keys(data).length === 0) return jsonError("Nothing to change");

  const updated = await prisma.agreement.update({ where: { id }, data: data as never });
  return jsonSuccess(updated);
}

/**
 * DELETE: remove a draft or a template for good (Owner, Admin). A contract
 * that was ever sent is voided or archived, never deleted: a voided envelope
 * that carries a signature is the record of that signature.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const { id } = await params;
  const existing = await prisma.agreement.findFirst({ where: { id, organizationId: getOrgId(session) }, select: { id: true, status: true, isTemplate: true } });
  if (!existing) return jsonError("Not found", 404);
  if (!existing.isTemplate && existing.status !== "DRAFT") return jsonError("Only drafts and templates can be deleted. Void or archive it instead.", 409);
  await prisma.agreement.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
