// The six departments every new workspace starts with (seedOrgDefaults).
// Pure, so a client surface can tell the seeded set from one a person made:
// the Overview setup card ticks "Review your departments" only once the
// list is no longer exactly this one.

export const DEFAULT_DEPARTMENTS = ["Engineering", "Sales", "Marketing", "Operations", "HR", "Finance"] as const;

/** True while the department names are exactly the seeded six (in any order and case). */
export function isSeededDepartmentSet(names: readonly string[]): boolean {
  if (names.length !== DEFAULT_DEPARTMENTS.length) return false;
  const want = new Set(DEFAULT_DEPARTMENTS.map((n) => n.toLowerCase()));
  return names.every((n) => want.has(n.trim().toLowerCase())) && new Set(names.map((n) => n.trim().toLowerCase())).size === want.size;
}
