"use client";

// The client call sites of src/lib/nav/object-href.ts. Client code never
// hard-codes a hub: the section a link is opened from decides its form.
//
//   useObjectHref()     for RENDER-TIME hrefs (a Link's href): the hub from
//                       usePathname(), the open object from the store.
//   objectHrefNow()     for anything that runs LATER than the render that
//   sectionHrefNow()    built it (a click handler, a toast's action, a timer,
//                       a desktop notification): they read the location and
//                       the open object at the moment they run, so a toast
//                       raised in Work and clicked from Docs opens in Docs.
//   copyObjectLink()    the absolute link Copy link puts on the clipboard:
//   shareHrefNow()      the door from Work (never a Space's slug), the
//                       canonical URL from every other hub.
//
// Server components (the Space page, the Folder page) call objectHref(kind,
// id, "home", slug) directly: they render only in Work.

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { resolveHub, type HubKey } from "@/lib/nav/route-hub";
import {
  canonicalHref, objectHrefFor, sectionHrefFor, shareHref, type ObjectKind,
} from "@/lib/nav/object-href";
import { currentOpenObject, useOpenObject } from "./work-placement";

export interface ObjectHrefApi {
  /** The hub the current page belongs to. */
  hub: HubKey;
  /** An object's href in this section (its mounted address when it is the open object). */
  href: (kind: ObjectKind, id: string, spaceSlug?: string | null) => string;
  /** Any stored or server-built href, mapped into this section; non-object hrefs pass through. */
  map: (href: string) => string;
}

export function useObjectHref(): ObjectHrefApi {
  const pathname = usePathname() || "/";
  const open = useOpenObject();
  return useMemo<ObjectHrefApi>(
    () => ({
      hub: resolveHub(pathname),
      href: (kind, id, spaceSlug) => objectHrefFor(kind, id, pathname, open, spaceSlug),
      map: (href) => sectionHrefFor(href, pathname, open),
    }),
    [pathname, open],
  );
}

function pathnameNow(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname || "/";
}

/** The hub of the page as it is right now. */
export function hubNow(): HubKey {
  return resolveHub(pathnameNow());
}

/** An object's href in the section the person is in at this moment. */
export function objectHrefNow(kind: ObjectKind, id: string, spaceSlug?: string | null): string {
  return objectHrefFor(kind, id, pathnameNow(), currentOpenObject(), spaceSlug);
}

/** Any href mapped into the section the person is in at this moment. */
export function sectionHrefNow(href: string): string {
  return sectionHrefFor(href, pathnameNow(), currentOpenObject());
}

/** The absolute share form of an href, taken at the moment of the copy. */
export function shareHrefNow(href: string): string {
  const shared = shareHref(href, hubNow());
  // An href that is already absolute (a file URL, another site) is copied as it is.
  if (!shared.startsWith("/") || shared.startsWith("//")) return shared;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${shared}`;
}

/** The absolute link Copy link copies for an object, taken at the moment of the copy. */
export function copyObjectLink(kind: ObjectKind, id: string): string {
  return shareHrefNow(canonicalHref(kind, id));
}
