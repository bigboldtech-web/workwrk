// The org switch "AI features for members" (settings-architecture section 5,
// Data > Retention and privacy), stored at Organization.settings.data.aiEnabled.
//
// Default ON. The key is read wherever it matters (access rule 2 for the `ai`
// app key, /api/boot for the shell's Ask AI entry points, /api/ai/status) and
// every reader tolerates the key, or the whole `data` section, being absent:
// only an explicit `false` turns the assistant off. The Phase 8 Data page is
// the writer.

export function aiEnabledFromSettings(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return true;
  const data = (settings as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return true;
  return (data as Record<string, unknown>).aiEnabled !== false;
}
