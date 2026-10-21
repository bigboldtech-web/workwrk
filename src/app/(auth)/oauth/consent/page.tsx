// GET /oauth/consent: the consent page (docs/plans/mcp-server.md 3.4, 6.1;
// the logic is src/lib/oauth/consent.ts). Always shown, even for an app
// already connected; the person chooses the workspace and the access, and
// Allow or Deny posts to /oauth/decision. Also where the decision's refusals
// land (?view=). Renders nothing (a 404) while MCP_OFFERED is unset.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { mcpServes } from "@/lib/mcp/config";
import { MCP_CONSENT_COPY } from "@/lib/mcp/mcp-copy";
import { consentStep } from "@/lib/oauth/consent";
import { consentSession } from "@/lib/oauth/session";
import { OAuthCard } from "../oauth-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: MCP_CONSENT_COPY.pageTitle };

function first(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : null;
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const h = await headers();
  if (!mcpServes(h.get("host"))) notFound();
  const sp = await searchParams;
  const view = await consentStep({ requestToken: first(sp.request), view: first(sp.view), session: consentSession });
  if (view.kind === "redirect") redirect(view.to);
  return (
    <AuthShell panel="none">
      <OAuthCard view={view} />
    </AuthShell>
  );
}
