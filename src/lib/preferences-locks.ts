// preferences-locks (settings-architecture 9.3, spec-settings-workspace
// section 3): the lockable preference dot-paths, in ONE place.
//
// Identity > Appearance defaults is the only writer of
// OrgPreference.lockedKeys and may write only these strings; My settings >
// Preferences and the Customize panel read them to grey a row ("Set by your
// workspace"); src/lib/preferences.ts re-stamps each locked path from the
// org default. PATCH /api/org/preferences refuses any other string with a
// 400 naming it, so a typo can never become a lock that silently does
// nothing (or one that locks something nobody meant to).

//
// "sidebar.iconsOnly" is no longer on the list (settings-cleanup Phase 5):
// the rail lost its icons-only mode (design-system 4.1), so its lock froze
// nothing anyone could see. A workspace that locked it still stores the key;
// that key still reads (every reader treats lockedKeys as plain strings) and
// is carried through every later lock change (refusedLockedKeys), so the
// Appearance defaults card never hits a 400 for a key nobody can clear.
export const LOCKABLE_PREFERENCE_PATHS = [
  "theme.appearance",
  "theme.accent",
  "density",
  "home.cards",
] as const;

/** Lock paths the product offered once and no longer does; a stored one is kept, never offered again. */
export const RETIRED_LOCK_PATHS = ["sidebar.iconsOnly"] as const;

export type LockablePreferencePath = (typeof LOCKABLE_PREFERENCE_PATHS)[number];

export function isLockablePreferencePath(v: unknown): v is LockablePreferencePath {
  return typeof v === "string" && (LOCKABLE_PREFERENCE_PATHS as readonly string[]).includes(v);
}

/** The three lock switches the Appearance defaults card renders, each owning its paths. */
export const PREFERENCE_LOCK_GROUPS: ReadonlyArray<{ key: "theme" | "density" | "home"; paths: readonly LockablePreferencePath[] }> = [
  { key: "theme", paths: ["theme.appearance", "theme.accent"] },
  { key: "density", paths: ["density"] },
  { key: "home", paths: ["home.cards"] },
];

/** Split a lockedKeys write into the accepted paths and the unknown strings (tested). */
export function partitionLockedKeys(keys: readonly unknown[]): { ok: LockablePreferencePath[]; unknown: string[] } {
  const ok: LockablePreferencePath[] = [];
  const unknown: string[] = [];
  for (const k of keys) {
    if (isLockablePreferencePath(k)) {
      if (!ok.includes(k)) ok.push(k);
    } else unknown.push(String(k));
  }
  return { ok, unknown };
}

/**
 * The strings in a lockedKeys write that PATCH /api/org/preferences refuses
 * (pure; tested): unknown to the lockable list AND not already stored. A key
 * the workspace already stores (a retired "sidebar.iconsOnly", an older
 * per-card "home.cards.<key>") is carried through, because the card re-sends
 * the whole stored set on every toggle.
 */
export function refusedLockedKeys(next: readonly unknown[], stored: readonly string[] | null | undefined): string[] {
  const { unknown } = partitionLockedKeys(next);
  if (unknown.length === 0) return [];
  const have = new Set(stored ?? []);
  return unknown.filter((k) => !have.has(k));
}

/**
 * The lockedKeys after one lock switch (pure; tested): this group's paths
 * added or removed, every other stored key kept as it was, in its order.
 */
export function nextLockedKeys(current: readonly string[], paths: readonly string[], on: boolean): string[] {
  const set = new Set(current);
  for (const p of paths) {
    if (on) set.add(p);
    else set.delete(p);
  }
  return [...set];
}

/** Whether a preference row is locked, given the effective lockedKeys. */
export function isPreferenceLocked(lockedKeys: readonly string[] | null | undefined, path: LockablePreferencePath): boolean {
  return !!lockedKeys && lockedKeys.includes(path);
}
