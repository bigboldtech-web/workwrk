// GET /oauth/authorize: the OAuth 2.1 authorization endpoint
// (docs/plans/mcp-server.md 3.4; the logic is src/lib/oauth/authorize.ts).
//
// A page rather than a route handler so that every error renders here, in
// the sign-in pages' own frame, with no Location header: an unknown app and
// an unregistered redirect show no link at all, and every other error shows
// a "Back to <app>" link the person may click. Nothing redirects to the app
// by itself (review M1). A good request is stored and the browser moves on
// to the consent page (or to /login first), our own pages only.
// Renders nothing (a 404) while MCP_OFFERED is unset.

import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { authOptions } from "@/lib/auth";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { mcpServes } from "@/lib/mcp/config";
import { MCP_CONSENT_COPY } from "@/lib/mcp/mcp-copy";
import { authorizeStep } from "@/lib/oauth/authorize";
import { OAuthCard } from "../oauth-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: MCP_CONSENT_COPY.pageTitle };

function toQuery(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) for (const x of v) q.append(k, x);
    else if (typeof v === "string") q.append(k, v);
  }
  return q;
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const h = await headers();
  if (!mcpServes(h.get("host"))) notFound();
  const session = await getServerSession(authOptions);
  const view = await authorizeStep(toQuery(await searchParams), {
    ip: clientIpFromHeaders(h) ?? "unknown",
    signedIn: !!(session?.user as { id?: string } | undefined)?.id,
  });
  if (view.kind === "redirect") redirect(view.to);
  return (
    <AuthShell panel="none">
      <OAuthCard view={view} />
    </AuthShell>
  );
}
