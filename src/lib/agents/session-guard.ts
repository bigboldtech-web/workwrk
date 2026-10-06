// Ask AI and AI teammates, kept apart (docs/plans/ai-teammates.md 3.15).
//
// A TEAMMATE chat (ChatSession.kind "TEAMMATE") is one person's chat with an
// AI teammate. Its turns run through the teammate engine, which acts as the
// person and asks before anything other people will see; Ask AI's loop runs
// its tools without asking. So Ask AI never lists, opens or runs one: its
// lists and its session routes read only ASK_AI_CHATS (kind null, every chat
// made before teammates), and its two chat routes answer a teammate chat
// with 409 use_teammate_chat.
//
// An Ask AI chat bound to an agent (agentId) speaks as that agent only while
// it is on and the person may still use it (canUseAgent). An agent that has
// since become someone else's private teammate, or one that is paused or
// removed, leaves the chat running as plain Ask AI: no persona, no product
// tools, never the agent's instructions.
//
// Pure: next/server for the refusal, and teammate-access.ts and
// teammate-copy.ts, which import nothing that reads the database.

import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { canUseAgent, type TeammateAccessRow, type TeammateViewer } from "./teammate-access";
import { TEAMMATE_ERRORS } from "./teammate-copy";

/** The chats Ask AI lists and opens: never a teammate's. Spread into a ChatSession where. */
export const ASK_AI_CHATS = { kind: null } satisfies Prisma.ChatSessionWhereInput;

/** The refusal's machine code. */
export const USE_TEAMMATE_CHAT = "use_teammate_chat";

/**
 * 409 for a chat Ask AI must not run: a teammate's (any kind but Ask AI's
 * own null, so a kind added later is refused rather than run ungated). Null
 * for an Ask AI chat.
 */
export function teammateChatRefusal(chat: { kind?: string | null }): NextResponse | null {
  if (chat.kind === null || chat.kind === undefined) return null;
  return NextResponse.json({ error: TEAMMATE_ERRORS.useTeammateChat, code: USE_TEAMMATE_CHAT }, { status: 409 });
}

/**
 * The agent an Ask AI chat speaks as: the chat's agent while it is ENABLED
 * and this person may use it, else null (plain Ask AI).
 */
export function askAiAgent<A extends TeammateAccessRow & { status: string }>(
  agent: A | null | undefined,
  viewer: TeammateViewer,
): A | null {
  return agent && agent.status === "ENABLED" && canUseAgent(agent, viewer) ? agent : null;
}
