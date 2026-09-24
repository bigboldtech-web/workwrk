"use client";

// SectionLinkInterceptor: every same-origin object link that no call site
// converted opens in the section it was clicked in.
//
// The call sites that build object links map them themselves (useObjectHref,
// objectHrefNow). What they cannot reach is every anchor that carries a URL
// written somewhere else: link marks in a read-only doc, bookmark cards,
// comment links, Space bookmarks, a URL pasted into a task description, the
// canonical href stored in any row. Without this, each of those would throw
// a person out of Work into the Docs or Tables hub, one click at a time.
//
// ONE capture-phase click listener on document, registered when the shell
// mounts, so it runs before any page's own capture guard (the sheet's and
// the form builder's Not saved guards). It works in both directions: a
// canonical link clicked in Work stays in Work, and a Work link clicked in
// the Docs hub stays in Docs. The decision is interceptDecision (pure,
// src/lib/nav/object-href.ts): a plain primary click on a same-origin
// <a href> whose section form differs from its own href, outside an editable
// region (a link mark in a doc being edited keeps BlockNote's behaviour), not
// a download and not inside data-section-map="off".
//
// It calls preventDefault and never stopPropagation: the anchor's own onClick
// still runs, and next/link sees defaultPrevented and stands down. A new-tab
// target opens the mapped URL in a new tab; everything else asks
// confirmLeave() first, so a Not saved sheet or a dirty form still asks.
// Modified clicks and middle clicks are the browser's, and a new tab follows
// the link as written; converted call sites write Work hrefs themselves.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { interceptDecision } from "@/lib/nav/object-href";
import { confirmLeave } from "@/lib/dirty-guard";
import { currentOpenObject } from "./work-placement";

export function SectionLinkInterceptor() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const a = target?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      const decision = interceptDecision({
        href: a.href,
        origin: window.location.origin,
        pathname: window.location.pathname,
        button: e.button,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        defaultPrevented: e.defaultPrevented,
        isContentEditable: a.isContentEditable,
        download: a.hasAttribute("download"),
        target: a.getAttribute("target"),
        optOut: a.closest('[data-section-map="off"]') !== null,
        open: currentOpenObject(),
      });
      if (decision.action === "none") return;
      e.preventDefault();
      if (decision.action === "open") {
        window.open(decision.href, "_blank", "noopener,noreferrer");
        return;
      }
      const href = decision.href;
      void confirmLeave().then((ok) => {
        if (ok) router.push(href);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);
  return null;
}
