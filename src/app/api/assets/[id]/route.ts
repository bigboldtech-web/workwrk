import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { moveToTrash } from "@/lib/trash";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { resolveAssetReadScope } from "@/lib/assets/asset-query";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import type { Prisma } from "@/generated/prisma";

// Enum allowlists, the register UI now writes these directly, so reject a
// bad value with a 400 rather than letting Prisma throw a 500.
const ASSET_TYPES = new Set(["LAPTOP", "DESKTOP", "MONITOR", "PHONE", "TABLET", "KEYBOARD", "MOUSE", "HEADSET", "WEBCAM", "CHAIR", "DESK", "ID_CARD", "ACCESS_CARD", "VEHICLE", "OTHER"]);
const ASSET_CONDITIONS = new Set(["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"]);
const ASSET_STATUSES = new Set(["AVAILABLE", "ASSIGNED", "IN_REPAIR", "RETIRED", "LOST"]);

// GET /api/assets/[id]: one asset, through the same scope as the list. A
// person reads the kit they hold; anyone else needs the `assets` app key and
// the row inside their chain (or the whole org for the People team and
// Admin). Outside that, the row is a 404 exactly as the list would be: it
// used to answer any signed-in Member for any id in the org, serial, IMEI,
// notes and purchase cost included, while the list 404'd for them.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const asset = await prisma.asset.findFirst({
    where: { id, organizationId: orgId },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
    },
  });
  if (!asset) return jsonError("Asset not found", 404);

  // Own kit: the door every Member has (the profile's Assets tab).
  if (asset.assignedToId === callerId) return jsonSuccess(asset);

  const scope = await resolveAssetReadScope(session, { mine: false, requestedScope: "all", assignedToId: null });
  if ("error" in scope) return scope.error;
  if (!scope.canSeeAll) {
    // A manager: the row must be held by someone in their chain. The list
    // shows a manager no unassigned rows either, so neither does this.
    const inChain = await prisma.asset.count({ where: { ...scope.where, id } });
    if (inChain === 0) return jsonError("Asset not found", 404);
  }
  return jsonSuccess(asset);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // If body has assignedToId, this is an assign action, otherwise edit
  const body = await req.json();
  const action = body.assignedToId !== undefined ? "assign" : "edit";
  const denied = await requirePermission(session, "assets", action);
  if (denied) return denied;

  const { id } = await params;
  const orgId = getOrgId(session);

  const existing = await prisma.asset.findFirst({ where: { id, organizationId: orgId } });
  if (!existing) return jsonError("Asset not found", 404);

  // Validate enums the UI can set directly.
  if (body.type !== undefined && !ASSET_TYPES.has(body.type)) return jsonError("Invalid asset type");
  if (body.condition !== undefined && !ASSET_CONDITIONS.has(body.condition)) return jsonError("Invalid condition");
  if (body.status !== undefined && body.status && !ASSET_STATUSES.has(body.status)) return jsonError("Invalid status");
  // "Assigned" is what assigning does, never a word typed on its own: an
  // asset nobody holds cannot be saved as Assigned.
  if (body.status === "ASSIGNED" && !body.assignedToId && !(body.assignedToId === undefined && existing.assignedToId)) {
    return jsonError("Assign it to someone to mark it Assigned. Use Assign to on the row.", 400);
  }

  // Cross-org guard: a client-supplied assignee id must belong to THIS org,
  // or an attacker could point one org's asset at another org's user (and
  // trigger a notification + email to them). Same IDOR lesson as before.
  if (body.assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: body.assignedToId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!assignee) return jsonError("Assignee not found in your organization", 400);
  }

  const data: Prisma.AssetUncheckedUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.type !== undefined) data.type = body.type;
  if (body.brand !== undefined) data.brand = body.brand || null;
  if (body.model !== undefined) data.model = body.model || null;
  if (body.serialNumber !== undefined) data.serialNumber = body.serialNumber || null;
  if (body.imeiNumber !== undefined) data.imeiNumber = body.imeiNumber || null;
  if (body.purchaseDate !== undefined) data.purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : null;
  if (body.purchaseCost !== undefined) data.purchaseCost = body.purchaseCost ? parseFloat(body.purchaseCost) : null;
  if (body.warrantyExpiry !== undefined) data.warrantyExpiry = body.warrantyExpiry ? new Date(body.warrantyExpiry) : null;
  if (body.condition !== undefined) data.condition = body.condition;
  if (body.notes !== undefined) data.notes = body.notes || null;
  if (body.status !== undefined) data.status = body.status;

  // Handle assignment/unassignment
  if (body.assignedToId !== undefined) {
    if (body.assignedToId) {
      data.assignedToId = body.assignedToId;
      data.assignedAt = new Date();
      data.returnedAt = null;
      data.status = "ASSIGNED";
    } else {
      data.assignedToId = null;
      data.returnedAt = new Date();
      data.assignedAt = null;
      if (!body.status) data.status = "AVAILABLE";
    }
  }

  const updated = await prisma.asset.update({
    where: { id },
    data,
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Notify newly assigned user
  if (body.assignedToId !== undefined && body.assignedToId && body.assignedToId !== existing.assignedToId) {
    await prisma.notification.create({
      data: {
        userId: body.assignedToId,
        type: "asset_assigned",
        title: "Asset Assigned",
        message: `You have been assigned: ${updated.name}${updated.serialNumber ? ` (S/N: ${updated.serialNumber})` : ""}`,
        link: "/people/" + body.assignedToId,
      },
    });

    // Email the assignee
    try {
      const user = await prisma.user.findUnique({ where: { id: body.assignedToId }, select: { email: true, firstName: true } });
      if (user?.email) {
        const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
        const { subject, html } = genericNotificationTemplate({
          heading: "Asset Assigned to You",
          recipientName: user.firstName,
          subjectText: "A new company asset has been assigned to you.",
          itemTitle: updated.name,
          itemDetails: [
            updated.type?.replace("_", " "),
            updated.brand,
            updated.model,
            updated.serialNumber && `S/N: ${updated.serialNumber}`,
            updated.imeiNumber && `IMEI: ${updated.imeiNumber}`,
          ].filter(Boolean).join(" · "),
          actionLabel: "View Profile",
          actionLink: `${baseUrl}/people/${body.assignedToId}`,
        });
        sendEmail({
          to: user.email, subject, html,
          template: "asset-assigned",
          variables: { asset: updated.name },
          organizationId: orgId, userId: body.assignedToId, category: "reminder",
        }).catch((err) => console.error("[Asset] Email failed:", err));
      }
    } catch (err) { console.error("[Asset] Email setup failed:", err); }
  }

  return jsonSuccess(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "assets", "delete");
  if (denied) return denied;

  const { id } = await params;
  const orgId = getOrgId(session);
  // To Trash, not out of the database (spec-tools-misc 2.12): restorable for
  // the retention window. Another org's id is a 404, as before.
  const asset = await prisma.asset.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!asset) return jsonError("Asset not found", 404);
  const u = session.user as { id?: string; name?: string | null };
  await moveToTrash("asset", id, { organizationId: orgId, userId: u.id ?? null, userName: u.name ?? null });
  return jsonSuccess({ message: "Asset moved to Trash", trashed: true });
}
