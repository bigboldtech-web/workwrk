// GET  /api/tools: the tools this viewer can see (tool-access.ts).
//   ?q=          name, website or description contains
//   ?category=   exact category ("none" for no category)
// The list never carries the saved login: `hasLogin` says whether there is
// one, and GET /api/tools/[id] returns it to someone who can see the tool.
// POST /api/tools: add a tool (a manager or above, unchanged).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity, logAuditEvent } from "@/lib/activity";
import { accessV2Tables } from "@/lib/access/flags";
import { canAddTool, canEditTool, canShareTool, hasLogin, seesAllTools, toolShareRole } from "@/lib/tools/tool-access";
import { requireTools } from "@/lib/tools/tool-server";

export async function GET(req: NextRequest) {
  const v = await requireTools();
  if ("error" in v) return v.error;
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 200);
  const category = (sp.get("category") ?? "").trim();

  const mine = await prisma.toolShare.findMany({ where: { userId: v.userId, tool: { organizationId: v.orgId } }, select: { toolId: true, sharedAt: true, role: true } });
  const sharedAt = new Map(mine.map((s) => [s.toolId, s.sharedAt]));
  // What each of the viewer's shares gives (Can view while ACCESS_V2_TABLES is off).
  const rolesOn = accessV2Tables();
  const myRole = new Map(mine.map((s) => [s.toolId, toolShareRole(s, rolesOn)]));

  const tools = await prisma.tool.findMany({
    where: {
      organizationId: v.orgId,
      ...(seesAllTools(v) ? {} : { OR: [{ addedBy: v.userId }, { id: { in: [...sharedAt.keys()] } }] }),
      ...(q ? { AND: [{ OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { url: { contains: q, mode: "insensitive" as const } },
        { description: { contains: q, mode: "insensitive" as const } },
      ] }] } : {}),
      ...(category === "none" ? { category: null } : category ? { category } : {}),
    },
    select: {
      id: true, name: true, description: true, url: true, icon: true, category: true, credentials: true,
      addedBy: true, createdAt: true, updatedAt: true,
      shares: { select: { userId: true, sharedAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const peopleIds = [...new Set(tools.flatMap((t) => [t.addedBy, ...t.shares.map((s) => s.userId)]))];
  const people = peopleIds.length
    ? await prisma.user.findMany({ where: { id: { in: peopleIds }, organizationId: v.orgId }, select: { id: true, firstName: true, lastName: true, avatar: true } })
    : [];
  const person = new Map(people.map((p) => [p.id, { id: p.id, name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Someone", avatar: p.avatar }]));

  return jsonSuccess({
    tools: tools.map(({ credentials, shares, ...t }) => {
      const share = myRole.get(t.id) ?? null;
      const manage = canShareTool(v, t, share);
      return {
        ...t,
        hasLogin: hasLogin(credentials),
        // canManage: share and delete it. With the roles on (the flag),
        // canEdit: change it (category, fields, login).
        canManage: manage,
        ...(rolesOn ? { canEdit: canEditTool(v, t, share) } : {}),
        sharedAt: sharedAt.get(t.id) ?? null,
        addedByPerson: person.get(t.addedBy) ?? null,
        // Who it is shared with: shown to the people who can change it, and
        // as a count to everyone else.
        sharedWith: manage ? shares.map((s) => person.get(s.userId)).filter(Boolean) : [],
        shareCount: shares.length,
      };
    }),
    canAdd: canAddTool(v),
    seesAll: seesAllTools(v),
  });
}

export async function POST(req: NextRequest) {
  const v = await requireTools();
  if ("error" in v) return v.error;
  if (!canAddTool(v)) return jsonError("Only a manager or an admin can add tools.", 403);

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return jsonError("Tool name is required");
  const str = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);
  const credentials = body?.credentials && typeof body.credentials === "object" && hasLogin(body.credentials) ? body.credentials : undefined;

  const tool = await prisma.tool.create({
    data: {
      name,
      description: str(body?.description, 2000),
      url: str(body?.url, 500),
      icon: str(body?.icon, 16),
      category: str(body?.category, 60),
      credentials,
      addedBy: v.userId,
      organizationId: v.orgId,
    },
    select: { id: true, name: true, url: true, category: true },
  });

  // Tools with a saved login are a security surface: admins need to trace
  // who added what and when.
  if (credentials) {
    logAuditEvent({
      type: "tool_created",
      actorId: v.userId,
      organizationId: v.orgId,
      description: `Added tool "${tool.name}" with a saved login`,
      targetId: tool.id,
      targetType: "tool",
      metadata: { url: tool.url ?? null, category: tool.category ?? null, hasCredentials: true },
    });
  } else {
    logActivity({
      type: "tool_created",
      actorId: v.userId,
      organizationId: v.orgId,
      description: `Added tool "${tool.name}"`,
      targetId: tool.id,
      targetType: "tool",
    });
  }

  return jsonSuccess(tool, 201);
}
