// PUT /api/teammate-connections/teammates/[slug] { gmail?: boolean, calendar?: boolean, expect?: string, organizationId?: string }
//
// The person lets a workspace teammate (or any teammate someone else may
// change) use their own Gmail or Google Calendar, or stops it
// (docs/plans/ai-teammates-phase3.md step 2, Decision 6). The allow is
// stored with the teammate's part prints: once anyone changes the teammate,
// it stops using the person's Google until they allow it again
// (connections.ts connectorAccess, teammate_changed).
//
// AN ALLOW COVERS WHAT THE PERSON SAW (review of step 2). The card's read
// gives each teammate its print as shown (teammateShownPrint), and turning on
// sends it back as `expect`. A teammate changed since answers 409
// teammate_changed naming the parts, and nothing is stored, so an Admin's
// rewrite made while the card was open is never allowed unseen; the card
// reads again and shows it. The prints stored are those of the teammate as
// read and compared here, never re-read after.
//
// TURNING ON needs the person to be someone a teammate can act for here (the
// AI app, resolveActingPerson), the product on in the workspace, the
// teammate's tools here to reach it, a connection (not_connected) that holds
// the product (not_granted, its own refusal: "isn't connected" beside a card
// that says connected was untrue). TURNING OFF needs none of that (Decision
// 27): stopping a teammate must always work.
//
// One statement per product, by INSERT ... ON CONFLICT, so two tabs switching
// two products at once never lose each other's change.
//
// THE WORKSPACE THE PAGE SHOWED (review round 1 of Phase 3): the body names it
// (organizationId), and a session switched to another workspace in another
// tab allows or stops nothing there (409 workspace_changed); the page reloads.

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { viewerFromSession } from "@/lib/access/viewer";
import { resolveActingPerson } from "@/lib/agents/acting";
import { auditAgent } from "@/lib/agents/audit";
import { CONNECTION_ROUTE_ERRORS, CONNECTIONS_COPY, PRINT_FIELD_WORDS, titleList } from "@/lib/agents/teammate-copy";
import { changedSinceShown, othersMayChange, teammateFieldPrints } from "@/lib/agents/teammate-print";
import { invalidRequest, loadTeammate, teammateError, teammateNotFound, workspaceModules } from "@/lib/agents/teammate-server";
import { teammateToolNames } from "@/lib/agents/teammate-tools";
import { requireApp } from "@/lib/app-gate";
import { teammateGoogleUse } from "@/lib/connectors/connection-views-server";
import { productsOfTools } from "@/lib/connectors/connection-views";
import { connectionFor, workspaceConnectorProducts } from "@/lib/connectors/connections";
import { CONNECTOR_PRODUCTS, type ConnectorProduct } from "@/lib/connectors/products";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ slug: string }> };

const bodySchema = z
  .object({ gmail: z.boolean().optional(), calendar: z.boolean().optional(), expect: z.string().max(400).optional(), organizationId: z.string().min(1).max(200).optional() })
  .strict()
  .refine((v) => v.gmail !== undefined || v.calendar !== undefined);

function productWord(p: ConnectorProduct): string {
  return p === "gmail" ? CONNECTIONS_COPY.gmail : CONNECTIONS_COPY.calendar;
}

