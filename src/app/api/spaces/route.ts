// GET  /api/spaces — list Spaces visible to the caller in their org.
//      The answer keeps the shape it always had: every Space the caller can
//      open, with numeric folderCount and boardCount (what the caller's tree
//      renders, never a hidden node), plus the Spaces the caller only passes
//      through on the way to something they were given (access "path": named,
//      with no role, no counts and no member list), which is how a Folder
//      grantee always found the Space that holds their Folder in the pickers.
//      ?paths=0 leaves the path rows out; ?counts=0 skips the counts (null)
//      for a caller that never shows them.
// POST /api/spaces — create a Space. Manager+ only; creator becomes OWNER.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canContributeSpace, createSpace, getSpaceForReader, listSpacesForUser } from "@/lib/space";
import { createBoard } from "@/lib/board";
import { SPACE_CREATE_LEVELS } from "@/lib/template-center";

// One definition, read from src/lib/template-center.ts, because applying a
// Space TEMPLATE creates a Space too and has to answer with the same floor.
// Two private copies is how the two doors end up disagreeing.
const MANAGER_LEVELS = SPACE_CREATE_LEVELS;

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
    // On unless the caller opts out: before node-access every caller got
    // counts and the Spaces holding a Folder shared with them (A8). A path
    // row carries role null, so a caller that asks "can I open it" still
    // reads no.
    paths: url.searchParams.get("paths") !== "0",
    counts: url.searchParams.get("counts") !== "0",
  });
  return NextResponse.json({ spaces }, { headers: { "Cache-Control": "no-store" } });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(20).optional(),
  visibility: z.enum(["PRIVATE", "WORKSPACE", "ORG"]).optional(),
  parentSpaceId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  linkedKraIds: z.array(z.string().min(1)).max(50).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
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
  // A sub-Space is made INSIDE its parent (the placement rule, node-rules
  // P1): the parent in this org, and Can edit or higher on it.
  if (parsed.data.parentSpaceId) {
    const parent = await getSpaceForReader(parsed.data.parentSpaceId, c.userId, c.accessLevel);
    if (!parent || parent.organizationId !== c.organizationId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canContributeSpace(parsed.data.parentSpaceId, c.userId, c.accessLevel))) {
      return NextResponse.json({ error: "You need Can edit on that Space to add a Space inside it." }, { status: 403 });
    }
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
      ownerId: parsed.data.ownerId,
      linkedKraIds: parsed.data.linkedKraIds,
      settings: parsed.data.settings,
    });
    // Seed a starter List so the Space is never empty (ClickUp parity).
    // Best-effort: a board failure must not fail Space creation.
    try {
      await createBoard({
        organizationId: c.organizationId,
        userId: c.userId,
        spaceId: space.id,
        name: "Tasks",
      });
    } catch (boardErr) {
      console.error("[Spaces POST] default list creation failed", boardErr);
    }
    return NextResponse.json({ space }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create Space" },
      { status: 400 },
    );
  }
}
