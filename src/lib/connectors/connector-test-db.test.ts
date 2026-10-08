// The connector tests' database double holds each statement to the clauses
// its meaning rests on (review of step 2): it applies its own logic once it
// knows a statement, so without these checks a query that lost its state
// expiry, a leaver condition, the hard delete's other-workspace NOT EXISTS or
// the policy upsert's array guard would still pass every test.

import { beforeEach, describe, expect, it } from "vitest";
import { cdb, connectorDb, resetConnectorDb, seedConnection } from "./connector-test-db";

beforeEach(() => {
  resetConnectorDb();
});

describe("connector-test-db", () => {
  it("refuses consumeState without its expiry", async () => {
    await expect(connectorDb.$queryRaw`DELETE FROM "TeammateOAuthState" WHERE "id" = ${"s1"} RETURNING "organizationId"`).rejects.toThrow(/lacks AND "expiresAt" >/);
  });

  it("refuses the state sweep without its expiry", async () => {
    await expect(connectorDb.$executeRaw`DELETE FROM "TeammateOAuthState" WHERE "expiresAt" < now()`).rejects.toThrow(/lacks/);
  });

  it("refuses a leaver sweep that lost the membership anti-join", async () => {
    seedConnection({ organizationId: "org1", userId: "u1", accountSub: "s1" });
    const take = 10;
    await expect(
      connectorDb.$transaction(
        () =>
          connectorDb.$queryRaw`DELETE FROM "TeammateConnection" WHERE "id" IN (SELECT "id" FROM "TeammateConnection" WHERE "id" IN (SELECT c."id" FROM "TeammateConnection" c JOIN "User" u ON u."id" = c."userId" WHERE u."deletedAt" IS NOT NULL OR u."status" = 'INACTIVE' OR u."organizationId" <> c."organizationId" OR EXISTS (SELECT 1 FROM "OrganizationMembership" m)) LIMIT ${take}) RETURNING "id"`,
      ),
    ).rejects.toThrow(/leaver sweep lacks NOT EXISTS/);
    expect(cdb.connections).toHaveLength(1);
  });

  it("refuses the hard delete's queue without its other-workspace NOT EXISTS", async () => {
    await expect(
      connectorDb.$executeRaw`INSERT INTO "TeammateTokenRevocation" ("id", "provider", "tokenSealed", "reason", "attempts", "nextAttemptAt", "createdAt", "accountKey")
        SELECT 'rv_' || c."id", c."provider", c."refreshTokenSealed", 'workspace_deleted', 0, now(), now(), encode(sha256(convert_to(c."provider" || ':' || c."accountSub", 'UTF8')), 'hex')
          FROM "TeammateConnection" c WHERE c."organizationId" = ${"org1"}`,
    ).rejects.toThrow(/queueWorkspaceRevocations lacks AND NOT EXISTS/);
  });

  it("refuses a policy upsert that would append a product twice", async () => {
    const org = "org1";
    const on = true;
    const product = "gmail";
    await expect(
      connectorDb.$queryRaw`INSERT INTO "TeammateConnectorPolicy" ("organizationId", "provider", "products", "updatedById", "createdAt", "updatedAt")
        VALUES (${org}, 'google', CASE WHEN ${on}::boolean THEN ARRAY[${product}::text] ELSE ARRAY[]::text[] END, ${"u1"}, now(), now())
        ON CONFLICT ("organizationId", "provider") DO UPDATE SET "products" = array_append("TeammateConnectorPolicy"."products", ${product}::text)
        RETURNING "products"`,
    ).rejects.toThrow(/setPolicyProduct lacks/);
  });

  it("refuses an account lock taken outside a transaction, which would hold nothing", async () => {
    const keys = ["k1"];
    await expect(connectorDb.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tc-sub:' || k)) FROM unnest(${keys}::text[]) AS k ORDER BY k`).rejects.toThrow(/outside a transaction/);
  });
});
