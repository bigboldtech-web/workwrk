// GET /api/export/tools?q=&category=&hasLogin=&ids=
//
// The "…" menu's Export CSV on /tools (spec-tools-misc 2.1): the tool admins
// only (the people who see every tool), never an Agent or an acting-as
// session. The list without its logins: a saved login never leaves the
// product in a file.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-helpers";
import { csvFilename, csvFormulaSafe, toCsv, type CsvCell } from "@/lib/csv";
import { hasLogin, seesAllTools } from "@/lib/tools/tool-access";
import { requireTools } from "@/lib/tools/tool-server";

export async function GET(req: NextRequest) {
  const v = await requireTools();
  if ("error" in v) return v.error;
  if (!seesAllTools(v)) return jsonError("Only a tool admin can export the tools list.", 403);
  if (v.isAgent || v.actingAs) return jsonError("Exports are not available to agents or while acting as somebody else.", 403);

  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 200);
  const category = (sp.get("category") ?? "").trim();
  const wantLogin = sp.get("hasLogin");
  const ids = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);

  const tools = await prisma.tool.findMany({
    where: {
      organizationId: v.orgId,
      ...(ids.length ? { id: { in: ids } } : {}),
      ...(q ? { OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { url: { contains: q, mode: "insensitive" as const } },
        { description: { contains: q, mode: "insensitive" as const } },
      ] } : {}),
      ...(category === "none" ? { category: null } : category ? { category } : {}),
    },
    select: { id: true, name: true, description: true, url: true, icon: true, category: true, credentials: true, addedBy: true, createdAt: true, shares: { select: { userId: true } } },
    orderBy: { name: "asc" },
    take: 5000,
  });
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(tools.map((t) => t.addedBy))] }, organizationId: v.orgId }, select: { id: true, firstName: true, lastName: true } });
  const name = new Map(people.map((p) => [p.id, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()]));
  const text = (x: string | null | undefined) => (x ? csvFormulaSafe(x) : "");
  const data: Record<string, CsvCell>[] = tools
    .filter((t) => wantLogin === "yes" ? hasLogin(t.credentials) : wantLogin === "no" ? !hasLogin(t.credentials) : true)
    .map((t) => ({
      Name: text(t.name),
      Category: text(t.category),
      Website: text(t.url),
      Description: text(t.description),
      Login: hasLogin(t.credentials) ? "Saved" : "None",
      "Shared with": t.shares.length,
      "Added by": text(name.get(t.addedBy) ?? ""),
      Added: t.createdAt.toISOString().slice(0, 10),
    }));
  const csv = toCsv(data, ["Name", "Category", "Website", "Description", "Login", "Shared with", "Added by", "Added"]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("tools")}"`,
      "Cache-Control": "no-store",
    },
  });
}
