// GET  /api/workspaces?product=workwrk-crm — list workspaces inside a
//                                              product visible to the
//                                              current user.
// POST /api/workspaces  { product, name, color?, description? }
//      Create a new workspace under (org, product). Caller becomes OWNER.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { createWorkspace, listWorkspacesForUser } from "@/lib/workspaces";

// We treat manager+ as "see all workspaces in the product" so people
// leads can audit/jump between teams. Non-managers only see the
// workspaces they're a member of (plus the default).
const ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userId = (session.user as { id?: string }).id;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const organizationId = (session.user as { organizationId?: string }).organizationId;
  if (!userId || !organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId, accessLevel, organizationId };
}

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const product = url.searchParams.get("product");
  if (!product) {
    return NextResponse.json({ error: "product query param is required" }, { status: 400 });
  }
  const workspaces = await listWorkspacesForUser(c.userId, product, {
    includeAll: ADMIN_LEVELS.has(c.accessLevel),
  });
  return NextResponse.json({ workspaces });
}

const createSchema = z.object({
  product: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  color: z.string().max(20).optional(),
  description: z.string().max(280).optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  // Only manager+ can create new workspaces — keeps random employees
  // from spinning up shadow teams.
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required to create workspaces." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const workspace = await createWorkspace({
      organizationId: c.organizationId,
      productSlug: parsed.data.product,
      userId: c.userId,
      name: parsed.data.name,
      color: parsed.data.color,
      description: parsed.data.description,
    });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create workspace" },
      { status: 400 },
    );
  }
}
