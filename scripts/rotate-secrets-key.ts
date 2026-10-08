// Move every secret stored under SECRETS_ENCRYPTION_KEY to a new key, with
// nothing failing at any moment. Written 2026-10-05, when the production key
// was found committed in LAUNCH-CHECKLIST.md in a public repository: git
// history keeps it, so it must be replaced, and the secrets it protects
// re-encrypted under the new one.
//
// RUN IT ON THE SERVER, by the founder, in this order:
//
//   1. Make the new key: `openssl rand -hex 32`. In EVERY place the app reads
//      its environment (.env and any .env.production*, the aaPanel Node
//      settings), set SECRETS_ENCRYPTION_KEY to the NEW key and
//      SECRETS_ENCRYPTION_KEY_PREVIOUS to the OLD one. Reload from a fresh
//      shell: pm2 reload workwrk --update-env && pm2 save. The app now writes
//      with the new key and reads either (src/lib/secrets-crypto.ts).
//   1b. PROVE THE RUNNING APP HOLDS THE NEW KEY: re-save one workspace's AI
//      key in Settings > API & webhooks > AI keys, so the app writes that row
//      with the key it really has. The tab is there only for a workspace with
//      the Bring your own AI key add-on on (staff turn it on, with the
//      Enterprise plan, on the company page; your own workspace will do), and
//      the key must be typed in again, since the editor never shows it. Any
//      sealed value the app wrote since the reload proves it as well: a Google
//      connection made or refreshed for AI teammates, for one. --write refuses until at least one
//      secret opens with the new key, because a stale process (pm2 keeps the
//      environment it started with: `pm2 env <id>` shows it) would otherwise
//      be left holding a key nothing is encrypted with. If there is no
//      workspace whose AI key you can re-save, check `pm2 env <id>` shows the
//      new SECRETS_ENCRYPTION_KEY and pass --app-holds-new-key.
//   2. Dry run, with the same two values: says how many secrets are on each
//      key, column by column. Writes nothing.
//        DIRECT_URL= DATABASE_URL=<the app's database> SECRETS_ENCRYPTION_KEY=<new> \
//          SECRETS_ENCRYPTION_KEY_PREVIOUS=<old> npx tsx scripts/rotate-secrets-key.ts
//   3. The same with --write: each secret still on the old key is
//      re-encrypted, one by one, and only if nobody changed it since it was
//      read. Run it again until it says every secret is on the new key.
//   4. Remove SECRETS_ENCRYPTION_KEY_PREVIOUS everywhere, reload again
//      (pm2 reload workwrk --update-env && pm2 save), and run the dry run once
//      more WITHOUT the previous key: it must say every secret opens with the
//      new key.
//
// Never write either key into this repository. It prints the database it is
// pointed at, counts and row ids: never a key, and never a secret.
//
// WHAT IT COVERS: every column in SEALED_COLUMNS (src/lib/connectors/seal.ts),
// so a column added there is moved here with no change to this script:
//   OrgSecret.encryptedKey                       a workspace's own AI key
//                                                (Settings > API & webhooks > AI keys)
//   TeammateConnection.refreshTokenSealed        a person's Google connection for
//   TeammateConnection.accessTokenSealed         AI teammates (docs/plans/ai-teammates-phase3.md;
//                                                the access token may be empty)
//   TeammateOAuthState.verifierSealed            a connect in flight (gone in 10 minutes)
//   TeammateTokenRevocation.tokenSealed          a revoke Google has not confirmed yet
// The plan is worked out by scripts/lib/rotation-plan.ts planRotation, which
// rotation-plan.test.ts holds to every column.

import type { Prisma } from "../src/generated/prisma";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { SEALED_COLUMNS } from "../src/lib/connectors/seal";
import { encryptSecretWith } from "../src/lib/secrets-crypto";
import { opensWith, planRotation, type SealedCell } from "./lib/rotation-plan";

const prisma = scriptPrisma();

/** Rows read per query, so a table of a hundred thousand connections is never one read. */
const PAGE = 1000;

/** The two calls this script makes on each sealed model, by its Prisma name. */
type Delegate = {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  updateMany(args: unknown): Promise<{ count: number }>;
};

