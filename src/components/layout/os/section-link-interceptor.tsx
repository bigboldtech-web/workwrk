"use client";

// SectionLinkInterceptor: every same-origin object link that no call site
// converted opens in the section it was followed from.
//
// THE RULE is src/lib/nav/object-href.ts's: from every hub but the Docs and
// Tables storage browsers a doc, table, canvas, form or SOP link opens at
// its Work address; inside those two it keeps the canonical form.
//
// The call sites that build object links map them themselves (useObjectHref,
// objectHrefNow). What they cannot reach is every anchor that carries a URL
// written somewhere else: a link in a Talk message, an AI answer or a task
// comment, a link mark in a read-only doc, a bookmark card, a Space
// bookmark, a URL pasted into a task description, the canonical href stored
// in any row. Without this, each of those would throw a person out of their
// Space into the Docs or Tables hub, one click at a time.
//
// ONE capture-phase click listener on document, registered when the shell
// mounts, so it runs before any page's own capture guard (the sheet's and
// the form builder's Not saved guards). It works in both directions: a
// canonical link clicked in Talk or Work opens in Work, and a Work link
// clicked in the Docs hub stays in Docs. The decision is interceptDecision
// (pure, object-href.ts): a plain primary click on a same-origin <a href>
// whose section form differs from its own href, outside an editable region
// (a link mark in a doc being edited keeps BlockNote's behaviour), not a
// download and not inside data-section-map="off".
//
// It calls preventDefault and never stopPropagation: the anchor's own onClick
// still runs, and next/link sees defaultPrevented and stands down. A new-tab
// target opens the mapped URL in a new tab; everything else asks
// confirmLeave() first, so a Not saved sheet or a dirty form still asks.
//
// NEW TABS AND COPIED ADDRESSES. A cmd, ctrl or shift click, a middle click
// and the context menu's Open link in new tab and Copy link address never
// run a page's click handler: the browser follows the anchor's href
// attribute. So three more capture listeners, pointerdown (the primary and
// middle buttons), auxclick (the middle button) and contextmenu, write the
// section form (newTabHref, pure) onto the attribute before the browser
// acts, and the click listener does the same for a modified click that no
// pointer press announced (cmd and Enter on a focused link).
// The attribute matters only at the gesture. A later React render that puts
// the page's own href back changes nothing, and every decision here reads
// the href the PAGE rendered, never one this file wrote: next/link navigates
// to its own href prop, not the attribute, so a link rewritten for a
// cmd-click and then clicked plainly must still be mapped and pushed through
// the router, not handed to next/link with a canonical prop.
// Nothing is ever written inside an editor's DOM (anything under a
// contenteditable root, a read-only BlockNote doc included): ProseMirror
// parses its own DOM back into the document, so a rewritten href there could
// change a link stored in the doc, and stored hrefs are never changed.
//
// WHAT STAYS CANONICAL: a canonical URL typed into the address bar,
// bookmarked or opened from outside the app, for a person who has its hub.
// That is decision B2, the storage browsers keeping their canonical URLs for
// the people who have them. A person without the Docs or Tables hub (or the
// Forms or SOPs app) who lands on one is moved to the Work door by
// CanonicalHubGate (src/components/access/canonical-hub-gate.tsx).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { interceptDecision, newTabHref } from "@/lib/nav/object-href";
import { confirmLeave } from "@/lib/dirty-guard";
import { currentOpenObject } from "./work-placement";

// Anchors whose href attribute a new-tab gesture rewrote: the href the page
// rendered, and the one written over it. Weak, so an anchor React drops
// takes its entry with it.
const rewritten = new WeakMap<HTMLAnchorElement, { rendered: string; written: string }>();

function anchorOf(e: Event): HTMLAnchorElement | null {
  const target = e.target as Element | null;
  const a = target?.closest?.("a[href]");
  return a instanceof HTMLAnchorElement ? a : null;
}

/** The href the page rendered on this anchor, whatever a gesture wrote over it since. */
function renderedHref(a: HTMLAnchorElement): string {
  const attr = a.getAttribute("href") ?? "";
  const w = rewritten.get(a);
  if (w && w.written === attr) return w.rendered;
  // The page has rendered a new href since the rewrite: that one is its own.
  if (w) rewritten.delete(a);
  return attr;
}

/** An href resolved the way the anchor resolves it (`a.href`), so a relative one reads as the browser reads it. */
function resolved(raw: string): string {
  try {
    return new URL(raw, document.baseURI).href;
  } catch {
    return raw;
  }
}

/**
 * Give the anchor's attribute the href this gesture must carry: the section
 * form for a new-tab gesture, and the page's own href for every other one,
 * so a rewrite never outlives the section it was made for.
 */
function retarget(a: HTMLAnchorElement, e: MouseEvent, gesture: "press" | "menu") {
  if (a.closest("[contenteditable]")) return;
  const rendered = renderedHref(a);
  const mapped = newTabHref({
    href: resolved(rendered),
    origin: window.location.origin,
    pathname: window.location.pathname,
    gesture,
    button: e.button,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    isContentEditable: a.isContentEditable,
    download: a.hasAttribute("download"),
    optOut: a.closest('[data-section-map="off"]') !== null,
    open: currentOpenObject(),
  });
  const want = mapped ?? rendered;
  if (a.getAttribute("href") !== want) a.setAttribute("href", want);
  if (mapped) rewritten.set(a, { rendered, written: mapped });
  else rewritten.delete(a);
}

export function SectionLinkInterceptor() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = anchorOf(e);
      if (!a) return;
      const decision = interceptDecision({
        href: resolved(renderedHref(a)),
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
      if (decision.action === "none") {
        // The browser follows the attribute from here: give it this click's form.
        retarget(a, e, "press");
        return;
      }
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
    // The primary button carries a cmd, ctrl or shift click; the middle one
    // opens a new tab. The right button is the context menu's, below.
    const onPress = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      const a = anchorOf(e);
      if (a) retarget(a, e, "press");
    };
    // The middle button only: a right button's auxclick can arrive after the
    // context menu has read the href, and must not put the old one back.
    const onAuxClick = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const a = anchorOf(e);
      if (a) retarget(a, e, "press");
    };
    const onMenu = (e: MouseEvent) => {
      const a = anchorOf(e);
      if (a) retarget(a, e, "menu");
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("auxclick", onAuxClick, true);
    document.addEventListener("contextmenu", onMenu, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("auxclick", onAuxClick, true);
      document.removeEventListener("contextmenu", onMenu, true);
    };
  }, [router]);
  return null;
}
