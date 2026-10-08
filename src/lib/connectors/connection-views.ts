// What the /api/teammate-connections routes answer with
// (docs/plans/ai-teammates-phase3.md step 2), as the Connections card and the
// Apps & modules section read it. The server fills them
// (connection-views-server.ts); this file only shapes them, so the client and
// the tests read one thing.
//
// THE PERSON SEES THEIR OWN ACCOUNT, ADMINS SEE COUNTS (Decision 5). A
// TeammateConnectionsView is only ever built for the signed-in person's own
// connection; a ConnectorPolicyView holds numbers and no person.
//
// Pure and client safe: no prisma, no fetch, no node modules.

import type { TeammateHue } from "@/lib/agents/hues";
import { CONNECT_ERROR_WORDS } from "@/lib/agents/teammate-copy";
import type { PrintField } from "@/lib/agents/teammate-print";
import { TOOL_PRODUCT, type ConnectorProduct, type ProductSet } from "./products";

export type ProductState = "on" | "off";

/** The person's own connection, as their card shows it. */
export interface ConnectionView {
  accountEmail: string;
  products: ConnectorProduct[];
  status: "active" | "needs_reconnect";
  connectedAt: string;
  lastUsedAt: string | null;
  /** The teammate that used it last, when the person can still use that teammate. */
  lastUsedBy: string | null;
  needsReconnectAt: string | null;
}

/** One teammate whose tools reach Google, and what the person lets it use. */
export interface TeammateGoogleUse {
  slug: string;
  name: string;
  hue: TeammateHue | null;
  avatar: string | null;
  /** The person's own private teammate: it uses what they ticked in its tools, with no allow (Decision 6). */
  own: boolean;
  /** The products it has tools for, with the workspace's switch. */
  tools: ProductSet;
  /** The products the person let it use. */
  allowed: ProductSet;
  /** Per allowed product, what changed since the person allowed it; such a product is not used until allowed again. */
  changed: Partial<Record<ConnectorProduct, PrintField[]>>;
  /**
   * The teammate as this read showed it (teammate-print.ts teammateShownPrint).
   * An allow sends it back as `expect`, so it covers what the person saw: one
   * changed since answers 409 teammate_changed (review of step 2).
   */
  print: string;
}

/** GET /api/teammate-connections. */
export interface TeammateConnectionsView {
  /** False only when this WorkwrK offers no Google and the person holds no connection: the card is not drawn. */
  available: boolean;
  workspaceName: string;
  products: Record<ConnectorProduct, ProductState>;
  connection: ConnectionView | null;
  teammates: TeammateGoogleUse[];
  canManagePolicy: boolean;
  /** A Guest or an agent account: nothing to connect (Decision 27). */
  guest: boolean;
}

/** GET /api/teammate-connections/policy, for Owners and Admins. */
export interface ConnectorPolicyView {
  /** False only when this WorkwrK offers no Google and nobody here is connected. */
  available: boolean;
  /** What this WorkwrK offers (GOOGLE_AGENT_PRODUCTS). */
  offered: ProductSet;
  /** What the workspace turned on, of what is offered. */
  on: ProductSet;
  counts: { connected: number; gmail: number; calendar: number; needsReconnect: number };
  updatedAt: string | null;
}

/** The products this tool set reaches: one tool of a product is enough. */
export function productsOfTools(toolNames: readonly string[]): ProductSet {
  const out: Record<ConnectorProduct, boolean> = { gmail: false, calendar: false };
  for (const n of toolNames) {
    if (Object.prototype.hasOwnProperty.call(TOOL_PRODUCT, n)) out[TOOL_PRODUCT[n as keyof typeof TOOL_PRODUCT]] = true;
  }
  return out;
}

/**
 * The fragment an ?ai_error= code reads as, inside CONNECTIONS_COPY.didntConnect.
 * A code this file does not know reads as itself (connect-errors.ts rule: a
 * code somebody can search for beats "something went wrong"), but only when it
 * is shaped like a code, so a crafted link cannot put a sentence of its own
 * on the page.
 */
export function teammateConnectSentence(code: string): string {
  const c = String(code ?? "");
  if (Object.prototype.hasOwnProperty.call(CONNECT_ERROR_WORDS, c)) return CONNECT_ERROR_WORDS[c];
  return /^[a-z0-9_]{1,40}$/.test(c) ? c : "unknown";
}
