// Any /account/* path no page owns lands on My settings > Profile
// (spec-account-auth /account/profile, "Who sees it": "/account and any
// unresolved /account/* path"). Nothing under /account/* 404s. Next resolves a
// catch-all last, so this never shadows a real page, and it also catches a
// typo below a real page (/account/security/xyz). The old personal URLs that
// moved (appearance and the rest) answer from next.config.ts and the
// registry twin before this runs, so a moved URL keeps its exact target.
//
// A temporary redirect on purpose: an unknown path is not a permanent move,
// and a later page at that path must not be shadowed by a cached 308.

import { permanentRedirect, redirect } from "next/navigation";
import { settingsRedirectFor, settingsRedirectTarget } from "@/lib/settings-registry";

export const dynamic = "force-dynamic";

export default async function UnknownAccountPath({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  const path = `/account/${(rest ?? []).map(encodeURIComponent).join("/")}`;
  const moved = settingsRedirectFor(path);
  if (moved) permanentRedirect(settingsRedirectTarget(moved));
  redirect("/account/profile");
}
