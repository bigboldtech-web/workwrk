// A connect in flight (docs/plans/ai-teammates-phase3.md step 2): the OAuth
// state a person's browser carries to Google and back, bound to that person
// and that workspace, used once and gone in ten minutes.
//
// ONLY THE STATE'S HASH IS STORED (TeammateOAuthState.id = sha256 hex), so a
// read of the table gives nothing a callback could be forged with, and the
// PKCE verifier is sealed like a token (seal.ts). consumeState is one DELETE
// ... RETURNING: of two callbacks with one state (a replay, a double load),
// exactly one gets the row, and an expired row is never returned. The cron
// sweep (connections.ts sweepConnections) deletes the ones never used.
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { newState, stateId } from "./google/oauth";
import { parseProducts, type ConnectorProduct } from "./products";
import { openToken, sealToken } from "./seal";

/** How long a person has to finish at Google. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Store a new state for this person in this workspace; the state itself goes only to the browser. */
export async function createState(a: { organizationId: string; userId: string; products: ConnectorProduct[]; verifier: string }): Promise<{ state: string }> {
  const { state, id } = newState();
  await prisma.teammateOAuthState.create({
    data: {
      id,
      organizationId: a.organizationId,
      userId: a.userId,
      provider: "google",
      products: [...a.products],
      verifierSealed: sealToken(a.verifier) as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });
  return { state };
}

/**
 * The connect this state began, taken once: null when it expired, was used
 * already, was never issued, or its verifier no longer opens.
 */
export async function consumeState(state: string): Promise<{ organizationId: string; userId: string; products: ConnectorProduct[]; verifier: string } | null> {
  if (typeof state !== "string" || state.length < 16 || state.length > 200) return null;
  const rows = await prisma.$queryRaw<Array<{ organizationId: string; userId: string; products: string[]; verifierSealed: unknown }>>`
    DELETE FROM "TeammateOAuthState"
     WHERE "id" = ${stateId(state)} AND "expiresAt" > (now() AT TIME ZONE 'UTC')
    RETURNING "organizationId", "userId", "products", "verifierSealed"`;
  const row = rows[0];
  if (!row) return null;
  const products = parseProducts(row.products);
  if (products.length === 0) return null;
  let verifier: string;
  try {
    verifier = openToken(row.verifierSealed);
  } catch {
    return null;
  }
  return { organizationId: row.organizationId, userId: row.userId, products, verifier };
}
