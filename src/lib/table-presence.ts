// Co-presence on a table (docs/plans/tables.md Phase 5 "20s co-presence poll
// ('Priya is editing' chip)", spec-tables-forms section 2 /tables/[id]
// Realtime). Deliberately NOT a socket and NOT a table in the database: each
// open sheet posts a heartbeat every 20 seconds and reads back who else sent
// one in the last 45. A person who closes the tab simply stops beating and
// drops off within one window. Losing this state (a server restart) costs a
// chip for at most one poll, never data, so it lives in process memory.
//
// Pure except for the module-level map; the route is the only writer.

export interface PresenceEntry {
  userId: string;
  name: string;
  avatar: string | null;
  /** Epoch ms of the last heartbeat. */
  at: number;
}

export const PRESENCE_POLL_MS = 20_000;
export const PRESENCE_TTL_MS = 45_000;
const MAX_TABLES = 5_000;

export class PresenceBoard {
  private byTable = new Map<string, Map<string, PresenceEntry>>();

  beat(tableId: string, entry: PresenceEntry): void {
    let m = this.byTable.get(tableId);
    if (!m) {
      if (this.byTable.size >= MAX_TABLES) this.sweep(entry.at);
      m = new Map();
      this.byTable.set(tableId, m);
    }
    m.set(entry.userId, entry);
  }

  leave(tableId: string, userId: string): void {
    const m = this.byTable.get(tableId);
    if (!m) return;
    m.delete(userId);
    if (m.size === 0) this.byTable.delete(tableId);
  }

  /** Everyone but `userId` seen on the table within the TTL, most recent first. */
  others(tableId: string, userId: string, now: number): PresenceEntry[] {
    const m = this.byTable.get(tableId);
    if (!m) return [];
    const out: PresenceEntry[] = [];
    for (const [id, e] of m) {
      if (now - e.at > PRESENCE_TTL_MS) { m.delete(id); continue; }
      if (id !== userId) out.push(e);
    }
    if (m.size === 0) this.byTable.delete(tableId);
    return out.sort((a, b) => b.at - a.at);
  }

  /** Drop every stale entry (bounded memory for a long-lived process). */
  sweep(now: number): void {
    for (const [tid, m] of this.byTable) {
      for (const [id, e] of m) if (now - e.at > PRESENCE_TTL_MS) m.delete(id);
      if (m.size === 0) this.byTable.delete(tid);
    }
  }
}

/** The chip's words: "Priya is editing", "Priya and Sam are editing", "Priya and 2 others are editing". */
export function presenceLabel(names: readonly string[]): string {
  const first = (n: string) => (n.trim().split(/\s+/)[0] || "Someone");
  if (names.length === 0) return "";
  if (names.length === 1) return `${first(names[0])} is editing`;
  if (names.length === 2) return `${first(names[0])} and ${first(names[1])} are editing`;
  return `${first(names[0])} and ${names.length - 1} others are editing`;
}

const g = globalThis as unknown as { __workwrkTablePresence?: PresenceBoard };
/** One board per server process (survives dev hot reloads). */
export const tablePresence: PresenceBoard = g.__workwrkTablePresence ?? (g.__workwrkTablePresence = new PresenceBoard());
