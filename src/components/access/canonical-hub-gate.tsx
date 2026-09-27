"use client";

// CanonicalHubGate: decision B3 on the canonical object routes
// (/docs/[id], /tables/[id], /canvas/[id], /forms/[id], /sops/[id]).
//
// Docs and Tables are storage browsers, and an org can take them off a
// person's rail (Settings > Admin > Apps), or switch off or floor the folded
// Forms and SOPs apps. Such a person may still land on a canonical address:
// an old bookmark, a link pasted in from outside, a stored href nothing
// mapped. They are moved to the item's Work door (canonicalRedirect in
// src/lib/nav/object-href.ts), keeping the query and the hash, and the door
// places the item for them: at its Space-scoped address when they can see
// its path, in place when they cannot, and the in-shell not-found, with
// nothing named, when they cannot read it at all. Work addresses never send
// anyone to a canonical one, so the two can never bounce. People who have
// the hub and the app see no change at all: this renders its children.
//
// The redirect is computed from canonicalHref(kind, id), the object's own
// address, not from the pathname: each [id] segment this wraps holds only
// the object's page. The public form (/forms/[id]/respond) lives in the
// (public) group and never passes through here. A child route added under
// one of these segments later would need the pathname instead, since
// canonicalRedirect refuses deeper paths.
//
// THE ANSWER IS READY AT FIRST RENDER. The shell mounts only after the
// session and GET /api/boot have both resolved, and its rail (railApps, the
// same set isHubVisible reads) and its launcher apps are derived from the
// boot preferences, so nothing here waits or flashes.
//
// IT IS DECIDED ONCE PER OBJECT. A rail that changes while the item is open
// (an admin hiding the Docs hub) never swaps a mounted editor, which may
// hold unsaved work, for a redirect: the person is moved at their next
// navigation, exactly as the Work placement never unmounts an editor it has
// shown (src/components/layout/os/work-placement.tsx). While it moves
// someone it renders RouteLoadingView and no editor mounts, and it calls
// router.replace once per mount, in the shape work-placement.tsx uses.

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useOsShell } from "@/components/layout/os/shell-context";
import { RouteLoadingView } from "@/components/layout/os/route-loading-view";
import { canonicalHref, canonicalRedirect, type ObjectKind } from "@/lib/nav/object-href";

export function CanonicalHubGate({ kind, id, children }: { kind: ObjectKind; id: string; children: ReactNode }) {
  const router = useRouter();
  const { railApps, launcherApps } = useOsShell();
  const live = useMemo(() => {
    const rail = new Set(railApps.map((a) => a.key));
    const launcher = new Set(launcherApps.map((a) => a.key));
    return canonicalRedirect(
      canonicalHref(kind, id),
      { hub: (h) => rail.has(h), app: (key) => launcher.has(key) },
      [kind],
    );
  }, [railApps, launcherApps, kind, id]);

  // The first answer for this object, kept for as long as it is open (see
  // the header). Stored from render, React's "information from previous
  // renders" pattern, so nothing reads a ref during render.
  const objectKey = `${kind}:${id}`;
  const [decided, setDecided] = useState(() => ({ key: objectKey, to: live }));
  if (decided.key !== objectKey) setDecided({ key: objectKey, to: live });
  const to = decided.key === objectKey ? decided.to : live;

  const sent = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!to || sent.current === to) return;
    sent.current = to;
    router.replace(`${to}${window.location.search}${window.location.hash}`, { scroll: false });
  }, [to, router]);

  if (to) return <RouteLoadingView />;
  return <>{children}</>;
}
