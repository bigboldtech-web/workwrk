// The unknown-path door into the in-shell 404 (spec-shell 2.5).
//
// Next only renders a segment's not-found.tsx for a notFound() thrown inside
// that segment, so without this catch-all a typo or a dead link on the app
// host fell through to the chrome-less root 404 and told a signed-in person
// to log in. This page matches every path no static or dynamic route owns
// (Next resolves it last, so it can never shadow a real route) and delegates
// to (dashboard)/not-found.tsx: the same sentence, the same one "Search" link
// and the same BackButton as a not-discoverable object, with the rail,
// sidebar and bar intact (2.4).
//
// A signed-out person gets the one redirect the system has, /login with the
// path as callbackUrl (1.10 rule 2), exactly as any other dashboard route,
// so an unknown path never confirms whether it exists. The marketing host
// never reaches here: under the hard host split src/proxy.ts rewrites its
// unknown paths to the marketing 404.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function UnknownDashboardPath({ params }: { params: Promise<{ rest: string[] }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    const { rest } = await params;
    const path = `/${(rest ?? []).map(encodeURIComponent).join("/")}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);
  }
  notFound();
}
