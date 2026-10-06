// The Run history filters as a database query (spec-ai-automation section 2,
// /agents: GET /api/agents/runs?agentSlug=&trigger=&status=&from=&to=&cursor=
// &take=&sort=). Pure, so the route and the tests build the same WHERE.
//
// Who reads which runs (the rows carry tool results):
//   everyone, the Owner and Admins included, reads the autonomous runs (a
//   schedule or Run now) and the runs they triggered themselves. The rows a
//   chat with an agent writes (one per tool call, with its input and raw
//   result) are that person's chat, and nobody reads another person's chats
//   (spec-ai-automation 1.4). What a Member may see INSIDE an autonomous run
//   somebody else started is narrower again (run-view.ts redactRunFor).
//   A PRIVATE AI teammate's runs are its owner's alone, whatever started
//   them: anyone else reads none of them, an Admin included, exactly as they
//   cannot open the teammate (teammate-access.ts agentUsableWhere).
//
// An autonomous run stores its trigger in input.trigger; a chat run has
// none. Every JSON filter here is a positive match, because a negated JSON
// path comparison is null (not true) on a row that lacks the key, which
// would silently drop the chat runs it meant to keep.

import type { Prisma } from "@/generated/prisma";
import { agentUsableWhere } from "./teammate-access";

export type RunStatusFilter = "succeeded" | "failed" | "running";
export type RunTriggerFilter = "SCHEDULED" | "MANUAL";
export type RunSort = "newest" | "oldest";

export const RUN_STATUS_FILTERS: readonly RunStatusFilter[] = ["succeeded", "failed", "running"];
export const RUN_SORTS: readonly RunSort[] = ["newest", "oldest"];

const STATUS_VALUES: Record<RunStatusFilter, string[]> = {
  succeeded: ["SUCCEEDED", "SUCCESS", "COMPLETED"],
  failed: ["FAILED", "ERROR"],
  running: ["PENDING", "RUNNING"],
};

export interface RunQuery {
  agentSlug: string | null;
  statuses: RunStatusFilter[];
  trigger: RunTriggerFilter | null;
  from: Date | null;
  to: Date | null;
  sort: RunSort;
  take: number;
  cursor: string | null;
}

export const RUNS_MAX_TAKE = 100;
export const RUNS_DEFAULT_TAKE = 50;

type ParamsLike = { get(name: string): string | null };

function day(v: string | null, endOfDay: boolean): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Read the query string. Unknown values are dropped, never an error. */
export function parseRunQuery(sp: ParamsLike): RunQuery {
  const slug = sp.get("agentSlug") ?? sp.get("agent");
  const statuses = (sp.get("status") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is RunStatusFilter => (RUN_STATUS_FILTERS as readonly string[]).includes(s));
  const t = (sp.get("trigger") ?? "").toUpperCase();
  const takeRaw = parseInt(sp.get("take") ?? sp.get("limit") ?? "", 10);
  return {
    agentSlug: slug && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug) ? slug : null,
    statuses: [...new Set(statuses)],
    trigger: t === "SCHEDULED" || t === "MANUAL" ? t : null,
    from: day(sp.get("from"), false),
    to: day(sp.get("to"), true),
    sort: sp.get("sort") === "oldest" ? "oldest" : "newest",
    take: Math.min(RUNS_MAX_TAKE, Math.max(1, Number.isFinite(takeRaw) ? takeRaw : RUNS_DEFAULT_TAKE)),
    cursor: sp.get("cursor") && /^[A-Za-z0-9_-]{1,64}$/.test(sp.get("cursor") as string) ? sp.get("cursor") : null,
  };
}

const autonomous = (t: RunTriggerFilter): Prisma.AgentRunWhereInput => ({ input: { path: ["trigger"], equals: t } });

export function agentRunsWhere(q: RunQuery, viewer: { organizationId: string; userId: string; admin: boolean }): Prisma.AgentRunWhereInput {
  const and: Prisma.AgentRunWhereInput[] = [
    { agent: { organizationId: viewer.organizationId, ...(q.agentSlug ? { slug: q.agentSlug } : {}) } },
    // The same for every role: `admin` no longer widens it to other
    // people's chat rows.
    { OR: [autonomous("SCHEDULED"), autonomous("MANUAL"), { triggeredBy: viewer.userId }] },
    // A private teammate's runs: its owner's only (see the header).
    { agent: agentUsableWhere(viewer.userId) },
  ];
  if (q.trigger) and.push(autonomous(q.trigger));
  if (q.statuses.length > 0) and.push({ status: { in: q.statuses.flatMap((s) => STATUS_VALUES[s]) } });
  if (q.from || q.to) and.push({ startedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } });
  return { AND: and };
}

export function agentRunsOrder(sort: RunSort): Prisma.AgentRunOrderByWithRelationInput[] {
  const dir = sort === "oldest" ? "asc" : "desc";
  return [{ startedAt: dir }, { id: dir }];
}
