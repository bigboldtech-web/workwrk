// scripts/rotate-secrets-key.ts's plan (docs/plans/ai-teammates-phase3.md
// step 2): every column that holds a sealed secret is counted and moved, not
// only OrgSecret's. A column the script forgot would keep its secrets on a key
// the founder is about to delete, and every Google connection for AI
// teammates would stop opening the day the old key goes.

import { describe, expect, it } from "vitest";
import { SEALED_COLUMNS } from "../../src/lib/connectors/seal";
import { encryptSecretWith } from "../../src/lib/secrets-crypto";
import { planRotation, type SealedCell } from "./rotation-plan";

const OLD = "0".repeat(64);
const NEW = "1".repeat(64);
const OTHER = "2".repeat(64);

function cell(model: string, column: string, id: string, plain: string | null, key = OLD): SealedCell {
  return { model, column, id, blob: plain === null ? null : encryptSecretWith(plain, key) };
}

describe("planRotation", () => {
  it("counts every SEALED_COLUMNS column, the Google connector ones too", () => {
    const cells = SEALED_COLUMNS.map((c, i) => cell(c.model, c.column, `r${i}`, `secret-${i}`));
    const plan = planRotation(cells, { newKey: NEW, oldKey: OLD });
    expect(plan.columns.map((c) => `${c.model}.${c.column}`)).toEqual(SEALED_COLUMNS.map((c) => `${c.model}.${c.column}`));
    for (const c of plan.columns) expect(c).toMatchObject({ rows: 1, onOld: 1, onNew: 0, unreadable: 0 });
    // Every one moves, with what it held: the old plan read OrgSecret alone and moved one of these five.
    expect(plan.moves.map((m) => m.cell.id)).toEqual(SEALED_COLUMNS.map((_, i) => `r${i}`));
    expect(plan.moves.map((m) => m.plain)).toEqual(SEALED_COLUMNS.map((_, i) => `secret-${i}`));
    expect(plan.total).toBe(SEALED_COLUMNS.length);
    expect(SEALED_COLUMNS.map((c) => c.model)).toEqual(expect.arrayContaining(["orgSecret", "teammateConnection", "teammateOAuthState", "teammateTokenRevocation"]));
  });

  it("counts a column with no rows as zero, never leaves it out", () => {
    const plan = planRotation([cell("orgSecret", "encryptedKey", "s1", "sk-1")], { newKey: NEW, oldKey: OLD });
    expect(plan.columns).toHaveLength(SEALED_COLUMNS.length);
    expect(plan.columns.find((c) => c.column === "tokenSealed")).toMatchObject({ rows: 0, onOld: 0 });
  });

  it("leaves what is on the new key, skips an empty nullable column, and names what opens with neither", () => {
    const plan = planRotation(
      [
        cell("teammateConnection", "refreshTokenSealed", "c1", "rt-1", NEW),
        cell("teammateConnection", "accessTokenSealed", "c1", null),
        cell("teammateConnection", "refreshTokenSealed", "c2", "rt-2", OTHER),
        // A non-nullable column holding nothing is not a secret to skip.
        cell("teammateTokenRevocation", "tokenSealed", "q1", null),
      ],
      { newKey: NEW, oldKey: OLD },
    );
    const refresh = plan.columns.find((c) => c.column === "refreshTokenSealed");
    const access = plan.columns.find((c) => c.column === "accessTokenSealed");
    expect(refresh).toMatchObject({ rows: 2, onNew: 1, unreadable: 1 });
    expect(access).toMatchObject({ rows: 1, empty: 1, unreadable: 0 });
    expect(plan.moves).toEqual([]);
    expect(plan.unreadable.map((u) => `${u.model}.${u.column} ${u.id}`)).toEqual(["teammateConnection.refreshTokenSealed c2", "teammateTokenRevocation.tokenSealed q1"]);
    expect(plan.total).toBe(3);
    expect(plan.onNew).toBe(1);
  });

  it("proves the new key with a secret of any column (step 1b), not only an AI key", () => {
    const connector = planRotation(
      [cell("orgSecret", "encryptedKey", "s1", "sk-1"), cell("teammateConnection", "accessTokenSealed", "c1", "at-1", NEW)],
      { newKey: NEW, oldKey: OLD },
    );
    expect(connector.anyOnNew).toBe(true);
    const none = planRotation([cell("orgSecret", "encryptedKey", "s1", "sk-1")], { newKey: NEW, oldKey: OLD });
    expect(none.anyOnNew).toBe(false);
  });

  it("moves nothing without the old key, and calls each such secret unreadable", () => {
    const plan = planRotation([cell("teammateOAuthState", "verifierSealed", "st1", "v-1")], { newKey: NEW, oldKey: "" });
    expect(plan.moves).toEqual([]);
    expect(plan.unreadable).toHaveLength(1);
  });

  it("refuses a column SEALED_COLUMNS does not list", () => {
    expect(() => planRotation([cell("user", "passwordHash", "u1", "x")], { newKey: NEW, oldKey: OLD })).toThrow(/not in SEALED_COLUMNS/);
  });
});
