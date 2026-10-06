// The agents the old autonomous loop and the Workspace agents tab act on:
// every agent made before AI teammates, never one made as a teammate (whose
// toolNames is set). Server-only.
//
// WHY. A teammate run through the old loop (Run now, a schedule set in
// Workspace agents, the cron's legacy pass) would skip everything that makes
// it a teammate: its approval cards (the old loop calls handlers directly),
// its own tool set (the old loop uses the Ask AI set), and its monthly limit
// (the old loop claims a plain question). Review round 1 found an invitation
// sent that way with no card. So the old routes and the cron see only these;
// a teammate runs through its chat and its routines.

import { Prisma } from "@/generated/prisma";

export const LEGACY_AGENT: Prisma.AgentWhereInput = { toolNames: { equals: Prisma.DbNull } };
