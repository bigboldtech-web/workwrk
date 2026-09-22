"use client";

// The one client component in the CTA stack, and it is deliberately the
// smallest thing that could be one.
//
// The CTA needs a click handler, so something here has to run in the browser.
// What must NOT cross into the browser is the config: `config.ts` reads the
// Tuesday fixture and the pricing JSON at module scope, so marking the whole
// CTA module "use client" shipped 24 KB of storyboard and price tables into
// every marketing page, including /demo and /contact which render neither.
//
// So the boundary sits here instead: the server resolves the spec (label,
// href, data-cta) and passes three strings across. The fixtures stay on the
// server, every page keeps the same buttons, and the client payload of a page
// that shows no receipt and no story is the handler and nothing else.

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { appHref } from "@/lib/app-url";
import { trackCta } from "./instrumentation";
import "./shell/marketing-shell.css";

export type CtaVariant = "primary" | "outline" | "ghost" | "link" | "quiet";

/**
 * Two heights, and the small one exists for exactly one placement: the phone
 * sticky bar, which the concept sizes at 48px. A 44px button inside a 48px
 * bar is not a bar, it is a button with a hairline round it, and the version
 * that shipped measured 65 while its own comment claimed 48.
 */
export type CtaSize = "default" | "compact";

/** Paths that live on the product host once the split is on. */
const APP_PATHS = ["/signup", "/join", "/login"];

function resolveHref(href: string): string {
  const path = href.split("?")[0];
  return APP_PATHS.includes(path) ? appHref(href) : href;
}

const BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 44,
  paddingInline: 20,
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 500,
  lineHeight: "20px",
  textDecoration: "none",
  whiteSpace: "nowrap",
  transition: "background-color 120ms cubic-bezier(0.2, 0, 0, 1)",
};

const SKIN: Record<CtaVariant, CSSProperties> = {
  // The only filled element in its viewport.
  primary: { background: "var(--os-brand)", color: "var(--os-ink-inv)" },
  // Blue ink on a blue hairline, on white. It is NOT a filled element, so it
  // can share a viewport with the page's one primary, and it still reads as
  // the main door where the page's own primary is somewhere else: the
  // navigation, which is on screen above every hero on the site.
  outline: { background: "transparent", color: "var(--os-brand-deep)", border: "1px solid var(--os-brand)" },
  ghost: { background: "transparent", color: "var(--os-ink)", border: "1px solid var(--os-line-strong)" },
  link: { background: "transparent", color: "var(--os-brand-deep)", height: "auto", paddingInline: 0 },
  // The same link, in ink.
  //
  // It exists for the navigation, and the navigation is the reason the
  // whole site could not keep its colour rule. "Colour is almost absent:
  // near black on white, one blue at most once per screen" is a rule about
  // a VIEWPORT, and the nav is in every viewport on the site: a blue "Log
  // in", a blue bordered "Start free" and the page's own blue button put
  // three blues in the first screen of the home page. The doors have not
  // moved and neither have their measurement ids; they are ink now, and
  // the page's one button is the only blue a visitor sees.
  quiet: { background: "transparent", color: "var(--os-ink)", height: "auto", paddingInline: 0 },
};

const COMPACT: CSSProperties = { height: 40, paddingInline: 16, fontSize: 15 };

export function CtaLink({
  label,
  href,
  dataCta,
  variant = "primary",
  size = "default",
  children,
  className,
}: {
  label: string;
  href: string;
  dataCta: string;
  variant?: CtaVariant;
  size?: CtaSize;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={resolveHref(href)}
      data-cta={dataCta}
      onClick={() => trackCta(dataCta)}
      className={`mk-focus${className ? ` ${className}` : ""}`}
      style={{
        ...BASE,
        ...SKIN[variant],
        ...(size === "compact" && variant !== "link" && variant !== "quiet" ? COMPACT : null),
      }}
    >
      {children ?? label}
    </Link>
  );
}
