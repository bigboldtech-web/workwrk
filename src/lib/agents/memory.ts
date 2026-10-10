// What an AI teammate remembers (docs/plans/ai-teammates.md 3.8), stored in
// AgentMemory.
//
// TWO SCOPES, and nobody reads anyone else's:
//   person  scopeId = the person's userId. Everything a chat or a routine
//           saves. Only that person's chats and routines read it, so on a
//           workspace teammate one person's memories never reach another.
//   agent   scopeId = the agent's id. Saved only from the Memory tab by a
//           manager of a WORKSPACE teammate, and read by everyone who uses
//           it. A PRIVATE teammate has person memories only.
// A row with a null scopeId is never read: Postgres treats NULLs as distinct,
// so such rows would also defeat the (agentId, scope, scopeId, key) unique
// key. Every query here names its scopeId.
//
// A KEY MATCHES WITHOUT CASE OR EXTRA SPACES ("Report day" is "report  day")
// and is stored in the person's own spelling, tidied. A value is stored as a
// JSON string.
//
// WHAT IS REMEMBERED IS DATA. memoriesForPrompt hands the model a <memory>
// block with every "<" and ">" escaped, so a remembered sentence can never
// close the block or open another, and the system prompt says the block is
// notes, never instructions. Every save and removal from a chat also writes
// a line into the chat (the executor), so a planted memory is seen at once.
//
// Server-only: imports prisma.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { TEAMMATE_ROUTE_ERRORS, TEAMMATE_TOOL_ERRORS, memoryFull } from "./teammate-copy";
import { sharedMemoriesPrint } from "./teammate-print";
import { clampText } from "./clamp";
import { plainData } from "./plain-data";

export const MEMORY_LIMITS = {
  keyMax: 80,
  valueMax: 500,
  /** Memories one person may have with one teammate. */
  perPerson: 100,
  /** Shared memories one workspace teammate may have. */
  perAgent: 100,
  /** At most this many memories go into one prompt... */
  injectCount: 40,
  /** ...and at most this many characters of them. */
  injectChars: 3000,
} as const;

export type MemoryScope = "person" | "agent";

export interface MemoryView {
  id: string;
  key: string;
  value: string;
  scope: MemoryScope;
  /** "chat" | "settings", or null for a row saved before the column. */
  source: string | null;
  createdById: string | null;
  updatedAt: string;
}

/** A key as people write it, tidied: trimmed, inner spaces collapsed. */
function tidyKey(key: string): string {
  return String(key ?? "").trim().replace(/\s+/g, " ");
}

/** The key a memory is matched by: tidied and lowercased. */
export function normaliseKey(key: string): string {
  return tidyKey(key).toLowerCase();
}

/** The stored value as text (a row from before this file may hold any JSON). */
function valueText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function scopeIdOf(scope: MemoryScope, a: { agentId: string; userId: string }): string {
  return scope === "person" ? a.userId : a.agentId;
}

