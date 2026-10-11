// The teammate a browser call is for, and whether its turn may use the
// computer now (docs/plans/ai-teammates-phase4.md step 2, used by step 3's
// tools and the engine). Read fresh on every call, never taken from the
// start of a long turn: a manager pausing the teammate, or changing its
// sites, stops the next call.
//
// Server-only: imports prisma.

import { prisma } from "@/lib/prisma";
import { computerAccess, type ComputerRefusal } from "@/lib/browser/sessions";
import type { ActingPerson } from "./acting";
import { isBrowserToolName } from "./tool-names";

export const COMPUTER_AGENT_SELECT = { id: true, name: true, status: true, browserSites: true, toolNames: true } as const;

export interface ComputerAgent {
  id: string;
  name: string;
  status: string;
  browserSites: string[];
  /**
   * Whether its stored tools hold any browser tool (step 2: the sweep ends a
   * session whose teammate lost them, Decision 6). The stored list, as the
   * teammate's managers ticked it, whatever is offered now.
   */
  browserTools: boolean;
}

/** The stored tools hold a browser tool: a list of names with one in it. A legacy agent (no list) has none. */
export function holdsBrowserTool(toolNames: unknown): boolean {
  return Array.isArray(toolNames) && toolNames.some((n) => typeof n === "string" && isBrowserToolName(n));
}

export function computerAgentFrom(row: { id: string; name: string; status: string; browserSites: unknown; toolNames: unknown }): ComputerAgent {
  return {
    id: row.id,
    name: row.name,
    status: String(row.status),
    browserSites: Array.isArray(row.browserSites) ? row.browserSites.filter((s): s is string => typeof s === "string") : [],
    browserTools: holdsBrowserTool(row.toolNames),
  };
}

/** The teammate, ENABLED and in this workspace, read now; null otherwise (paused, removed, another workspace's). */
export async function computerAgentById(organizationId: string, agentId: string): Promise<ComputerAgent | null> {
  if (typeof agentId !== "string" || !agentId) return null;
  const row = await prisma.agent.findFirst({ where: { id: agentId, organizationId, status: "ENABLED" }, select: COMPUTER_AGENT_SELECT });
  return row ? computerAgentFrom(row) : null;
}

/** "teammate_off": the teammate is paused, removed, another workspace's, or holds no browser tool. */
export type BrowserTurnRefusal = ComputerRefusal | "teammate_off";

export type BrowserTurnAccess = { ok: true; sites: string[] } | { ok: false; reason: BrowserTurnRefusal };

/**
 * Whether this turn may be offered the browser for this person and
 * teammate, and the sites it may open (block 2 lists them, step 3), each
 * refusal its own (Decision 33).
 */
export async function browserTurnAccess(a: { person: Pick<ActingPerson, "organizationId">; agentId: string }): Promise<BrowserTurnAccess> {
  const agent = await computerAgentById(a.person.organizationId, a.agentId);
  if (!agent || !agent.browserTools) return { ok: false, reason: "teammate_off" };
  const access = await computerAccess({ organizationId: a.person.organizationId, agent });
  if (!access.ok) return { ok: false, reason: access.reason };
  return { ok: true, sites: access.sites };
}
