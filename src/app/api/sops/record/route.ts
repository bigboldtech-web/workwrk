import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, requirePermission, hasPermission } from "@/lib/api-helpers";
import { checkPlanLimit } from "@/lib/plan-limits";

interface RecordedStep {
  order: number;
  action: string;
  description: string;
  url: string;
  // One of these two will be set. `screenshotKey` means the image was
  // uploaded to S3 by the extension (preferred — keeps JSON small).
  // `screenshot` (base64 data URL) is the fallback when S3 isn't
  // configured or the upload failed.
  screenshot: string | null;
  screenshotKey?: string | null;
  elementText: string;
  elementTag: string;
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // Same gates as POST /api/sops — the extension is just another
  // SOP-creating client and must not bypass permissions or plan limits.
  const denied = await requirePermission(session, "sops", "create");
  if (denied) return denied;

  const orgId = getOrgId(session);

  const planCheck = await checkPlanLimit(orgId, "sops");
  if (!planCheck.allowed) return jsonError(planCheck.message, 403);

  const body = await req.json();
  const { title, description, category, subcategory, steps, clientSessionId } = body as {
    title: string;
    description?: string;
    category: string | null;
    subcategory?: string | null;
    steps: RecordedStep[];
    clientSessionId?: string;
  };

  if (!title?.trim()) {
    return jsonError("Title is required");
  }

  if (!steps || steps.length === 0) {
    return jsonError("No steps recorded");
  }

  // Idempotency: the extension stamps each recording session with a client
  // id and re-sends it on retry. If the first POST succeeded but its
  // response was lost (popup closed, network blip), the retry must return
  // the already-created SOP instead of minting a duplicate.
  const sessionId = typeof clientSessionId === "string" && clientSessionId.trim() ? clientSessionId.trim().slice(0, 64) : null;
  if (sessionId) {
    const existing = await prisma.sOP.findFirst({
      where: {
        organizationId: orgId,
        sopType: "RECORDED",
        content: { path: ["clientSessionId"], equals: sessionId },
      },
      select: { id: true, title: true, status: true },
    });
    if (existing) return jsonSuccess(existing, 201);
  }

  // Build SOP content from recorded steps. `screenshot` is kept as-is
  // when it came in as a base64 data URL (legacy path); when the
  // extension uploaded to S3 it's null and `screenshotKey` holds the
  // object key. Read-side enrichment turns the key into a presigned
  // GET URL when serving the SOP.
  const content = {
    type: "recorded",
    ...(sessionId ? { clientSessionId: sessionId } : {}),
    steps: steps.map((step) => ({
      order: step.order,
      action: step.action,
      description: step.description,
      url: step.url,
      screenshot: step.screenshot ?? null,
      screenshotKey: step.screenshotKey ?? null,
      elementText: step.elementText,
      elementTag: step.elementTag,
    })),
  };

  // Publishing is a separate capability from creating. Callers without
  // it still get their recording saved — as a DRAFT a publisher can
  // review. The returned sop.status tells the extension popup which
  // outcome happened.
  const canPublish = await hasPermission(session, "sops", "publish");

  const sop = await prisma.sOP.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      category: category?.trim() || null,
      subcategory: subcategory?.trim() || null,
      sopType: "RECORDED",
      content,
      status: canPublish ? "PUBLISHED" : "DRAFT",
      organizationId: orgId,
      createdById: getUserId(session),
      publishedAt: canPublish ? new Date() : null,
      publishedBy: canPublish ? getUserId(session) : null,
    },
  });

  return jsonSuccess(sop, 201);
}
