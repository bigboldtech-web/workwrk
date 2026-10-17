// GET /api/teammate-browser/policy
// PUT /api/teammate-browser/policy { organizationId, enabled: boolean } or { organizationId, skillsEnabled: boolean }, exactly one
//
// The workspace switch for the computer for AI teammates, its two site
// lists and its usage (docs/plans/ai-teammates-phase4.md step 2, Decisions
// 3, 4, 28 and 30). Owners and Admins only (requireManageApps, the Apps &
// modules page's own gate). They see numbers, never anyone's browser, steps
// or pictures.
//
// TURNING ON needs this WorkwrK to offer the computer (503 not_configured),
// a live workspace (409 workspace_closed), no trial (403 trial) and Growth or
// above (403 plan), each its own refusal (Decision 33). Turning off always
// works and ends every browser in the workspace at once (`ended`).
//
// A CHANGE RE-READS THE ACTOR (the Phase 3 policy route's rule):
// freshWorkspaceActor, so an Admin demoted a moment ago changes nothing. The
// body names the workspace the page showed; a session switched in another
// tab answers 409 workspace_changed and changes nothing. What it was and
// what it is come from the same write, under the policy's lock
// (sessions.ts setComputerEnabled), so the audit row says this change.
//
// TEACHING BY SHOWING (docs/plans/ai-teammates-phase5.md Decision 2, step
// 2): `skillsEnabled`, the switch under the computer's, sent alone (both or
// neither is 400 invalid). Turning it on needs this WorkwrK to offer it (503
// not_offered) and the computer to be available here, answering the
// computer's own refusal as turning the computer on does; with the
// computer's own switch off it may be set, and means nothing until that is
// on. Turning it off stops every recording in the workspace at once, each
// kept as a draft (sessions.ts setSkillsEnabled, `stopped`), and writes one
// audit row when it changed.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { BROWSER_POLICY_COPY, BROWSER_ROUTE_ERRORS, CONNECTION_ROUTE_ERRORS, SKILL_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { requireManageApps } from "@/lib/app-gate";
import { authOptions } from "@/lib/auth";
import { skillsOffered } from "@/lib/browser/config";
import { browserPolicyView, setComputerEnabled, setSkillsEnabled, workspaceComputer } from "@/lib/browser/sessions";

// organizationId: optional in the schema only so that naming none answers
// workspace_changed below, never a bare 400 (the Phase 3 routes' rule).
const bodySchema = z
  .object({ organizationId: z.string().min(1).max(200).optional(), enabled: z.boolean().optional(), skillsEnabled: z.boolean().optional() })
  .strict()
  // Exactly one switch a request (Phase 5 step 2).
  .refine((b) => (b.enabled === undefined) !== (b.skillsEnabled === undefined));

export async function GET() {
  const gate = await requireManageApps("apps");
  if ("error" in gate) return gate.error;
  return NextResponse.json(await browserPolicyView(gate.viewer.organizationId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const gate = await requireManageApps("apps");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const fresh = await freshWorkspaceActor(await getServerSession(authOptions));
  if (!fresh.ok) return teammateError(fresh.status, fresh.code, fresh.error);
  if (!fresh.admin) return teammateError(403, "stale_session", CONNECTION_ROUTE_ERRORS.adminsOnly);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const org = viewer.organizationId;

  // An available computer (this WorkwrK offering it, a live workspace, no trial, the plan) before either switch goes on.
  const refusedOn = async (): Promise<Response | null> => {
    const w = await workspaceComputer(org);
    if (w.reason === "not_configured") return teammateError(503, "not_configured", BROWSER_ROUTE_ERRORS.notConfigured);
    if (w.reason === "workspace_closed") return teammateError(409, "workspace_closed", BROWSER_ROUTE_ERRORS.workspaceClosed);
    if (w.reason === "trial") return teammateError(403, "trial", BROWSER_ROUTE_ERRORS.trial);
    if (w.reason === "plan") return teammateError(403, "plan", BROWSER_ROUTE_ERRORS.plan);
    return null;
  };

  if (parsed.data.skillsEnabled !== undefined) {
    if (parsed.data.skillsEnabled) {
      if (!skillsOffered()) return teammateError(503, "not_offered", SKILL_ROUTE_ERRORS.notOffered);
      const no = await refusedOn();
      if (no) return no;
    }
    const changed = await setSkillsEnabled(org, parsed.data.skillsEnabled, viewer.userId);
    return NextResponse.json({ ...(await browserPolicyView(org)), stopped: changed.stopped }, { headers: { "Cache-Control": "no-store" } });
  }

  if (parsed.data.enabled) {
    const no = await refusedOn();
    if (no) return no;
  }

  const changed = await setComputerEnabled(org, parsed.data.enabled === true, viewer.userId);
  if (changed.before !== changed.after) {
    await logActivity({
      type: "teammate_browser.changed",
      actorId: viewer.userId,
      organizationId: org,
      description: BROWSER_POLICY_COPY.auditChanged(changed.after),
      targetId: org,
      targetType: "organization",
      oldValue: { enabled: changed.before },
      newValue: { enabled: changed.after },
      metadata: { ended: changed.ended },
      severity: changed.after ? "warning" : "info",
    });
  }
  return NextResponse.json({ ...(await browserPolicyView(org)), ended: changed.ended }, { headers: { "Cache-Control": "no-store" } });
}
