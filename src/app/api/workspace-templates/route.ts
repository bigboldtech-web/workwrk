// GET /api/workspace-templates   list available starter workspace templates
//
// Distinct from /api/templates (board templates marketplace). These
// are starter bundles (Doc + Form + Table) defined in code at
// src/lib/workspace-templates.ts.

import { TEMPLATES } from "@/lib/workspace-templates";
import { getSessionOrFail, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error } = await getSessionOrFail();
  if (error) return error;

  return jsonSuccess(
    TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      tagline: t.tagline,
      description: t.description,
      iconKey: t.iconKey,
      gradient: t.gradient,
      summary: {
        doc: t.doc.title,
        form: t.form.name,
        table: t.table.name,
      },
    })),
  );
}
