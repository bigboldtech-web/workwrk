// GET /api/teammate-connections/policy
// PUT /api/teammate-connections/policy { gmail?: boolean, calendar?: boolean, organizationId? }
//
// The workspace switch for Google in AI teammates, per product, and the
// numbers behind it (docs/plans/ai-teammates-phase3.md step 2, Decisions 1,
// 2 and 21). Owners and Admins only (requireManageApps, the Apps & modules
// page's own gate). They never read or use anyone's connection: counts only.
//
// A product can be turned on only when this WorkwrK offers it
// (GOOGLE_AGENT_PRODUCTS, 409 not_offered); turning one off always works.
// One statement per product (connections.ts setPolicyProduct). Turning off
// stops every use at the next call; people stay connected, and the answer's
// `turnedOff` lets the page offer to disconnect everyone.
//
// A CHANGE RE-READS THE ACTOR (review of step 2): the session's role is
// checked against the database only every five minutes (src/lib/auth.ts), so
// PUT asks freshWorkspaceActor, as the users route does, and an Admin demoted
// or removed a moment ago cannot turn Gmail on for the workspace. GET returns
// counts only and keeps the gate alone.
//
// REVIEW ROUND 1 OF PHASE 3. The audit row says what this write changed, from
// the switch as it was just before it and as it left it (setPolicyProduct
// reads both under one lock), never from a read made before another Admin's
// change landed. And PUT names the workspace the page showed
// (organizationId), as Disconnect everyone does, since "Turn off and
// disconnect everyone" sends this first: a session switched to another
// workspace in another tab changes nothing there (409 workspace_changed), and
// the page reloads.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { CONNECTION_ROUTE_ERRORS, CONNECTOR_POLICY_COPY } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { requireManageApps } from "@/lib/app-gate";
import { authOptions } from "@/lib/auth";
import { connectorPolicyView } from "@/lib/connectors/connection-views-server";
import { setPolicyProduct } from "@/lib/connectors/connections";
import { googleConfig } from "@/lib/connectors/google/config";
import { CONNECTOR_PRODUCTS, productSet, type ConnectorProduct } from "@/lib/connectors/products";

const bodySchema = z
  .object({ gmail: z.boolean().optional(), calendar: z.boolean().optional(), organizationId: z.string().min(1).max(200).optional() })
  .strict()
  .refine((v) => v.gmail !== undefined || v.calendar !== undefined);

function productWord(p: ConnectorProduct): string {
  return p === "gmail" ? CONNECTOR_POLICY_COPY.gmail : CONNECTOR_POLICY_COPY.calendar;
}

export async function GET() {
  const gate = await requireManageApps("apps");
  if ("error" in gate) return gate.error;
  return NextResponse.json(await connectorPolicyView(gate.viewer.organizationId), { headers: { "Cache-Control": "no-store" } });
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
  // A caller that names no workspace (an API client, a page from before this) is answered as before.
  const shownIn = parsed.data.organizationId;
  // Required (lead, after review round 1): a page that names no workspace,
  // such as one loaded before this release, reloads rather than act on
  // whichever workspace the session holds now.
  if (shownIn !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);

  const wants = CONNECTOR_PRODUCTS.filter((p) => parsed.data[p] !== undefined).map((p) => ({ product: p, on: parsed.data[p] === true }));
  if (wants.some((w) => w.on)) {
    const cfg = googleConfig();
    if (!cfg) return teammateError(503, "not_configured", CONNECTION_ROUTE_ERRORS.notConfigured);
    const notOffered = wants.find((w) => w.on && !cfg.products.includes(w.product));
    if (notOffered) return teammateError(409, "not_offered", CONNECTION_ROUTE_ERRORS.notOffered(productWord(notOffered.product)));
  }

  const turnedOff: ConnectorProduct[] = [];
  for (const { product, on } of wants) {
    // What it was and what it is, both from this write (see the file header).
    const changed = await setPolicyProduct(viewer.organizationId, product, on, viewer.userId);
    const before = productSet(changed.before);
    const after = productSet(changed.after);
    if (before[product] === after[product]) continue;
    if (!after[product]) turnedOff.push(product);
    await logActivity({
      type: "teammate_connectors.changed",
      actorId: viewer.userId,
      organizationId: viewer.organizationId,
      description: CONNECTOR_POLICY_COPY.auditChanged(productWord(product), after[product]),
      targetId: viewer.organizationId,
      targetType: "organization",
      oldValue: { provider: "google", product, on: before[product] },
      newValue: { provider: "google", product, on: after[product] },
      metadata: { provider: "google", product },
      severity: after[product] ? "warning" : "info",
    });
  }
  return NextResponse.json({ ...(await connectorPolicyView(viewer.organizationId)), turnedOff });
}
