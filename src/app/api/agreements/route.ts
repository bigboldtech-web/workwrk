import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { parseContractsSort, parseContractsView, statusesForContractsView, type ContractStatus } from "@/lib/contracts";
import { isMissingContractColumnError, LEGACY_AGREEMENT_SELECT } from "@/lib/contract-columns";

function token() { return crypto.randomBytes(16).toString("hex"); }

/**
 * GET /api/agreements?view=all|drafts|out|completed|voided|templates&status=&category=&party=&q=&sort=&dir=&page=&pageSize=
 * (spec-process section 2 `/agreements`). Owner, Admin and the People team
 * (the `agreements` app key; today's manager tier stands in for the FULL
 * rule). Archived contracts live in the one /trash. `q` matches the title
 * and a party's name or email; `party` matches a party's name or email
 * alone. The response carries the real total and the per-view counts.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const view = parseContractsView(sp.get("view"));
  const q = (sp.get("q") ?? "").trim();
  const party = (sp.get("party") ?? "").trim();
  const category = sp.get("category");
  const statusParam = sp.get("status");
  const source = sp.get("source");
  const sentFrom = sp.get("sentFrom"); const sentTo = sp.get("sentTo");
  const sort = parseContractsSort(sp.get("sort"));
  const dir: "asc" | "desc" = sp.get("dir") === "asc" || sp.get("dir") === "desc" ? (sp.get("dir") as "asc" | "desc") : sort === "name" ? "asc" : "desc";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(200, Number(sp.get("pageSize")) || 40));

  const where: Record<string, unknown> = { organizationId: orgId, archivedAt: null, isTemplate: view === "templates" };
  const statuses = statusesForContractsView(view);
  if (statuses) where.status = { in: statuses };
  if (statusParam && ["DRAFT", "SENT", "PARTIALLY_SIGNED", "COMPLETED", "VOIDED"].includes(statusParam)) where.status = statuses ? { in: statuses.filter((s) => s === statusParam) } : statusParam;
  if (category) where.category = category === "__none__" ? null : category;
  if (source === "pdf" || source === "blocknote") where.sourceType = source;
  if (sentFrom || sentTo) where.sentAt = { ...(sentFrom ? { gte: new Date(sentFrom) } : {}), ...(sentTo ? { lte: new Date(sentTo) } : {}) };
  const and: unknown[] = [];
  if (q) and.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { parties: { some: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } }] });
  if (party) and.push({ parties: { some: { OR: [{ name: { contains: party, mode: "insensitive" } }, { email: { contains: party, mode: "insensitive" } }] } } });
  if (and.length) where.AND = and;

  const orderBy = sort === "name" ? { title: dir } : sort === "status" ? { status: dir } : { updatedAt: dir };

  const partiesSelect = { select: { id: true, name: true, email: true, role: true, status: true, userId: true, order: true }, orderBy: { order: "asc" as const } };
  type ListRow = { id: string; title: string; status: string; category: string | null; isTemplate: boolean; sourceType: string; archivedAt: Date | null; sentAt: Date | null; updatedAt: Date; createdAt: Date; parties: Array<{ id: string; name: string; email: string; role: string; status: string; userId: string | null; order: number }> };
  const listRows = async (): Promise<ListRow[]> => {
    try {
      return await prisma.agreement.findMany({ where: where as never, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { parties: partiesSelect } });
    } catch (e) {
      // One-release tolerance: the database has not had the 2026-09-21
      // contract columns applied yet. Read the columns every release has had.
      if (!isMissingContractColumnError(e)) throw e;
      const legacy = await prisma.agreement.findMany({ where: where as never, orderBy, skip: (page - 1) * pageSize, take: pageSize, select: { ...LEGACY_AGREEMENT_SELECT, parties: partiesSelect } });
      return legacy.map((a) => ({ ...a, sentAt: null }));
    }
  };
  const [rows, total, countsRaw, usedRaw] = await Promise.all([
    listRows(),
    prisma.agreement.count({ where: where as never }),
    prisma.agreement.groupBy({ by: ["status", "isTemplate"], where: { organizationId: orgId, archivedAt: null }, _count: { _all: true } }),
    view === "templates" ? prisma.agreement.groupBy({ by: ["templateId"], where: { organizationId: orgId, isTemplate: false, templateId: { not: null } }, _count: { _all: true } }) : Promise.resolve([] as Array<{ templateId: string | null; _count: { _all: number } }>),
  ]);
  const usedBy = new Map(usedRaw.map((u) => [u.templateId, u._count._all]));

  const counts = { all: 0, drafts: 0, out: 0, completed: 0, voided: 0, templates: 0 };
  for (const c of countsRaw) {
    if (c.isTemplate) { counts.templates += c._count._all; continue; }
    counts.all += c._count._all;
    if (c.status === "DRAFT") counts.drafts += c._count._all;
    else if (c.status === "SENT" || c.status === "PARTIALLY_SIGNED") counts.out += c._count._all;
    else if (c.status === "COMPLETED") counts.completed += c._count._all;
    else if (c.status === "VOIDED") counts.voided += c._count._all;
  }

  return jsonSuccess({
    data: rows.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status as ContractStatus,
      category: a.category,
      isTemplate: a.isTemplate,
      sourceType: a.sourceType,
      archivedAt: a.archivedAt,
      sentAt: a.sentAt,
      updatedAt: a.updatedAt,
      createdAt: a.createdAt,
      parties: a.parties,
      partyCount: a.parties.length,
      signedCount: a.parties.filter((p) => p.status === "SIGNED").length,
      usedCount: a.isTemplate ? usedBy.get(a.id) ?? 0 : null,
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    counts,
    view,
  });
}

/**
 * POST /api/agreements { title, category?, sourceType?, pdfUrl?, content?, isTemplate?, fromTemplateId? }
 * The chooser supplies the title and folder, so no "Untitled" rows are
 * created. A live contract starts with the two standard parties; a template
 * clones its source's content, fields, folder and party roles.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;

  if (typeof body.fromTemplateId === "string" && body.fromTemplateId) {
    const tpl = await prisma.agreement.findFirst({
      where: { id: body.fromTemplateId, organizationId: orgId, isTemplate: true },
      include: { parties: { orderBy: { order: "asc" } } },
    });
    if (!tpl) return jsonError("Template not found", 404);
    const created = await prisma.agreement.create({
      data: {
        organizationId: orgId,
        title: title || tpl.title.replace(/\s*\(template\)\s*$/i, ""),
        content: tpl.content,
        sourceType: tpl.sourceType,
        pdfUrl: tpl.pdfUrl,
        fields: tpl.fields as object,
        category: category ?? tpl.category,
        templateId: tpl.id,
        createdById: getUserId(session),
        parties: { create: tpl.parties.map((p, i) => ({ name: p.name, email: "", role: p.role, order: i, token: token() })) },
      },
    });
    return jsonSuccess(created, 201);
  }

  const isTemplate = body.isTemplate === true;
  if (!title) return jsonError("Title is required");
  const sourceType = body.sourceType === "pdf" ? "pdf" : "blocknote";
  if (sourceType === "pdf" && typeof body.pdfUrl !== "string") return jsonError("Upload a PDF first");
  const created = await prisma.agreement.create({
    data: {
      organizationId: orgId,
      title,
      content: typeof body.content === "string" ? body.content : "",
      sourceType,
      pdfUrl: typeof body.pdfUrl === "string" ? body.pdfUrl : null,
      category,
      isTemplate,
      createdById: getUserId(session),
      parties: {
        create: [
          { name: "1st Party", email: "", role: "COMPANY", order: 0, token: token() },
          { name: "2nd Party", email: "", role: "SIGNER", order: 1, token: token() },
        ],
      },
    },
  });
  return jsonSuccess(created, 201);
}
