// GET /api/ai-apps/policy
// PUT /api/ai-apps/policy { organizationId } and exactly one of { enabled: boolean }, { addApp: string } or { removeApp: string }
//
// The workspace switch for AI apps (MCP) and its optional allow list
// (docs/plans/mcp-server.md Decision 9, 3.9, 6.3). A 404 while MCP_OFFERED
// is unset. Owners and Admins only (requireManageApps, the Apps & modules
// page's own gate), and a change re-reads the actor (freshWorkspaceActor),
// so an Admin demoted a moment ago changes nothing. The body names the
// workspace the page showed; another one answers 409 workspace_changed and
// changes nothing.
//
// GET re-reads the actor too, so a demoted Admin no longer reads the counts.
//
// Both answers name the workspace they were read in (organizationId, step
// 4): Settings, Apps & modules sends it back with every change, the rule of
// the sections beside it, so a change made from a page another tab's switch
// left behind answers workspace_changed instead of landing elsewhere.
//
// TURNING ON needs an open workspace (409 workspace_closed) and AI features
// on (409 ai_off). TURNING OFF always works and disconnects every AI app in
// the workspace at once; a list change disconnects every app it leaves out.
// Both under the policy lock (src/lib/mcp/policy-admin.ts), answering
// `revoked`.
//
// THE ALLOWED APPS CHANGE ONE APP AT A TIME (review of step 4, L2, the
// shape of /api/teammate-browser/policy/sites): addApp is parsed
// (parseAllowedApp, 400 invalid_app when it names no app) and added to the
// list as it is under the lock; removeApp takes the entry as stored (as
// parsed when it parses), so an entry a newer rule would refuse can still be
// taken away. So two Admins at once both keep their change, and a page's
// stale list never disconnects an app another Admin just allowed. Adding to
// a full list (50) is 400 too_many_apps and changes nothing. The whole-list
// form is gone: nothing else sent it. Every change writes one apps.mcp_changed audit row: what it was
// and what it is, and how many connections it ended; a request for what
// already is writes nothing, revokes nothing and audits nothing. Counts
// only, never who connected what.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { requireManageApps } from "@/lib/app-gate";
import { authOptions } from "@/lib/auth";
import { mcpOffered } from "@/lib/mcp/config";
import { MCP_POLICY_COPY as C } from "@/lib/mcp/mcp-copy";
import { ALLOWED_APPS_MAX, parseAllowedApp } from "@/lib/mcp/policy";
import { changeMcpAllowedApp, mcpPolicyAdminView, setMcpEnabled, turnOnRefusal, type PolicyChange } from "@/lib/mcp/policy-admin";
import { NO_STORE as OAUTH_NO_STORE, offNotFound } from "@/lib/oauth/oauth-errors";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

// organizationId: optional in the schema only so that naming none answers
// workspace_changed below, never a bare 400 (the Phase 3 routes' rule).
const bodySchema = z
  .object({
    organizationId: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    addApp: z.string().min(1).max(300).optional(),
    removeApp: z.string().min(1).max(300).optional(),
  })
  .strict()
  .refine((b) => [b.enabled, b.addApp, b.removeApp].filter((v) => v !== undefined).length === 1);

/** A removal's entry: as parsed when it parses, else as stored (trimmed, lower case), the sites route's rule. */
function removalEntry(raw: string): string {
  return parseAllowedApp(raw) ?? raw.trim().toLowerCase();
}

function refuse(status: number, code: string, error: string): NextResponse {
  return NextResponse.json({ error, code }, { status, headers: NO_STORE });
}

/** The Apps page's gate, then the actor re-read from the database (an Admin demoted a moment ago is refused). */
async function admin(): Promise<{ viewer: { userId: string; organizationId: string } } | { error: Response }> {
  const gate = await requireManageApps("apps");
  if ("error" in gate) return { error: gate.error };
  const fresh = await freshWorkspaceActor(await getServerSession(authOptions));
  if (!fresh.ok) return { error: refuse(fresh.status, fresh.code, fresh.error) };
  if (!fresh.admin) return { error: refuse(403, "stale_session", C.adminsOnly) };
  return { viewer: gate.viewer };
}

export async function GET() {
  if (!mcpOffered()) return offNotFound();
  const who = await admin();
  if ("error" in who) return who.error;
  return NextResponse.json({ organizationId: who.viewer.organizationId, ...(await mcpPolicyAdminView(who.viewer.organizationId)) }, { headers: NO_STORE });
}

async function audit(org: string, actorId: string, change: PolicyChange): Promise<void> {
  // A request for what already was wrote nothing, so it says nothing.
  if (!change.changed) return;
  const switched = change.before.enabled !== change.after.enabled;
  await logActivity({
    type: "apps.mcp_changed",
    actorId,
    organizationId: org,
    description: switched ? (change.after.enabled ? C.auditOn : C.auditOff) : C.auditList,
    targetId: org,
    targetType: "organization",
    oldValue: { enabled: change.before.enabled, allowedApps: change.before.allowedApps },
    newValue: { enabled: change.after.enabled, allowedApps: change.after.allowedApps },
    metadata: { revoked: change.revoked },
    severity: switched && change.after.enabled ? "warning" : "info",
  });
}

export async function PUT(req: Request) {
  if (!mcpOffered()) return offNotFound();
  const who = await admin();
  if ("error" in who) return who.error;
  const { viewer } = who;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse(400, "invalid", C.invalid);
  if (parsed.data.organizationId !== viewer.organizationId) return refuse(409, "workspace_changed", C.workspaceChanged);
  const org = viewer.organizationId;

  let change: PolicyChange;
  if (parsed.data.enabled !== undefined) {
    if (parsed.data.enabled) {
      const no = await turnOnRefusal(org);
      if (no === "workspace_closed") return refuse(409, "workspace_closed", C.workspaceClosed);
      if (no === "ai_off") return refuse(409, "ai_off", C.aiOff);
    }
    change = await setMcpEnabled(org, parsed.data.enabled, viewer.userId);
  } else if (parsed.data.addApp !== undefined) {
    const raw = parsed.data.addApp;
    const entry = parseAllowedApp(raw);
    if (!entry) return refuse(400, "invalid_app", C.badApp(raw.trim().slice(0, 100)));
    const out = await changeMcpAllowedApp(org, { add: entry }, viewer.userId);
    if (out.tooMany) return refuse(400, "too_many_apps", C.tooManyApps(ALLOWED_APPS_MAX));
    change = out;
  } else {
    change = await changeMcpAllowedApp(org, { remove: removalEntry(parsed.data.removeApp ?? "") }, viewer.userId);
  }
  await audit(org, viewer.userId, change);
  return NextResponse.json({ organizationId: org, ...(await mcpPolicyAdminView(org)), revoked: change.revoked }, { headers: NO_STORE });
}

/** Every other method: 404 while MCP_OFFERED is unset, else 405 (never Next's own 405). */
function other(): Response {
  if (!mcpOffered()) return offNotFound();
  return new Response(null, { status: 405, headers: { Allow: "GET, PUT", ...OAUTH_NO_STORE } });
}
export const HEAD = other;
export const POST = other;
export const PATCH = other;
export const DELETE = other;
export const OPTIONS = other;
