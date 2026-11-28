// A tool's saved login is kept sealed (pen test 2026-11-28, V-27): every
// company's shared usernames and passwords sat readable in the database and
// in every backup, while the app sealed its other secrets. Sealed with the
// connector-token seal (AES-256-GCM, src/lib/secrets-crypto.ts), and listed
// in SEALED_COLUMNS so a key rotation moves them with the rest. A login saved
// before this is read as it is and sealed the first time it is opened.
//
// Server-only.

import { openToken, sealToken, type Sealed } from "@/lib/connectors/seal";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

export type ToolLogin = Record<string, unknown>;

export function isSealedLogin(v: unknown): v is Sealed {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const b = v as Record<string, unknown>;
  return b.v === 1 && typeof b.iv === "string" && typeof b.ct === "string" && typeof b.tag === "string";
}

/** The login as typed: opened when sealed, as stored when it predates the seal; null when none or unreadable. */
export function openLogin(stored: unknown): ToolLogin | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  if (!isSealedLogin(stored)) return stored as ToolLogin;
  try {
    const parsed = JSON.parse(openToken(stored)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ToolLogin) : null;
  } catch (err) {
    console.error("[tool-credentials] a saved login did not open", err);
    return null;
  }
}

/**
 * The login as it is stored: sealed. With no encryption key configured the
 * seal throws, and the login is kept as typed (as before) rather than the
 * save failing, and the failure is logged.
 */
export function sealLogin(login: ToolLogin): ToolLogin | Sealed {
  try {
    return sealToken(JSON.stringify(login));
  } catch (err) {
    console.error("[tool-credentials] no key to seal a saved login; kept as typed", err);
    return login;
  }
}

/**
 * Seal every login in these rows that predates the seal; an empty one is
 * cleared. Each write only lands while the row still holds what was read, so
 * a save made meanwhile is never overwritten. Never throws.
 */
export async function sealLegacyLogins(rows: ReadonlyArray<{ id: string; credentials: unknown }>): Promise<void> {
  for (const r of rows) {
    if (!r.credentials || typeof r.credentials !== "object" || Array.isArray(r.credentials) || isSealedLogin(r.credentials)) continue;
    const login = r.credentials as ToolLogin;
    const empty = !Object.values(login).some((v) => typeof v === "string" && v.trim().length > 0);
    const next = empty ? null : sealLogin(login);
    if (next && !isSealedLogin(next)) return; // no key: nothing can be sealed now
    try {
      await prisma.tool.updateMany({
        where: { id: r.id, credentials: { equals: r.credentials as object } },
        data: { credentials: next === null ? Prisma.DbNull : (next as object) },
      });
    } catch (err) {
      console.error("[tool-credentials] sealing an older login failed", err);
    }
  }
}
