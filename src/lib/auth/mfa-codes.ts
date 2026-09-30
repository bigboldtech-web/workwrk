// Two step verification codes, shared by every route and dialog that takes
// one (enrol, turn off, backup codes, the login step). One normaliser, so a
// pasted "123 456" or "abcd efgh" means the same thing everywhere
// (spec-account-auth: "both accept a 6 digit code or an 8 character backup
// code, both strip spaces and hyphens").
//
// Backup codes are 8 characters from an unambiguous alphabet, shown and
// stored as "ABCD-EFGH" (bcrypt hashed at rest). They are drawn from the
// platform CSPRNG; the old Math.random() source is gone.

import { randomInt } from "node:crypto";
import { normaliseMfaCode } from "./login-messages";

export const BACKUP_CODE_COUNT = 8;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The shape the server compares: digits for an app code, "ABCD-EFGH" for a backup code. */
export function normaliseMfaInput(raw: string): string {
  return normaliseMfaCode(raw);
}

export type MfaCodeKind = "totp" | "backup" | "invalid";

/** Which kind of code a normalised value is. */
export function mfaCodeKind(code: string): MfaCodeKind {
  if (/^\d{6}$/.test(code)) return "totp";
  if (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return "backup";
  return "invalid";
}

export function randomBackupCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Eight fresh codes and their bcrypt hashes (the hashes are what is stored). */
export async function generateBackupCodes(): Promise<{ backupCodes: string[]; hashedCodes: string[] }> {
  const bcrypt = await import("bcryptjs");
  const backupCodes: string[] = [];
  const hashedCodes: string[] = [];
  const seen = new Set<string>();
  while (backupCodes.length < BACKUP_CODE_COUNT) {
    const raw = randomBackupCode();
    if (seen.has(raw)) continue;
    seen.add(raw);
    backupCodes.push(raw);
    hashedCodes.push(await bcrypt.hash(raw, 10));
  }
  return { backupCodes, hashedCodes };
}
