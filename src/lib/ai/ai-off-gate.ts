// The server half of "AI features for members" (settings.data.aiEnabled) for
// the model calls that sit outside the `ai` app key: the meeting summary
// (POST /api/ai), the palette summary (/api/ai/cmdk-summary), the Inbox
// suggestions (/api/ai/inbox-suggestion) and Build apps' Generate
// (/api/build/generate). The `ai` key itself (Ask AI, Agents) already
// resolves off through access rule 2, and run-due-agents skips the org.
//
// Answers 403 { error: "ai_off" } when the switch is off; null otherwise,
// including when the key or the whole settings blob is absent (default on).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";

export const AI_OFF_MESSAGE = "AI is turned off for this workspace.";

export async function aiOffResponse(organizationId: string): Promise<NextResponse | null> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
  if (aiEnabledFromSettings(org?.settings)) return null;
  return NextResponse.json({ error: "ai_off", message: AI_OFF_MESSAGE }, { status: 403 });
}
