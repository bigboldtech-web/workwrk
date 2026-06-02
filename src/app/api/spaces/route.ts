// GET  /api/spaces — list Spaces visible to the caller in their org.
// POST /api/spaces — create a Space. Manager+ only; creator becomes OWNER.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { createSpace, listSpacesForUser } from "@/lib/space";

const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD",
]);

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const spaces = await listSpacesForUser(c.userId, c.organizationId, {
    accessLevel: c.accessLevel,
    includeArchived,
  });
  return NextResponse.json({ spaces });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(20).optional(),
  visibility: z.enum(["PRIVATE", "WORKSPACE", "ORG"]).optional(),
  parentSpaceId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!MANAGER_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required to create Spaces." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const space = await createSpace({
      organizationId: c.organizationId,
      userId: c.userId,
      name: parsed.data.name,
      description: parsed.data.description,
      icon: parsed.data.icon,
      color: parsed.data.color,
      visibility: parsed.data.visibility,
      parentSpaceId: parsed.data.parentSpaceId,
    });
    return NextResponse.json({ space }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create Space" },
      { status: 400 },
    );
  }
}
