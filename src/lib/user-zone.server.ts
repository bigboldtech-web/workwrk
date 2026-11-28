// The time zone each person reads their notifications in (pen test
// 2026-11-28, V-42): a reminder or an assignment notice said "due Dec 5" on
// the SERVER's clock, which is the wrong day for anyone far from it. Their
// preferred zone (Settings > Preferences, home.locale.timezone), else UTC,
// which is what the server's clock was.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import { validZone } from "@/lib/recurrence";

/** Each person's zone; anyone without one (or unreadable) reads UTC. Never throws. */
export async function zonesOf(userIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds)];
  for (const id of ids) out.set(id, "UTC");
  if (ids.length === 0) return out;
  try {
    const rows = await prisma.userPreference.findMany({ where: { userId: { in: ids } }, select: { userId: true, home: true } });
    for (const r of rows) {
      const zone = validZone((r.home as { locale?: { timezone?: unknown } } | null)?.locale?.timezone);
      if (zone) out.set(r.userId, zone);
    }
  } catch {
    // UTC for everyone: a notice is never held back by a preference read.
  }
  return out;
}
