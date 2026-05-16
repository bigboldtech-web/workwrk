import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId } from "@/lib/api-helpers";
import { exchangeCodeForTokens, resolveTenantId } from "@/lib/integrations/xero";

/**
 * Xero OAuth callback. After consent, Xero redirects here with
 * `code` + `state`. We exchange the code for tokens, then resolve
 * the tenantId by calling /connections (Xero doesn't include it in
 * the OAuth response — it's a separate API call).
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const finalRedirect = (params: Record<string, string>) =>
    NextResponse.redirect(
      new URL(`/financials/integrations?${new URLSearchParams(params)}`, url.origin),
    );

  if (errorParam) return finalRedirect({ provider: "xero", error: errorParam });
  if (!code || !state) return finalRedirect({ provider: "xero", error: "missing_oauth_params" });

  const cookie = req.cookies.get("xero_oauth_state")?.value;
  if (!cookie) return finalRedirect({ provider: "xero", error: "missing_state_cookie" });
  let parsed: { orgId?: string; state?: string };
  try {
    parsed = JSON.parse(cookie);
  } catch {
    return finalRedirect({ provider: "xero", error: "bad_state_cookie" });
  }
  if (parsed.state !== state || parsed.orgId !== orgId) {
    return finalRedirect({ provider: "xero", error: "state_mismatch" });
  }

  try {
    const partial = await exchangeCodeForTokens(code);
    const tenantId = await resolveTenantId(partial.accessToken);
    const tokens = { ...partial, tenantId };

    await prisma.integration.upsert({
      where: { type_organizationId: { type: "XERO", organizationId: orgId } },
      create: {
        name: "Xero",
        type: "XERO",
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
  } catch (e: any) {
    console.error("[xero-callback] failed:", e);
    return finalRedirect({ provider: "xero", error: "token_exchange_failed" });
  }

  const res = finalRedirect({ provider: "xero", connected: "1" });
  res.cookies.delete("xero_oauth_state");
  return res;
}
