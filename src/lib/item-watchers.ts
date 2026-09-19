// Task watchers — the two-list rule, pure.
//
// spec-task-detail.md section 2 (Watchers field) settles this: ONE list cannot
// express "stop telling me", because auto-watch would silently re-subscribe
// anyone who comments again. So a task carries two arrays in Item.metadata:
//
//   watchers   — people who are watching
//   unwatchers — people who explicitly stopped, and must never be re-added
//                by an automatic rule
//
// The five ordered rules, quoted from the spec:
//
//   1. auto-watch on acting: creator, every assignee, every commenter and
//      every mentioned person is added to `watchers` when they act, UNLESS
//      their id is in `unwatchers`, in which case nothing happens;
//   2. Unwatch removes you from `watchers` AND adds you to `unwatchers`, so
//      commenting again does not silently re-subscribe you;
//   3. Watch adds you to `watchers` and removes you from `unwatchers`;
//   4. someone else adding you in the picker adds you to `watchers` and
//      removes you from `unwatchers`;
//   5. nobody but you can put your id in `unwatchers`.
//
// Today's `Item.metadata.followers` (written by the create-task modal and read
// by nobody) is READ as `watchers` and written back under the new name, so no
// batch migration is needed and nothing a user already picked is lost.
//
// Pure module: no imports, so vitest loads it in the node environment.

/** The three metadata keys this module owns. */
export const WATCHERS_KEY = "watchers";
export const UNWATCHERS_KEY = "unwatchers";
/** The legacy key the create-task modal wrote; read once, written back as `watchers`. */
export const LEGACY_WATCHERS_KEY = "followers";

export interface WatcherState {
  watchers: string[];
  unwatchers: string[];
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.length > 0 && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Read the two lists out of an `Item.metadata` blob.
 *
 * `followers` is merged into `watchers` (legacy read), and anyone who is in
 * `unwatchers` is never reported as a watcher even if a stale `watchers` or
 * `followers` array still names them: rule 2 is what "removing yourself
 * sticks" means, and the read is the last place it can be honoured.
 */
export function readWatchers(metadata: unknown): WatcherState {
  const md = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
  const unwatchers = ids(md[UNWATCHERS_KEY]);
  const stored = ids(md[WATCHERS_KEY]);
  const legacy = ids(md[LEGACY_WATCHERS_KEY]);
  const merged: string[] = [];
  for (const id of [...stored, ...legacy]) {
    if (!merged.includes(id) && !unwatchers.includes(id)) merged.push(id);
  }
  return { watchers: merged, unwatchers };
}

/** Rule 1: auto-watch on acting. An unwatcher is left alone. */
export function autoWatch(state: WatcherState, actorIds: (string | null | undefined)[]): WatcherState {
  const watchers = [...state.watchers];
  for (const raw of actorIds) {
    if (!raw) continue;
    if (state.unwatchers.includes(raw)) continue;
    if (!watchers.includes(raw)) watchers.push(raw);
  }
  return { watchers, unwatchers: [...state.unwatchers] };
}

/** Rules 3 and 4: watching (by yourself or by someone adding you). */
export function watch(state: WatcherState, userId: string): WatcherState {
  return {
    watchers: state.watchers.includes(userId) ? [...state.watchers] : [...state.watchers, userId],
    unwatchers: state.unwatchers.filter((id) => id !== userId),
  };
}

/** Rule 2: unwatching, which sticks. */
export function unwatch(state: WatcherState, userId: string): WatcherState {
  return {
    watchers: state.watchers.filter((id) => id !== userId),
    unwatchers: state.unwatchers.includes(userId) ? [...state.unwatchers] : [...state.unwatchers, userId],
  };
}

/**
 * Apply a whole `watcherIds` set sent by the picker, on behalf of `actorId`.
 *
 * Rule 5 is the load-bearing half: only the actor may put their OWN id into
 * `unwatchers`. Someone else removing you from the picker takes you off the
 * watcher list but must not silence you for good, so their removal never
 * writes an unwatcher row.
 */
export function applyWatcherIds(state: WatcherState, next: string[], actorId: string): WatcherState {
  const wanted = ids(next);
  const added = wanted.filter((id) => !state.watchers.includes(id));
  const removed = state.watchers.filter((id) => !wanted.includes(id));
  let out: WatcherState = { watchers: wanted, unwatchers: [...state.unwatchers] };
  // Rules 3 and 4: anyone newly added clears their own unwatcher row.
  for (const id of added) out = { watchers: out.watchers, unwatchers: out.unwatchers.filter((u) => u !== id) };
  // Rule 2 + rule 5: only the actor removing themselves writes an unwatcher.
  if (removed.includes(actorId) && !out.unwatchers.includes(actorId)) {
    out = { watchers: out.watchers, unwatchers: [...out.unwatchers, actorId] };
  }
  // A wanted id that is still in unwatchers was never explicitly re-added by
  // this call (it was already a watcher), so honour the opt-out on the way out.
  return {
    watchers: out.watchers.filter((id) => !out.unwatchers.includes(id)),
    unwatchers: out.unwatchers,
  };
}

/**
 * Merge the two lists back into a metadata blob for a wholesale
 * `PATCH { metadata }` write. `followers` is dropped once it has been folded
 * into `watchers`, so the legacy key never disagrees with the new one.
 */
export function writeWatchers(metadata: unknown, state: WatcherState): Record<string, unknown> {
  const md = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
  delete md[LEGACY_WATCHERS_KEY];
  md[WATCHERS_KEY] = state.watchers;
  md[UNWATCHERS_KEY] = state.unwatchers;
  return md;
}

/**
 * Who a comment or status-change notification goes to: watchers minus the
 * actor, never anyone who opted out. Assignment notifications do NOT come
 * through here (being handed work is a different message, spec section 2).
 */
export function notifyTargets(state: WatcherState, actorId: string | null): string[] {
  return state.watchers.filter((id) => id !== actorId && !state.unwatchers.includes(id));
}