function viewOf(r: { id: string; key: string; value: unknown; scope: string; source?: string | null; createdById?: string | null; updatedAt: Date }): MemoryView {
  return {
    id: r.id,
    key: r.key,
    value: valueText(r.value),
    scope: r.scope === "agent" ? "agent" : "person",
    source: r.source ?? null,
    createdById: r.createdById ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type RememberResult =
  | { ok: true; created: boolean; memory: MemoryView }
  | { ok: false; error: string; gone?: true };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * One read-modify-write at a time for one teammate's memories in one scope:
 * remembering, editing from the Memory tab and forgetting all take it, so
 * none of them acts on a read another has since changed (review rounds 9
 * and 10). Held to the end of the transaction.
 */
async function lockMemories(tx: Tx, agentId: string, scope: MemoryScope, scopeId: string): Promise<void> {
  const lockKey = `agent-memory:${agentId}:${scope}:${scopeId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

/**
 * Remember one fact: the memory with the same key (matched without case) is
 * replaced, else a new one is added, up to MEMORY_LIMITS for its scope.
 * `userId` is the person whose memories a person-scope fact joins.
 */
export async function rememberFact(a: {
  agentId: string;
  userId: string;
  scope: MemoryScope;
  key: string;
  value: string;
  source: "chat" | "settings";
  createdById: string;
}): Promise<RememberResult> {
  const key = clampText(tidyKey(a.key), MEMORY_LIMITS.keyMax).trim();
  const value = clampText(String(a.value ?? "").trim(), MEMORY_LIMITS.valueMax).trim();
  if (!key || !value) return { ok: false, error: TEAMMATE_TOOL_ERRORS.memoryEmpty };
  const scopeId = scopeIdOf(a.scope, a);
  const match = normaliseKey(key);
  const limit = a.scope === "person" ? MEMORY_LIMITS.perPerson : MEMORY_LIMITS.perAgent;

  // One read-modify-write at a time for these memories: two turns of one
  // teammate for one person (a group chat and its own chat, at once) never
  // both find no match and both add one, as two keys differing only in case
  // or spacing, or pass the limit (review round 9).
  return prisma.$transaction(async (tx) => {
    await lockMemories(tx, a.agentId, a.scope, scopeId);
    const rows = await tx.agentMemory.findMany({
      where: { agentId: a.agentId, scope: a.scope, scopeId },
      select: { id: true, key: true },
    });
    const existing = rows.find((r) => normaliseKey(r.key) === match);
    if (existing) {
      const row = await tx.agentMemory.update({
        where: { id: existing.id },
        data: { key, value, source: a.source, createdById: a.createdById },
      });
      return { ok: true as const, created: false, memory: viewOf(row) };
    }
    if (rows.length >= limit) return { ok: false as const, error: memoryFull(limit, a.scope) };
    const row = await tx.agentMemory.create({
      data: { agentId: a.agentId, scope: a.scope, scopeId, key, value, source: a.source, createdById: a.createdById },
    });
    return { ok: true as const, created: true, memory: viewOf(row) };
  });
}

/**
 * Change one memory's key or value from the Memory tab, in its own scope.
 * The caller has checked whose it is (PATCH /api/agents/memories/[id]). A
 * new key that matches another memory of that scope (without case) replaces
 * that one, as remembering a fact under its key does, in one transaction.
 */
export async function updateMemory(
  row: { id: string; agentId: string; scope: MemoryScope; scopeId: string; key: string },
  patch: { key?: string; value?: string },
  editorId: string,
): Promise<RememberResult> {
  const key = patch.key !== undefined ? clampText(tidyKey(patch.key), MEMORY_LIMITS.keyMax).trim() : row.key;
  const value = patch.value !== undefined ? clampText(String(patch.value).trim(), MEMORY_LIMITS.valueMax).trim() : null;
  if (!key || value === "") return { ok: false, error: TEAMMATE_TOOL_ERRORS.memoryEmpty };
  // Under the lock remembering takes, so a fact a chat adds under this key
  // meanwhile is found and replaced, never left beside it (review round 10).
  return prisma.$transaction(async (tx): Promise<RememberResult> => {
    await lockMemories(tx, row.agentId, row.scope, row.scopeId);
    const rows = await tx.agentMemory.findMany({
      where: { agentId: row.agentId, scope: row.scope, scopeId: row.scopeId },
      select: { id: true, key: true },
    });
    // Forgotten or replaced since the tab read it: nothing to change.
    if (!rows.some((m) => m.id === row.id)) return { ok: false, error: TEAMMATE_ROUTE_ERRORS.memoryNotFound, gone: true };
    const replaced = rows.filter((m) => m.id !== row.id && normaliseKey(m.key) === normaliseKey(key)).map((m) => m.id);
    if (replaced.length > 0) {
      await tx.agentMemory.deleteMany({ where: { id: { in: replaced }, agentId: row.agentId, scope: row.scope, scopeId: row.scopeId } });
    }
    const updated = await tx.agentMemory.update({
      where: { id: row.id },
      data: { key, ...(value !== null ? { value } : {}), source: "settings", createdById: editorId },
    });
    return { ok: true, created: false, memory: viewOf(updated) };
  });
}

/**
 * Forget one of the person's own memories by key. Only person scope, only
 * theirs: a chat can never remove a workspace teammate's shared memories or
 * anyone else's.
 */
export async function forgetFact(a: { agentId: string; userId: string; key: string }): Promise<{ removed: boolean; key: string | null }> {
  const match = normaliseKey(a.key);
  if (!match) return { removed: false, key: null };
  return prisma.$transaction(async (tx) => {
    await lockMemories(tx, a.agentId, "person", a.userId);
    const rows = await tx.agentMemory.findMany({
      where: { agentId: a.agentId, scope: "person", scopeId: a.userId },
      select: { id: true, key: true },
    });
    const hit = rows.find((r) => normaliseKey(r.key) === match);
    if (!hit) return { removed: false, key: null };
    const gone = await tx.agentMemory.deleteMany({ where: { id: hit.id, agentId: a.agentId, scope: "person", scopeId: a.userId } });
    return { removed: gone.count > 0, key: hit.key };
  });
}

/**
 * The memories one person's chat with this teammate reads: theirs, then the
 * teammate's shared ones (workspace teammates only have those), most
 * recently changed first. Never another person's.
 */
export async function listMemories(agentId: string, userId: string, opts: { includeAgent?: boolean } = {}): Promise<MemoryView[]> {
  const includeAgent = opts.includeAgent !== false;
  const [mine, shared] = await Promise.all([
    prisma.agentMemory.findMany({
      where: { agentId, scope: "person", scopeId: userId },
      orderBy: { updatedAt: "desc" },
      take: MEMORY_LIMITS.perPerson,
    }),
    includeAgent
      ? prisma.agentMemory.findMany({
          where: { agentId, scope: "agent", scopeId: agentId },
          orderBy: { updatedAt: "desc" },
          take: MEMORY_LIMITS.perAgent,
        })
      : Promise.resolve([]),
  ]);
  return [...mine, ...shared].map(viewOf);
}

/**
 * The shared memories' print of one teammate (teammate-print.ts
 * sharedMemoriesPrint), the part of a Google allow they are (review round 2
 * of Phase 3): the very rows listMemories reads into every person's turn.
 * `db`: a transaction's client when the caller reads inside one.
 */
export async function sharedMemoriesPrintOf(agentId: string, db: Prisma.TransactionClient = prisma): Promise<string> {
  const rows = await db.agentMemory.findMany({
    where: { agentId, scope: "agent", scopeId: agentId },
    orderBy: { updatedAt: "desc" },
    take: MEMORY_LIMITS.perAgent,
    select: { key: true, value: true },
  });
  return sharedMemoriesPrint(rows);
}

/** The same for several teammates in one read (the Connections card), by teammate id; one with none has the print of none. */
export async function sharedMemoriesPrints(agentIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(agentIds)];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await prisma.agentMemory.findMany({
    where: { agentId: { in: ids }, scope: "agent" },
    orderBy: { updatedAt: "desc" },
    take: ids.length * MEMORY_LIMITS.perAgent,
    select: { agentId: true, scopeId: true, key: true, value: true },
  });
  const byAgent = new Map<string, Array<{ key: string; value: unknown }>>();
  for (const r of rows) {
    // Only a teammate's own shared rows are read into its turns (scopeId is its id).
    if (r.scopeId !== r.agentId) continue;
    const list = byAgent.get(r.agentId) ?? [];
    if (list.length < MEMORY_LIMITS.perAgent) list.push({ key: r.key, value: r.value });
    byAgent.set(r.agentId, list);
  }
  for (const id of ids) out.set(id, sharedMemoriesPrint(byAgent.get(id) ?? []));
  return out;
}

/** One memory as one prompt line: one line, and nothing that can open or close a block. */
function promptLine(m: MemoryView): string {
  const flat = (s: string) => plainData(s).replace(/\s+/g, " ").trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `- ${flat(m.key)}: ${flat(m.value)}`;
}

/**
 * The <memory> block for this person's turn with this teammate, or null when
 * there is nothing to remember: the person's memories first, then the
 * shared ones, newest first, until MEMORY_LIMITS.injectCount rows or
 * injectChars characters.
 */
export async function memoriesForPrompt(agentId: string, userId: string): Promise<string | null> {
  const all = await listMemories(agentId, userId);
  const lines: string[] = [];
  let chars = 0;
  for (const m of all) {
    if (lines.length >= MEMORY_LIMITS.injectCount) break;
    const line = promptLine(m);
    if (chars + line.length > MEMORY_LIMITS.injectChars) break;
    lines.push(line);
    chars += line.length;
  }
  if (lines.length === 0) return null;
  return `<memory>\n${lines.join("\n")}\n</memory>`;
}
