// Who is using the Staff console and their console-local layout state
// (spec-admin-backoffice section 1 "Console preferences", section 3 item 3).
// Server only. Read by the (admin) layout for the first paint and by
// GET /api/admin/me; written by PATCH /api/admin/me/console.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import {
  mergeConsolePrefs,
  readConsolePrefs,
  type ConsolePrefs,
  type ConsolePrefsPatch,
} from "@/lib/admin/console-prefs";

/** A company in Search's RECENT section: only what the row shows. */
export interface RecentCompany {
  id: string;
  name: string;
  plan: string;
  status: string;
}

export interface ConsoleMe {
  staff: { email: string; name: string | null };
  prefs: ConsolePrefs;
  recents: RecentCompany[];
  /**
   * False for a local bootstrap staff member with no PlatformAdmin row yet
   * (platform-admin.ts): their layout state has nowhere to persist until
   * they add themselves on Staff.
   */
  persisted: boolean;
}

/**
 * Resolve recent company ids to rows, in the stored order. A company that
 * has since been deleted simply drops out: RECENT never shows a dangling id.
 */
export async function resolveRecents(ids: readonly string[]): Promise<RecentCompany[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.organization.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, plan: true, status: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: RecentCompany[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r) out.push({ id: r.id, name: r.name, plan: r.plan, status: r.status });
  }
  return out;
}

export async function loadConsoleMe(email: string, fallbackName?: string | null): Promise<ConsoleMe> {
  const lower = email.trim().toLowerCase();
  const row = await prisma.platformAdmin.findUnique({
    where: { email: lower },
    select: { email: true, name: true, consolePrefs: true },
  });
  const prefs = readConsolePrefs(row?.consolePrefs ?? null);
  const recents = await resolveRecents(prefs.recent);
  return {
    staff: { email: row?.email ?? lower, name: row?.name ?? fallbackName ?? null },
    prefs,
    recents,
    persisted: Boolean(row),
  };
}

export type SaveConsolePrefsResult =
  | { ok: true; prefs: ConsolePrefs; recents: RecentCompany[] }
  | { ok: false; status: 409; error: string };

/**
 * Merge a validated patch into the stored prefs. The row is locked for the
 * read-merge-write so two tabs saving at once cannot drop each other's key.
 */
export async function saveConsolePrefs(email: string, patch: ConsolePrefsPatch): Promise<SaveConsolePrefsResult> {
  const lower = email.trim().toLowerCase();
  const saved = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; consolePrefs: unknown }[]>`
      SELECT "id", "consolePrefs" FROM "PlatformAdmin" WHERE "email" = ${lower} FOR UPDATE`;
    const row = locked[0];
    if (!row) return null;
    // RECENT keeps only companies that exist. An id for a deleted company
    // (a stale tab, a hand-made request) is never stored: a dangling id
    // would hold one of the five slots for good. A missing opened company
    // is dropped BEFORE it is pushed, so it cannot evict a real one, and
    // anything already stored that has since been deleted is pruned here.
    let effective = patch;
    if (patch.openedCompany) {
      const exists = await tx.organization.findUnique({ where: { id: patch.openedCompany }, select: { id: true } });
      if (!exists) effective = { ...patch, openedCompany: undefined };
    }
    const merged = mergeConsolePrefs(readConsolePrefs(row.consolePrefs), effective);
    const alive = merged.recent.length
      ? new Set(
          (await tx.organization.findMany({ where: { id: { in: merged.recent } }, select: { id: true } })).map((o) => o.id),
        )
      : new Set<string>();
    const next = { ...merged, recent: merged.recent.filter((id) => alive.has(id)) };
    await tx.platformAdmin.update({
      where: { id: row.id },
      data: { consolePrefs: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  });
  if (!saved) {
    return {
      ok: false,
      status: 409,
      error: "Add yourself on Staff first; until then console settings are not kept.",
    };
  }
  return { ok: true, prefs: saved, recents: await resolveRecents(saved.recent) };
}

/** The signed-in staff member's email: the session claim, else their user row. */
export async function staffEmailOf(
  session: { user?: { id?: string; email?: string | null; name?: string | null } | null } | null | undefined,
): Promise<string | null> {
  const claim = session?.user?.email?.trim();
  if (claim) return claim.toLowerCase();
  const id = session?.user?.id;
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { email: true } });
  return u?.email ? u.email.toLowerCase() : null;
}
