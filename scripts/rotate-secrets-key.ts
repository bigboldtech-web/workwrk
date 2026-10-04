// Re-encrypt every secret stored under SECRETS_ENCRYPTION_KEY with a new
// key. Written 2026-10-05, when the production key was found committed in
// LAUNCH-CHECKLIST.md in a public repository: git history keeps it, so the
// key must be replaced, and the secrets it protects re-encrypted with the
// new one or they stop working.
//
// RUN IT ON THE SERVER, by the founder, with the app's own database:
//
//   # 1. Dry run: says how many secrets there are and that each one opens
//   #    with the old key. Writes nothing.
//   OLD_SECRETS_ENCRYPTION_KEY='<the current key>' SECRETS_ENCRYPTION_KEY='<the new key>' \
//     npx tsx scripts/rotate-secrets-key.ts
//
//   # 2. Re-encrypt, all in ONE transaction:
//   OLD_SECRETS_ENCRYPTION_KEY='<the current key>' SECRETS_ENCRYPTION_KEY='<the new key>' \
//     npx tsx scripts/rotate-secrets-key.ts --write
//
//   # 3. Put the new key in the app's .env as SECRETS_ENCRYPTION_KEY, then
//   pm2 reload workwrk --update-env
//
// Make the new key with `openssl rand -hex 32`, and never write either value
// into this repository.
//
// WHAT IT COVERS: OrgSecret.encryptedKey (a workspace's own AI key, Settings
// > AI). Each blob is decrypted with the old key and encrypted with the new
// one. If ANY blob does not open with the old key, nothing is written and the
// run says which row (by id) failed, so a wrong old key can never leave some
// secrets on one key and some on another. Between step 2 and step 3 the app
// still holds the old key, so a workspace's own AI key fails for that
// moment; do the two steps back to back.
//
// It prints counts and row ids only: never a key, and never a secret.

import { prisma } from "../src/lib/prisma";
import { decryptSecretWith, encryptSecretWith } from "../src/lib/secrets-crypto";

async function main() {
  const oldKey = process.env.OLD_SECRETS_ENCRYPTION_KEY ?? "";
  const newKey = process.env.SECRETS_ENCRYPTION_KEY ?? "";
  const write = process.argv.includes("--write");
  if (!oldKey || !newKey) {
    console.error("Set OLD_SECRETS_ENCRYPTION_KEY (the current key) and SECRETS_ENCRYPTION_KEY (the new one).");
    process.exit(2);
  }
  if (oldKey === newKey) {
    console.error("The old and the new key are the same: make a new one with `openssl rand -hex 32`.");
    process.exit(2);
  }

  const rows = await prisma.orgSecret.findMany({ select: { id: true, encryptedKey: true } });
  const fresh: { id: string; blob: object }[] = [];
  const failed: string[] = [];
  for (const r of rows) {
    try {
      const plain = decryptSecretWith(r.encryptedKey, oldKey);
      const blob = encryptSecretWith(plain, newKey);
      // Prove the new blob opens with the new key before anything is written.
      if (decryptSecretWith(blob, newKey) !== plain) throw new Error("round trip");
      fresh.push({ id: r.id, blob });
    } catch {
      failed.push(r.id);
    }
  }

  console.log(`OrgSecret rows: ${rows.length}. Open with the old key: ${fresh.length}. Do not: ${failed.length}.`);
  if (failed.length > 0) {
    console.error(`Nothing written. These rows do not open with the old key: ${failed.join(", ")}`);
    process.exit(1);
  }
  if (!write) {
    console.log("Dry run: nothing written. Run again with --write to re-encrypt.");
    return;
  }
  await prisma.$transaction(fresh.map((f) => prisma.orgSecret.update({ where: { id: f.id }, data: { encryptedKey: f.blob } })));
  console.log(`Re-encrypted ${fresh.length} secrets. Now put the new key in the app's .env and run: pm2 reload workwrk --update-env`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
