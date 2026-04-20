import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

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

  const orgId = getOrgId(session);
  const body = await req.json();
  const { title, description, category, subcategory, steps } = body as {
    title: string;
    description?: string;
    category: string | null;
    subcategory?: string | null;
    steps: RecordedStep[];
  };

  if (!title?.trim()) {
    return jsonError("Title is required");
  }

  if (!steps || steps.length === 0) {
    return jsonError("No steps recorded");
  }

  // Build SOP content from recorded steps. `screenshot` is kept as-is
  // when it came in as a base64 data URL (legacy path); when the
  // extension uploaded to S3 it's null and `screenshotKey` holds the
  // object key. Read-side enrichment turns the key into a presigned
  // GET URL when serving the SOP.
  const content = {
    type: "recorded",
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

  const sop = await prisma.sOP.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      category: category?.trim() || null,
      subcategory: subcategory?.trim() || null,
      sopType: "RECORDED",
      content,
      status: "PUBLISHED",
      organizationId: orgId,
      publishedAt: new Date(),
    },
  });

  return jsonSuccess(sop, 201);
}
