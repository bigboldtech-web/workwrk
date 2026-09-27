// /api/docs/[id]/sharing: read and change a doc's general access.
//
// GET   { sharing: { restricted, members, publicUrl }, myRole, createdById }
// PATCH the same shape back; body { restricted?, publicLink?, members? }
//
// Who can open a doc is decided by the one node-access resolver
// (src/lib/access/node-access.ts), and the people on a doc are changed only
// through the Manage access dialog (POST and DELETE
// /api/access/doc/:id/grants, src/lib/access/grants.ts). This route keeps the
// two general switches and the shape its older client reads:
//   - restricted and publicLink go through grants.setDocGeneral: the
//     Organization row is locked, exactly one doc's entry is rewritten, and
//     the change is recorded as access activity in the same transaction;
//   - members is the stored rollback projection, read only. A client that
//     sends it back unchanged is fine; one that sends a different map is a
//     page loaded before the dialog changed, and it is refused with 409
//     stale_client instead of overwriting everyone else's grants.
//   - publicUrl goes only to people who can change the doc's sharing (Can
//     edit or higher); everyone else reads null.
// Changing either switch needs Can edit or higher (today's doc sharing rule).

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { docAccess } from "@/lib/doc-access";
import { nodeCtxFromSession } from "@/lib/access/node-access";
import { docSharingEntries } from "@/lib/access/access-grant-store";
import { GrantError, setDocGeneral } from "@/lib/access/grants";
import type { DocSharingFact } from "@/lib/access/node-rules";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const patchSchema = z.object({
  members: z.record(z.string(), z.enum(["view", "edit"])).optional(),
  restricted: z.boolean().optional(),
  publicLink: z.boolean().optional(),
});

function sharingPayload(entry: DocSharingFact | undefined, docId: string, canShare: boolean) {
  return {
    restricted: !!entry?.restricted,
    members: entry?.members ?? {},
    publicUrl: canShare && entry?.publicSecret ? `/share/doc/${docId}.${entry.publicSecret}` : null,
  };
}

/** Two members maps say the same thing, the creator's own row aside (the older server stripped it). */
function sameMembers(a: Record<string, string>, b: Record<string, string>, creatorId: string | null): boolean {
  const norm = (m: Record<string, string>) =>
    Object.entries(m)
      .filter(([k]) => k !== creatorId)
      .sort(([x], [y]) => x.localeCompare(y));
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

async function loadDoc(id: string, orgId: string) {
  return prisma.doc.findFirst({ where: { id, organizationId: orgId }, select: { id: true, createdById: true } });
}

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const doc = await loadDoc(id, ctx.organizationId);
  if (!doc) return notFound();
  const access = await docAccess(ctx, doc.id);
  if (!access) return notFound();
  const entry = (await docSharingEntries(ctx.organizationId, [doc.id])).get(doc.id);

  return NextResponse.json(
    { sharing: sharingPayload(entry, doc.id, access.canShare), myRole: access.legacy, createdById: doc.createdById },
    { headers: NO_STORE },
  );
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const doc = await loadDoc(id, ctx.organizationId);
  if (!doc) return notFound();
  const access = await docAccess(ctx, doc.id);
  if (!access) return notFound();
  // An Agent who can share shares, as this gate let them before node-access (A8).
  if (!access.canShare) return NextResponse.json({ error: "read-only" }, { status: 403 });

  if (parsed.data.members !== undefined) {
    const stored = (await docSharingEntries(ctx.organizationId, [doc.id])).get(doc.id)?.members ?? {};
    if (!sameMembers(parsed.data.members, stored, doc.createdById)) {
      return NextResponse.json(
        { error: "stale_client", message: "Reload the page to change who has access." },
        { status: 409, headers: NO_STORE },
      );
    }
  }

  const { restricted, publicLink } = parsed.data;
  if (restricted !== undefined || publicLink !== undefined) {
    try {
      await setDocGeneral(ctx, doc.id, { restricted, publicLink });
    } catch (err) {
      if (err instanceof GrantError) {
        return NextResponse.json({ error: err.code, message: err.message }, { status: err.status, headers: NO_STORE });
      }
      const raw = err instanceof Error ? err.message : String(err);
      console.error(`[docs/sharing] PATCH ${doc.id} failed: ${raw}`);
      return NextResponse.json({ error: "server_error", message: "Could not save. Your changes are kept." }, { status: 500, headers: NO_STORE });
    }
  }

  const entry = (await docSharingEntries(ctx.organizationId, [doc.id])).get(doc.id);
  return NextResponse.json(
    { sharing: sharingPayload(entry, doc.id, true), myRole: access.legacy, createdById: doc.createdById },
    { headers: NO_STORE },
  );
}