function delegate(model: string): Delegate {
  const d = (prisma as unknown as Record<string, Delegate | undefined>)[model];
  if (!d) throw new Error(`The Prisma client has no model ${model}: run npx prisma generate.`);
  return d;
}

function isMissingTable(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === "P2021";
}

/** Every sealed cell of every column, page by page. A table this database does not have yet holds none. */
async function readCells(): Promise<SealedCell[]> {
  const cells: SealedCell[] = [];
  for (const c of SEALED_COLUMNS) {
    const d = delegate(c.model);
    let cursor: string | null = null;
    try {
      for (;;) {
        const page: Array<Record<string, unknown>> = await d.findMany({
          select: { id: true, [c.column]: true },
          orderBy: { id: "asc" },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const r of page) cells.push({ model: c.model, column: c.column, id: String(r.id), blob: r[c.column] ?? null });
        if (page.length < PAGE) break;
        cursor = String(page[page.length - 1].id);
      }
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      console.log(`${c.model}.${c.column}: no such table in this database yet, so nothing to move.`);
    }
  }
  return cells;
}

async function main() {
  const newKey = process.env.SECRETS_ENCRYPTION_KEY ?? "";
  const oldKey = process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS ?? "";
  const write = process.argv.includes("--write");
  if (!newKey) {
    console.error("Set SECRETS_ENCRYPTION_KEY (the new key) and, until every secret is moved, SECRETS_ENCRYPTION_KEY_PREVIOUS (the old one).");
    process.exit(2);
  }
  if (oldKey && oldKey === newKey) {
    console.error("The previous and the new key are the same: make a new one with `openssl rand -hex 32`.");
    process.exit(2);
  }
  console.log(`Database: ${databaseLabel()}`);

  const plan = planRotation(await readCells(), { newKey, oldKey });
  // Before anything moves: some secret, in any column, must already open
  // with the new key, the app's own proof that it holds it (step 1b).
  if (write && plan.total > 0 && !process.argv.includes("--app-holds-new-key") && !plan.anyOnNew) {
    console.error(
      "Nothing written: no stored secret opens with this new key yet, so the running app may not hold it. Re-save one workspace's AI key in Settings > API & webhooks > AI keys (step 1b), or check `pm2 env <id>` and pass --app-holds-new-key.",
    );
    process.exit(1);
  }

  let moved = 0;
  const changed: string[] = [];
  if (write) {
    for (const { cell, plain } of plan.moves) {
      const blob = encryptSecretWith(plain, newKey);
      if (opensWith(blob, newKey) !== plain) throw new Error(`Re-encrypting ${cell.model}.${cell.column} ${cell.id} did not round-trip. Nothing more is written.`);
      // Only if the cell still holds what was read: a secret saved in the
      // meantime (already on the new key: a re-saved AI key, a refreshed
      // Google token) is never overwritten.
      const res = await delegate(cell.model).updateMany({
        where: { id: cell.id, [cell.column]: { equals: cell.blob as object } },
        data: { [cell.column]: blob as unknown as Prisma.InputJsonValue },
      });
      if (res.count === 1) moved += 1;
      else changed.push(`${cell.model}.${cell.column} ${cell.id}`);
    }
  }

  for (const c of plan.columns) {
    const held = c.rows - c.empty;
    console.log(
      `${c.model}.${c.column}: ${held} secret${held === 1 ? "" : "s"}${c.empty ? ` (and ${c.empty} empty)` : ""}. On the new key: ${c.onNew}. ${write ? `To move: ${c.onOld}.` : `On the old key: ${c.onOld}.`}${c.unreadable ? ` Opens with neither: ${c.unreadable}.` : ""}`,
    );
  }
  console.log(`In all: ${plan.total}. On the new key: ${plan.onNew}. ${write ? `Moved now: ${moved}.` : `On the old key: ${plan.moves.length}.`}`);
  if (changed.length) console.log(`Changed while this ran, so left for the next run: ${changed.join(", ")}`);
  if (plan.unreadable.length) {
    console.error(`These open with neither key, so they were not touched: ${plan.unreadable.map((u) => `${u.model}.${u.column} ${u.id}`).join(", ")}`);
    process.exit(1);
  }
  if (!write && plan.moves.length) console.log("Dry run: nothing written. Run again with --write.");
  if (plan.onNew + moved === plan.total) console.log("Every secret is on the new key.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
