// The server's half of src/lib/tab-workspace.ts: a tab that still shows the
// workspace the person switched away from (in another tab, which moves the
// one session for every tab) names that workspace in x-workspace-id, and the
// shared admin write gates refuse it rather than write the change into the
// workspace the session acts in now (freshWorkspaceActor, and so
// settingsWriteGate; the people routes through staleTabRefusal).
//
// Only a request that names a workspace is checked. No header (an API key,
// the MCP server, a script, the cron, a server action, a page outside the
// dashboard) means no check, and headers() outside a request (a test, the
// cron) reads as no header; Next's own request-time signal (a prerender
// bailing out) is rethrown, never swallowed. A route that names the
// workspace in its body (organizationId, the Computer and Google cards)
// keeps its own check.
//
// Server-only.

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { STALE_TAB_HEADER, TAB_WORKSPACE_HEADER } from "@/lib/tab-workspace";

export const WORKSPACE_CHANGED = "workspace_changed" as const;

/** What a refused tab reads (in the save's own error line, and the shell's strip under the bar). */
export const WORKSPACE_CHANGED_ERROR = "This tab shows another workspace. Reload it to make changes here.";

/** The response header that tells the tab's fetch wrapper to raise the strip. */
export const STALE_TAB_HEADERS: Readonly<Record<string, string>> = { [STALE_TAB_HEADER]: "1" };

/**
 * Does this request come from a tab showing another workspace than the
 * session's? True only when x-workspace-id is present, not empty, and names
 * another workspace than `sessionOrgId`.
 */
export async function tabWorkspaceMismatch(sessionOrgId: string | null | undefined): Promise<boolean> {
  let tab: string | null;
  try {
    tab = (await headers()).get(TAB_WORKSPACE_HEADER);
  } catch (err) {
    // Next's own signals go back to Next (unstable_rethrow, Next 16 docs).
    unstable_rethrow(err);
    // Outside a request scope (a test, the cron, a script): nothing to check.
    return false;
  }
  const named = tab?.trim();
  return !!named && named !== sessionOrgId;
}

/** The refusal: 409, the code the cards already reload on, and the header that raises the strip. */
export function workspaceChangedResponse(extraHeaders?: Record<string, string>): NextResponse {
  return NextResponse.json(
    { error: WORKSPACE_CHANGED_ERROR, code: WORKSPACE_CHANGED },
    { status: 409, headers: { ...STALE_TAB_HEADERS, ...extraHeaders } },
  );
}

/** For a route on no shared gate (the people routes): the refusal to send, or null to go on. */
export async function staleTabRefusal(sessionOrgId: string | null | undefined): Promise<NextResponse | null> {
  return (await tabWorkspaceMismatch(sessionOrgId)) ? workspaceChangedResponse() : null;
}
