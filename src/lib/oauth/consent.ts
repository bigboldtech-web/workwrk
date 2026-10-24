// GET /oauth/consent (docs/plans/mcp-server.md 3.4, 6.1), as one function the
// page renders.
//
//   1. the request is found and not expired, else `expired`;
//   2. a session, else /login with the consent page as the callback;
//   3. freshWorkspaceActor (session.ts), else `stale`, with a link to log in
//      again;
//   4. the workspaces the person may connect this app in (eligibility.ts):
//      a hold on the session's own workspace sends them to the hold page;
//   5. at 20 or more live grants only a workspace where this app is
//      already connected can be chosen (updated in place); none gives
//      `tooManyApps`;
//   6. no eligible workspace gives `noWorkspace`, whose Cancel goes back to
//      the app with access_denied when clicked;
//   7. otherwise the form, the request bound to this viewer with a new csrf
//      token; 60 views a minute per person.
// Always shown, even for an app already connected (Decision 5).
//
// Also the page the decision's refusals land on (`view`): stale, refused,
// expired or tooMany, our fixed sentences only.
//
// Server-only.

import { MFA_HOLD_PAGE, PASSWORD_HOLD_PAGE } from "@/lib/auth/mfa-hold";
import { ISSUER } from "@/lib/mcp/config";
import { MCP_OAUTH_COPY } from "@/lib/mcp/mcp-copy";
import { prisma } from "@/lib/prisma";
import { appLabel } from "./app-label";
import { loginPathFor } from "./authorize";
import { findClient } from "./clients";
import { liveGrantCount, mcpWorkspacesFor, type EligibleWorkspace } from "./eligibility";
import { LIVE_GRANTS_MAX, hostNamesOneApp } from "./grants";
import { consentLimit } from "./limits";
import { redirectHostOf, redirectLabelOf, withParams } from "./redirect-uri";
import { bindViewer, readRequest } from "./requests";
import type { ConsentSession } from "./session";
import { isWellFormed } from "./tokens";

export type ConsentErrorKey = "unknownApp" | "badRedirect" | "expired" | "refused" | "tooMany" | "tooManyApps";

export type ConsentView =
  | { kind: "redirect"; to: string }
  | { kind: "error"; error: ConsentErrorKey }
  | { kind: "stale"; loginHref: string }
  | { kind: "noWorkspace"; cancelHref: string }
  | {
      kind: "form";
      label: string;
      email: string;
      /** Where the person goes back to: an https host, "an app on this computer", "the cursor app". */
      target: string;
      workspaces: Array<Pick<EligibleWorkspace, "id" | "name">>;
      selected: string;
      unavailable: number;
      writeAsked: boolean;
      request: string;
      csrf: string;
      notYouHref: string;
    };

/** The views the decision's refusals may name (`?view=`). */
const LANDING_VIEWS = new Set(["stale", "refused", "expired", "tooMany"]);

export async function consentStep(input: {
  requestToken: string | null;
  view: string | null;
  /** Read only once the request is known to be live (step 2). */
  session: () => Promise<ConsentSession>;
  now?: Date;
}): Promise<ConsentView> {
  const now = input.now ?? new Date();
  const token = isWellFormed("request", input.requestToken) ? input.requestToken : null;
  if (input.view && LANDING_VIEWS.has(input.view)) {
    if (input.view === "stale") return { kind: "stale", loginHref: loginPathFor(token) };
    return { kind: "error", error: input.view as ConsentErrorKey };
  }

  // 1.
  const request = await readRequest(token, now);
  if (!request || !token) return { kind: "error", error: "expired" };
  const client = await findClient(request.clientId);
  if (!client || client.disabledAt) return { kind: "error", error: "unknownApp" };

  // 2 and 3.
  const s = await input.session();
  if (s.kind === "none") return { kind: "redirect", to: loginPathFor(token) };
  if (s.kind === "stale") return { kind: "stale", loginHref: loginPathFor(token) };
  if (!consentLimit(s.userId).ok) return { kind: "error", error: "tooMany" };

  // 4.
  const redirectHost = redirectHostOf(request.redirectUri);
  const elig = await mcpWorkspacesFor({ userId: s.userId, sessionOrgId: s.organizationId, authAt: s.authAt, redirectHost });
  if (elig.ownEnded) return { kind: "stale", loginHref: loginPathFor(token) };
  if (elig.held === "mfa") return { kind: "redirect", to: MFA_HOLD_PAGE };
  if (elig.held === "password") return { kind: "redirect", to: PASSWORD_HOLD_PAGE };

  // 5. At the cap, only a workspace where this app is already connected can
  // be chosen: its grant is updated in place, or (an app its https host
  // names, through another client of it) replaced, and adds nothing, exactly
  // as grantConsent counts (per workspace, never the app anywhere).
  let workspaces = elig.workspaces;
  let unavailable = elig.unavailable;
  if ((await liveGrantCount(s.userId, s.tokenVersion, now)) >= LIVE_GRANTS_MAX) {
    const sameApp = hostNamesOneApp(redirectHost) ? [{ redirectHost }] : [];
    const here = new Set(
      (
        await prisma.oAuthGrant.findMany({ where: { userId: s.userId, revokedAt: null, OR: [{ clientId: client.id }, ...sameApp] }, select: { organizationId: true } })
      ).map((g) => g.organizationId),
    );
    const kept = workspaces.filter((w) => here.has(w.id));
    if (kept.length === 0) return { kind: "error", error: "tooManyApps" };
    unavailable += workspaces.length - kept.length;
    workspaces = kept;
  }

  // 6.
  if (workspaces.length === 0) {
    return {
      kind: "noWorkspace",
      cancelHref: withParams(request.redirectUri, { error: "access_denied", error_description: MCP_OAUTH_COPY.unavailable, state: request.state, iss: ISSUER() }),
    };
  }

  // 7.
  const csrf = await bindViewer(request, s.userId, now);
  if (!csrf) return { kind: "error", error: "expired" };
  const selected = workspaces.some((w) => w.id === s.organizationId) ? s.organizationId : workspaces[0].id;
  return {
    kind: "form",
    label: appLabel(client.name, request.redirectUri),
    email: s.email,
    target: redirectLabelOf(request.redirectUri),
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
    selected,
    unavailable,
    writeAsked: request.scopes.includes("mcp:write"),
    request: token,
    csrf,
    notYouHref: loginPathFor(token),
  };
}
