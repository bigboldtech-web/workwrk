// The two AI features a workspace turns on for itself (Batch 8), stored next
// to "AI features for everyone" at Organization.settings.data:
//
//   aiFields       AI fields in Lists (Summary, Sentiment, Categorize,
//                  Translation), filled only when someone asks
//   aiTalkUpdates  scheduled AI updates in Talk channels (a daily standup or
//                  a weekly project update)
//
// Both are OFF unless the key is exactly true, so every workspace that never
// visits the switch keeps today's product. "AI features for everyone"
// (settings.data.aiEnabled, on by default) still wins: with it off, both are
// off whatever their own keys say.

import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";

function dataOf(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  const data = (settings as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}

export function aiFieldsOn(settings: unknown): boolean {
  return aiEnabledFromSettings(settings) && dataOf(settings).aiFields === true;
}

export function aiTalkUpdatesOn(settings: unknown): boolean {
  return aiEnabledFromSettings(settings) && dataOf(settings).aiTalkUpdates === true;
}
