// /api/docs/[id]/sharing — read + update a doc's sharing config.
//
// The ONLY writer of settings.docSharing[docId] (Organization.settings
// Json — same read-modify-write pattern as /api/permissions). No schema
// change, no migration.
//
// GET   → { sharing: { restricted, members, publicUrl }, myRole, createdById }
// PATCH → same shape; body { members?, restricted?, publicLink? }
//   - members replaces the whole map (client sends the full record); the
//     creator's own id is stripped server-side so the owner can never
//     demote themselves.
//   - publicLink true mints (or keeps) the public secret; false revokes it.
//   - An entry with no members, no restricted flag and no public secret is
//     deleted entirely — byte-identical pre-feature settings state.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";
import {
  getDocSharingMap,
  newPublicSecret,
  resolveDocRole,
  type DocSharingEntry,
} from "@/lib/doc-sharing";

const patchSchema = z.object({
  members: z.record(z.string(), z.enum(["view", "edit"])).optional(),
  restricted: z.boolean().optional(),
  publicLink: z.boolean().optional(),
});

function sharingPayload(entry: DocSharingEntry | undefined, docId: string) {
  return {
    restricted: !!entry?.restricted,
    members: entry?.members ?? {},
    publicUrl: entry?.publicSecret ? `/share/doc/${docId}.${entry.publicSecret}` : null,
  };
}

async function loadDoc(id: string, orgId: string) {
  return prisma.doc.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, createdById: true, entityType: true, entityId: true, archivedAt: true },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const doc = await loadDoc(id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { settings: true },
  });
  const entry = getDocSharingMap(org?.settings)[id];
  const role = resolveDocRole(entry, {
    userId: ctx.userId,
    accessLevel: ctx.accessLevel,
    createdById: doc.createdById,
  });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    sharing: sharingPayload(entry, id),
    myRole: role,
    createdById: doc.createdById,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const doc = await loadDoc(id, ctx.orgId);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Re-read settings fresh inside the handler (read-modify-write, the
  // /api/permissions pattern) so we merge on top of the latest state.
  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { settings: true },
  });
  const settings =
    org?.settings && typeof org.settings === "object" && !Array.isArray(org.settings)
      ? (org.settings as Record<string, unknown>)
      : {};
  const map = { ...getDocSharingMap(settings) };
  const prev = map[id];

  const role = resolveDocRole(prev, {
    userId: ctx.userId,
    accessLevel: ctx.accessLevel,
    createdById: doc.createdById,
  });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (role !== "edit") return NextResponse.json({ error: "read-only" }, { status: 403 });

  const next: DocSharingEntry = { ...prev };

  if (parsed.data.members !== undefined) {
    const members = { ...parsed.data.members };
    // The owner can never demote themselves — strip their id.
    if (doc.createdById) delete members[doc.createdById];
    next.members = members;
  }
  if (parsed.data.restricted !== undefined) {
    if (parsed.data.restricted) next.restricted = true;
    else delete next.restricted;
  }
  if (parsed.data.publicLink !== undefined) {
    if (parsed.data.publicLink) {
      if (!next.publicSecret) {
        next.publicSecret = newPublicSecret();
        next.publicCreatedAt = new Date().toISOString();
      }
    } else {
      delete next.publicSecret;
      delete next.publicCreatedAt;
    }
  }

  const hasMembers = !!next.members && Object.keys(next.members).length > 0;
  if (!hasMembers && !next.restricted && !next.publicSecret) {
    // Fully unshared — remove the entry so settings stay lean and the
    // doc returns to literal pre-feature semantics.
    delete map[id];
  } else {
    if (next.members && Object.keys(next.members).length === 0) delete next.members;
    map[id] = next;
  }

  await prisma.organization.update({
    where: { id: ctx.orgId },
    data: { settings: { ...settings, docSharing: map } as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({
    sharing: sharingPayload(map[id], id),
    myRole: role,
    createdById: doc.createdById,
  });
}
