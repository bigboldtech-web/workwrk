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
//      the key must be typed in again, since the editor never shows it. --write refuses until at least one
//      secret opens with the new key, because a stale process (pm2 keeps the
//      environment it started with: `pm2 env <id>` shows it) would otherwise
//      be left holding a key nothing is encrypted with. If there is no
//      workspace whose AI key you can re-save, check `pm2 env <id>` shows the
//      new SECRETS_ENCRYPTION_KEY and pass --app-holds-new-key.
//   2. Dry run, with the same two values: says how many secrets are on each
//      key. Writes nothing.
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
// WHAT IT COVERS: OrgSecret.encryptedKey (a workspace's own AI key, Settings
// > API & webhooks > AI keys).

import type { Prisma } from "../src/generated/prisma";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { decryptSecretWith, encryptSecretWith } from "../src/lib/secrets-crypto";

const prisma = scriptPrisma();

function opens(blob: unknown, key: string): string | null {
  try {
    return decryptSecretWith(blob, key);
  } catch {
    return null;
  }
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

  const rows = await prisma.orgSecret.findMany({ select: { id: true, encryptedKey: true } });
  // Before anything moves: some secret must already open with the new key,
  // the app's own proof that it holds it (step 1b).
  if (write && rows.length > 0 && !process.argv.includes("--app-holds-new-key") && !rows.some((r) => opens(r.encryptedKey, newKey) !== null)) {
    console.error(
      "Nothing written: no stored secret opens with this new key yet, so the running app may not hold it. Re-save one workspace's AI key in Settings > API & webhooks > AI keys (step 1b), or check `pm2 env <id>` and pass --app-holds-new-key.",
    );
    process.exit(1);
  }
  let onNew = 0;
  let moved = 0;
  const onOld: string[] = [];
  const unreadable: string[] = [];
  const changed: string[] = [];

  for (const r of rows) {
    if (opens(r.encryptedKey, newKey) !== null) {
      onNew += 1;
      continue;
    }
    const plain = oldKey ? opens(r.encryptedKey, oldKey) : null;
    if (plain === null) {
      unreadable.push(r.id);
      continue;
    }
    if (!write) {
      onOld.push(r.id);
      continue;
    }
    const blob = encryptSecretWith(plain, newKey);
    if (opens(blob, newKey) !== plain) throw new Error(`Re-encrypting ${r.id} did not round-trip. Nothing more is written.`);
    // Only if the row still holds what was read: a secret a person saved in
    // the meantime (already on the new key) is never overwritten.
    const res = await prisma.orgSecret.updateMany({
      where: { id: r.id, encryptedKey: { equals: r.encryptedKey as object } },
      data: { encryptedKey: blob as unknown as Prisma.InputJsonValue },
    });
    if (res.count === 1) moved += 1;
    else changed.push(r.id);
  }

  console.log(`OrgSecret rows: ${rows.length}. On the new key: ${onNew}. ${write ? `Moved now: ${moved}.` : `On the old key: ${onOld.length}.`}`);
  if (changed.length) console.log(`Changed while this ran, so left for the next run: ${changed.join(", ")}`);
  if (unreadable.length) {
    console.error(`These rows open with neither key, so they were not touched: ${unreadable.join(", ")}`);
    process.exit(1);
  }
  if (!write && onOld.length) console.log("Dry run: nothing written. Run again with --write.");
  if (onNew + moved === rows.length) console.log("Every secret is on the new key.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
