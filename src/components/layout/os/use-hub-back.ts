"use client";

// The BackButton target of the pages that know nothing better (back-map 0):
// the in-shell 404, the error boundary and the denial views fall back to
// the current hub's defaultHref, labelled with the hub. Reads the shell for
// the Talk-module branch of `hubHref` when it is mounted, and the static
// table otherwise, so the same hook works inside and outside the frame.

import { useContext } from "react";
import { usePathname } from "next/navigation";
import { hubDefaultHref, resolveHub } from "@/lib/nav/route-hub";
import { HUB_LABELS } from "@/lib/nav/labels";
import { OsShellContext } from "./shell-context";

export function useHubBack(): { fallbackHref: string; label: string; hub: ReturnType<typeof resolveHub> } {
  const pathname = usePathname() || "/";
  const shell = useContext(OsShellContext);
  // An unknown path resolves to Work (route-hub rule 3); a settings path to
  // Settings, whose landing is the personal door for everyone but admins.
  // A hub this viewer does not have (a Member on a Teams URL) would send them
  // to a second 404, so the button falls back to Work instead.
  const resolved = resolveHub(pathname);
  const visible = !shell || resolved === "settings" || shell.railApps.some((a) => a.key === resolved);
  const hub = visible ? resolved : "home";
  const fallbackHref = shell ? shell.hubHref(hub) : hubDefaultHref(hub);
  return { fallbackHref, label: HUB_LABELS[hub], hub };
}
