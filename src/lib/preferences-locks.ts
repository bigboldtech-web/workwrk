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

export const LOCKABLE_PREFERENCE_PATHS = [
  "theme.appearance",
  "theme.accent",
  "density",
  "sidebar.iconsOnly",
  "home.cards",
] as const;

export type LockablePreferencePath = (typeof LOCKABLE_PREFERENCE_PATHS)[number];

export function isLockablePreferencePath(v: unknown): v is LockablePreferencePath {
  return typeof v === "string" && (LOCKABLE_PREFERENCE_PATHS as readonly string[]).includes(v);
}

/** The four lock switches the Appearance defaults card renders, each owning its paths. */
export const PREFERENCE_LOCK_GROUPS: ReadonlyArray<{ key: "theme" | "density" | "sidebar" | "home"; paths: readonly LockablePreferencePath[] }> = [
  { key: "theme", paths: ["theme.appearance", "theme.accent"] },
  { key: "density", paths: ["density"] },
  { key: "sidebar", paths: ["sidebar.iconsOnly"] },
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

/** Whether a preference row is locked, given the effective lockedKeys. */
export function isPreferenceLocked(lockedKeys: readonly string[] | null | undefined, path: LockablePreferencePath): boolean {
  return !!lockedKeys && lockedKeys.includes(path);
}
