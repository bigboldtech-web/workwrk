"use client";

// The nav's link list. A client island for one reason: the underline has to
// know which page you are on, and `aria-current="page"` is what drives it in
// CSS. Without this the nav has a hover underline and no active state, which
// is an underline navigation that never tells you where you are.
//
// Everything else about the nav stays on the server.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { trackCta } from "./instrumentation";

export interface NavLinkSpec {
  label: string;
  href: string;
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ links, drawer }: { links: NavLinkSpec[]; drawer?: boolean }) {
  const pathname = usePathname();
  return (
    <>
      {links.map((link) => {
        const current = isActive(pathname, link.href);
        const id = `nav${drawer ? "-mobile" : ""}-${link.href.replace(/^\//, "")}`;
        return (
          <Link
            key={link.href}
            href={link.href}
            className="mk-nav__link mk-focus"
            aria-current={current ? "page" : undefined}
            data-cta={id}
            onClick={() => trackCta(id)}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
