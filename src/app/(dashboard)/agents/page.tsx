// AI teammates (/agents, docs/plans/ai-teammates.md 5.1): Chats, Waiting for
// you, Workspace agents and Run history. The page is the hub
// (src/components/agents/agents-hub.tsx); its views and their address
// (?tab=, ?chat=, and the ?agent=&run= links from before) are described
// there. The Suspense boundary is for useSearchParams.

import { Suspense } from "react";
import { AgentsHub } from "@/components/agents/agents-hub";

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentsHub />
    </Suspense>
  );
}
