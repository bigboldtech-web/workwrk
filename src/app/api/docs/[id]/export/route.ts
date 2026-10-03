// GET /api/docs/[id]/export?format=md
//
// Serializes a Doc's content to markdown so users can hand it off to
// anything (Notion, Obsidian, README, AI prompts). Today we only support
// format=md; format=html and format=pdf can plug in here later behind the
// same content walker, which the workspace export shares.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";
import { requireDocRole } from "@/lib/doc-sharing";
import { docToMarkdown } from "@/lib/docs/content-markdown";
import { absoluteUrl } from "@/lib/app-url";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "md").toLowerCase();
  if (format !== "md") {
    return NextResponse.json({ error: "Only format=md is supported for now" }, { status: 400 });
  }

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, title: true, content: true, entityType: true, entityId: true, updatedAt: true, createdById: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Viewers may export; restricted + unlisted → 404.
  const role = await requireDocRole(ctx, { id, createdById: doc.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Whichever editor saved it (BlockNote, TipTap or the first block
  // editor): src/lib/docs/content-markdown.ts. A sub-page links to its own
  // page in the app.
  const md = docToMarkdown(doc.title, doc.content, (childId) => absoluteUrl(`/docs/${encodeURIComponent(childId)}`));

  // Stream the markdown back as a download. The Content-Disposition
  // filename uses the title — sanitized to ascii so weird emoji
  // titles never break the header.
  const safeName = (doc.title || "note")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "note";

  return new Response(md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.md"`,
      "Cache-Control": "private, no-store",
    },
  });
}
