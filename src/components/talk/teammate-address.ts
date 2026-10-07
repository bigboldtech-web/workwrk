// Which AI teammate a Talk message asks (docs/plans/ai-teammates-phase2.md
// step 6, Decision 10): only one picked from the @ list, and only while its
// "@Name" is still in the body. A typed or pasted "@Name" asks nobody. One
// teammate per message: the first picked whose name is still there.
//
// Pure.

import { addressedIn } from "@/lib/agents/talk-address";

export interface PickedTeammate {
  slug: string;
  name: string;
}

/** The slug of the teammate the message asks, or undefined when it asks none. */
export function pickTeammateInBody(body: string, picked: readonly PickedTeammate[]): string | undefined {
  return picked.find((t) => addressedIn(body, t.name))?.slug;
}
