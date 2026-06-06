// GET /api/docs/[id]/export?format=md
//
// Serializes a Doc's block content to markdown so users can hand it
// off to anything (Notion, Obsidian, README, AI prompts, …). Today we
// only support format=md; format=html and format=pdf can plug in here
// later behind the same content-walker.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";

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
    select: { id: true, title: true, content: true, entityType: true, entityId: true, updatedAt: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const md = blocksToMarkdown(doc.title, doc.content);

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

function blocksToMarkdown(title: string, content: unknown): string {
  const out: string[] = [];
  if (title) { out.push(`# ${title}`, ""); }

  if (!content || typeof content !== "object") return out.join("\n");
  const c = content as { blocks?: unknown[] };
  if (!Array.isArray(c.blocks)) return out.join("\n");

  let numberedSeq = 0;
  for (const b of c.blocks) {
    if (!b || typeof b !== "object") continue;
    const block = b as Record<string, unknown>;
    const kind = String(block.kind ?? "");

    // Reset numbered-list counter when we leave a numbered run.
    if (kind !== "numbered") numberedSeq = 0;

    switch (kind) {
      case "h1": out.push(`# ${stripHtml(block.text)}`, ""); break;
      case "h2": out.push(`## ${stripHtml(block.text)}`, ""); break;
      case "h3": out.push(`### ${stripHtml(block.text)}`, ""); break;
      case "paragraph": out.push(stripHtml(block.text), ""); break;
      case "bullet": out.push(`- ${stripHtml(block.text)}`); break;
      case "numbered":
        numberedSeq += 1;
        out.push(`${numberedSeq}. ${stripHtml(block.text)}`);
        break;
      case "todo":
        out.push(`- [${block.done ? "x" : " "}] ${stripHtml(block.text)}`);
        break;
      case "quote": out.push(`> ${stripHtml(block.text)}`, ""); break;
      case "code":
        out.push(`\`\`\`${block.lang ?? ""}`, String(block.text ?? ""), "```", "");
        break;
      case "divider": out.push("---", ""); break;
      case "callout": {
        const tone = String(block.tone ?? "info").toUpperCase();
        out.push(`> **${tone}** — ${stripHtml(block.text)}`, "");
        break;
      }
      case "toggle": {
        const head = stripHtml(block.text);
        const body = stripHtml(block.body);
        if (body) {
          out.push(`<details><summary>${head}</summary>`, "", body, "", "</details>", "");
        } else {
          out.push(`<details><summary>${head}</summary></details>`, "");
        }
        break;
      }
      case "image": {
        const url = String(block.url ?? "");
        const alt = String(block.alt ?? "");
        if (url) out.push(`![${alt}](${url})`, "");
        if (block.caption) out.push(`*${stripHtml(block.caption)}*`, "");
        break;
      }
      case "file": out.push(`[📎 ${String(block.name ?? "file")}](${String(block.url ?? "")})`, ""); break;
      case "embed": {
        const url = String(block.url ?? "");
        if (url) out.push(`<${url}>`, "");
        break;
      }
      case "entity_link":
        out.push(`@${String(block.label ?? "entity")} (${String(block.entityKind ?? "")})`, "");
        break;
      case "sop_card":  out.push(`[🔗 SOP: ${String(block.sopId ?? "")}](/sops/${String(block.sopId ?? "")})`, ""); break;
      case "task_card": out.push(`[🔗 Task: ${String(block.taskId ?? "")}](/tasks/${String(block.taskId ?? "")})`, ""); break;
      case "note_card": out.push(`[🔗 Note: ${String(block.noteId ?? "")}](/docs/${String(block.noteId ?? "")})`, ""); break;
      case "subpage":   out.push(`[📄 ${String(block.title ?? "sub-page")}](/docs/${String(block.childDocId ?? "")})`, ""); break;
      case "ai_write":
        if (block.result) out.push(String(block.result), "");
        break;
      // Workspace embeds — markdown can't render them, so we just note them.
      case "tasks_view": case "studio_board": case "sops_list":
      case "meetings_view": case "form": case "data_table":
        out.push(`> *[Embedded ${kind.replace(/_/g, " ")}]*`, "");
        break;
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function stripHtml(s: unknown): string {
  if (typeof s !== "string") return "";
  // Convert <a class="bmen-inline" data-kind="user" ...>@Alice</a>
  // to @Alice — preserve mention readability in the markdown output.
  return s
    .replace(/<a[^>]*class="[^"]*bmen-inline[^"]*"[^>]*>(@[^<]+)<\/a>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
