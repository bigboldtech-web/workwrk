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

import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { CONNECTION_ROUTE_ERRORS, CONNECTOR_POLICY_COPY } from "@/lib/agents/teammate-copy";
import { invalidRequest, teammateError } from "@/lib/agents/teammate-server";
import { requireManageApps } from "@/lib/app-gate";
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
