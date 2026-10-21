// POST /api/docs, as a function of WHO is acting (docs/plans/mcp-server.md
// step 3).
//
// The MCP server's create_doc makes a doc AS the person who connected the
// app, who is not at the keyboard. It runs the exact path that person's own
// create runs: the anchor rules (docAnchorInput, the known kinds), the three
// placement checks (Can view, the parent's anchor, Can edit), the live-place
// check and the first version. So the route's body lives here, moved
// verbatim, and both callers come through it:
//
//   POST /api/docs     reads the session (resolveSuiteContext) and the JSON
//                      body, then hands both here
//   create_doc (src/lib/mcp/tools/write.ts)
//                      builds the person's context and hands it here
//
// The answer is the route's own NextResponse.
//
// Server-only: imports prisma.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canCreateDocAt } from "@/lib/doc-access";
import { canReadDocPlace, nodeCtxFromLevel } from "@/lib/access/node-access";
import { DOC_ANCHOR_REFUSAL, DOC_PARENT_EMPTY_REFUSAL, anchorAgreesWithParent, createRefusal, docAnchorInput, isDocAnchorKind } from "@/lib/access/node-rules";
import { docAnchorPlaceOf, docHomeOf, docPlaceLive } from "@/lib/access/node-placement";

/** Who is creating: the signed-in caller, or the person an app acts as. */
export interface DocCreateCtx {
  userId: string;
  orgId: string;
  accessLevel: string | null | undefined;
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.unknown().optional(),
  entityType: z.string().max(40).nullable().optional(),
  entityId: z.string().max(80).nullable().optional(),
  parentId: z.string().nullable().optional(),
  isFolder: z.boolean().optional(),
  position: z.number().optional(),
});

/**
 * Create one doc for `ctx`, exactly as POST /api/docs does. `body` is the
 * request's JSON (null when it did not parse); the answer is the route's
 * response, status and body included.
 */
export async function createDocAs(ctx: DocCreateCtx, body: unknown): Promise<NextResponse> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  // P3: a parent page is an id or nothing; an empty string once reached the
  // database as a foreign key and answered a bare 500 (round seven, item 4).
  if (parsed.data.parentId === "") {
    return NextResponse.json({ error: DOC_PARENT_EMPTY_REFUSAL, code: "invalid_parent", message: DOC_PARENT_EMPTY_REFUSAL }, { status: 400 });
  }
  // P3: both halves of the anchor or neither (docAnchorInput); a kind with an
  // empty id, or an id with no kind, was once stored as-is (round seven,
  // item 3). Then M2: a doc is made on an anchor the model knows
  // (DOC_ANCHOR_KINDS, exact case) or as a note. Any other string is refused
  // before anything is read: it once fell through R6's open fallback, so a
  // Member anchored a doc to a Folder, a table or a canvas they could not see
  // (round six, item 4).
  const anchorIn = docAnchorInput(parsed.data.entityType, parsed.data.entityId);
  if (!anchorIn.ok) return NextResponse.json({ error: anchorIn.error, code: "invalid_anchor", message: anchorIn.error }, { status: 400 });
  if (anchorIn.entityType && anchorIn.entityType !== "NOTEPAD" && !isDocAnchorKind(anchorIn.entityType)) {
    return NextResponse.json({ error: DOC_ANCHOR_REFUSAL, code: "invalid_anchor", message: DOC_ANCHOR_REFUSAL }, { status: 400 });
  }

  const content = (parsed.data.content as object) ?? {};

  // The placement rule (node-rules P1 and P3). A doc is made only where the
  // viewer can edit: Can edit or higher on its anchor (a Space, a Folder, a
  // List, a task's List) and on its parent page; Can view and Can comment
  // never create. A place the viewer cannot even read is the same 404 as one
  // that does not exist, so a guessed id confirms nothing. A sub-page lives
  // where its parent page lives: an anchor that disagrees with the parent's
  // is refused (a page of a Folder in one Space anchored to another Space).
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  const anchor = { entityType: anchorIn.entityType, entityId: anchorIn.entityId };
  const parentId = parsed.data.parentId ?? null;
  if (!(await canReadDocPlace(nodeCtx, anchor, parentId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (parentId && anchor.entityType && anchor.entityId) {
    const parentHome = await docHomeOf(ctx.orgId, { entityType: null, entityId: null, parentId });
    if (!anchorAgreesWithParent(anchor, parentHome)) {
      const message = "A sub-page lives where its parent page lives. Leave out the place, or pick the parent's.";
      return NextResponse.json({ error: message, code: "invalid_anchor", message }, { status: 400 });
    }
  }
  if (!(await docPlaceLive(ctx.orgId, { ...anchor, parentId }))) {
    const message = "That place is in Trash or gone, so nothing can be added to it.";
    return NextResponse.json({ error: message, code: "conflict", message }, { status: 400 });
  }
  if (!(await canCreateDocAt(nodeCtx, anchor, parentId))) {
    const place = parentId ? { kind: "doc" as const, id: parentId } : (await docAnchorPlaceOf(ctx.orgId, anchor)) ?? null;
    const message = createRefusal("doc", place);
    return NextResponse.json({ error: message, code: "forbidden", message }, { status: 403 });
  }

  const doc = await prisma.doc.create({
    data: {
      organizationId: ctx.orgId,
      title: parsed.data.title,
      content,
      entityType: anchor.entityType,
      entityId: anchor.entityId,
      parentId,
      isFolder: parsed.data.isFolder ?? false,
      // Default to a monotonically increasing position so new items land at
      // the bottom of their sibling list (sorted ascending in the tree).
      position: parsed.data.position ?? Date.now(),
      createdById: ctx.userId,
      // Snapshot v1 immediately so every Doc has at least one version.
      versions: {
        create: { version: 1, title: parsed.data.title, content, authorId: ctx.userId },
      },
    },
    select: { id: true, title: true, content: true, entityType: true, entityId: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ doc });
}
