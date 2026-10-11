// POST /api/teammate-browser/policy/sites { organizationId, list: "allow" | "block", add?: string, remove?: string }
//
// One site added to or removed from the workspace's allow list (the sites
// teammates may open, the ceiling) or its block list (never opened)
// (docs/plans/ai-teammates-phase4.md Decision 9). Owners and Admins, read
// fresh. Exactly one change per request, as one statement under the policy's
// lock (sessions.ts changePolicySite), so two Admins at once never lose each
// other's change and the audit row says exactly this one; a change that
// changes nothing writes no audit row.
//
// AN ADDED SITE IS PARSED (sites.ts parseSiteEntry): a pasted address gives
// its host; numbers, private and internal names, WorkwrK's own hosts, a port,
// a user name or password and a star over strangers' sites are refused, 400
// bad_site with the problem. A removal takes the entry as stored, so an entry
// a newer rule would refuse can still be taken away. 60 changes a minute per
// person (429 rate_limited).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { BROWSER_POLICY_COPY, BROWSER_ROUTE_ERRORS, CONNECTION_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { requireManageApps } from "@/lib/app-gate";
import { authOptions } from "@/lib/auth";
import { browserConfig, fixtureSuffixFor } from "@/lib/browser/config";
import { browserPolicyView, changePolicySite, SITE_LIST_MAX } from "@/lib/browser/sessions";
import { appHostsFrom, parseSiteEntry } from "@/lib/browser/sites";
import { rateLimit } from "@/lib/rate-limit-memory";

const bodySchema = z
  .object({
    organizationId: z.string().min(1).max(200).optional(),
    list: z.enum(["allow", "block"]),
    add: z.string().min(1).max(2000).optional(),
    remove: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .refine((v) => (v.add === undefined) !== (v.remove === undefined));

/** Changes one person may make a minute. */
const PER_MINUTE = 60;

/** A removal's entry: as parsed when it parses, else as stored (trimmed, lower case). */
function removalEntry(raw: string, o: { appHosts: string[]; fixtureSuffix: string | null }): string {
  const parsed = parseSiteEntry(raw, o);
  return parsed.ok ? parsed.entry : raw.trim().toLowerCase();
}

export async function POST(req: Request) {
  const gate = await requireManageApps("apps");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const fresh = await freshWorkspaceActor(await getServerSession(authOptions));
  if (!fresh.ok) return teammateError(fresh.status, fresh.code, fresh.error);
  if (!fresh.admin) return teammateError(403, "stale_session", CONNECTION_ROUTE_ERRORS.adminsOnly);
  const limited = rateLimit(`browser-sites:${viewer.userId}`, { max: PER_MINUTE, windowMs: 60_000 });
  if (!limited.ok) return teammateError(429, "rate_limited", BROWSER_ROUTE_ERRORS.rateLimited(limited.retryAfter), { "Retry-After": String(limited.retryAfter) });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const org = viewer.organizationId;
  const list = parsed.data.list;
  const rules = { appHosts: appHostsFrom(process.env), fixtureSuffix: fixtureSuffixFor(browserConfig()) };

  let change: { add: string } | { remove: string };
  if (parsed.data.add !== undefined) {
    const entry = parseSiteEntry(parsed.data.add, rules);
    if (!entry.ok) {
      return NextResponse.json({ error: BROWSER_POLICY_COPY.SITE_PROBLEM_WORDS[entry.problem], code: "bad_site", problem: entry.problem }, { status: 400 });
    }
    change = { add: entry.entry };
  } else {
    change = { remove: removalEntry(parsed.data.remove ?? "", rules) };
  }

  const out = await changePolicySite(org, list, change, viewer.userId);
  if (out.tooMany) return teammateError(409, "too_many", BROWSER_POLICY_COPY.tooMany(SITE_LIST_MAX[list]));
  if (out.changed) {
    const added = "add" in change;
    const site = added ? (change as { add: string }).add : (change as { remove: string }).remove;
    await logActivity({
      type: "teammate_browser.site_changed",
      actorId: viewer.userId,
      organizationId: org,
      description: BROWSER_POLICY_COPY.auditSite(list, site, added),
      targetId: org,
      targetType: "organization",
      metadata: { list, site, added },
      // Widening where teammates may go is the change to look at.
      severity: added && list === "allow" ? "warning" : "info",
    });
  }
  return NextResponse.json({ ...(await browserPolicyView(org)), changed: out.changed }, { headers: { "Cache-Control": "no-store" } });
}
