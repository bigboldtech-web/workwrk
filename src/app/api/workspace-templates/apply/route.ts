// POST /api/workspace-templates/apply  { templateId }
//
// Seeds a Doc + Form + DataTable into the current org based on the
// template definition in src/lib/workspace-templates.ts.

import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getTemplate } from "@/lib/workspace-templates";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = await req.json();
  const templateId = typeof body.templateId === "string" ? body.templateId : null;
  if (!templateId) return jsonError("templateId required");

  const t = getTemplate(templateId);
  if (!t) return jsonError("unknown template", 404);

  const [doc, form, table] = await Promise.all([
    prisma.doc.create({
      data: {
        organizationId: orgId,
        title: t.doc.title,
        content: { blocks: t.doc.blocks } as unknown as Prisma.InputJsonValue,
        createdById: userId,
        versions: {
          create: {
            version: 1,
            title: t.doc.title,
            content: { blocks: t.doc.blocks } as unknown as Prisma.InputJsonValue,
            authorId: userId,
          },
        },
      },
      select: { id: true, title: true },
    }),
    prisma.formDefinition.create({
      data: {
        organizationId: orgId,
        name: t.form.name,
        description: t.form.description,
        isPublic: t.form.isPublic,
        fields: t.form.fields as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
      select: { id: true, name: true },
    }),
    prisma.dataTable.create({
      data: {
        organizationId: orgId,
        name: t.table.name,
        description: t.table.description,
        columns: t.table.columns as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
      select: { id: true, name: true },
    }),
  ]);

  void logActivity({
    type: "template.applied",
    actorId: userId,
    organizationId: orgId,
    description: `Applied "${t.name}" template — seeded a doc, form, and table`,
    metadata: {
      template: t.id,
      docId: doc.id,
      formId: form.id,
      tableId: table.id,
    },
  });

  return jsonSuccess({
    applied: t.id,
    created: { doc, form, table },
  }, 201);
}
