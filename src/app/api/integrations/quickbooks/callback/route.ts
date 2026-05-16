import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId } from "@/lib/api-helpers";
import { exchangeCodeForTokens } from "@/lib/integrations/quickbooks";

/**
 * OAuth callback. QuickBooks redirects here with `code`, `state`,
 * and `realmId` query params after the user consents. We verify
 * the state cookie, exchange the code for tokens, and persist the
 * result on an `Integration` row scoped to the org.
 *
 * Failure modes are deliberately surfaced as querystring messages
 * on a redirect to the Integrations page so the user can see what
 * happened — never silent.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const errorParam = url.searchParams.get("error");

  const finalRedirect = (params: Record<string, string>) =>
    NextResponse.redirect(
      new URL(`/financials/integrations?${new URLSearchParams(params)}`, url.origin),
    );

  if (errorParam) {
    return finalRedirect({ provider: "quickbooks", error: errorParam });
  }
  if (!code || !state || !realmId) {
    return finalRedirect({ provider: "quickbooks", error: "missing_oauth_params" });
  }

  const cookie = req.cookies.get("qb_oauth_state")?.value;
  if (!cookie) {
    return finalRedirect({ provider: "quickbooks", error: "missing_state_cookie" });
  }
  let parsed: { orgId?: string; state?: string };
  try {
    parsed = JSON.parse(cookie);
  } catch {
    return finalRedirect({ provider: "quickbooks", error: "bad_state_cookie" });
  }
  if (parsed.state !== state || parsed.orgId !== orgId) {
    return finalRedirect({ provider: "quickbooks", error: "state_mismatch" });
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, realmId);
  } catch (e: any) {
    console.error("[quickbooks-callback] token exchange failed:", e);
    return finalRedirect({ provider: "quickbooks", error: "token_exchange_failed" });
  }

  await prisma.integration.upsert({
    where: { type_organizationId: { type: "QUICKBOOKS", organizationId: orgId } },
    create: {
      name: "QuickBooks Online",
      type: "QUICKBOOKS",
      status: "ACTIVE",
      organizationId: orgId,
      config: tokens as any,
    },
    update: {
      status: "ACTIVE",
      config: tokens as any,
      lastSyncAt: null,
    },
  });

  const res = finalRedirect({ provider: "quickbooks", connected: "1" });
  res.cookies.delete("qb_oauth_state");
  return res;
}
