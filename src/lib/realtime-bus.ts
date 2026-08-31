// In-process realtime bus for SSE (Talk instant push).
//
// The app runs as ONE Node process (`next start`, no cluster), so a
// module-level singleton is reached by every SSE connection AND every publish
// call in the same process. Held on globalThis so Next's dev HMR can't spawn a
// second copy.
//
// Payloads are TRIGGER-ONLY (ids + type), never message bodies: an event just
// says "something changed in conversation X / for user Y", and the client
// refetches through the existing redaction/auth-scoped endpoints. So even a
// mis-scoped emit can never leak content.
//
// SCALE WARNING: in-process pub/sub works ONLY on a single instance. The
// moment pm2 `instances > 1` (cluster) or a second box is added, the bus
// splits and half the connections miss events — swap this for Postgres
// LISTEN/NOTIFY (no new infra) before ever scaling out.

export type RealtimeEvent =
  | { type: "message"; conversationId: string }
  | { type: "notification" }
  | { type: "call"; conversationId: string };

export interface RealtimeConn {
  userId: string;
  conversationIds: Set<string>;
  send: (event: RealtimeEvent) => void;
}

interface Registry {
  byUser: Map<string, Set<RealtimeConn>>;
  byConversation: Map<string, Set<RealtimeConn>>;
}

const g = globalThis as unknown as { __wkRealtime?: Registry };
const registry: Registry = (g.__wkRealtime ??= { byUser: new Map(), byConversation: new Map() });

function add(map: Map<string, Set<RealtimeConn>>, key: string, conn: RealtimeConn) {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(conn);
}

function remove(map: Map<string, Set<RealtimeConn>>, key: string, conn: RealtimeConn) {
  const set = map.get(key);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) map.delete(key);
}

/** Register an SSE connection. Returns an unsubscribe to call on disconnect. */
export function subscribe(conn: RealtimeConn): () => void {
  add(registry.byUser, conn.userId, conn);
  for (const cid of conn.conversationIds) add(registry.byConversation, cid, conn);
  return () => {
    remove(registry.byUser, conn.userId, conn);
    for (const cid of conn.conversationIds) remove(registry.byConversation, cid, conn);
  };
}

export function publishToConversation(conversationId: string, event: RealtimeEvent): void {
  const set = registry.byConversation.get(conversationId);
  if (!set) return;
  for (const conn of set) {
    try { conn.send(event); } catch { /* a dead controller is cleaned up on its own abort */ }
  }
}

export function publishToUser(userId: string, event: RealtimeEvent): void {
  const set = registry.byUser.get(userId);
  if (!set) return;
  for (const conn of set) {
    try { conn.send(event); } catch { /* ignore */ }
  }
}
