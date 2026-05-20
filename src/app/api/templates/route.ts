// GET /api/templates — list all templates in the catalog, grouped
// info for the UI (product slug, name, tagline). Apply endpoint is
// at /api/templates/[slug]/apply.

import { NextResponse } from "next/server";
import { TEMPLATE_CATALOG } from "@/lib/templates/catalog";

export async function GET() {
  return NextResponse.json({
    templates: TEMPLATE_CATALOG.map((t) => ({
      slug: t.slug,
      name: t.name,
      tagline: t.tagline,
      productSlug: t.productSlug,
    })),
  });
}
