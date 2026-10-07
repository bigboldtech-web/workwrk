// Which AI teammate a Talk message asks (docs/plans/ai-teammates-phase2.md
// step 6, Decision 10): only one picked from the @ list, and only while its
// "@Name" is still in the body. A typed or pasted "@Name" asks nobody. One
// teammate per message: the picked one named first in the message.
//
// Pure.

import { addressedAt, addressedIn } from "@/lib/agents/talk-address";

export interface PickedTeammate {
  slug: string;
  name: string;
}

/**
 * The slug of the teammate the message asks, or undefined when it asks none:
 * of the picked teammates still named, the one named first, and at the same
 * place the longer name ("@PM Lead" is never read as "@PM"; review round 1).
 */
export function pickTeammateInBody(body: string, picked: readonly PickedTeammate[]): string | undefined {
  let best: { slug: string; at: number; len: number } | null = null;
  for (const t of picked) {
    const at = addressedAt(body, t.name);
    if (at < 0) continue;
    const len = t.name.trim().length;
    if (!best || at < best.at || (at === best.at && len > best.len)) best = { slug: t.slug, at, len };
  }
  return best?.slug;
}

/** The picks a draft still names: none once it is empty, so a later paste never asks a teammate nobody picked for it. */
export function picksStillNamed(body: string, picked: readonly PickedTeammate[]): PickedTeammate[] {
  if (!body.trim()) return [];
  const kept = picked.filter((t) => addressedIn(body, t.name));
  return kept.length === picked.length ? (picked as PickedTeammate[]) : kept;
}
