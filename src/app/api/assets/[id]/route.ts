import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const asset = await prisma.asset.findFirst({
    where: { id, organizationId: getOrgId(session) },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
    },
  });

  if (!asset) return jsonError("Asset not found", 404);
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

  const data: any = {};
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
  await prisma.asset.deleteMany({ where: { id, organizationId: getOrgId(session) } });
  return jsonSuccess({ message: "Asset deleted" });
}
