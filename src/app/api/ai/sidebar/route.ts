// GET /api/ai/sidebar: the AI hub sidebar's live data in one call
// (spec-ai-automation section 1.2), so the sidebar never fans out.
//
// { chats, chatsTotal, agentsEnabled, workflowsActive, runsFailed24h,
//   usableBuildApps, teammatesWaiting, teammatesUnread }
//
// usableBuildApps is the number of Build apps the viewer may open: the Member
// exception (src/lib/build/gate.ts) keeps a Member using the org's live apps
// and their own, so the APPS > Build apps row renders for them too.
//
// Each field is scoped by the gate of the app it belongs to: a field whose
// app the viewer cannot open comes back as zero (or an empty list), so the
// sidebar never learns an org-wide number it would not render. Chats are the
// viewer's own Ask AI chats and nobody else's: a chat with an AI teammate is
// not one of them (src/lib/agents/session-guard.ts).
//
// AI teammates (docs/plans/ai-teammates.md 3.15): agentsEnabled counts only
// the agents this viewer may use (another person's private teammate is not
// counted); teammatesWaiting is what waits for this viewer's own approval,
// and teammatesUnread says a teammate they may use answered or reported
// since they last read its chat.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/access/index";
import { viewerFromSession } from "@/lib/access/viewer";
import { countUsableBuildApps } from "@/lib/build/gate";
import { waitingCount } from "@/lib/agents/actions";
import { ASK_AI_CHATS } from "@/lib/agents/session-guard";
import { agentUsableWhere } from "@/lib/agents/teammate-access";
import { anyTeammateUnread } from "@/lib/agents/teammate-server";
import { anyGroupUnread } from "@/lib/agents/group-server";

export const dynamic = "force-dynamic";

const CHAT_ROWS = 15;

export async function GET() {
  const viewer = await viewerFromSession();
  if (!viewer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = viewer.organizationId;

  const [ai, automation] = await Promise.all([
    can(viewer, "view", { type: "app", key: "ai" }),
    can(viewer, "view", { type: "app", key: "automation" }),
  ]);
  // Guests never discover the AI hub (access 5.5 item 2): a body identical
  // to any other 404. A hub with neither key open answers the same way.
  if (!ai.allowed && !automation.allowed) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [chats, chatsTotal, agentsEnabled, workflowsActive, runsFailed24h, usableBuildApps, teammatesWaiting, teammatesUnread] = await Promise.all([
    ai.allowed
      ? prisma.chatSession.findMany({
          // A chat with no messages (a send that never reached the server)
          // is not a row; /api/sidekick/sessions applies the same rule.
          where: { organizationId: orgId, userId: viewer.userId, ...ASK_AI_CHATS, archivedAt: null, messages: { some: {} } },
          select: { id: true, title: true, pinned: true, updatedAt: true },
          orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
          take: CHAT_ROWS,
        })
      : Promise.resolve([]),
    ai.allowed
      ? prisma.chatSession.count({ where: { organizationId: orgId, userId: viewer.userId, ...ASK_AI_CHATS, archivedAt: null, messages: { some: {} } } })
      : Promise.resolve(0),
    ai.allowed ? prisma.agent.count({ where: { organizationId: orgId, status: "ENABLED", ...agentUsableWhere(viewer.userId) } }) : Promise.resolve(0),
    automation.allowed
      ? prisma.automationWorkflow.count({ where: { organizationId: orgId, status: "ACTIVE" } })
      : Promise.resolve(0),
    automation.allowed
      ? prisma.automationRun.count({ where: { organizationId: orgId, status: "FAILED", startedAt: { gte: since } } })
      : Promise.resolve(0),
    viewer.orgRole === "GUEST"
      ? Promise.resolve(0)
      : countUsableBuildApps(orgId, viewer.userId),
    // Teammates' only: Ask AI's own requests wait on cards in their chats.
    ai.allowed ? waitingCount(orgId, viewer.userId, new Date(), { teammatesOnly: true }) : Promise.resolve(0),
    // A teammate's chat or a group chat with an answer not yet read.
    ai.allowed ? Promise.all([anyTeammateUnread(viewer), anyGroupUnread(viewer)]).then(([one, group]) => one || group) : Promise.resolve(false),
  ]);

  return NextResponse.json(
    {
      chats: chats.map((c) => ({ id: c.id, title: c.title ?? "Untitled chat", pinned: c.pinned, updatedAt: c.updatedAt.toISOString() })),
      chatsTotal,
      agentsEnabled,
      workflowsActive,
      runsFailed24h,
      usableBuildApps,
      teammatesWaiting,
      teammatesUnread,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
