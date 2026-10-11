// GET /api/teammate-browser/teammates/[slug]/sites
// PUT /api/teammate-browser/teammates/[slug]/sites { organizationId, add?: string, remove?: string }
//
// A teammate's own allowed sites (docs/plans/ai-teammates-phase4.md Decision
// 9): chosen by its managers only from the workspace's allow list, never one
// the block list covers. Anyone who may use the teammate reads them; only its
// managers change them (403 not_manager), one change per request under a
// lock on its Agent row (sessions.ts changeTeammateSite; the Phase 3 step 5
// rule: a stale page never writes a whole list back).
//
// Its sites are part of what a person's Google allow covers (teammate-print.ts
// "sites"): changing them stops the allow until the person allows it again.
// Another person's private teammate is the same 404 as a missing one.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Viewer } from "@/lib/access/types";
import { logActivity } from "@/lib/activity";
import { canManageAgent } from "@/lib/agents/teammate-access";
import { BROWSER_POLICY_COPY, BROWSER_ROUTE_ERRORS, BROWSER_SITES_COPY, CONNECTION_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, loadTeammate, notManager, teammateError, teammateNotFound, type TeammateRecord } from "@/lib/agents/teammate-server";
import { requireApp } from "@/lib/app-gate";
import { browserConfig, fixtureSuffixFor } from "@/lib/browser/config";
import { workspaceSitesOf } from "@/lib/browser/policy";
import { changeTeammateSite, SITE_LIST_MAX, workspaceComputer } from "@/lib/browser/sessions";
import { appHostsFrom, entryMatches, parseSiteEntry } from "@/lib/browser/sites";

type Params = { params: Promise<{ slug: string }> };

const bodySchema = z
  .object({
    organizationId: z.string().min(1).max(200).optional(),
    add: z.string().min(1).max(2000).optional(),
    remove: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .refine((v) => (v.add === undefined) !== (v.remove === undefined));

function sitesOf(agent: { browserSites: unknown }): string[] {
  return Array.isArray(agent.browserSites) ? agent.browserSites.filter((s): s is string => typeof s === "string") : [];
}

async function body(agent: TeammateRecord, viewer: Viewer, sites: string[]) {
  const [workspace, w] = await Promise.all([workspaceSitesOf(viewer.organizationId), workspaceComputer(viewer.organizationId)]);
  return { workspaceSites: [...workspace.allow], blockSites: [...workspace.block], sites, canManage: canManageAgent(agent, viewer), available: w.available };
}

export async function GET(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const agent = await loadTeammate((await params).slug, viewer);
  if (!agent) return teammateNotFound();
  return NextResponse.json(await body(agent, viewer, sitesOf(agent)), { headers: { "Cache-Control": "no-store" } });
}

/** An entry's own host: "*.example.com" and "example.com" are both "example.com". */
function baseOf(entry: string): string {
  return entry.startsWith("*.") ? entry.slice(2) : entry;
}

export async function PUT(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const agent = await loadTeammate((await params).slug, viewer);
  if (!agent) return teammateNotFound();
  if (!canManageAgent(agent, viewer)) return notManager();

  const rules = { appHosts: appHostsFrom(process.env), fixtureSuffix: fixtureSuffixFor(browserConfig()) };
  const raw = parsed.data.add ?? parsed.data.remove ?? "";
  const read = parseSiteEntry(raw, rules);
  const entry = read.ok ? read.entry : raw.trim().toLowerCase();
  let change: { add: string } | { remove: string };
  if (parsed.data.add !== undefined) {
    // Only from the workspace's list as it is now, never one it blocks.
    const workspace = await workspaceSitesOf(viewer.organizationId);
    if (!read.ok || !workspace.allow.includes(entry)) return teammateError(409, "not_in_workspace_list", BROWSER_ROUTE_ERRORS.notInWorkspaceList(entry));
    if (workspace.block.some((b) => entryMatches(b, baseOf(entry)))) return teammateError(409, "blocked", BROWSER_ROUTE_ERRORS.blocked(entry));
    change = { add: entry };
  } else {
    // Taking a site away always works, whatever the lists say now.
    change = { remove: entry };
  }

  const out = await changeTeammateSite(agent.id, viewer.organizationId, change);
  if (!out) return teammateNotFound();
  if (out.tooMany) return teammateError(409, "too_many", BROWSER_POLICY_COPY.tooMany(SITE_LIST_MAX.teammate));
  if (out.changed) {
    const added = "add" in change;
    await logActivity({
      type: "teammate_browser.sites_changed",
      actorId: viewer.userId,
      organizationId: viewer.organizationId,
      description: BROWSER_SITES_COPY.auditChanged(agent.name, entry, added),
      targetId: agent.id,
      targetType: "agent",
      metadata: { agentId: agent.id, agentSlug: agent.slug, site: entry, added },
      severity: added ? "warning" : "info",
    });
  }
  return NextResponse.json({ ...(await body(agent, viewer, out.sites)), changed: out.changed }, { headers: { "Cache-Control": "no-store" } });
}
