// The server half of "AI features for everyone" (settings.data.aiEnabled) for
// every model call outside the `ai` app key: EVERY route that sends workspace
// content to the model provider calls this first, so the privacy policy's
// "an Owner or Admin can turn AI features off for the whole workspace" is
// true (src/app/(marketing)/privacy/page.tsx section 3). The `ai` key itself
// (Ask AI, Agents) resolves off through access rule 2, run-due-agents skips
// the org, the AI fields and Talk updates read src/lib/ai/ai-features.ts. A
// new model call that skips this is a broken promise to every customer.
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
