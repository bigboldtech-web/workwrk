import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

interface RecordedStep {
  order: number;
  action: string;
  description: string;
  url: string;
  screenshot: string | null;
  elementText: string;
  elementTag: string;
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();
  const { title, category, steps } = body as {
    title: string;
    category: string | null;
    steps: RecordedStep[];
  };

  if (!title?.trim()) {
    return jsonError("Title is required");
  }

  if (!steps || steps.length === 0) {
    return jsonError("No steps recorded");
  }

  // Build SOP content from recorded steps
  // Store steps as structured JSON in the content field
  const content = {
    type: "recorded",
    steps: steps.map((step) => ({
      order: step.order,
      action: step.action,
      description: step.description,
      url: step.url,
      screenshot: step.screenshot, // base64 data URL
      elementText: step.elementText,
      elementTag: step.elementTag,
    })),
  };

  const sop = await prisma.sOP.create({
    data: {
      title: title.trim(),
      description: `Recorded SOP with ${steps.length} steps`,
      category: category?.trim() || null,
      sopType: "RECORDED",
      content,
      status: "PUBLISHED",
      organizationId: orgId,
      publishedAt: new Date(),
    },
  });

  return jsonSuccess(sop, 201);
}