export async function PUT(req: Request, { params }: Params) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", CONNECTIONS_COPY.signedOut);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  // A caller that names no workspace (an API client, a page from before this) is answered as before.
  const shownIn = parsed.data.organizationId;
  // Required (lead, after review round 1): a page that names no workspace,
  // such as one loaded before this release, reloads rather than act on
  // whichever workspace the session holds now.
  if (shownIn !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer);
  if (!agent) return teammateNotFound();
  // The person's own private teammate uses what they ticked in its tools.
  if (!othersMayChange(agent, viewer.userId)) return teammateError(409, "own_teammate", CONNECTION_ROUTE_ERRORS.ownTeammate);

  const wants = CONNECTOR_PRODUCTS.filter((p) => parsed.data[p] !== undefined).map((p) => ({ product: p, on: parsed.data[p] === true }));
  // Turning on says what the person was shown (see the file header). Asked
  // after the own-teammate answer, so that one keeps its own reason.
  if (wants.some((w) => w.on) && typeof parsed.data.expect !== "string") return invalidRequest();
  const [modules, connectors] = await Promise.all([workspaceModules(viewer.organizationId), workspaceConnectorProducts(viewer.organizationId)]);
  const tools = teammateToolNames(agent, { ...modules, connectors });

  if (wants.some((w) => w.on)) {
    // Read now, as the person is now: a Guest, an agent account, AI off or
    // gone allows nothing.
    const gate = await requireApp("ai");
    if ("error" in gate || gate.viewer.userId !== viewer.userId) return teammateError(403, "person_cannot", CONNECTION_ROUTE_ERRORS.personCannot);
    const acting = await resolveActingPerson(viewer.organizationId, viewer.userId);
    if (!acting.ok) return teammateError(403, "person_cannot", CONNECTION_ROUTE_ERRORS.personCannot);
    const reach = productsOfTools(tools);
    const connection = await connectionFor(acting.person);
    for (const { product, on } of wants) {
      if (!on) continue;
      if (!connectors[product]) return teammateError(409, "product_off", CONNECTION_ROUTE_ERRORS.productOff(productWord(product)));
      if (!reach[product]) return teammateError(409, "no_tool", CONNECTION_ROUTE_ERRORS.noTool(agent.name, productWord(product)));
      if (!connection) return teammateError(409, "not_connected", CONNECTION_ROUTE_ERRORS.notConnected);
      if (!connection.products.includes(product)) return teammateError(409, "not_granted", CONNECTION_ROUTE_ERRORS.notGranted(productWord(product)));
    }
    const changed = changedSinceShown(parsed.data.expect ?? "", agent);
    if (changed.length > 0) {
      const parts = titleList(changed.map((f) => PRINT_FIELD_WORDS[f] ?? f), 6);
      return NextResponse.json({ error: CONNECTION_ROUTE_ERRORS.teammateChanged(agent.name, parts), code: "teammate_changed", changed }, { status: 409 });
    }
  }

  const prints = JSON.stringify(teammateFieldPrints(agent));
  for (const { product, on } of wants) {
    if (on) {
      await prisma.$executeRaw`
        INSERT INTO "AgentPersonSetting" ("id", "agentId", "userId", "approvalRules", "connectorProducts", "connectorPrints", "createdAt", "updatedAt")
        VALUES (${`c${randomBytes(12).toString("hex")}`}, ${agent.id}, ${viewer.userId}, '{}'::jsonb, ARRAY[${product}::text],
                jsonb_build_object(${product}::text, ${prints}::jsonb), (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
        ON CONFLICT ("agentId", "userId") DO UPDATE SET
          "connectorProducts" = CASE WHEN ${product}::text = ANY("AgentPersonSetting"."connectorProducts") THEN "AgentPersonSetting"."connectorProducts"
                                     ELSE array_append("AgentPersonSetting"."connectorProducts", ${product}::text) END,
          "connectorPrints" = jsonb_set(CASE WHEN jsonb_typeof("AgentPersonSetting"."connectorPrints") = 'object' THEN "AgentPersonSetting"."connectorPrints" ELSE '{}'::jsonb END,
                                        ARRAY[${product}::text], ${prints}::jsonb, true),
          "updatedAt" = (now() AT TIME ZONE 'UTC')`;
    } else {
      await prisma.$executeRaw`
        UPDATE "AgentPersonSetting"
           SET "connectorProducts" = array_remove("connectorProducts", ${product}::text),
               "connectorPrints" = CASE WHEN jsonb_typeof("connectorPrints") = 'object' THEN "connectorPrints" - ${product}::text ELSE NULL END,
               "updatedAt" = (now() AT TIME ZONE 'UTC')
         WHERE "agentId" = ${agent.id} AND "userId" = ${viewer.userId}`;
    }
    await auditAgent({ organizationId: viewer.organizationId, actorId: viewer.userId, agent, action: "approvals_changed", metadata: { connector: { product, on } } });
  }

  const setting = await prisma.agentPersonSetting.findUnique({
    where: { agentId_userId: { agentId: agent.id, userId: viewer.userId } },
    select: { connectorProducts: true, connectorPrints: true },
  });
  // The row as the card lists it: by the Google tools the teammate holds,
  // on here or off (connection-views-server.ts teammatesWithGoogle, review of
  // step 5), so a product off keeps its line after a switch.
  const held = teammateToolNames(agent, { ...modules, connectors: { gmail: true, calendar: true } });
  return NextResponse.json({ teammate: teammateGoogleUse(agent, viewer.userId, held, setting) });
}
