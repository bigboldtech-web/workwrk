// The pure half of src/hooks/use-local-draft.ts: the key shape, the JSON
// envelope and the one rule ("a draft counts only when it is newer than the
// server row"). No DOM, no React, so vitest proves it in node.

export interface DraftEnvelope<T> {
  /** ISO of when the draft was written. */
  at: string;
  payload: T;
}

export const DRAFT_PREFIX = "workwrk:draft:";

export function draftKey(kind: string, id: string): string {
  return `${DRAFT_PREFIX}${kind}:${id}`;
}

export function serializeDraft<T>(payload: T, now: Date = new Date()): string {
  return JSON.stringify({ at: now.toISOString(), payload } satisfies DraftEnvelope<T>);
}

export function parseDraft<T>(raw: string | null | undefined): DraftEnvelope<T> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const env = v as { at?: unknown; payload?: unknown };
    if (typeof env.at !== "string" || Number.isNaN(new Date(env.at).getTime())) return null;
    if (!("payload" in env)) return null;
    return { at: env.at, payload: env.payload as T };
  } catch {
    return null;
  }
}

/**
 * A draft is worth offering only when it was written AFTER the server's
 * current row was saved. A draft older than the server row means the save
 * that produced the row happened after the draft: the server already has
 * everything the draft has, or more.
 */
export function isDraftNewer(env: DraftEnvelope<unknown>, serverUpdatedAt: string | Date): boolean {
  const draftMs = new Date(env.at).getTime();
  const serverMs = serverUpdatedAt instanceof Date ? serverUpdatedAt.getTime() : new Date(serverUpdatedAt).getTime();
  if (Number.isNaN(draftMs)) return false;
  if (Number.isNaN(serverMs)) return true;
  return draftMs > serverMs;
}
