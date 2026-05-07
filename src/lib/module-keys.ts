// Canonical module keys for `Organization.settings.enabledModules`.
// The setup wizard used different ids (`goals`, `onboarding`) than the
// settings UI and sidebar (`kra-kpi`, `checkins`), which broke nav for
// any org that came in via setup. Setup is fixed; this normalizer is
// defense-in-depth so any future client (API consumer, extension,
// migration script) writing the legacy keys gets corrected on the way
// into the DB.

const LEGACY_TO_CANONICAL: Record<string, string> = {
  goals: "kra-kpi",
  onboarding: "checkins",
};

export function normalizeEnabledModules(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const key = LEGACY_TO_CANONICAL[raw] ?? raw;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}
