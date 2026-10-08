// Test-only fixtures for code that still reads the legacy access level (the
// goal rules, the Ask AI tools' caller lookup). The engine folder owns that
// signal, so the tests build and read it through these instead of each
// spelling out `accessLevel` themselves (the G7 lint rule in
// eslint.config.mjs forbids that outside src/lib/access/).

/** A session-shaped object as the goal rules and page gates read it. */
export function legacyTestSession(id: string, level: string, organizationId = "org") {
  return { user: { id, organizationId, accessLevel: level } };
}

/** The row prisma.user returns when a caller's level is selected. */
export function legacyLevelRow(level: string) {
  return { accessLevel: level };
}

/** The level a stored user row carries, for test doubles that answer as the database would. */
export function legacyLevelOfRow(row: { accessLevel?: string | null }): string {
  return row.accessLevel ?? "";
}

/** The level a legacy session carries. */
export function legacyLevelOf(session: { user: { accessLevel?: string } }): string {
  return session.user.accessLevel ?? "";
}
