import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { sendWebhook } from "@/lib/webhooks";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const integration = await prisma.integration.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!integration) return jsonError("Integration not found", 404);

  const config = integration.config as any;
  if (!config?.webhookUrl) {
    return jsonError("No webhook URL configured for this integration");
  }

  // Send test payload
  await sendWebhook({
    integrationId: integration.id,
    event: "test",
    payload: {
      message: "This is a test webhook from TheywrK",
      integration: integration.name,
      timestamp: new Date().toISOString(),
    },
  });

  // Check if it succeeded
  const lastLog = await prisma.webhookLog.findFirst({
    where: { integrationId: integration.id, event: "test" },
    orderBy: { createdAt: "desc" },
  });

  if (lastLog?.status === "sent") {
    return jsonSuccess({ success: true, message: "Test webhook sent successfully" });
  }

  return jsonSuccess({
    success: false,
    message: `Test webhook failed: ${lastLog?.error || "Unknown error"}`,
    responseCode: lastLog?.responseCode,
  });
}
