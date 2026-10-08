// GET /api/teammate-connections/policy
// PUT /api/teammate-connections/policy { gmail?: boolean, calendar?: boolean }
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
import { prisma } from "@/lib/prisma";

const bodySchema = z
  .object({ gmail: z.boolean().optional(), calendar: z.boolean().optional() })
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

  const wants = CONNECTOR_PRODUCTS.filter((p) => parsed.data[p] !== undefined).map((p) => ({ product: p, on: parsed.data[p] === true }));
  if (wants.some((w) => w.on)) {
    const cfg = googleConfig();
    if (!cfg) return teammateError(503, "not_configured", CONNECTION_ROUTE_ERRORS.notConfigured);
    const notOffered = wants.find((w) => w.on && !cfg.products.includes(w.product));
    if (notOffered) return teammateError(409, "not_offered", CONNECTION_ROUTE_ERRORS.notOffered(productWord(notOffered.product)));
  }

  // What it was, for the audit row and for `turnedOff`; the write itself never reads it.
  const before = productSet(
    (
      await prisma.teammateConnectorPolicy.findUnique({
        where: { organizationId_provider: { organizationId: viewer.organizationId, provider: "google" } },
        select: { products: true },
      })
    )?.products,
  );
  const turnedOff: ConnectorProduct[] = [];
  for (const { product, on } of wants) {
    const after = productSet(await setPolicyProduct(viewer.organizationId, product, on, viewer.userId));
    if (before[product] === after[product]) continue;
    if (!after[product]) turnedOff.push(product);
    await logActivity({
      type: "teammate_connectors.changed",
      actorId: viewer.userId,
      organizationId: viewer.organizationId,
      description: CONNECTOR_POLICY_COPY.auditChanged(productWord(product), on),
      targetId: viewer.organizationId,
      targetType: "organization",
      oldValue: { provider: "google", product, on: before[product] },
      newValue: { provider: "google", product, on: after[product] },
      metadata: { provider: "google", product },
      severity: on ? "warning" : "info",
    });
  }
  return NextResponse.json({ ...(await connectorPolicyView(viewer.organizationId)), turnedOff });
}
